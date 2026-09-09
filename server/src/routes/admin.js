/**
 * API do painel de administração (tudo abaixo de /admin/api).
 *
 * Regra geral: qualquer staff logada mexe no modpack, nas notícias e na
 * configuração; só quem tem role "admin" gerencia contas de staff.
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const store = require('../lib/store');
const auth = require('../lib/auth');
const manifest = require('../lib/manifest');
const filestore = require('../lib/filestore');
const fetchurl = require('../lib/fetchurl');
const players = require('../lib/players');
const { slugify, normalizeRelative, safeFolderName } = require('../lib/paths');
const { DEFAULT_CONFIG, defaultInstance } = require('../lib/defaults');
const { TMP_DIR, MAX_UPLOAD_MB, FILES_DIR, PUBLIC_URL } = require('../config');

const router = express.Router();

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, TMP_DIR),
        filename: (_req, _file, cb) => cb(null, `up-${crypto.randomUUID()}`)
    }),
    limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

/* ------------------------------------------------------------- utilidades - */

function fail(res, status, message) {
    return res.status(status).json({ error: message });
}

function wrap(handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function instances() {
    return store.read('instances', []);
}

function findInstance(id) {
    const found = instances().find(i => i.id === id);
    if (!found) throw Object.assign(new Error('Modpack não encontrado.'), { status: 404 });
    return found;
}

function logAction(req, action, detail) {
    const entries = store.read('log', []);
    entries.unshift({
        at: new Date().toISOString(),
        user: req.user ? req.user.username : 'sistema',
        action,
        detail: detail || ''
    });
    store.write('log', entries.slice(0, 200));
}

async function cleanupTmp(files) {
    for (const file of files || []) {
        await fsp.rm(file.path, { force: true }).catch(() => {});
    }
}

/* ------------------------------------------------------------------ login - */

router.post('/login', express.json(), wrap(async (req, res) => {
    const ip = req.ip || 'desconhecido';
    if (auth.tooManyAttempts(ip)) {
        return fail(res, 429, 'Muitas tentativas. Espere 15 minutos e tente de novo.');
    }

    const { username, password } = req.body || {};
    if (!username || !password) return fail(res, 400, 'Informe usuário e senha.');

    const user = auth.findUser(username);
    if (!user || !auth.verifyPassword(password, user.password)) {
        auth.registerFailure(ip);
        return fail(res, 401, 'Usuário ou senha incorretos.');
    }

    auth.clearAttempts(ip);
    auth.setSessionCookie(res, auth.createToken(user));
    logAction({ user: auth.publicUser(user) }, 'login', '');
    res.json({ user: auth.publicUser(user) });
}));

router.post('/logout', (_req, res) => {
    auth.clearSessionCookie(res);
    res.json({ ok: true });
});

router.get('/me', (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Não autenticado.', needsSetup: auth.users().length === 0 });
    }
    res.json({ user: req.user, needsSetup: false });
});

/**
 * Criação do primeiro administrador. Só funciona enquanto não existe nenhuma
 * conta — depois disso a rota fecha e novos usuários saem de /users.
 */
router.post('/setup', express.json(), wrap(async (req, res) => {
    if (auth.users().length > 0) return fail(res, 403, 'O painel já foi configurado.');

    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (username.length < 3) return fail(res, 400, 'O usuário precisa de pelo menos 3 caracteres.');
    if (password.length < 8) return fail(res, 400, 'A senha precisa de pelo menos 8 caracteres.');

    const user = {
        id: crypto.randomUUID(),
        username,
        password: auth.hashPassword(password),
        role: 'admin',
        createdAt: new Date().toISOString()
    };

    auth.saveUsers([user]);
    auth.setSessionCookie(res, auth.createToken(user));
    logAction({ user: auth.publicUser(user) }, 'setup', username);
    res.status(201).json({ user: auth.publicUser(user) });
}));

// Daqui para baixo, tudo exige login.
router.use(auth.requireAuth);

/* ---------------------------------------------------------------- config -- */

router.get('/config', (_req, res) => {
    const config = { ...DEFAULT_CONFIG, ...store.read('config', DEFAULT_CONFIG) };

    // O segredo do Discord não volta para a tela; o painel só sabe se ele já
    // foi preenchido alguma vez.
    const { clientSecret, ...discordRest } = config.discord || {};
    res.json({
        ...config,
        discord: { ...discordRest, hasSecret: !!clientSecret },
        redirectUri: `${PUBLIC_URL}/api/discord/callback`
    });
});

router.put('/config', express.json(), wrap(async (req, res) => {
    const current = { ...DEFAULT_CONFIG, ...store.read('config', DEFAULT_CONFIG) };
    const body = req.body || {};

    const next = {
        ...current,
        maintenance: !!body.maintenance,
        maintenance_message: String(body.maintenance_message ?? current.maintenance_message),
        dataDirectory: safeFolderName(body.dataDirectory || current.dataDirectory) || 'Atena',
        client_id: body.client_id ? String(body.client_id).trim() : null,
        rss: body.rss ? String(body.rss).trim() : null
    };

    // A verificação por Discord. O client_secret só é sobrescrito quando o
    // painel manda um valor novo — assim editar as outras opções não apaga o
    // segredo, que nunca é devolvido para a tela.
    const discordBody = body.discord || {};
    next.discord = {
        enabled: !!discordBody.enabled,
        required: !!discordBody.required,
        clientId: String(discordBody.clientId ?? current.discord?.clientId ?? '').trim(),
        clientSecret: discordBody.clientSecret
            ? String(discordBody.clientSecret).trim()
            : (current.discord?.clientSecret || ''),
        guildId: String(discordBody.guildId ?? current.discord?.guildId ?? '').trim(),
        requireGuild: !!discordBody.requireGuild,
        staffRoleId: String(discordBody.staffRoleId ?? current.discord?.staffRoleId ?? '').trim()
    };

    // online aceita boolean (Microsoft/offline) ou a URL do Azuriom.
    if (typeof body.online === 'string' && body.online.trim()) {
        const url = body.online.trim();
        if (!/^https?:\/\/\S+$/.test(url)) return fail(res, 400, 'A URL do AZauth precisa começar com http:// ou https://');
        next.online = url;
    } else {
        next.online = !!body.online;
    }

    store.write('config', next);
    logAction(req, 'config.update', '');
    res.json(next);
}));

/* ------------------------------------------------------------- instâncias - */

router.get('/instances', wrap(async (_req, res) => {
    const out = [];
    for (const instance of instances()) {
        const published = manifest.readManifest(instance.id);
        const status = await manifest.pendingChanges(instance.id);
        const disk = await manifest.diskStats(instance.id);

        out.push({
            ...instance,
            disk,
            pending: status.pending,
            published: published ? {
                version: published.version,
                publishedAt: published.publishedAt,
                publishedBy: published.publishedBy,
                changelog: published.changelog,
                fileCount: published.fileCount,
                totalSize: published.totalSize
            } : null
        });
    }
    res.json(out);
}));

router.post('/instances', express.json(), wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return fail(res, 400, 'Dê um nome ao modpack.');

    const id = slugify(name);
    if (!id) return fail(res, 400, 'Nome inválido. Use letras e números.');
    if (instances().some(i => i.id === id)) return fail(res, 409, 'Já existe um modpack com esse nome.');

    const instance = defaultInstance(id, name);
    store.write('instances', [...instances(), instance]);
    manifest.instanceDir(id);

    logAction(req, 'instance.create', id);
    res.status(201).json(instance);
}));

router.put('/instances/:id', express.json(), wrap(async (req, res) => {
    const current = findInstance(req.params.id);
    const body = req.body || {};

    const updated = {
        ...current,
        displayName: String(body.displayName || current.displayName || current.id),
        enabled: body.enabled !== false,
        loader: {
            minecraft_version: String(body.loader?.minecraft_version || current.loader.minecraft_version).trim(),
            loader_type: String(body.loader?.loader_type || current.loader.loader_type).trim(),
            loader_version: String(body.loader?.loader_version || current.loader.loader_version).trim()
        },
        verify: body.verify !== false,
        ignored: toList(body.ignored, current.ignored),
        backup: toList(body.backup, current.backup),
        access: {
            mode: ['public', 'discord', 'roles', 'players'].includes(body.access?.mode)
                ? body.access.mode
                : 'public',
            roles: toList(body.access?.roles, current.access?.roles),
            players: toList(body.access?.players, current.access?.players)
        },
        whitelist: toList(body.whitelist, current.whitelist),
        whitelistActive: !!body.whitelistActive,
        status: {
            nameServer: String(body.status?.nameServer || current.status.nameServer),
            ip: String(body.status?.ip || current.status.ip).trim(),
            port: Number(body.status?.port || current.status.port) || 25565
        },
        jvm_args: toList(body.jvm_args, current.jvm_args),
        game_args: toList(body.game_args, current.game_args)
    };

    store.write('instances', instances().map(i => (i.id === updated.id ? updated : i)));
    logAction(req, 'instance.update', updated.id);
    res.json(updated);
}));

function toList(value, fallback) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    if (typeof value === 'string') return value.split('\n').map(v => v.trim()).filter(Boolean);
    return fallback || [];
}

router.delete('/instances/:id', auth.requireAdmin, wrap(async (req, res) => {
    const instance = findInstance(req.params.id);

    store.write('instances', instances().filter(i => i.id !== instance.id));
    manifest.deleteManifest(instance.id);
    await fsp.rm(path.join(FILES_DIR, instance.id), { recursive: true, force: true });

    logAction(req, 'instance.delete', instance.id);
    res.json({ ok: true });
}));

/* --------------------------------------------------- arquivos do modpack -- */

router.get('/instances/:id/files', wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    res.json(await filestore.list(instance.id, req.query.path || ''));
}));

router.post('/instances/:id/folder', express.json(), wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    const created = await filestore.makeDir(instance.id, req.body?.path);

    logAction(req, 'files.mkdir', `${instance.id}/${created}`);
    res.json({ path: created });
}));

router.delete('/instances/:id/files', express.json(), wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    const removed = await filestore.remove(instance.id, req.body?.path || req.query.path);

    logAction(req, 'files.delete', `${instance.id}/${removed}`);
    res.json({ path: removed });
}));

/** Upload de arquivos soltos ou de uma pasta inteira (preserva a estrutura). */
router.post('/instances/:id/upload', upload.array('files', 5000), wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    const base = normalizeRelative(req.body?.path || '');

    let relativePaths = [];
    try {
        relativePaths = JSON.parse(req.body?.relativePaths || '[]');
    } catch {
        relativePaths = [];
    }

    const saved = [];
    try {
        for (let i = 0; i < req.files.length; i += 1) {
            const file = req.files[i];
            const relative = normalizeRelative(relativePaths[i] || file.originalname);
            const target = base ? `${base}/${relative}` : relative;
            saved.push(await filestore.placeUpload(instance.id, target, file.path));
        }
    } finally {
        await cleanupTmp(req.files);
    }

    logAction(req, 'files.upload', `${instance.id}: ${saved.length} arquivo(s) em /${base}`);
    res.json({ saved: saved.length, files: saved.slice(0, 50) });
}));

/** Upload de um .zip do modpack — o caminho normal para publicar uma versão. */
router.post('/instances/:id/upload-zip', upload.single('archive'), wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    if (!req.file) return fail(res, 400, 'Envie um arquivo .zip.');

    const destination = normalizeRelative(req.body?.path || '');
    const strip = Number(req.body?.strip || 0) || 0;
    const wipe = String(req.body?.wipe || 'false') === 'true';

    try {
        if (wipe) {
            const dir = manifest.instanceDir(instance.id);
            for (const entry of await fsp.readdir(dir)) {
                await fsp.rm(path.join(dir, entry), { recursive: true, force: true });
            }
            logAction(req, 'files.wipe', instance.id);
        }

        const result = await filestore.extractZip(instance.id, req.file.path, { destination, strip });
        logAction(req, 'files.unzip', `${instance.id}: ${result.extracted} arquivo(s)${wipe ? ' (substituiu tudo)' : ''}`);
        res.json(result);
    } finally {
        await fsp.rm(req.file.path, { force: true }).catch(() => {});
    }
}));

/* ------------------------------------------------------ importar por URL -- */

/**
 * Publica o modpack a partir de um link em vez de um upload.
 *
 * O caminho do navegador — 1,6 GB saindo da internet de casa, atravessando o
 * nginx e o multer — é lento e frágil (foi o que estourou em 502). Aqui o
 * arquivo vai do GitHub direto para a VPS, e o navegador só acompanha.
 *
 * Roda como job pelo mesmo motivo da publicação: baixar e extrair demora mais
 * do que uma requisição HTTP aguenta esperar.
 */
const imports = new Map();

router.post('/instances/:id/import-url', express.json(), wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    const running = imports.get(instance.id);

    if (running && running.state === 'running') {
        return res.status(409).json({ error: 'Já existe uma importação em andamento para este modpack.' });
    }

    const url = String(req.body?.url || '').trim();
    if (!url) return fail(res, 400, 'Cole o link do arquivo .zip.');

    // Falha cedo em URL inválida ou endereço interno: assim o painel mostra o
    // erro na hora, em vez de abrir um job que morre no primeiro passo.
    try {
        await fetchurl.prepare(url);
    } catch (err) {
        return fail(res, err.status || 400, err.message);
    }

    const strip = Number(req.body?.strip || 0) || 0;
    const wipe = req.body?.wipe === true || String(req.body?.wipe) === 'true';
    const destination = normalizeRelative(req.body?.destination || req.body?.path || '');

    const job = {
        state: 'running',
        step: 'baixando',
        received: 0,
        total: 0,
        extracted: 0,
        result: null,
        error: null,
        startedAt: Date.now()
    };
    imports.set(instance.id, job);

    // Responde já; o trabalho continua em segundo plano.
    res.status(202).json({ state: 'running' });

    runImport(req, instance, job, { url, strip, wipe, destination }).catch(err => {
        job.state = 'error';
        job.error = err.message;
        console.error('[import-url]', err);
    });
}));

async function runImport(req, instance, job, { url, strip, wipe, destination }) {
    let downloaded = null;

    try {
        downloaded = await fetchurl.download(url, {
            onProgress: (received, total) => { job.received = received; job.total = total; }
        });

        job.step = 'extraindo';
        job.received = downloaded.size;
        job.total = downloaded.size;

        if (wipe) {
            const dir = manifest.instanceDir(instance.id);
            for (const entry of await fsp.readdir(dir)) {
                await fsp.rm(path.join(dir, entry), { recursive: true, force: true });
            }
            logAction(req, 'files.wipe', instance.id);
        }

        const result = await filestore.extractZip(instance.id, downloaded.path, { destination, strip });

        job.state = 'done';
        job.step = 'pronto';
        job.extracted = result.extracted;
        job.result = { ...result, size: downloaded.size, url: downloaded.url };

        logAction(req, 'files.import-url',
            `${instance.id}: ${result.extracted} arquivo(s) de ${url}${wipe ? ' (substituiu tudo)' : ''}`);
    } finally {
        if (downloaded) await fsp.rm(downloaded.path, { force: true }).catch(() => {});
    }
}

router.get('/instances/:id/import-url', wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    const job = imports.get(instance.id);

    if (!job) return res.json({ state: 'idle' });
    res.json(job);
}));

/** Analisa o zip antes de extrair, para sugerir quantas pastas remover. */
router.post('/instances/:id/inspect-zip', upload.single('archive'), wrap(async (req, res) => {
    findInstance(req.params.id);
    if (!req.file) return fail(res, 400, 'Envie um arquivo .zip.');

    try {
        res.json(await filestore.inspectZip(req.file.path));
    } finally {
        await fsp.rm(req.file.path, { force: true }).catch(() => {});
    }
}));

/* ------------------------------------------------------------- publicação - */

// Publicar relê e faz o SHA-1 do modpack inteiro; em pack grande isso demora
// mais que um request HTTP aguenta. Então roda como job e o painel fica
// perguntando o andamento.
const jobs = new Map();

router.post('/instances/:id/publish', express.json(), wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    const existing = jobs.get(instance.id);

    if (existing && existing.state === 'running') {
        return res.status(202).json({ state: 'running', done: existing.done, total: existing.total });
    }

    const job = { state: 'running', done: 0, total: 0, startedAt: Date.now(), result: null, error: null };
    jobs.set(instance.id, job);

    const changelog = String(req.body?.changelog || '').trim();
    const author = req.user.username;

    const onProgress = (done, total) => { job.done = done; job.total = total; };

    manifest.publish(instance.id, { author, changelog, onProgress })
        .then(({ manifest: published, changed }) => {
            job.state = 'done';
            job.result = {
                version: published.version,
                changed,
                fileCount: published.fileCount,
                totalSize: published.totalSize,
                publishedAt: published.publishedAt
            };
            logAction(req, 'instance.publish', `${instance.id} v${published.version}${changed ? '' : ' (sem mudanças)'}`);
        })
        .catch(err => {
            job.state = 'error';
            job.error = err.message;
            console.error('[publish]', err);
        });

    res.status(202).json({ state: 'running' });
}));

router.get('/instances/:id/publish', wrap(async (req, res) => {
    const instance = findInstance(req.params.id);
    const job = jobs.get(instance.id);

    if (!job) return res.json({ state: 'idle' });
    res.json({ state: job.state, done: job.done, total: job.total, result: job.result, error: job.error });
}));

/* ---------------------------------------------------------------- notícias */

router.get('/news', (_req, res) => res.json(store.read('news', [])));

router.post('/news', express.json(), wrap(async (req, res) => {
    const body = req.body || {};
    if (!String(body.title || '').trim()) return fail(res, 400, 'A notícia precisa de um título.');

    const item = {
        id: crypto.randomUUID(),
        title: String(body.title).trim(),
        content: String(body.content || '').trim(),
        author: String(body.author || req.user.username).trim(),
        publish_date: body.publish_date || new Date().toISOString(),
        published: body.published !== false
    };

    store.write('news', [item, ...store.read('news', [])]);
    logAction(req, 'news.create', item.title);
    res.status(201).json(item);
}));

router.put('/news/:id', express.json(), wrap(async (req, res) => {
    const news = store.read('news', []);
    const current = news.find(n => n.id === req.params.id);
    if (!current) return fail(res, 404, 'Notícia não encontrada.');

    const body = req.body || {};
    const updated = {
        ...current,
        title: String(body.title ?? current.title).trim(),
        content: String(body.content ?? current.content).trim(),
        author: String(body.author ?? current.author).trim(),
        publish_date: body.publish_date || current.publish_date,
        published: body.published !== false
    };

    store.write('news', news.map(n => (n.id === updated.id ? updated : n)));
    logAction(req, 'news.update', updated.title);
    res.json(updated);
}));

router.delete('/news/:id', wrap(async (req, res) => {
    const news = store.read('news', []);
    if (!news.some(n => n.id === req.params.id)) return fail(res, 404, 'Notícia não encontrada.');

    store.write('news', news.filter(n => n.id !== req.params.id));
    logAction(req, 'news.delete', req.params.id);
    res.json({ ok: true });
}));

/* -------------------------------------------------------------- staff ---- */

router.get('/users', auth.requireAdmin, (_req, res) => {
    res.json(auth.users().map(auth.publicUser));
});

router.post('/users', auth.requireAdmin, express.json(), wrap(async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const role = req.body?.role === 'admin' ? 'admin' : 'staff';

    if (username.length < 3) return fail(res, 400, 'O usuário precisa de pelo menos 3 caracteres.');
    if (password.length < 8) return fail(res, 400, 'A senha precisa de pelo menos 8 caracteres.');
    if (auth.findUser(username)) return fail(res, 409, 'Esse usuário já existe.');

    const user = {
        id: crypto.randomUUID(),
        username,
        password: auth.hashPassword(password),
        role,
        createdAt: new Date().toISOString()
    };

    auth.saveUsers([...auth.users(), user]);
    logAction(req, 'user.create', `${username} (${role})`);
    res.status(201).json(auth.publicUser(user));
}));

router.put('/users/:id', auth.requireAdmin, express.json(), wrap(async (req, res) => {
    const users = auth.users();
    const current = users.find(u => u.id === req.params.id);
    if (!current) return fail(res, 404, 'Usuário não encontrado.');

    const body = req.body || {};
    const updated = { ...current };

    if (body.password) {
        if (String(body.password).length < 8) return fail(res, 400, 'A senha precisa de pelo menos 8 caracteres.');
        updated.password = auth.hashPassword(String(body.password));
    }

    if (body.role && body.role !== current.role) {
        const admins = users.filter(u => u.role === 'admin');
        if (current.role === 'admin' && admins.length === 1) {
            return fail(res, 400, 'Precisa sobrar pelo menos um administrador.');
        }
        updated.role = body.role === 'admin' ? 'admin' : 'staff';
    }

    auth.saveUsers(users.map(u => (u.id === updated.id ? updated : u)));
    logAction(req, 'user.update', updated.username);
    res.json(auth.publicUser(updated));
}));

router.delete('/users/:id', auth.requireAdmin, wrap(async (req, res) => {
    const users = auth.users();
    const target = users.find(u => u.id === req.params.id);
    if (!target) return fail(res, 404, 'Usuário não encontrado.');

    if (target.id === req.user.id) return fail(res, 400, 'Você não pode apagar a sua própria conta.');
    if (target.role === 'admin' && users.filter(u => u.role === 'admin').length === 1) {
        return fail(res, 400, 'Precisa sobrar pelo menos um administrador.');
    }

    auth.saveUsers(users.filter(u => u.id !== target.id));
    logAction(req, 'user.delete', target.username);
    res.json({ ok: true });
}));

/** Troca da própria senha — qualquer staff pode. */
router.post('/me/password', express.json(), wrap(async (req, res) => {
    const users = auth.users();
    const current = users.find(u => u.id === req.user.id);
    if (!current) return fail(res, 404, 'Usuário não encontrado.');

    const { currentPassword, newPassword } = req.body || {};
    if (!auth.verifyPassword(String(currentPassword || ''), current.password)) {
        return fail(res, 401, 'Senha atual incorreta.');
    }
    if (String(newPassword || '').length < 8) {
        return fail(res, 400, 'A nova senha precisa de pelo menos 8 caracteres.');
    }

    current.password = auth.hashPassword(String(newPassword));
    auth.saveUsers(users);
    logAction(req, 'user.password', current.username);
    res.json({ ok: true });
}));

/* ----------------------------------------------------------- jogadores -- */

router.get('/players', (_req, res) => {
    // Mais recentes primeiro: quem acabou de entrar aparece no topo.
    const list = [...players.all()].sort((a, b) => new Date(b.lastSeen || 0) - new Date(a.lastSeen || 0));
    res.json(list);
});

router.post('/players/:id/ban', express.json(), wrap(async (req, res) => {
    const banned = req.body?.banned !== false;
    const reason = String(req.body?.reason || '').trim();

    const player = players.setBanned(req.params.id, banned, reason);
    if (!player) return fail(res, 404, 'Jogador não encontrado.');

    logAction(req, banned ? 'player.ban' : 'player.unban', `${player.username}${reason ? ': ' + reason : ''}`);
    res.json(player);
}));

router.delete('/players/:id', auth.requireAdmin, wrap(async (req, res) => {
    const player = players.find(req.params.id);
    if (!player) return fail(res, 404, 'Jogador não encontrado.');

    // Apagar desconecta o Discord: o token que o launcher guarda deixa de valer.
    players.remove(req.params.id);
    logAction(req, 'player.delete', player.username);
    res.json({ ok: true });
}));

/* -------------------------------------------------------------- histórico - */

router.get('/log', (_req, res) => res.json(store.read('log', []).slice(0, 100)));

module.exports = router;
