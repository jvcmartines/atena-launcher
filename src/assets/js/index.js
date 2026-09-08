/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 *
 * Janela de abertura: mostra a logo enquanto procura atualizações do launcher
 * e confere se o servidor está em manutenção.
 */

const { ipcRenderer, shell } = require('electron');
const pkg = require('../package.json');
const os = require('os');
import { config, database, lang } from './utils.js';
const nodeFetch = require("node-fetch");


class Splash {
    constructor() {
        this.splash = document.querySelector(".splash");
        this.message = document.querySelector(".message");
        this.progress = document.querySelector(".progress");

        document.addEventListener('DOMContentLoaded', async () => {
            let databaseLauncher = new database();
            let configClient = await databaseLauncher.readData('configClient');

            // O idioma padrão é o inglês até o jogador escolher outro.
            lang.load(configClient?.launcher_config?.lang || lang.defaultCode);

            let theme = configClient?.launcher_config?.theme || "auto"
            let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
            document.body.className = isDarkTheme ? 'dark global' : 'light global';

            if (process.platform == 'win32') ipcRenderer.send('update-window-progress-load')
            this.startAnimation()
        });
    }

    async startAnimation() {
        this.setStatus(lang.t('splash.searching'));

        await sleep(100);
        document.querySelector("#splash").style.display = "flex";
        await sleep(400);
        this.splash.classList.add("opacity");
        await sleep(400);
        this.splash.classList.add("translate");
        this.message.classList.add("opacity");
        await sleep(700);
        this.checkUpdate();
    }

    async checkUpdate() {
        // Não conseguir falar com o GitHub (repositório ainda não configurado,
        // sem internet, API fora do ar) não pode impedir ninguém de jogar:
        // seguimos direto para a checagem de manutenção.
        ipcRenderer.invoke('update-app').catch(err => {
            console.error('[update] checagem falhou, seguindo sem atualizar:', err);
            this.maintenanceCheck();
        });

        ipcRenderer.on('updateAvailable', () => {
            this.setStatus(lang.t('splash.available'));
            if (os.platform() == 'win32') {
                this.toggleProgress();
                ipcRenderer.send('start-update');
            }
            else return this.dowloadUpdate();
        })

        ipcRenderer.on('error', (event, err) => {
            if (!err) return;
            console.error('[update] erro do autoUpdater, seguindo sem atualizar:', err);
            this.maintenanceCheck();
        })

        ipcRenderer.on('download-progress', (event, progress) => {
            ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total })
            this.setProgress(progress.transferred, progress.total);
        })

        ipcRenderer.on('update-not-available', () => {
            console.log("Nenhuma atualização disponível");
            this.maintenanceCheck();
        })
    }

    getLatestReleaseForOS(os, preferredFormat, asset) {
        return asset.filter(asset => {
            const name = asset.name.toLowerCase();
            const isOSMatch = name.includes(os);
            const isFormatMatch = name.endsWith(preferredFormat);
            return isOSMatch && isFormatMatch;
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    async dowloadUpdate() {
        const repoURL = pkg.repository.url.replace("git+", "").replace(".git", "").replace("https://github.com/", "").split("/");
        const githubAPI = await nodeFetch('https://api.github.com').then(res => res.json()).catch(err => err);

        const githubAPIRepoURL = githubAPI.repository_url.replace("{owner}", repoURL[0]).replace("{repo}", repoURL[1]);
        const githubAPIRepo = await nodeFetch(githubAPIRepoURL).then(res => res.json()).catch(err => err);

        const releases_url = await nodeFetch(githubAPIRepo.releases_url.replace("{/id}", '')).then(res => res.json()).catch(err => err);
        const latestRelease = releases_url[0].assets;
        let latest;

        if (os.platform() == 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', latestRelease);
        else if (os == 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', latestRelease);

        this.setStatus(`${lang.t('splash.available')}<br><div class="download-update">${lang.t('splash.download')}</div>`);
        document.querySelector(".download-update").addEventListener("click", () => {
            shell.openExternal(latest.browser_download_url);
            return this.shutdown(lang.t('splash.downloading'));
        });
    }


    async maintenanceCheck() {
        if (this.checked) return;
        this.checked = true;

        config.GetConfig().then(res => {
            if (res.maintenance) return this.shutdown(res.maintenance_message);
            this.startLauncher();
        }).catch(e => {
            console.error(e);
            return this.shutdown(lang.t('splash.offline'));
        })
    }

    startLauncher() {
        this.setStatus(lang.t('splash.starting'));
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    shutdown(text) {
        let seconds = 5;
        this.setStatus(lang.t('splash.closing', { text, seconds }));

        setInterval(() => {
            seconds -= 1;
            this.setStatus(lang.t('splash.closing', { text, seconds }));
            if (seconds < 0) ipcRenderer.send('update-window-close');
        }, 1000);
    }

    setStatus(text) {
        this.message.innerHTML = text;
    }

    toggleProgress() {
        if (this.progress.classList.toggle("show")) this.setProgress(0, 1);
    }

    setProgress(value, max) {
        this.progress.value = value;
        this.progress.max = max;
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
        ipcRenderer.send("update-window-dev-tools");
    }
})
new Splash();
