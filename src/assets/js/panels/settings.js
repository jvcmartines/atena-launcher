/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground, lang, backup, formatSize, discord } from '../utils.js'
const { ipcRenderer, shell } = require('electron');
const os = require('os');
const fs = require('fs');

class Settings {
    static id = "settings";
    async init(config) {
        this.config = config;
        this.db = new database();
        this.navBTN()
        this.accounts()
        this.ram()
        this.javaPath()
        this.resolution()
        this.launcher()
        this.language()
        this.backups()
        this.protectedFolders()
        this.discordAccount()
    }

    navBTN() {
        document.querySelector('.nav-settings').addEventListener('click', e => {
            if (e.target.classList.contains('nav-settings-btn')) {
                let id = e.target.id

                let activeSettingsBTN = document.querySelector('.active-settings-BTN')
                let activeContainerSettings = document.querySelector('.active-container-settings')

                if (id == 'save') {
                    if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
                    document.querySelector('#account').classList.add('active-settings-BTN');

                    if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
                    document.querySelector(`#account-tab`).classList.add('active-container-settings');
                    return changePanel('home')
                }

                if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
                e.target.classList.add('active-settings-BTN');

                if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
                document.querySelector(`#${id}-tab`).classList.add('active-container-settings');

                if (id == 'java') this.memorySlider?.refresh();
            }
        })
    }

    accounts() {
        document.querySelector('.accounts-list').addEventListener('click', async e => {
            let popupAccount = new popup()
            try {
                let id = e.target.id
                if (e.target.classList.contains('account')) {
                    popupAccount.openPopup({
                        title: lang.t('settings.wait'),
                        content: lang.t('settings.processing'),
                        color: 'var(--color)'
                    })

                    if (id == 'add') {
                        document.querySelector('.cancel-home').style.display = 'inline'
                        return changePanel('login')
                    }

                    let account = await this.db.readData('accounts', id);
                    let configClient = await this.setInstance(account);
                    await accountSelect(account);
                    configClient.account_selected = account.ID;
                    return await this.db.updateData('configClient', configClient);
                }

                if (e.target.classList.contains("delete-profile")) {
                    popupAccount.openPopup({
                        title: lang.t('settings.wait'),
                        content: lang.t('settings.processing'),
                        color: 'var(--color)'
                    })
                    await this.db.deleteData('accounts', id);
                    let deleteProfile = document.getElementById(`${id}`);
                    let accountListElement = document.querySelector('.accounts-list');
                    accountListElement.removeChild(deleteProfile);

                    if (accountListElement.children.length == 1) return changePanel('login');

                    let configClient = await this.db.readData('configClient');

                    if (configClient.account_selected == id) {
                        let allAccounts = await this.db.readAllData('accounts');
                        configClient.account_selected = allAccounts[0].ID
                        accountSelect(allAccounts[0]);
                        let newInstanceSelect = await this.setInstance(allAccounts[0]);
                        configClient.instance_select = newInstanceSelect.instance_select
                        return await this.db.updateData('configClient', configClient);
                    }
                }
            } catch (err) {
                console.error(err)
            } finally {
                popupAccount.closePopup();
            }
        })
    }

    async setInstance(auth) {
        let configClient = await this.db.readData('configClient')
        let instanceSelect = configClient.instance_select
        let instancesList = await config.getInstanceList()

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist == auth.name)
                if (whitelist !== auth.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        configClient.instance_select = newInstanceSelect.name
                        await setStatus(newInstanceSelect.status)
                    }
                }
            }
        }
        return configClient
    }

    async ram() {
        let config = await this.db.readData('configClient');
        let totalMem = Math.trunc(os.totalmem() / 1073741824 * 10) / 10;
        let freeMem = Math.trunc(os.freemem() / 1073741824 * 10) / 10;

        document.getElementById("total-ram").textContent = `${totalMem} GB`;
        document.getElementById("free-ram").textContent = `${freeMem} GB`;

        let sliderDiv = document.querySelector(".memory-slider");
        // Teto: 24 GB é o máximo que faz sentido para o modpack, mas nunca mais
        // que 80% da RAM da máquina — passar disso trava o sistema inteiro.
        let sliderMax = Math.max(4, Math.min(24, Math.trunc((80 * totalMem) / 100)));
        sliderDiv.setAttribute("max", sliderMax);

        let ram = config?.java_config?.java_memory ? {
            ramMin: Number(config.java_config.java_memory.min),
            ramMax: Number(config.java_config.java_memory.max)
        } : { ramMin: 4, ramMax: 8 };

        // O padrão de fábrica (8 GB) não cabe em todo PC. Se o configurado passa
        // do teto da máquina, recua para o maior valor que cabe.
        if (ram.ramMax > sliderMax) {
            let max = sliderMax;
            let min = Math.max(1, Math.min(4, max - 1));
            config.java_config.java_memory = { min, max };
            this.db.updateData('configClient', config);
            ram = { ramMin: min, ramMax: max }
        };

        let slider = new Slider(".memory-slider", parseFloat(ram.ramMin), parseFloat(ram.ramMax));
        this.memorySlider = slider;

        // A aba nasce escondida, então as medidas só ficam corretas quando ela abre.
        window.addEventListener("resize", () => this.memorySlider?.refresh());

        let minSpan = document.querySelector(".slider-touch-left span");
        let maxSpan = document.querySelector(".slider-touch-right span");

        minSpan.setAttribute("value", `${ram.ramMin} GB`);
        maxSpan.setAttribute("value", `${ram.ramMax} GB`);

        slider.on("change", async (min, max) => {
            let config = await this.db.readData('configClient');
            minSpan.setAttribute("value", `${min} GB`);
            maxSpan.setAttribute("value", `${max} GB`);
            config.java_config.java_memory = { min: min, max: max };
            this.db.updateData('configClient', config);
        });
    }

    async javaPath() {
        let javaPathText = document.querySelector(".java-path-txt")
        javaPathText.textContent = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/runtime`;

        let configClient = await this.db.readData('configClient')
        let javaPath = configClient?.java_config?.java_path || lang.t('settings.java_bundled');
        let javaPathInputTxt = document.querySelector(".java-path-input-text");
        let javaPathInputFile = document.querySelector(".java-path-input-file");
        javaPathInputTxt.value = javaPath;

        document.querySelector(".java-path-set").addEventListener("click", async () => {
            javaPathInputFile.value = '';
            javaPathInputFile.click();
            await new Promise((resolve) => {
                let interval;
                interval = setInterval(() => {
                    if (javaPathInputFile.value != '') resolve(clearInterval(interval));
                }, 100);
            });

            if (javaPathInputFile.value.replace(".exe", '').endsWith("java") || javaPathInputFile.value.replace(".exe", '').endsWith("javaw")) {
                let configClient = await this.db.readData('configClient')
                let file = javaPathInputFile.files[0].path;
                javaPathInputTxt.value = file;
                configClient.java_config.java_path = file
                await this.db.updateData('configClient', configClient);
            } else alert(lang.t('settings.java_invalid'));
        });

        document.querySelector(".java-path-reset").addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            javaPathInputTxt.value = lang.t('settings.java_bundled');
            configClient.java_config.java_path = null
            await this.db.updateData('configClient', configClient);
        });
    }

    async resolution() {
        let configClient = await this.db.readData('configClient')
        let resolution = configClient?.game_config?.screen_size || { width: 1920, height: 1080 };

        let width = document.querySelector(".width-size");
        let height = document.querySelector(".height-size");
        let resolutionReset = document.querySelector(".size-reset");

        width.value = resolution.width;
        height.value = resolution.height;

        width.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size.width = width.value;
            await this.db.updateData('configClient', configClient);
        })

        height.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size.height = height.value;
            await this.db.updateData('configClient', configClient);
        })

        resolutionReset.addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size = { width: '854', height: '480' };
            width.value = '854';
            height.value = '480';
            await this.db.updateData('configClient', configClient);
        })
    }

    async launcher() {
        let configClient = await this.db.readData('configClient');

        let maxDownloadFiles = configClient?.launcher_config?.download_multi || 5;
        let maxDownloadFilesInput = document.querySelector(".max-files");
        let maxDownloadFilesReset = document.querySelector(".max-files-reset");
        maxDownloadFilesInput.value = maxDownloadFiles;

        maxDownloadFilesInput.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.launcher_config.download_multi = maxDownloadFilesInput.value;
            await this.db.updateData('configClient', configClient);
        })

        maxDownloadFilesReset.addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            maxDownloadFilesInput.value = 5
            configClient.launcher_config.download_multi = 5;
            await this.db.updateData('configClient', configClient);
        })

        let themeBox = document.querySelector(".theme-box");
        let theme = configClient?.launcher_config?.theme || "auto";

        if (theme == "auto") {
            document.querySelector('.theme-btn-auto').classList.add('active-theme');
        } else if (theme == "dark") {
            document.querySelector('.theme-btn-sombre').classList.add('active-theme');
        } else if (theme == "light") {
            document.querySelector('.theme-btn-clair').classList.add('active-theme');
        }

        themeBox.addEventListener("click", async e => {
            if (e.target.classList.contains('theme-btn')) {
                let activeTheme = document.querySelector('.active-theme');
                if (e.target.classList.contains('active-theme')) return
                activeTheme?.classList.remove('active-theme');

                if (e.target.classList.contains('theme-btn-auto')) {
                    setBackground();
                    theme = "auto";
                    e.target.classList.add('active-theme');
                } else if (e.target.classList.contains('theme-btn-sombre')) {
                    setBackground(true);
                    theme = "dark";
                    e.target.classList.add('active-theme');
                } else if (e.target.classList.contains('theme-btn-clair')) {
                    setBackground(false);
                    theme = "light";
                    e.target.classList.add('active-theme');
                }

                let configClient = await this.db.readData('configClient')
                configClient.launcher_config.theme = theme;
                await this.db.updateData('configClient', configClient);
            }
        })

        let closeBox = document.querySelector(".close-box");
        let closeLauncher = configClient?.launcher_config?.closeLauncher || "close-launcher";

        if (closeLauncher == "close-launcher") {
            document.querySelector('.close-launcher').classList.add('active-close');
        } else if (closeLauncher == "close-all") {
            document.querySelector('.close-all').classList.add('active-close');
        } else if (closeLauncher == "close-none") {
            document.querySelector('.close-none').classList.add('active-close');
        }

        closeBox.addEventListener("click", async e => {
            if (e.target.classList.contains('close-btn')) {
                let activeClose = document.querySelector('.active-close');
                if (e.target.classList.contains('active-close')) return
                activeClose?.classList.toggle('active-close');

                let configClient = await this.db.readData('configClient')

                if (e.target.classList.contains('close-launcher')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-launcher";
                    await this.db.updateData('configClient', configClient);
                } else if (e.target.classList.contains('close-all')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-all";
                    await this.db.updateData('configClient', configClient);
                } else if (e.target.classList.contains('close-none')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-none";
                    await this.db.updateData('configClient', configClient);
                }
            }
        })
    }

    /**
     * Seletor de idioma. O padrão é inglês; a escolha fica salva por jogador.
     * Trocar recarrega a janela — é mais simples e mais seguro do que retraduzir
     * tudo em memória, e garante que nenhum texto fica para trás.
     */
    async language() {
        let box = document.querySelector('.lang-box');
        if (!box) return;

        let configClient = await this.db.readData('configClient');
        let current = configClient?.launcher_config?.lang || lang.defaultCode;

        box.innerHTML = lang.available.map(item => {
            let active = item.code === current ? ' active-theme' : '';
            return `<div class="theme-btn lang-btn${active}" data-lang="${item.code}">${item.label}</div>`;
        }).join('');

        box.addEventListener('click', async e => {
            let code = e.target.dataset.lang;
            if (!code || code === current) return;

            let configClient = await this.db.readData('configClient');
            configClient.launcher_config.lang = code;
            await this.db.updateData('configClient', configClient);

            ipcRenderer.send('main-window-reload');
        });
    }

    /**
     * Mostra onde ficam os backups do modpack selecionado e quanto ocupam.
     * Quem decide o que é copiado é a staff, no painel de administração.
     */
    async backups() {
        let pathElement = document.querySelector('.backup-path-txt');
        let summary = document.querySelector('.backup-summary');
        let openButton = document.querySelector('.backup-open');
        if (!pathElement || !summary || !openButton) return;

        let base = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`;

        let configClient = await this.db.readData('configClient');
        let instances = await config.getInstanceList();
        let selected = instances.find(i => i.name == configClient?.instance_select) || instances[0];
        if (!selected) return;

        let folder = backup.folderFor(base, selected.name);
        pathElement.textContent = folder;

        let stats = backup.stats(folder);
        summary.textContent = stats.count
            ? lang.t('settings.backups_count', { count: stats.count, size: formatSize(stats.size) })
            : lang.t('settings.backups_none');

        openButton.addEventListener('click', () => {
            // A pasta só existe depois do primeiro backup; criamos para o botão
            // nunca ficar sem efeito.
            fs.mkdirSync(folder, { recursive: true });
            shell.openPath(folder);
        });
    }

    /**
     * Mostra a conta do Discord conectada e permite desconectar.
     * A seção some inteira quando a verificação está desligada no servidor.
     */
    async discordAccount() {
        let sections = document.querySelectorAll('.discord-section');
        if (!sections.length) return;

        if (!this.config.discord?.enabled) {
            sections.forEach(section => section.style.display = 'none');
            return;
        }

        let avatar = document.querySelector('.discord-account .discord-avatar');
        let name = document.querySelector('.discord-account .discord-name');
        let sub = document.querySelector('.discord-account .discord-sub');
        let action = document.querySelector('.discord-action');

        let configClient = await this.db.readData('configClient');
        let player = configClient?.discord?.player;

        if (player) {
            if (player.avatar) avatar.src = player.avatar;
            avatar.style.display = player.avatar ? 'block' : 'none';
            name.textContent = player.globalName || player.username;
            sub.textContent = player.username;
            action.textContent = lang.t('discord.disconnect');
        } else {
            avatar.style.display = 'none';
            name.textContent = lang.t('discord.not_linked');
            sub.textContent = '';
            action.textContent = lang.t('discord.connect');
        }

        action.addEventListener('click', async () => {
            let configClient = await this.db.readData('configClient');

            if (configClient?.discord?.player) {
                configClient.discord = { token: null, player: null };
                await this.db.updateData('configClient', configClient);
            } else {
                action.textContent = lang.t('discord.waiting');
                let result = await discord.link();
                if (result.error) {
                    action.textContent = lang.t('discord.connect');
                    return alert(result.detail ? `${lang.t(result.error)} — ${result.detail}` : lang.t(result.error));
                }
                configClient.discord = { token: result.token, player: result.player };
                await this.db.updateData('configClient', configClient);
            }

            ipcRenderer.send('main-window-reload');
        });
    }

    /**
     * Pastas que o jogador não quer que o launcher encoste.
     *
     * Elas entram na lista de ignorados na hora de sincronizar o modpack, então
     * param de ser apagadas e de ser sobrescritas. O preço é deixar de receber
     * as atualizações daquela pasta — está escrito na tela.
     */
    async protectedFolders() {
        let field = document.querySelector('.protected-list');
        let saveButton = document.querySelector('.protected-save');
        if (!field || !saveButton) return;

        let configClient = await this.db.readData('configClient');
        field.value = (configClient?.launcher_config?.protected || []).join('\n');

        saveButton.addEventListener('click', async () => {
            let entries = field.value
                .split('\n')
                .map(line => line.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''))
                .filter(Boolean);

            let configClient = await this.db.readData('configClient');
            configClient.launcher_config.protected = entries;
            await this.db.updateData('configClient', configClient);

            field.value = entries.join('\n');
            saveButton.classList.add('saved');
            setTimeout(() => saveButton.classList.remove('saved'), 1400);
        });
    }
}
export default Settings;