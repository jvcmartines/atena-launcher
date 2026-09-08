/**
 * Autenticação da staff no painel.
 *
 * - Senhas: scrypt com salt por usuário (nada de senha em texto puro no disco).
 * - Sessão: token assinado com HMAC-SHA256 guardado num cookie httpOnly.
 *   Não há sessão em memória, então reiniciar o servidor não desloga ninguém.
 */
const crypto = require('crypto');
const store = require('./store');
const { SESSION_SECRET, SESSION_TTL_HOURS, SECURE_COOKIES } = require('../config');

const COOKIE = 'atena_session';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* --------------------------------------------------------------- senhas -- */

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
    try {
        const [algo, N, r, p, saltHex, hashHex] = String(stored).split('$');
        if (algo !== 'scrypt') return false;

        const salt = Buffer.from(saltHex, 'hex');
        const expected = Buffer.from(hashHex, 'hex');
        const actual = crypto.scryptSync(password, salt, expected.length, {
            N: Number(N), r: Number(r), p: Number(p)
        });
        return crypto.timingSafeEqual(expected, actual);
    } catch {
        return false;
    }
}

/* -------------------------------------------------------------- usuários -- */

function users() {
    return store.read('users', []);
}

function saveUsers(list) {
    return store.write('users', list);
}

function findUser(username) {
    const wanted = String(username || '').trim().toLowerCase();
    return users().find(u => u.username.toLowerCase() === wanted);
}

function publicUser(user) {
    if (!user) return null;
    return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

/* -------------------------------------------------------------- sessões --- */

function sign(data) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
}

function createToken(user) {
    const payload = Buffer.from(JSON.stringify({
        id: user.id,
        username: user.username,
        role: user.role,
        exp: Date.now() + SESSION_TTL_HOURS * 3600 * 1000
    })).toString('base64url');

    return `${payload}.${sign(payload)}`;
}

function readToken(token) {
    if (!token || typeof token !== 'string') return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = sign(payload);
    if (expected.length !== signature.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!data.exp || data.exp < Date.now()) return null;
        // A conta pode ter sido removida ou rebaixada depois do login.
        const current = users().find(u => u.id === data.id);
        if (!current) return null;
        return publicUser(current);
    } catch {
        return null;
    }
}

function parseCookies(header) {
    const out = {};
    for (const part of String(header || '').split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1) continue;
        out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    }
    return out;
}

function setSessionCookie(res, token) {
    const bits = [
        `${COOKIE}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${SESSION_TTL_HOURS * 3600}`
    ];
    if (SECURE_COOKIES) bits.push('Secure');
    res.setHeader('Set-Cookie', bits.join('; '));
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/* ---------------------------------------------------------- middlewares --- */

function attachUser(req, _res, next) {
    const cookies = parseCookies(req.headers.cookie);
    req.user = readToken(cookies[COOKIE]);
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Faça login para continuar.' });
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Só um administrador pode fazer isso.' });
    }
    next();
}

/* ------------------------------------------------- limite de tentativas --- */

const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(ip) {
    const entry = attempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.first > WINDOW_MS) {
        attempts.delete(ip);
        return false;
    }
    return entry.count >= MAX_ATTEMPTS;
}

function registerFailure(ip) {
    const entry = attempts.get(ip);
    if (!entry || Date.now() - entry.first > WINDOW_MS) {
        attempts.set(ip, { first: Date.now(), count: 1 });
    } else {
        entry.count += 1;
    }
}

function clearAttempts(ip) {
    attempts.delete(ip);
}

module.exports = {
    COOKIE,
    hashPassword,
    verifyPassword,
    users,
    saveUsers,
    findUser,
    publicUser,
    createToken,
    setSessionCookie,
    clearSessionCookie,
    attachUser,
    requireAuth,
    requireAdmin,
    tooManyAttempts,
    registerFailure,
    clearAttempts
};
