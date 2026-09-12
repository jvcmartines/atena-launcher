/**
 * Configuração do servidor
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
    return persistentSecret('ATENA_SESSION_SECRET', 'session.key', 48);
}

/**
 * Segredo que assina os links de download. Precisa ser o MESMO configurado no
 * secure_link_md5 do nginx — por isso ele fica num arquivo legível, e não é
 * gerado de novo a cada restart.
 */
function filesSecret() {
    return persistentSecret('ATENA_FILES_SECRET', 'files.key', 32);
}

function persistentSecret(envName, fileName, bytes) {
    if (process.env[envName]) return process.env[envName];

    const keyFile = path.join(DATA_DIR, fileName);
    if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();

    const secret = crypto.randomBytes(bytes).toString('hex');
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

    // Assinatura dos links de download do modpack.
    FILES_SECRET: filesSecret(),

    // Quanto tempo um link do manifesto continua valendo. Precisa cobrir um
    // download inteiro numa internet ruim: 1,6 GB a 1 Mb/s passa das 3 horas.
    SIGNED_URL_TTL_HOURS: Number(process.env.ATENA_SIGNED_URL_TTL_HOURS || 12),

    // false desliga a assinatura e volta a servir /files/ para qualquer um.
    // Só existe para destravar um deploy quebrado; não deixe assim.
    SIGNED_URLS: String(process.env.ATENA_SIGNED_URLS || 'true') !== 'false',

    // true quando o painel está atrás de HTTPS (nginx com certificado).
    SECURE_COOKIES: String(process.env.ATENA_SECURE_COOKIES || 'false') === 'true',

    // Tamanho máximo por arquivo enviado pelo painel, em MB.
    MAX_UPLOAD_MB: Number(process.env.ATENA_MAX_UPLOAD_MB || 4096),

    TRUST_PROXY: String(process.env.ATENA_TRUST_PROXY || 'false') === 'true'
};
