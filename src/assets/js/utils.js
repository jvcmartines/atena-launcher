/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */

const { ipcRenderer } = require('electron')
const { Status } = require('minecraft-java-core')
const fs = require('fs');
const pkg = require('../package.json');

import config from './utils/config.js';
import database from './utils/database.js';
import logger from './utils/logger.js';
import popup from './utils/popup.js';
import lang from './utils/lang.js';
import backup from './utils/backup.js';
import modpack from './utils/modpack.js';
import discord from './utils/discord.js';
import skinChanger from './utils/skinchanger.js';
import { skin2D } from './utils/skin.js';
import slider from './utils/slider.js';

async function setBackground(theme) {
    if (typeof theme == 'undefined') {
        let databaseLauncher = new database();
        let configClient = await databaseLauncher.readData('configClient');
        theme = configClient?.launcher_config?.theme || "auto"
        theme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
    }
    let background
    let body = document.body;
    body.className = theme ? 'dark global' : 'light global';
    if (fs.existsSync(`${__dirname}/assets/images/background/${theme ? 'dark' : 'light'}`)) {
        let backgrounds = fs.readdirSync(`${__dirname}/assets/images/background/${theme ? 'dark' : 'light'}`);
        let Background = backgrounds[Math.floor(Math.random() * backgrounds.length)];
        let scrim = theme
            ? 'linear-gradient(180deg, rgba(16,3,10,.52) 0%, rgba(16,3,10,.76) 52%, rgba(16,3,10,.95) 100%)'
            : 'linear-gradient(180deg, rgba(255,250,246,.5) 0%, rgba(255,248,244,.72) 52%, rgba(252,244,240,.9) 100%)';
        background = `${scrim}, url(./assets/images/background/${theme ? 'dark' : 'light'}/${Background})`;
    }
    body.style.backgroundImage = background ? background : theme ? '#000' : '#fff';
    body.style.backgroundSize = 'cover';
}

async function changePanel(id) {
    let panel = document.querySelector(`.${id}`);
    let active = document.querySelector(`.active`)
    if (active) active.classList.toggle("active");
    panel.classList.add("active");
}

async function appdata() {
    return await ipcRenderer.invoke('appData').then(path => path)
}

async function addAccount(data) {
    let skin = false
    if (data?.profile?.skins[0]?.base64) skin = await new skin2D().creatHeadTexture(data.profile.skins[0].base64);
    let div = document.createElement("div");
    div.classList.add("account");
    div.id = data.ID;
    div.innerHTML = `
        <div class="profile-image" ${skin ? 'style="background-image: url(' + skin + ');"' : ''}></div>
        <div class="profile-infos">
            <div class="profile-pseudo">${data.name}</div>
            <div class="profile-uuid">${data.uuid}</div>
        </div>
        <div class="delete-profile" id="${data.ID}">
            <div class="icon-account-delete delete-profile-icon"></div>
        </div>
    `
    return document.querySelector('.accounts-list').appendChild(div);
}

async function accountSelect(data) {
    let account = document.getElementById(`${data.ID}`);
    let activeAccount = document.querySelector('.account-select')

    if (activeAccount) activeAccount.classList.toggle('account-select');
    account.classList.add('account-select');
    if (data?.profile?.skins[0]?.base64) headplayer(data.profile.skins[0].base64);

    let nameElement = document.querySelector('.player-name');
    if (nameElement) nameElement.textContent = data.name;

    await showDiscordIdentity(data);
}

/**
 * Preenche o rodapé com a identidade do Discord: a foto vira um selo no canto
 * da cabeça, e o nome ocupa a linha de baixo.
 *
 * O nick do Minecraft continua sendo o nome principal — é um launcher de
 * Minecraft, e é o nick que aparece no jogo. O Discord entra como "quem é essa
 * pessoa na comunidade", que é mais útil ali do que "Microsoft account".
 *
 * Sem Discord conectado, volta a mostrar o tipo da conta.
 */
async function showDiscordIdentity(account) {
    let typeElement = document.querySelector('.player-type');
    let badge = document.querySelector('.discord-badge');

    let player = null;
    try {
        let configClient = await new database().readData('configClient');
        player = configClient?.discord?.player || null;
    } catch {
        player = null;
    }

    let staffBadge = document.querySelector('.staff-badge');
    if (staffBadge) staffBadge.style.display = player?.isStaff ? '' : 'none';

    if (!player) {
        if (badge) badge.style.display = 'none';
        if (typeElement) typeElement.textContent = account ? accountLabel(account) : '';
        return;
    }

    if (typeElement) typeElement.textContent = player.globalName || player.username;

    if (badge) {
        if (player.avatar) {
            badge.src = player.avatar;
            badge.style.display = '';
            badge.onerror = () => { badge.style.display = 'none'; };
        } else {
            badge.style.display = 'none';
        }
    }
}

/** Rótulo amigável do tipo de conta, exibido embaixo do nick. */
function accountLabel(data) {
    let type = data?.meta?.type;
    if (type === 'Xbox') return lang.t('account.microsoft');
    if (type === 'AZauth') return lang.t('account.site');
    if (type === 'Mojang') return lang.t(data?.meta?.online === false ? 'account.offline' : 'account.mojang');
    return lang.t('account.connected');
}

async function headplayer(skinBase64) {
    let skin = await new skin2D().creatHeadTexture(skinBase64);
    document.querySelector(".player-head").style.backgroundImage = `url(${skin})`;
}

/**
 * Consulta o servidor de Minecraft e preenche a tela inicial.
 *
 * A tela mostra só a contagem de jogadores, então é o próprio card que carrega
 * a informação de "fora do ar": o número some e o rótulo passa a dizer isso.
 */
async function setStatus(opt, instance) {
    let ipElement = document.querySelector('.server-ip')
    let playersBox = document.querySelector('.status-player-count')
    let playersOnline = document.querySelector('.player-count')
    let playersLabel = document.querySelector('.players-label')

    function offline(reasonKey) {
        playersBox?.classList.add('red')
        if (playersOnline) playersOnline.innerHTML = '—'
        if (playersLabel) playersLabel.textContent = lang.t(reasonKey)
    }

    function online(count) {
        playersBox?.classList.remove('red')
        if (playersOnline) playersOnline.innerHTML = count
        if (playersLabel) playersLabel.textContent = lang.t('home.players_label')
    }

    if (!opt) return offline('home.status_none')

    let { ip, port } = opt
    if (ipElement) ipElement.textContent = port && Number(port) !== 25565 ? `${ip}:${port}` : ip

    // Caminho preferido: perguntar ao nosso servidor, que está ao lado do
    // Minecraft. Além de mais confiável, é o único que traz os nomes.
    let fromApi = instance?.url ? await serverStatus(instance) : null

    if (fromApi) {
        lastStatus = fromApi
        if (!fromApi.online) return offline('home.status_down')
        return online(fromApi.players?.online ?? 0)
    }

    // Reserva: ping direto do PC do jogador.
    let status = new Status(ip, port);
    let statusServer = await status.getStatus().then(res => res).catch(err => err);

    if (statusServer.error) return offline('home.status_down')

    lastStatus = {
        online: true,
        ping: statusServer.ms || 0,
        players: { online: statusServer.playersConnect || 0, max: statusServer.playersMax || 0, sample: [] }
    }
    online(statusServer.playersConnect || 0)
}

/** Último status conhecido, para o popup de jogadores não precisar repingar. */
let lastStatus = null;

function getLastStatus() {
    return lastStatus;
}

/** Pergunta o status ao servidor do Atena (quem está online, ping, MOTD). */
async function serverStatus(instance) {
    try {
        let url = modpack.siblingUrl(instance.url, '/server-status')
        let response = await fetch(url, { headers: config.headers() })
        if (!response.ok) return null
        return await response.json()
    } catch {
        return null
    }
}

/** Tamanho legível, usado no resumo dos backups. */
function formatSize(bytes) {
    if (!bytes) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export {
    appdata as appdata,
    changePanel as changePanel,
    config as config,
    database as database,
    logger as logger,
    popup as popup,
    lang as lang,
    backup as backup,
    modpack as modpack,
    discord as discord,
    skinChanger as skinChanger,
    setBackground as setBackground,
    skin2D as skin2D,
    addAccount as addAccount,
    accountSelect as accountSelect,
    slider as Slider,
    pkg as pkg,
    setStatus as setStatus,
    showDiscordIdentity as showDiscordIdentity,
    getLastStatus as getLastStatus,
    serverStatus as serverStatus,
    formatSize as formatSize
}
