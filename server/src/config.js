/**
 * Configuração do servidor, lida do ambiente / arquivo .env.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

require('./lib/env').load();

const ROOT = path.resolve(__dirname, '..');

function resolveDir(value, fallback) {
    const dir = path.resolve(ROOT, value || fallback);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const DATA_DIR = resolveDir(process.env.ATENA_DATA_DIR, 'data');
const FILES_DIR = resolveDir(process.env.ATENA_FILES_DIR, 'files');
const TMP_DIR = resolveDir(process.env.ATENA_TMP_DIR, 'tmp');

/**
 * O segredo assina os cookies de sessão do painel. Se não for definido no .env
 * geramos um e guardamos em data/session.key — assim as sessões sobrevivem a
 * um restart do processo em vez de cair a cada deploy.
 */
function sessionSecret() {
    if (process.env.ATENA_SESSION_SECRET) return process.env.ATENA_SESSION_SECRET;

    const keyFile = path.join(DATA_DIR, 'session.key');
    if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();

    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(keyFile, secret, { mode: 0o600 });
    return secret;
}

module.exports = {
    ROOT,
    DATA_DIR,
    FILES_DIR,
    TMP_DIR,
    MANIFESTS_DIR: resolveDir(path.join(DATA_DIR, 'manifests'), 'data/manifests'),

    PORT: Number(process.env.ATENA_PORT || 3000),
    HOST: process.env.ATENA_HOST || '0.0.0.0',

    // URL pública onde este servidor é acessível pelos jogadores.
    // Entra nos links de download do manifesto, então PRECISA estar correta.
    PUBLIC_URL: (process.env.ATENA_PUBLIC_URL || 'http://localhost:3000').replace(/\/+$/, ''),

    SESSION_SECRET: sessionSecret(),
    SESSION_TTL_HOURS: Number(process.env.ATENA_SESSION_TTL_HOURS || 12),

    // true quando o painel está atrás de HTTPS (nginx com certificado).
    SECURE_COOKIES: String(process.env.ATENA_SECURE_COOKIES || 'false') === 'true',

    // Tamanho máximo por arquivo enviado pelo painel, em MB.
    MAX_UPLOAD_MB: Number(process.env.ATENA_MAX_UPLOAD_MB || 4096),

    TRUST_PROXY: String(process.env.ATENA_TRUST_PROXY || 'false') === 'true'
};
