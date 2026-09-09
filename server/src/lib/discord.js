/**
 * Verificação por Discord (OAuth2).
 *
 * O jogador clica em "Conectar o Discord" no launcher, aprova na tela oficial
 * do Discord, e o Discord manda o navegador de volta para cá com um código.
 * A troca do código pelo token acontece só aqui no servidor — o client_secret
 * nunca chega perto do launcher.
 *
 * Com o token a gente lê:
 *   - quem é a pessoa (id, nome de usuário, avatar)
 *   - se ela está no seu servidor do Discord e quais cargos tem
 *
 * É isso que permite liberar uma instância de testes só para quem tem o cargo
 * de staff, por exemplo.
 */

const crypto = require('crypto');
const store = require('./store');

const API = 'https://discord.com/api/v10';

/** Configuração do Discord, guardada junto com o resto da config do launcher. */
function settings() {
    const config = store.read('config', {});
    return {
        enabled: !!config.discord?.enabled,
        required: !!config.discord?.required,
        clientId: config.discord?.clientId || '',
        clientSecret: config.discord?.clientSecret || '',
        guildId: config.discord?.guildId || '',
        requireGuild: !!config.discord?.requireGuild,
        staffRoleId: config.discord?.staffRoleId || ''
    };
}

/** URL da tela de autorização do Discord. */
function authorizeUrl(state, redirectUri) {
    const { clientId, guildId } = settings();

    // guilds.members.read só é pedido quando há um servidor configurado — sem
    // isso o Discord mostra uma permissão a mais sem motivo.
    const scope = guildId ? 'identify guilds.members.read' : 'identify';

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        state,
        prompt: 'consent'
    });

    return `https://discord.com/oauth2/authorize?${params}`;
}

async function exchangeCode(code, redirectUri) {
    const { clientId, clientSecret } = settings();

    const response = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        })
    });

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`O Discord recusou o código (${response.status}): ${detail.slice(0, 200)}`);
    }
    return response.json();
}

async function fetchUser(accessToken) {
    const response = await fetch(`${API}/users/@me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) throw new Error('Não consegui ler o perfil do Discord.');
    return response.json();
}

/**
 * Dados da pessoa dentro do seu servidor: cargos e apelido.
 * Devolve null quando ela não está no servidor (o Discord responde 404).
 */
async function fetchMember(accessToken, guildId) {
    if (!guildId) return null;

    const response = await fetch(`${API}/users/@me/guilds/${guildId}/member`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (response.status === 404) return null;
    if (!response.ok) {
        console.error('[discord] não consegui ler o membro:', response.status);
        return null;
    }
    return response.json();
}

function avatarUrl(user) {
    if (!user?.avatar) return null;
    const extension = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}`;
}

/** Junta perfil + participação no servidor num registro só. */
async function identify(accessToken) {
    const { guildId } = settings();

    const user = await fetchUser(accessToken);
    const member = await fetchMember(accessToken, guildId);

    return {
        id: user.id,
        username: user.username,
        globalName: user.global_name || user.username,
        avatar: avatarUrl(user),
        inGuild: !!member,
        guildNick: member?.nick || null,
        roles: member?.roles || []
    };
}

function randomState() {
    return crypto.randomBytes(24).toString('hex');
}

module.exports = { settings, authorizeUrl, exchangeCode, identify, randomState };
