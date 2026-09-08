/**
 * Atena Launcher — servidor de API + painel de administração.
 *
 * Sobe dois grupos de rotas:
 *   - públicas  (/api/... e /files/...)  consumidas pelo launcher dos jogadores
 *   - painel    (/admin e /admin/api)    usadas pela staff, exigem login
 */
const express = require('express');
const path = require('path');

const config = require('./config');
const lock = require('./lib/lock');
const auth = require('./lib/auth');
const store = require('./lib/store');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');
const { DEFAULT_CONFIG } = require('./lib/defaults');

const app = express();

// Antes de qualquer coisa: garante que não há outro servidor na mesma pasta.
lock.acquire(config.DATA_DIR);

if (config.TRUST_PROXY) app.set('trust proxy', true);
app.disable('x-powered-by');

// Garante que os arquivos base existam já no primeiro boot.
store.read('config', DEFAULT_CONFIG);
store.read('instances', []);
store.read('news', []);
store.read('users', []);
store.read('players', []);
store.read('log', []);

// Log de acesso opcional (ATENA_LOG_REQUESTS=true), útil para conferir se o
// launcher está mesmo chegando no servidor.
if (String(process.env.ATENA_LOG_REQUESTS || 'false') === 'true') {
    app.use((req, res, next) => {
        const started = Date.now();
        res.on('finish', () => {
            console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started}ms)`);
        });
        next();
    });
}

app.use(auth.attachUser);

app.use('/', publicRoutes);
app.use('/admin/api', adminRoutes);

// Painel: arquivos estáticos + fallback para a SPA.
app.use('/admin', express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));
app.use('/admin', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.get('/', (_req, res) => res.redirect('/admin'));

app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Tratamento de erro: mensagens em português, stack só no log do servidor.
app.use((err, _req, res, _next) => {
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Arquivo maior que o limite de ${config.MAX_UPLOAD_MB} MB.` });
    }
    if (err && err.status && err.status < 500) {
        return res.status(err.status).json({ error: err.message });
    }

    console.error('[erro]', err);
    res.status(500).json({ error: 'Erro interno no servidor. Veja os logs para detalhes.' });
});

const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`Atena Launcher API rodando em http://${config.HOST}:${config.PORT}`);
    console.log(`URL pública configurada: ${config.PUBLIC_URL}`);
    console.log(`Painel: ${config.PUBLIC_URL}/admin`);

    if (auth.users().length === 0) {
        console.log('');
        console.log('>> Nenhuma conta de staff ainda. Abra o painel para criar o primeiro administrador,');
        console.log('   ou rode: npm run criar-usuario');
    }
});

// Uploads de modpack grande podem demorar; o padrão do Node derruba em 5 min.
server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;

function shutdown(signal) {
    console.log(`\n${signal} recebido, encerrando...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
