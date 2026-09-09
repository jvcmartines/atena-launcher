/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 *
 * Tela inicial. O botão principal muda de nome conforme o estado do modpack na
 * máquina do jogador: Instalar (primeira vez), Atualizar (a staff publicou uma
 * versão nova) ou Jogar (está tudo em dia).
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup, lang, backup, modpack, discord, serverStatus, showDiscordIdentity } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

class Home {
    static id = "home";

    async init(config) {
        this.config = config;
        this.db = new database();
        this.socialLick()
        this.copyServerIp()

        // Banido: nem tenta montar a lista de modpacks — o servidor nao vai
        // devolver nenhum, e a pessoa precisa e de saber o motivo.
        if (this.config.banned) {
            this.blockPlay(lang.t('blocked.banned_title'), this.config.banned.message || lang.t('blocked.banned_text'))
            this.showStoredAccount()
            document.querySelector('.settings-btn').addEventListener('click', () => changePanel('settings'))
            return
        }

        this.instancesSelect()
        this.reportNickname()
        this.playersPopup()
        document.querySelector('.settings-btn').addEventListener('click', e => changePanel('settings'))
    }

    /**
     * Conta ao servidor qual nick de Minecraft está selecionado agora. É o que
     * permite à staff ver, no painel, qual personagem é de qual pessoa do
     * Discord. Sem Discord conectado não manda nada.
     */
    async reportNickname() {
        let configClient = await this.db.readData('configClient')
        let account = await this.db.readData('accounts', configClient?.account_selected)
        if (account?.name) discord.heartbeat(account.name)
    }

    /** Pasta raiz do jogo: %appdata%/.Atena no Windows. */
    async basePath() {
        return `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`
    }

    /** Um clique na linha do IP copia o endereço para a área de transferência. */
    copyServerIp() {
        let row = document.querySelector('.ip-row')
        if (!row) return

        row.addEventListener('click', async () => {
            let ip = document.querySelector('.server-ip').textContent.trim()
            let feedback = document.querySelector('.ip-copy')

            try {
                await navigator.clipboard.writeText(ip)
            } catch (err) {
                console.error('Não consegui copiar o IP:', err)
                return
            }

            feedback.textContent = lang.t('home.ip_copied')
            feedback.classList.add('copied')
            setTimeout(() => {
                feedback.textContent = lang.t('home.ip_copy')
                feedback.classList.remove('copied')
            }, 1600)
        })
    }

    socialLick() {
        let socials = document.querySelectorAll('.social-block')

        socials.forEach(social => {
            social.addEventListener('click', e => {
                shell.openExternal(e.target.dataset.url)
            })
        });
    }

    async instancesSelect() {
        let configClient = await this.db.readData('configClient')
        let auth = await this.db.readData('accounts', configClient.account_selected)
        let instancesList = await config.getInstanceList()
        let instanceSelect = instancesList.find(i => i.name == configClient?.instance_select) ? configClient?.instance_select : null

        this.instancesList = instancesList

        let playBTN = document.querySelector('.play-btn')
        let packMenuBTN = document.querySelector('.pack-menu-btn')
        let instancePopup = document.querySelector('.instance-popup')
        let instancesListPopup = document.querySelector('.instances-List')
        let instanceCloseBTN = document.querySelector('.close-popup')

        // Sem nenhum modpack visivel nao ha o que jogar. Acontece quando a
        // staff restringe tudo por cargo, ou desativa o unico modpack.
        if (!instancesList.length) {
            return this.blockPlay(lang.t('blocked.no_pack_title'), lang.t('blocked.no_pack_text'))
        }

        // Com um modpack só não há o que escolher: a lista some do popup.
        if (instancesList.length <= 1) instancesListPopup.style.display = 'none'

        if (!instanceSelect) {
            // Prefere um aberto; se todos tem whitelist, fica com o primeiro
            // que o servidor liberou para esta pessoa.
            let newInstanceSelect = instancesList.find(i => i.whitelistActive == false) || instancesList[0]
            let configClient = await this.db.readData('configClient')
            configClient.instance_select = newInstanceSelect.name
            instanceSelect = newInstanceSelect.name
            await this.db.updateData('configClient', configClient)
        }

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist == auth?.name)
                if (whitelist !== auth?.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        let configClient = await this.db.readData('configClient')
                        configClient.instance_select = newInstanceSelect.name
                        instanceSelect = newInstanceSelect.name
                        setStatus(newInstanceSelect.status, newInstanceSelect)
                        await this.db.updateData('configClient', configClient)
                    }
                }
            }
            if (instance.name == instanceSelect) {
                setStatus(instance.status, instance)
                this.currentStatusInstance = instance
                this.refreshState(instance)
            }
        }

        instancePopup.addEventListener('click', async e => {
            let configClient = await this.db.readData('configClient')

            if (e.target.classList.contains('instance-elements')) {
                let newInstanceSelect = e.target.id
                let activeInstanceSelect = document.querySelector('.active-instance')

                if (activeInstanceSelect) activeInstanceSelect.classList.toggle('active-instance');
                e.target.classList.add('active-instance');

                configClient.instance_select = newInstanceSelect
                await this.db.updateData('configClient', configClient)

                let options = instancesList.find(i => i.name == newInstanceSelect)
                instancePopup.style.display = 'none'
                this.currentStatusInstance = options
                await setStatus(options.status, options)
                await this.refreshState(options)
            }

            if (e.target.classList.contains('pack-action')) {
                this.packAction(e.target.dataset.action)
            }
        })

        packMenuBTN.addEventListener('click', async () => {
            let configClient = await this.db.readData('configClient')
            let instanceSelect = configClient.instance_select
            let auth = await this.db.readData('accounts', configClient.account_selected)

            instancesListPopup.innerHTML = ''
            for (let instance of instancesList) {
                let visible = !instance.whitelistActive || instance.whitelist.includes(auth?.name)
                if (!visible) continue

                let active = instance.name == instanceSelect ? ' active-instance' : ''
                let label = instance.displayName || instance.name
                instancesListPopup.innerHTML += `<div id="${instance.name}" class="instance-elements${active}">${label}</div>`
            }

            instancePopup.style.display = 'flex'
        })

        playBTN.addEventListener('click', () => this.startGame())
        instanceCloseBTN.addEventListener('click', () => instancePopup.style.display = 'none')
    }

    /**
     * Clicar no card de jogadores abre a lista de quem está no servidor.
     *
     * Os nomes vêm do próprio protocolo do Minecraft, que limita a amostra
     * (normalmente 12 nomes) e deixa o servidor escondê-la. Quando não vem
     * lista, mostramos só a contagem — que é sempre confiável.
     */
    playersPopup() {
        let card = document.querySelector('.status-player-count')
        let popupBox = document.querySelector('.players-popup')
        let closeBTN = document.querySelector('.close-players')
        if (!card || !popupBox) return

        card.addEventListener('click', async () => {
            let list = document.querySelector('.players-list')
            let countLine = document.querySelector('.players-count-line')

            popupBox.style.display = 'flex'
            list.innerHTML = `<div class="players-empty">${lang.t('home.players_loading')}</div>`
            countLine.textContent = ''

            let status = this.currentStatusInstance
                ? await serverStatus(this.currentStatusInstance)
                : null

            if (!status || !status.online) {
                list.innerHTML = `<div class="players-empty">${lang.t('home.status_down')}</div>`
                return
            }

            countLine.textContent = lang.t('home.players_of', {
                online: status.players.online,
                max: status.players.max
            })

            let sample = status.players.sample || []

            if (!sample.length) {
                list.innerHTML = `<div class="players-empty">${lang.t(
                    status.players.online ? 'home.players_hidden' : 'home.players_none'
                )}</div>`
                return
            }

            list.innerHTML = sample.map(player => `
                <div class="player-row">
                    <img class="player-face" alt=""
                        src="https://mc-heads.net/avatar/${encodeURIComponent(player.id || player.name)}/32"
                        onerror="this.style.visibility='hidden'">
                    <span>${player.name.replace(/[<>&]/g, '')}</span>
                </div>`).join('')
        })

        closeBTN.addEventListener('click', () => popupBox.style.display = 'none')
        popupBox.addEventListener('click', e => {
            if (e.target === popupBox) popupBox.style.display = 'none'
        })
    }

    /**
     * Preenche o rodape com a conta salva, sem passar pela renovacao de token.
     * No estado bloqueado o fluxo normal de login nao roda, e sem isto o rodape
     * fica em Loading... para sempre.
     */
    async showStoredAccount() {
        let configClient = await this.db.readData('configClient')
        let account = await this.db.readData('accounts', configClient?.account_selected)

        if (!account) {
            document.querySelector('.account-chip')?.style.setProperty('display', 'none')
            return
        }

        let nameElement = document.querySelector('.player-name')
        if (nameElement) nameElement.textContent = account.name
        await showDiscordIdentity(account)
    }

    /**
     * Trava o launcher com um motivo na tela, em vez de fechar na cara da
     * pessoa. O botao de jogar sai, o card de jogadores sai, e fica so o aviso
     * — mas as configuracoes continuam acessiveis, para ela poder trocar de
     * conta ou de idioma.
     */
    blockPlay(title, message) {
        let box = document.querySelector('.blocked-box')
        let play = document.querySelector('.play-elements')
        let players = document.querySelector('.status-player-count')

        if (play) play.style.display = 'none'
        if (players) players.style.display = 'none'

        if (box) {
            box.querySelector('.blocked-title').textContent = title
            box.querySelector('.blocked-text').innerHTML = message
            box.classList.add('visible')
        }
    }

    /** Instância selecionada no momento. */
    async currentInstance() {
        let configClient = await this.db.readData('configClient')
        let instances = this.instancesList || await config.getInstanceList()
        return instances.find(i => i.name == configClient.instance_select)
    }

    /**
     * Descobre se o modpack precisa ser instalado, atualizado ou está pronto, e
     * ajusta o texto do botão e o resumo do popup.
     */
    async refreshState(instance) {
        if (!instance) instance = await this.currentInstance()
        if (!instance) return

        let base = await this.basePath()
        let state = await modpack.state(base, instance)
        let remote = await modpack.remoteVersion(instance.url)

        this.packState = state

        let playBTN = document.querySelector('.play-btn')
        let nameElement = document.querySelector('.current-instance-name')
        let stateElement = document.querySelector('.pack-state')

        if (playBTN) {
            playBTN.textContent = lang.t(
                state === 'install' ? 'home.install' : state === 'update' ? 'home.update' : 'home.play'
            )
        }

        if (nameElement) nameElement.textContent = instance.displayName || instance.name

        if (stateElement) {
            if (state === 'install') stateElement.textContent = lang.t('home.state_install')
            else if (state === 'update') stateElement.textContent = lang.t('home.state_update', { version: remote?.version ?? '?' })
            else if (remote) stateElement.textContent = lang.t('home.state_ready', { version: remote.version })
            else stateElement.textContent = lang.t('home.state_unknown')
        }
    }

    /* ------------------------------------------------- ações do modpack -- */

    async packAction(action) {
        let instance = await this.currentInstance()
        if (!instance) return

        let base = await this.basePath()

        if (action === 'folder') {
            let folder = modpack.dir(base, instance.name)
            require('fs').mkdirSync(folder, { recursive: true })
            shell.openPath(folder)
            return
        }

        if (action === 'reinstall') {
            if (!confirm(lang.t('home.reinstall_confirm'))) return

            let configClient = await this.db.readData('configClient')
            let userProtected = configClient?.launcher_config?.protected || []

            // Antes de apagar qualquer coisa, guarda uma cópia.
            try {
                await backup.run(base, instance.name, instance.backup || [])
            } catch (err) {
                console.error('[backup] falhou antes de reinstalar:', err)
            }

            // Mundos, prints e o que o jogador protegeu sobrevivem.
            await modpack.reinstall(base, instance.name, [...(instance.ignored || []), ...userProtected])

            document.querySelector('.instance-popup').style.display = 'none'
            await this.refreshState(instance)

            new popup().openPopup({
                title: lang.t('home.pack_options'),
                content: lang.t('home.reinstall_done'),
                color: 'var(--gold)',
                options: true
            })
        }
    }

    /* ---------------------------------------------------------- jogar --- */

    async startGame() {
        let launch = new Launch()
        let configClient = await this.db.readData('configClient')
        let instance = await config.getInstanceList()
        let authenticator = await this.db.readData('accounts', configClient.account_selected)
        let options = instance.find(i => i.name == configClient.instance_select)

        let playInstanceBTN = document.querySelector('.play-instance')
        let infoStartingBOX = document.querySelector('.info-starting-game')
        let infoStarting = document.querySelector(".info-starting-game-text")
        let progressBar = document.querySelector('.progress-bar')

        let base = await this.basePath()
        let state = this.packState || await modpack.state(base, options)

        // As pastas que o jogador marcou como intocáveis entram na lista de
        // ignorados. Elas precisam virar caminhos de arquivo: a biblioteca
        // compara caminho a caminho, então "config" sozinho não protegeria os
        // arquivos de dentro de serem sobrescritos.
        let userProtected = configClient?.launcher_config?.protected || []
        let ignored = [...(options.ignored || []), ...await modpack.expandProtected(options.url, userProtected)]

        let opt = {
            url: options.url,
            authenticator: authenticator,
            timeout: 10000,
            path: base,
            instance: options.name,
            version: options.loader.minecraft_version,
            detached: configClient.launcher_config.closeLauncher == "close-all" ? false : true,
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,

            loader: {
                type: options.loader.loader_type,
                build: options.loader.loader_version,
                enable: options.loader.loader_type == 'none' ? false : true
            },

            verify: options.verify,

            ignored: ignored,

            java: {
                path: configClient.java_config.java_path,
            },

            JVM_ARGS: options.jvm_args ? options.jvm_args : [],
            GAME_ARGS: options.game_args ? options.game_args : [],

            screen: {
                width: configClient.game_config.screen_size.width,
                height: configClient.game_config.screen_size.height
            },

            memory: {
                min: `${configClient.java_config.java_memory.min * 1024}M`,
                max: `${configClient.java_config.java_memory.max * 1024}M`
            }
        }

        playInstanceBTN.style.display = "none"
        infoStartingBOX.style.display = "block"
        progressBar.style.display = "";
        ipcRenderer.send('main-window-progress-load')

        infoStarting.innerHTML = lang.t(
            state === 'install' ? 'home.installing' : state === 'update' ? 'home.updating' : 'home.connecting'
        )

        // Guarda uma cópia das pastas do jogador antes de sincronizar o modpack.
        // Com o modo estrito ligado, qualquer arquivo fora do modpack é apagado —
        // o backup é a rede de segurança para o que a staff esqueceu de ignorar.
        // Na primeira instalação não há nada para guardar.
        if (options.backup?.length && state !== 'install') {
            infoStarting.innerHTML = lang.t('home.backup')
            try {
                await backup.run(base, options.name, options.backup)
            } catch (err) {
                console.error('[backup] falhou, seguindo mesmo assim:', err)
            }
        }

        launch.Launch(opt);

        launch.on('extract', extract => {
            ipcRenderer.send('main-window-progress-load')
            console.log(extract);
        });

        launch.on('progress', (progress, size) => {
            infoStarting.innerHTML = lang.t('home.downloading', { percent: ((progress / size) * 100).toFixed(0) })
            ipcRenderer.send('main-window-progress', { progress, size })
            progressBar.value = progress;
            progressBar.max = size;
        });

        launch.on('check', (progress, size) => {
            infoStarting.innerHTML = lang.t('home.checking', { percent: ((progress / size) * 100).toFixed(0) })
            ipcRenderer.send('main-window-progress', { progress, size })
            progressBar.value = progress;
            progressBar.max = size;
        });

        launch.on('estimated', (time) => {
            if (!etaElement) return
            let hours = Math.floor(time / 3600);
            let minutes = Math.floor((time - hours * 3600) / 60);
            let seconds = Math.floor(time - hours * 3600 - minutes * 60);

            let restante = hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${seconds}s` : `${seconds}s`
            etaElement.textContent = lang.t('home.eta', { time: restante })
        })

        let speedElement = document.querySelector('.download-speed')
        let etaElement = document.querySelector('.download-eta')

        launch.on('speed', (speed) => {
            if (speedElement) speedElement.textContent = `${(speed / 1067008).toFixed(1)} Mb/s`
        })

        launch.on('patch', patch => {
            console.log(patch);
            ipcRenderer.send('main-window-progress-load')
            infoStarting.innerHTML = lang.t('home.patching')
        });

        launch.on('data', async (e) => {
            progressBar.style.display = "none"

            // O jogo abriu, então a sincronização terminou: anota a versão que
            // ficou instalada aqui, para saber depois se saiu uma mais nova.
            if (!this.marked) {
                this.marked = true
                let remote = await modpack.remoteVersion(options.url)
                if (remote) {
                    modpack.writeLocal(base, options.name, {
                        version: remote.version,
                        publishedAt: remote.publishedAt,
                        syncedAt: new Date().toISOString()
                    })
                }
            }

            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-hide")
            };
            new logger('Minecraft', '#36b030');
            ipcRenderer.send('main-window-progress-load')
            infoStarting.innerHTML = lang.t('home.launching')
            console.log(e);
        })

        launch.on('close', code => {
            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            infoStarting.innerHTML = lang.t('home.verifying')
            if (speedElement) speedElement.textContent = ''
            if (etaElement) etaElement.textContent = ''
            new logger(pkg.name, '#7289da');
            this.marked = false
            this.refreshState(options)
            console.log('Close');
        });

        launch.on('error', err => {
            let popupError = new popup()

            popupError.openPopup({
                title: lang.t('common.error'),
                content: err.error,
                color: 'red',
                options: true
            })

            if (configClient.launcher_config.closeLauncher == 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            infoStarting.innerHTML = lang.t('home.verifying')
            if (speedElement) speedElement.textContent = ''
            if (etaElement) etaElement.textContent = ''
            new logger(pkg.name, '#7289da');
            this.marked = false
            console.log(err);
        });
    }
}
export default Home;
