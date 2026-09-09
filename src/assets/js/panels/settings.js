/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground, lang, backup, formatSize, discord, skinChanger, skin2D, pkg, suporte } from '../utils.js'
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
        this.skin()
        this.performanceProfiles()
        this.quickPlay()
        this.diagnostics()
        this.showVersion()
    }

    /* ------------------------------------------- perfis de desempenho ---- */

    /**
     * Três botões que ajustam a RAM de uma vez.
     *
     * A conta é sempre a mesma: deixe 2 GB para o sistema, não passe de 24 (o
     * Java não aproveita mais que isso num modpack) e nunca aloque mais da
     * metade da máquina no perfil baixo. Quem quiser afinar continua tendo o
     * controle deslizante acima — isto é só o atalho para quem não quer pensar.
     */
    async performanceProfiles() {
        let caixa = document.querySelector('.perf-box')
        let resultado = document.querySelector('.perf-result')
        if (!caixa) return

        let total = Math.trunc(os.totalmem() / 1073741824)

        let perfis = {
            low: { min: 4, max: Math.min(6, total - 2) },
            mid: { min: 6, max: Math.min(10, total - 2) },
            high: { min: 8, max: Math.min(16, total - 2) }
        }

        caixa.addEventListener('click', async e => {
            let botao = e.target.closest('.perf-btn')
            if (!botao) return

            let perfil = perfis[botao.dataset.perf]

            // Num PC pequeno o perfil "bom" não cabe: melhor dizer isso do que
            // aplicar um valor que vai travar o jogo.
            if (!perfil || perfil.max < perfil.min) {
                resultado.textContent = lang.t('settings.performance_too_small')
                return
            }

            let config = await this.db.readData('configClient')
            config.java_config.java_memory = { min: perfil.min, max: perfil.max }
            await this.db.updateData('configClient', config)

            caixa.querySelectorAll('.perf-btn').forEach(b => b.classList.remove('active-perf'))
            botao.classList.add('active-perf')

            resultado.textContent = lang.t('settings.performance_applied', {
                min: perfil.min,
                max: perfil.max
            })

            // O controle deslizante precisa refletir o que acabou de mudar.
            this.memorySlider?.setValue?.(perfil.min, perfil.max)
            document.querySelector('.slider-touch-left span')?.setAttribute('value', `${perfil.min} GB`)
            document.querySelector('.slider-touch-right span')?.setAttribute('value', `${perfil.max} GB`)
        })
    }

    /* ------------------------------------------------ entrar direto ------ */

    /**
     * Com isto ligado o jogo abre já conectando no servidor, sem passar pelo
     * menu de multijogador. O Minecraft 1.20 entende o argumento sozinho.
     */
    async quickPlay() {
        let caixa = document.querySelector('.quickplay-box')
        if (!caixa) return

        let config = await this.db.readData('configClient')
        let ligado = config?.launcher_config?.quickPlay !== false

        let pintar = () => {
            caixa.querySelectorAll('.quickplay-btn').forEach(botao => {
                botao.classList.toggle('active-quickplay',
                    (botao.dataset.quickplay === 'on') === ligado)
            })
        }
        pintar()

        caixa.addEventListener('click', async e => {
            let botao = e.target.closest('.quickplay-btn')
            if (!botao) return

            ligado = botao.dataset.quickplay === 'on'
            let config = await this.db.readData('configClient')
            config.launcher_config.quickPlay = ligado
            await this.db.updateData('configClient', config)
            pintar()
        })
    }

    /* --------------------------------------------------- diagnóstico ----- */

    /** O retrato da máquina, para a pessoa poder ler e mandar para a staff. */
    async diagnostics() {
        let lista = document.querySelector('.diag-list')
        if (!lista) return

        let configClient = await this.db.readData('configClient')
        let base = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`

        let diag = await suporte.diagnostico({
            basePath: base,
            instanceName: configClient?.instance_select,
            configClient
        })

        let gb = valor => valor === null || valor === undefined ? '—' : `${valor.toFixed(1)} GB`

        let linhas = [
            [lang.t('diag.system'), diag.sistema],
            [lang.t('diag.cpu'), `${diag.cpu} (${lang.t('diag.cores', { count: diag.nucleos })})`],
            [lang.t('settings.ram_total'), gb(diag.ramTotalGb)],
            [lang.t('settings.ram_free'), gb(diag.ramLivreGb)],
            [lang.t('diag.ram_allocated'), diag.ramAlocadaGb ? `${diag.ramMinimaGb} – ${diag.ramAlocadaGb} GB` : '—'],
            [lang.t('diag.disk_free'), gb(diag.discoLivreGb)],
            [lang.t('diag.pack_size'), gb(diag.tamanhoPastaGb)]
        ]

        lista.innerHTML = linhas.map(([rotulo, valor]) => `
            <div class="diag-row">
                <span class="diag-label">${rotulo}</span>
                <span class="diag-value">${String(valor).replace(/[<>&]/g, '')}</span>
            </div>`).join('') +
            diag.avisos.map(aviso =>
                `<div class="diag-warn">${lang.t(`support.warn_${aviso}`)}</div>`).join('')
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
                        await setStatus(newInstanceSelect.status, newInstanceSelect)
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
        // Teto: 24 GB é o máximo que faz sentido para o modpack. O limite real
        // é deixar 2 GB livres para o Windows — num PC de 16 GB isso dá 14, em
        // vez dos 12 que a regra dos 80% permitia.
        let sliderMax = Math.max(4, Math.min(24, Math.trunc(totalMem - 2)));
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
     * Versao do launcher no rodape das configuracoes. Serve para o jogador
     * responder "qual versao voce esta usando?" quando pedir ajuda, e para
     * conferir que uma atualizacao realmente aconteceu.
     */
    showVersion() {
        let element = document.querySelector('.launcher-version');
        if (element) element.textContent = 'v' + pkg.version;
    }

    /**
     * Troca de skin, falando direto com a Mojang.
     *
     * A seção some para conta offline: sem conta Microsoft não existe skin do
     * lado da Mojang para trocar.
     */
    async skin() {
        let sections = document.querySelectorAll('.skin-section');
        if (!sections.length) return;

        let configClient = await this.db.readData('configClient');
        let account = await this.db.readData('accounts', configClient?.account_selected);

        if (!skinChanger.canChange(account)) {
            sections.forEach(section => section.style.display = 'none');
            return;
        }

        let body = document.querySelector('.skin-body');
        let status = document.querySelector('.skin-status');
        let fileInput = document.querySelector('.skin-file');
        let variantButtons = document.querySelectorAll('.variant-btn');

        let variant = 'classic';

        const marcarVariante = escolhida => {
            variant = escolhida;
            variantButtons.forEach(btn => {
                btn.classList.toggle('active-theme', btn.dataset.variant === escolhida);
            });
        };

        const desenhar = async (url, modelo) => {
            if (!url) return;
            try {
                body.src = await new skin2D().creatBodyTexture(url, modelo === 'slim');
            } catch (err) {
                console.error('[skin] não consegui desenhar a prévia:', err);
            }
        };

        // Estado inicial: o que a Mojang diz que está em uso agora.
        let profile = await skinChanger.profile(account);
        if (profile) {
            marcarVariante(profile.variant === 'slim' ? 'slim' : 'classic');
            desenhar(profile.skinUrl, profile.variant);
        } else {
            marcarVariante('classic');
            if (account?.profile?.skins?.[0]?.base64) {
                desenhar(account.profile.skins[0].base64, 'classic');
            }
        }

        variantButtons.forEach(btn => btn.addEventListener('click', () => marcarVariante(btn.dataset.variant)));

        document.querySelector('.skin-choose').addEventListener('click', () => {
            fileInput.value = '';
            fileInput.click();
        });

        fileInput.addEventListener('change', async () => {
            let file = fileInput.files[0];
            if (!file) return;

            status.className = 'skin-status working';
            status.textContent = lang.t('skin.sending');

            let result = await skinChanger.upload(account, file.path, variant);

            if (result.error) {
                status.className = 'skin-status error';
                status.textContent = result.detail
                    ? `${lang.t(result.error)} (${result.detail})`
                    : lang.t(result.error);
                return;
            }

            status.className = 'skin-status ok';
            status.textContent = lang.t('skin.done');
            desenhar(file.path.replace(/\\/g, '/').startsWith('http') ? file.path : `file://${file.path}`, variant);
        });

        document.querySelector('.skin-reset').addEventListener('click', async () => {
            status.className = 'skin-status working';
            status.textContent = lang.t('skin.resetting');

            let result = await skinChanger.reset(account);

            if (result.error) {
                status.className = 'skin-status error';
                status.textContent = lang.t(result.error);
                return;
            }

            status.className = 'skin-status ok';
            status.textContent = lang.t('skin.reset_done');

            let atualizado = await skinChanger.profile(account);
            if (atualizado) desenhar(atualizado.skinUrl, atualizado.variant);
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