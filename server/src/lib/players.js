/**
 * Registro de jogadores.
 *
 * Cada pessoa que conecta o Discord no launcher vira uma linha aqui, com o
 * perfil do Discord, os cargos que tem no seu servidor e os nicks de Minecraft
 * que já usou. É esse registro que a staff vê no painel e onde o banimento fica
 * marcado.
 *
 * O launcher se identifica com um token assinado por nós — ele guarda o token,
 * não a senha de ninguém, e o token pode ser invalidado a qualquer momento
 * apagando ou banindo o jogador.
 */

const crypto = require('crypto');
const store = require('./store');
const { SESSION_SECRET } = require('../config');

const MAX_NICKS = 10;

function all() {
    return store.read('players', []);
}

function save(list) {
    return store.write('players', list);
}

function find(id) {
    return all().find(player => player.id === id) || null;
}

/**
 * Cria ou atualiza o registro a partir do que o Discord respondeu.
 * O banimento e os nicks já conhecidos são preservados.
 */
function upsert(profile) {
    const list = all();
    const existing = list.find(player => player.id === profile.id);
    const now = new Date().toISOString();

    const player = {
        ...(existing || { nicknames: [], banned: false, banReason: '', firstSeen: now }),
        id: profile.id,
        username: profile.username,
        globalName: profile.globalName,
        avatar: profile.avatar,
        inGuild: profile.inGuild,
        guildNick: profile.guildNick,
        roles: profile.roles,
        linkedAt: existing?.linkedAt || now,
        lastSeen: now
    };

    save(existing
        ? list.map(item => (item.id === player.id ? player : item))
        : [...list, player]);

    return player;
}

/** Anota o nick de Minecraft que a pessoa está usando agora. */
function touch(id, nickname) {
    const list = all();
    const player = list.find(item => item.id === id);
    if (!player) return null;

    player.lastSeen = new Date().toISOString();

    if (nickname) {
        player.currentNick = nickname;
        player.nicknames = [nickname, ...(player.nicknames || []).filter(nick => nick !== nickname)]
            .slice(0, MAX_NICKS);
    }

    save(list);
    return player;
}

function setBanned(id, banned, reason) {
    const list = all();
    const player = list.find(item => item.id === id);
    if (!player) return null;

    player.banned = !!banned;
    player.banReason = banned ? (reason || '') : '';
    player.bannedAt = banned ? new Date().toISOString() : null;

    save(list);
    return player;
}

function remove(id) {
    const list = all();
    if (!list.some(player => player.id === id)) return false;

    save(list.filter(player => player.id !== id));
    return true;
}

/* ------------------------------------------------------------- token --- */

function sign(data) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
}

function createToken(playerId) {
    const payload = Buffer.from(JSON.stringify({ id: playerId, iat: Date.now() })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

/**
 * Devolve o jogador dono do token, ou null se o token for inválido, tiver sido
 * adulterado, ou o registro não existir mais.
 */
function fromToken(token) {
    if (!token || typeof token !== 'string') return null;

    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const expected = sign(payload);
    if (expected.length !== signature.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

    try {
        const { id } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        return find(id);
    } catch {
        return null;
    }
}

/* ------------------------------------------------------------ acesso --- */

/**
 * Decide se este jogador enxerga esta instância.
 *
 * modes:
 *   public   — todo mundo
 *   discord  — quem conectou o Discord (e está no servidor, se exigido)
 *   roles    — quem tem pelo menos um dos cargos listados
 *   players  — só quem está na lista, por id ou nome de usuário do Discord
 */
function canAccess(instance, player) {
    const access = instance.access || { mode: 'public' };
    if (access.mode === 'public' || !access.mode) return true;

    // Qualquer modo que não seja público exige Discord conectado.
    if (!player) return false;
    if (player.banned) return false;

    if (access.mode === 'discord') return true;

    if (access.mode === 'roles') {
        const allowed = access.roles || [];
        if (!allowed.length) return false;
        return (player.roles || []).some(role => allowed.includes(role));
    }

    if (access.mode === 'players') {
        const allowed = (access.players || []).map(entry => String(entry).trim().toLowerCase());
        if (!allowed.length) return false;
        return allowed.includes(player.id) || allowed.includes(String(player.username).toLowerCase());
    }

    return false;
}

module.exports = { all, find, upsert, touch, setBanned, remove, createToken, fromToken, canAccess };
