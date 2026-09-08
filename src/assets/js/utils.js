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
    let typeElement = document.querySelector('.player-type');
    if (nameElement) nameElement.textContent = data.name;
    if (typeElement) typeElement.textContent = accountLabel(data);
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
 * Consulta o servidor de Minecraft e preenche os cartões da tela inicial:
 * status, ping, jogadores online e o IP para copiar.
 */
async function setStatus(opt) {
    let statusElement = document.querySelector('.server-status-text')
    let pingElement = document.querySelector('.server-ping')
    let ipElement = document.querySelector('.server-ip')
    let taglineElement = document.querySelector('.brand-tagline')
    let playersBox = document.querySelector('.status-player-count')
    let playersOnline = document.querySelector('.player-count')

    function offline(reasonKey) {
        statusElement.classList.add('red')
        statusElement.innerHTML = lang.t('home.status_offline')
        if (pingElement) pingElement.innerHTML = lang.t(reasonKey)
        playersBox.classList.add('red')
        playersOnline.innerHTML = '0'
    }

    if (!opt) return offline('home.status_none')

    let { ip, port, nameServer } = opt
    if (ipElement) ipElement.textContent = port && Number(port) !== 25565 ? `${ip}:${port}` : ip
    if (taglineElement && nameServer) taglineElement.textContent = nameServer

    let status = new Status(ip, port);
    let statusServer = await status.getStatus().then(res => res).catch(err => err);

    if (statusServer.error) return offline('home.status_down')

    statusElement.classList.remove('red')
    playersBox.classList.remove('red')
    statusElement.innerHTML = lang.t('home.status_online')
    if (pingElement) pingElement.innerHTML = `${statusServer.ms || 0} ms`
    playersOnline.innerHTML = statusServer.playersConnect || '0'
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
    setBackground as setBackground,
    skin2D as skin2D,
    addAccount as addAccount,
    accountSelect as accountSelect,
    slider as Slider,
    pkg as pkg,
    setStatus as setStatus,
    formatSize as formatSize
}
