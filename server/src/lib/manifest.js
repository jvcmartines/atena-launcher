/**
 * Geração e publicação do manifesto do modpack.
 *
 * O launcher (minecraft-java-core) espera uma lista de objetos:
 *   [{ path, url, size, hash }]  — hash = SHA-1 do arquivo
 *
 * Ele compara o SHA-1 de cada arquivo local com o do manifesto e baixa só o
 * que mudou. É isso que faz a atualização do modpack ser incremental.
 *
 * Fluxo:
 *   1. A staff sobe/apaga arquivos em  files/<instancia>/
 *   2. Clica em "Publicar" no painel
 *   3. Aqui a gente varre a pasta, calcula os SHA-1 e grava
 *      data/manifests/<instancia>.json
 *   4. Só o manifesto publicado é servido aos jogadores — mexer nos arquivos
 *      sem publicar não quebra quem está jogando.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const { FILES_DIR, MANIFESTS_DIR } = require('../config');

const running = new Map();

function instanceDir(instanceId) {
    const dir = path.join(FILES_DIR, instanceId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function manifestFile(instanceId) {
    return path.join(MANIFESTS_DIR, `${instanceId}.json`);
}

/* ------------------------------------------------------------- varredura -- */

/** Lista recursivamente os arquivos da instância (caminhos relativos, com /). */
async function walk(root, relative = '', out = []) {
    const entries = await fsp.readdir(path.join(root, relative), { withFileTypes: true });

    for (const entry of entries) {
        const rel = relative ? `${relative}/${entry.name}` : entry.name;

        // Symlinks são ignorados: apontariam para fora da pasta da instância.
        if (entry.isSymbolicLink()) continue;

        if (entry.isDirectory()) {
            await walk(root, rel, out);
        } else if (entry.isFile()) {
            const stat = await fsp.stat(path.join(root, rel));
            out.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs });
        }
    }
    return out;
}

async function sha1(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha1');
        const stream = fs.createReadStream(file);
        stream.on('error', reject);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

/**
 * Varre a instância calculando o SHA-1 de cada arquivo.
 * Reaproveita hashes já calculados quando tamanho e data de modificação não
 * mudaram — sem isso, publicar um modpack de 2 GB relia tudo toda vez.
 */
async function scan(instanceId, onProgress) {
    const root = instanceDir(instanceId);
    const files = await walk(root);
    files.sort((a, b) => a.path.localeCompare(b.path));

    const cache = store.read('hashcache', {});
    const next = {};
    const result = [];

    let done = 0;
    for (const file of files) {
        const key = `${instanceId}/${file.path}`;
        const cached = cache[key];

        let hash;
        if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
            hash = cached.hash;
        } else {
            hash = await sha1(path.join(root, file.path));
        }

        next[key] = { size: file.size, mtimeMs: file.mtimeMs, hash };
        result.push({ path: file.path, size: file.size, hash });

        done += 1;
        if (onProgress && done % 50 === 0) onProgress(done, files.length);
    }

    // Mantém no cache as entradas de outras instâncias.
    for (const [key, value] of Object.entries(cache)) {
        if (!key.startsWith(`${instanceId}/`)) next[key] = value;
    }
    store.write('hashcache', next);

    if (onProgress) onProgress(files.length, files.length);
    return result;
}

/* ------------------------------------------------------------ publicação -- */

function readManifest(instanceId) {
    const p = manifestFile(instanceId);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (err) {
        console.error(`[manifest] ${instanceId}.json ilegível:`, err.message);
        return null;
    }
}

function writeManifest(instanceId, manifest) {
    const p = manifestFile(instanceId);
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
    fs.renameSync(tmp, p);
    return manifest;
}

function deleteManifest(instanceId) {
    const p = manifestFile(instanceId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
}

/**
 * Varre a instância e grava um novo manifesto. A versão só sobe quando algo
 * realmente mudou, então republicar sem alterações não força download nenhum.
 */
async function publish(instanceId, { author, changelog, onProgress } = {}) {
    if (running.has(instanceId)) {
        throw Object.assign(new Error('Já existe uma publicação em andamento para esta instância.'), { status: 409 });
    }
    running.set(instanceId, true);

    try {
        const files = await scan(instanceId, onProgress);
        const previous = readManifest(instanceId);
        const signature = signatureOf(files);
        const changed = !previous || previous.signature !== signature;

        const manifest = {
            instance: instanceId,
            version: previous ? (changed ? previous.version + 1 : previous.version) : 1,
            signature,
            publishedAt: changed || !previous ? new Date().toISOString() : previous.publishedAt,
            publishedBy: changed || !previous ? (author || 'desconhecido') : previous.publishedBy,
            changelog: changelog || (previous ? previous.changelog : '') || '',
            fileCount: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
            files
        };

        writeManifest(instanceId, manifest);
        return { manifest, changed };
    } finally {
        running.delete(instanceId);
    }
}

function signatureOf(files) {
    const hash = crypto.createHash('sha1');
    for (const file of files) hash.update(`${file.path}:${file.hash}\n`);
    return hash.digest('hex');
}

/**
 * Comparação rápida (caminho + tamanho) entre o que está em disco e o que foi
 * publicado, para o painel avisar "há mudanças não publicadas" sem precisar
 * reler o modpack inteiro.
 */
async function pendingChanges(instanceId) {
    const manifest = readManifest(instanceId);
    const files = await walk(instanceDir(instanceId));

    if (!manifest) {
        return { published: false, pending: files.length > 0, fileCount: files.length };
    }

    const publishedMap = new Map(manifest.files.map(f => [f.path, f.size]));
    let pending = files.length !== manifest.files.length;

    if (!pending) {
        for (const file of files) {
            if (publishedMap.get(file.path) !== file.size) { pending = true; break; }
        }
    }

    return { published: true, pending, fileCount: files.length };
}

/** Estatísticas da pasta em disco (não do manifesto publicado). */
async function diskStats(instanceId) {
    const files = await walk(instanceDir(instanceId));
    return {
        fileCount: files.length,
        totalSize: files.reduce((sum, f) => sum + f.size, 0)
    };
}

module.exports = {
    instanceDir,
    scan,
    publish,
    readManifest,
    deleteManifest,
    pendingChanges,
    diskStats,
    walk
};
