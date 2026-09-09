/**
 * API pública — é isso que o Atena Launcher consome.
 *
 *   GET  /api/config                      configuração global
 *   GET  /api/articles                    notícias
 *   GET  /api/instances                   modpacks que ESTE jogador pode ver
 *   GET  /api/instances/:id/files         manifesto (path, url, size, hash)
 *   GET  /files/:id/<caminho>             download dos arquivos do modpack
 *
 *   GET  /api/discord/config              se a verificação está ligada
 *   POST /api/discord/start               começa a conexão, devolve a URL
 *   GET  /api/discord/callback            para onde o Discord manda de volta
 *   GET  /api/discord/session/:state      o launcher pergunta se já conectou
 *   POST /api/players/heartbeat           anota o nick de Minecraft em uso
 */
const express = require('express');
const store = require('./../lib/store');
const manifest = require('../lib/manifest');
const discord = require('../lib/discord');
const players = require('../lib/players');
const mcstatus = require('../lib/mcstatus');
const signed = require('../lib/signed');
const { DEFAULT_CONFIG, toLauncherInstance } = require('../lib/defaults');
const { encodePath } = require('../lib/paths');
const { PUBLIC_URL, FILES_DIR, SIGNED_URLS } = require('../config');

const router = express.Router();

// O launcher roda fora do navegador, mas liberar CORS deixa a API utilizável
// a partir do site do servidor (status, contador de jogadores, etc.).
router.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
});

/**
 * Identifica o jogador pelo token que o launcher manda no cabeçalho.
 * Sem token a requisição segue como visitante — o que é o normal enquanto a
 * verificação por Discord estiver desligada.
 */
function attachPlayer(req, _res, next) {
    const header = req.get('x-atena-player');
    req.player = header ? players.fromToken(header) : null;
    next();
}

/** Corta quem foi banido, com a mensagem que a staff escreveu. */
function blockBanned(req, res, next) {
    if (req.player?.banned) {
        return res.status(403).json({
            error: 'banned',
            message: req.player.banReason || 'Seu acesso ao launcher foi bloqueado.'
        });
    }
    next();
}

router.use('/api', express.json(), attachPlayer);

/* ------------------------------------------------------------- config -- */

router.get('/api/config', blockBanned, (req, res) => {
    const config = { ...DEFAULT_CONFIG, ...store.read('config', DEFAULT_CONFIG) };
    const settings = discord.settings();

    // O client_secret nunca sai daqui.
    res.json({
        ...config,
        discord: {
            enabled: settings.enabled,
            required: settings.required,
            linked: !!req.player
        }
    });
});

router.get('/api/articles', (_req, res) => {
    const news = store.read('news', []);
    const published = news
        .filter(item => item.published !== false)
        .sort((a, b) => new Date(b.publish_date) - new Date(a.publish_date))
        .map(({ title, content, author, publish_date }) => ({ title, content, author, publish_date }));

    res.json(published);
});

/* ---------------------------------------------------------- instâncias - */

router.get('/api/instances', blockBanned, (req, res) => {
    const instances = store.read('instances', []);
    const out = {};

    for (const instance of instances) {
        if (instance.enabled === false) continue;
        // O filtro é feito aqui, no servidor: um modpack que este jogador não
        // pode ver simplesmente não existe para ele.
        if (!players.canAccess(instance, req.player)) continue;

        const launcher = toLauncherInstance(instance, PUBLIC_URL);

        // O manifesto vai com a URL assinada porque a minecraft-java-core o
        // busca sozinha, com um fetch sem cabeçalho nenhum — o token do jogador
        // não chega lá. Sem isto, um modpack restrito por cargo daria 404 na
        // hora de instalar, mesmo para quem tem o cargo. A autorização já
        // aconteceu aqui em cima: quem chegou a receber esta URL pode baixar.
        if (SIGNED_URLS) {
            const manifestPath = `/api/instances/${instance.id}/files`;
            launcher.url = `${launcher.url}?${signed.queryFor(manifestPath)}`;
        }

        out[instance.id] = launcher;
    }
    res.json(out);
});

router.get('/api/instances/:id/files', blockBanned, (req, res) => {
    const instances = store.read('instances', []);
    const instance = instances.find(i => i.id === req.params.id);

    // Vale o token do jogador OU a assinatura na própria URL — esta segunda é
    // como a minecraft-java-core chega aqui, já que ela não manda cabeçalhos.
    const assinada = SIGNED_URLS &&
        signed.check(`/api/instances/${req.params.id}/files`, req.query.md5, req.query.expires) === 'ok';

    if (!instance || instance.enabled === false || !(assinada || players.canAccess(instance, req.player))) {
        return res.status(404).json({ error: 'Modpack não encontrado.' });
    }

    const published = manifest.readManifest(instance.id);
    if (!published) {
        // Ainda não publicado: lista vazia é melhor que erro — o launcher
        // baixa só o Minecraft/Forge e abre, em vez de travar.
        return res.json([]);
    }

    // Cada link vai assinado e com prazo: só quem passou pelo filtro de acesso
    // acima consegue um link que abre. Repassar o manifesto adiante deixa de
    // ser um jeito de contornar o controle por cargo, porque o link vence.
    const base = `${PUBLIC_URL}/files/${encodeURIComponent(instance.id)}`;
    const prefix = `/files/${instance.id}`;

    res.json(published.files.map(file => {
        const url = `${base}/${encodePath(file.path)}`;
        return {
            path: file.path,
            // A assinatura é feita sobre o caminho DECODIFICADO, que é o que o
            // nginx enxerga em $uri quando confere.
            url: SIGNED_URLS ? `${url}?${signed.queryFor(`${prefix}/${file.path}`)}` : url,
            size: file.size,
            hash: file.hash
        };
    }));
});

/**
 * Histórico de versões publicadas.
 *
 * Com ?since=N devolve só o que saiu depois da versão N — é assim que o
 * launcher mostra "o que mudou desde a sua última atualização" para quem
 * ficou várias versões para trás.
 */
router.get('/api/instances/:id/changelog', blockBanned, (req, res) => {
    const instances = store.read('instances', []);
    const instance = instances.find(i => i.id === req.params.id);

    if (!instance || instance.enabled === false || !players.canAccess(instance, req.player)) {
        return res.status(404).json({ error: 'Modpack não encontrado.' });
    }

    const since = Number(req.query.since);
    const entries = manifest.history(instance.id);

    res.json(Number.isFinite(since) ? entries.filter(entry => entry.version > since) : entries);
});

/**
 * Status do servidor de Minecraft: quem está online, ping, MOTD.
 *
 * O ping sai daqui, não do launcher: este servidor está ao lado do Minecraft,
 * então é mais confiável, funciona mesmo se a rede do jogador bloquear a porta,
 * e o cache evita que dezenas de launchers abertos virem um flood.
 *
 * O IP consultado é sempre o configurado na instância — nunca um vindo do
 * cliente, senão isto viraria um scanner de portas de graça.
 */
router.get('/api/instances/:id/server-status', blockBanned, async (req, res) => {
    const instances = store.read('instances', []);
    const instance = instances.find(i => i.id === req.params.id);

    if (!instance || instance.enabled === false || !players.canAccess(instance, req.player)) {
        return res.status(404).json({ error: 'Modpack não encontrado.' });
    }

    const { ip, port } = instance.status || {};
    if (!ip) return res.json({ online: false, players: { online: 0, max: 0, sample: [] } });

    res.json(await mcstatus.status(ip, Number(port) || 25565));
});

/** Versão publicada — útil para o site mostrar "modpack v12". */
router.get('/api/instances/:id/version', (req, res) => {
    const published = manifest.readManifest(req.params.id);
    if (!published) return res.status(404).json({ error: 'Modpack ainda não publicado.' });

    res.json({
        instance: published.instance,
        version: published.version,
        publishedAt: published.publishedAt,
        changelog: published.changelog,
        fileCount: published.fileCount,
        totalSize: published.totalSize
    });
});

/* ------------------------------------------------------------ discord -- */

// Conexões em andamento: state -> resultado. Ficam em memória e expiram em
// 10 minutos, então um state abandonado não vira lixo permanente.
const pending = new Map();
const STATE_TTL = 10 * 60 * 1000;

function cleanupPending() {
    const now = Date.now();
    for (const [state, entry] of pending) {
        if (now - entry.createdAt > STATE_TTL) pending.delete(state);
    }
}

function redirectUri() {
    return `${PUBLIC_URL}/api/discord/callback`;
}

router.get('/api/discord/config', (req, res) => {
    const settings = discord.settings();
    res.json({
        enabled: settings.enabled,
        required: settings.required,
        configured: !!(settings.clientId && settings.clientSecret),
        linked: !!req.player,
        player: req.player ? publicPlayer(req.player) : null
    });
});

function publicPlayer(player) {
    // Quem é staff é decidido aqui, não no launcher: assim a lista de cargos
    // da pessoa não precisa sair do servidor, e trocar o cargo de staff é
    // mexer numa configuração, não recompilar o launcher.
    const { staffRoleId } = discord.settings();

    return {
        id: player.id,
        username: player.username,
        globalName: player.globalName,
        avatar: player.avatar,
        inGuild: player.inGuild,
        isStaff: !!staffRoleId && (player.roles || []).includes(staffRoleId),
        banned: !!player.banned,
        banReason: player.banReason || ''
    };
}

router.post('/api/discord/start', (_req, res) => {
    const settings = discord.settings();

    if (!settings.enabled) return res.status(400).json({ error: 'A verificação por Discord está desligada.' });
    if (!settings.clientId || !settings.clientSecret) {
        return res.status(400).json({ error: 'O Discord ainda não foi configurado no painel.' });
    }

    cleanupPending();

    const state = discord.randomState();
    pending.set(state, { status: 'waiting', createdAt: Date.now() });

    res.json({ state, url: discord.authorizeUrl(state, redirectUri()) });
});

/** Página simples que o Discord abre depois que a pessoa aprova. */
function resultPage(title, message, ok) {
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<title>${title}</title><style>
body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
font-family:system-ui,sans-serif;background:#140309;color:#F7EDF1;text-align:center}
.card{max-width:420px;padding:40px 32px}
h1{font-size:22px;margin:0 0 10px;color:${ok ? '#5BD98C' : '#FF6B6B'}}
p{margin:0;font-size:14px;line-height:1.6;color:#B9A0AC}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

router.get('/api/discord/callback', async (req, res) => {
    const { code, state, error } = req.query;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    const entry = state ? pending.get(state) : null;

    if (error) {
        if (entry) entry.status = 'cancelled';
        return res.send(resultPage('Conexão cancelada', 'Você pode fechar esta janela e tentar de novo pelo launcher.', false));
    }

    if (!entry) {
        return res.send(resultPage('Link expirado', 'Essa tentativa de conexão expirou. Volte ao launcher e comece de novo.', false));
    }

    try {
        const tokens = await discord.exchangeCode(code, redirectUri());
        const profile = await discord.identify(tokens.access_token);
        const settings = discord.settings();

        if (settings.requireGuild && !profile.inGuild) {
            entry.status = 'not-in-guild';
            return res.send(resultPage(
                'Você ainda não está no servidor',
                'Entre no Discord do Atena e tente conectar de novo.',
                false
            ));
        }

        const player = players.upsert(profile);

        if (player.banned) {
            entry.status = 'banned';
            entry.message = player.banReason || 'Seu acesso ao launcher foi bloqueado.';
            return res.send(resultPage('Acesso bloqueado', entry.message, false));
        }

        entry.status = 'linked';
        entry.token = players.createToken(player.id);
        entry.player = publicPlayer(player);

        res.send(resultPage(
            `Tudo certo, ${profile.globalName}!`,
            'Pode fechar esta janela — o launcher já reconheceu você.',
            true
        ));
    } catch (err) {
        console.error('[discord] falha ao conectar:', err);
        entry.status = 'error';
        entry.message = err.message;
        res.send(resultPage('Não deu certo', 'Algo falhou ao falar com o Discord. Tente de novo pelo launcher.', false));
    }
});

/** O launcher fica perguntando aqui até a pessoa terminar no navegador. */
router.get('/api/discord/session/:state', (req, res) => {
    const entry = pending.get(req.params.state);
    if (!entry) return res.status(404).json({ status: 'expired' });

    if (entry.status === 'linked') {
        pending.delete(req.params.state);
        return res.json({ status: 'linked', token: entry.token, player: entry.player });
    }

    res.json({ status: entry.status, message: entry.message || '' });
});

/* ----------------------------------------------------------- jogadores - */

/**
 * O launcher avisa qual nick de Minecraft está em uso. É assim que a staff vê
 * no painel quem é quem — o Discord de um lado, o nick do outro.
 */
router.post('/api/players/heartbeat', (req, res) => {
    if (!req.player) return res.status(401).json({ error: 'Sem Discord conectado.' });

    if (req.player.banned) {
        return res.status(403).json({
            error: 'banned',
            message: req.player.banReason || 'Seu acesso ao launcher foi bloqueado.'
        });
    }

    const nickname = String(req.body?.nickname || '').trim().slice(0, 32);
    const player = players.touch(req.player.id, nickname || null);

    res.json({ ok: true, player: player ? publicPlayer(player) : null });
});

/* -------------------------------------------------------------- files -- */

/**
 * Confere a assinatura antes de entregar o arquivo.
 *
 * Em produção o nginx faz esta mesma conta e nem chega aqui — serve o arquivo
 * estático direto, que é o que aguenta um download de 1,6 GB sem ocupar o
 * Node. Este middleware é a rede de segurança para quando o nginx não está na
 * frente: em desenvolvimento, ou se alguém alcançar a porta do Node.
 */
function requireSignature(req, res, next) {
    if (!SIGNED_URLS) return next();

    // req.path chega escapado; a assinatura é sobre o caminho decodificado,
    // igual ao $uri do nginx.
    let decoded;
    try {
        decoded = decodeURIComponent(req.path);
    } catch {
        return res.status(400).type('text/plain').send('Caminho inválido.');
    }

    const result = signed.check(`/files${decoded}`, req.query.md5, req.query.expires);

    if (result === 'expirado') {
        return res.status(410).type('text/plain').send('Este link expirou. Abra o launcher de novo.');
    }
    if (result !== 'ok') {
        return res.status(403).type('text/plain').send('Link inválido.');
    }
    next();
}

// Arquivos do modpack. O manifesto (que é filtrado por cargo) é quem entrega
// os links assinados; sem assinatura válida não passa daqui.
router.use('/files', requireSignature, express.static(FILES_DIR, {
    dotfiles: 'allow',
    etag: true,
    maxAge: '5m',
    fallthrough: false
}));

module.exports = router;
