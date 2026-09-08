/**
 * Operações de arquivo do painel: navegar, subir, apagar, criar pasta e
 * extrair .zip dentro de files/<instancia>/.
 *
 * Tudo passa por safeJoin, então nenhum caminho vindo do navegador (ou de
 * dentro de um .zip) consegue escrever fora da pasta da instância.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const StreamZip = require('node-stream-zip');

const { safeJoin, normalizeRelative } = require('./paths');
const { instanceDir } = require('./manifest');

/** Conteúdo de uma pasta, pastas primeiro e em ordem alfabética. */
async function list(instanceId, relative = '') {
    const root = instanceDir(instanceId);
    const dir = safeJoin(root, relative);

    if (!fs.existsSync(dir)) return { path: normalizeRelative(relative), entries: [] };

    const entries = await fsp.readdir(dir, { withFileTypes: true });
    const out = [];

    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        let stat;
        try {
            stat = await fsp.stat(full);
        } catch {
            continue;
        }

        out.push({
            name: entry.name,
            type: entry.isDirectory() ? 'dir' : 'file',
            size: entry.isDirectory() ? null : stat.size,
            modifiedAt: stat.mtime.toISOString()
        });
    }

    out.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name, 'pt-BR');
    });

    return { path: normalizeRelative(relative), entries: out };
}

async function makeDir(instanceId, relative) {
    const target = safeJoin(instanceDir(instanceId), relative);
    await fsp.mkdir(target, { recursive: true });
    return normalizeRelative(relative);
}

async function remove(instanceId, relative) {
    const clean = normalizeRelative(relative);
    if (!clean) throw Object.assign(new Error('Informe o que deve ser apagado.'), { status: 400 });

    const target = safeJoin(instanceDir(instanceId), clean);
    if (!fs.existsSync(target)) throw Object.assign(new Error('Arquivo ou pasta não encontrado.'), { status: 404 });

    await fsp.rm(target, { recursive: true, force: true });
    return clean;
}

/**
 * Move um arquivo temporário do upload para o seu lugar definitivo.
 * O move é atômico dentro do mesmo disco; se o /tmp estiver em outra
 * partição caímos para copiar + apagar.
 */
async function placeUpload(instanceId, relative, tmpFile) {
    const clean = normalizeRelative(relative);
    if (!clean) throw Object.assign(new Error('Nome de arquivo inválido.'), { status: 400 });

    const target = safeJoin(instanceDir(instanceId), clean);
    await fsp.mkdir(path.dirname(target), { recursive: true });

    try {
        await fsp.rename(tmpFile, target);
    } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        await fsp.copyFile(tmpFile, target);
        await fsp.rm(tmpFile, { force: true });
    }
    return clean;
}

/**
 * Extrai um .zip dentro da instância, lendo direto do disco (streaming) para
 * não carregar um modpack inteiro na memória.
 *
 * `strip` remove N níveis de pasta do começo de cada entrada — útil quando o
 * zip vem com um `.minecraft/` ou `meumodpack/` envolvendo tudo.
 */
async function extractZip(instanceId, zipFile, { destination = '', strip = 0 } = {}) {
    const root = instanceDir(instanceId);
    const base = safeJoin(root, destination);
    // skipEntryNameValidation: a validação da lib rejeita qualquer entrada com
    // barra invertida, e o Compress-Archive do PowerShell (o jeito mais comum de
    // zipar no Windows) gera exatamente isso. A proteção contra zip-slip aqui é
    // o safeJoin abaixo, que normaliza as barras e confere a pasta de destino.
    const zip = new StreamZip.async({ file: zipFile, skipEntryNameValidation: true });

    let extracted = 0;
    let skipped = 0;

    try {
        const entries = await zip.entries();

        for (const entry of Object.values(entries)) {
            if (entry.isDirectory) continue;

            let rel = normalizeRelative(entry.name);
            if (strip > 0) {
                const parts = rel.split('/');
                if (parts.length <= strip) { skipped += 1; continue; }
                rel = parts.slice(strip).join('/');
            }
            if (!rel) { skipped += 1; continue; }

            try {
                // safeJoin barra qualquer "../" que venha dentro do zip (zip-slip).
                const target = safeJoin(base, rel);
                await fsp.mkdir(path.dirname(target), { recursive: true });
                await zip.extract(entry.name, target);
                extracted += 1;
            } catch (err) {
                // Uma entrada esquisita não pode derrubar a extração inteira.
                console.warn('[unzip] entrada ignorada:', entry.name, '-', err.message);
                skipped += 1;
            }
        }
    } finally {
        await zip.close().catch(() => {});
    }

    return { extracted, skipped };
}

/** Lê a lista de pastas de primeiro nível de um zip, para sugerir o `strip`. */
async function inspectZip(zipFile) {
    const zip = new StreamZip.async({ file: zipFile, skipEntryNameValidation: true });
    try {
        const entries = Object.values(await zip.entries());
        const roots = new Set();
        let fileCount = 0;

        for (const entry of entries) {
            if (entry.isDirectory) continue;
            fileCount += 1;
            const rel = normalizeRelative(entry.name);
            const first = rel.split('/')[0];
            if (rel.includes('/')) roots.add(first);
            else roots.add('');
        }
        return { fileCount, roots: [...roots] };
    } finally {
        await zip.close().catch(() => {});
    }
}

module.exports = { list, makeDir, remove, placeUpload, extractZip, inspectZip };
