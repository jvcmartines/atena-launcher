/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 *
 * Tela inicial. O botão principal muda de nome conforme o estado do modpack na
 * máquina do jogador: Instalar (primeira vez), Atualizar (a staff publicou uma
 * versão nova) ou Jogar (está tudo em dia).
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup, lang, backup, modpack, discord, serverStatus, showDiscordIdentity, news, suporte, presenca, registro } from '../utils.js'

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
        this.newsPopup()
        this.changelogPopup()
        this.richPresence()
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

        // Baixar e jogar são dois passos separados de propósito: quem clicou em
        // Atualizar quer o modpack em dia, não o Minecraft abrindo na cara.
        // Terminada a atualização, o botão vira Jogar e a pessoa decide.
        //
        // O catch não é decoração: sem ele, qualquer erro antes da tela mudar
        // deixava o botão vivo e nada acontecia — a pessoa clicava, clicava, e
        // concluía que travou.
        playBTN.addEventListener('click', () => {
            let acao = this.packState === 'install' || this.packState === 'update'
                ? this.updatePack()
                : this.startGame()

            acao.catch(err => this.falhouAoIniciar(err))
        })
        instanceCloseBTN.addEventListener('click', () => instancePopup.style.display = 'none')
    }

    /**
     * Clicar no indicador do rodapé abre a lista de quem está no servidor.
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

    /* ------------------------------------------------ avisos da staff ---- */

    /**
     * Avisos escritos no painel. O botão só aparece quando existe algum, e
     * ganha um ponto dourado enquanto houver aviso que esta pessoa ainda não
     * abriu — o "não li" fica guardado por data do aviso mais recente.
     */
    async newsPopup() {
        let botao = document.querySelector('.news-btn')
        let caixa = document.querySelector('.news-popup')
        if (!botao || !caixa) return

        let avisos = await news.articles()
        if (!avisos.length) return

        botao.hidden = false

        let maisNovo = avisos[0].publish_date || ''
        let lido = localStorage.getItem('atena-news-lido') || ''
        let ponto = document.querySelector('.news-dot')
        if (ponto) ponto.hidden = maisNovo <= lido

        document.querySelector('.news-list').innerHTML = avisos.map(aviso => `
            <article class="news-item">
                <h4>${this.escapar(aviso.title)}</h4>
                <div class="news-meta">${this.escapar(aviso.author || '')} · ${this.dataCurta(aviso.publish_date)}</div>
                <p>${this.escapar(aviso.content || '').replace(/\n/g, '<br>')}</p>
            </article>`).join('')

        botao.addEventListener('click', () => {
            caixa.style.display = 'flex'
            localStorage.setItem('atena-news-lido', maisNovo)
            if (ponto) ponto.hidden = true
        })

        document.querySelector('.close-news').addEventListener('click', () => caixa.style.display = 'none')
        caixa.addEventListener('click', e => { if (e.target === caixa) caixa.style.display = 'none' })
    }

    /* --------------------------------------------- o que mudou no pack --- */

    changelogPopup() {
        let caixa = document.querySelector('.changelog-popup')
        if (!caixa) return

        let fechar = () => caixa.style.display = 'none'
        document.querySelector('.close-changelog').addEventListener('click', fechar)
        document.querySelector('.changelog-ok').addEventListener('click', fechar)
        caixa.addEventListener('click', e => { if (e.target === caixa) fechar() })
    }

    /**
     * Mostra as versões publicadas depois da que a pessoa tem instalada.
     * `desde` nulo mostra o histórico inteiro (é o que o menu do modpack faz).
     */
    async showChangelog(instance, desde) {
        let entradas = await news.changelog(instance.url, desde)
        let caixa = document.querySelector('.changelog-popup')
        let lista = document.querySelector('.changelog-list')
        let intro = document.querySelector('.changelog-intro')
        if (!caixa || !lista) return false

        if (!entradas.length) {
            if (desde !== null && desde !== undefined) return false   // nada novo, não incomoda
            lista.innerHTML = `<div class="players-empty">${lang.t('home.changelog_empty')}</div>`
            intro.textContent = ''
            caixa.style.display = 'flex'
            return true
        }

        intro.textContent = desde === null || desde === undefined
            ? ''
            : lang.t('home.changelog_since', { count: entradas.length })

        lista.innerHTML = entradas.map(entrada => `
            <article class="changelog-item">
                <div class="changelog-version">v${entrada.version}
                    <span class="changelog-date">${this.dataCurta(entrada.publishedAt)}</span>
                </div>
                <p>${entrada.changelog
                    ? this.escapar(entrada.changelog).replace(/\n/g, '<br>')
                    : `<span class="muted">${lang.t('home.changelog_none')}</span>`}</p>
            </article>`).join('')

        caixa.style.display = 'flex'
        return true
    }

    escapar(texto) {
        return String(texto).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    }

    dataCurta(iso) {
        if (!iso) return ''
        try {
            return new Date(iso).toLocaleDateString(lang.code || 'en', {
                day: '2-digit', month: 'short', year: 'numeric'
            })
        } catch {
            return ''
        }
    }

    /* ----------------------------------------------- presença no discord - */

    /** "Jogando Atena" no perfil de quem está com o launcher aberto. */
    async richPresence() {
        try {
            let clientId = this.config?.discord?.clientId || this.config?.discordClientId
            if (!clientId) return

            if (!await presenca.conectar(clientId)) return

            let atualizar = () => {
                let status = getLastStatus()
                presenca.definir({
                    detalhes: lang.t('presence.in_launcher'),
                    estado: status?.online
                        ? lang.t('presence.players', { count: status.players.online })
                        : lang.t('presence.offline'),
                    convite: 'https://discord.gg/92cDk8rZKK'
                })
            }

            atualizar()
            this.presencaTimer = setInterval(atualizar, 60_000)
        } catch (err) {
            console.error('[presenca] não consegui falar com o Discord:', err.message)
        }
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

        if (action === 'changelog') {
            document.querySelector('.instance-popup').style.display = 'none'
            await this.showChangelog(instance, null)
            return
        }

        if (action === 'repair') return this.repairPack(instance, base)
        if (action === 'report') return this.reportProblem(instance, base)

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

    /**
     * Verificar e reparar: confere o SHA-1 de cada arquivo contra o manifesto e
     * apaga o que não bate, para o próximo Jogar baixar só isso de novo.
     *
     * Usa a mesma barra do download, porque conferir 5 mil arquivos leva o seu
     * tempo e a pessoa precisa ver que está andando.
     */
    async repairPack(instance, base) {
        document.querySelector('.instance-popup').style.display = 'none'

        let playInstanceBTN = document.querySelector('.play-instance')
        let infoBox = document.querySelector('.info-starting-game')
        let infoText = document.querySelector('.info-starting-game-text')
        let progressBar = document.querySelector('.progress-bar')

        playInstanceBTN.style.display = 'none'
        infoBox.style.display = 'block'
        progressBar.style.display = ''

        let resultado
        try {
            resultado = await modpack.repair(base, instance, (feitos, total) => {
                // Mesmo motivo do updatePack: redesenhar a cada um dos 5 mil
                // arquivos custa mais que o próprio trabalho.
                let agora = Date.now()
                if (feitos !== total && agora - (this.ultimoDesenho || 0) < 100) return
                this.ultimoDesenho = agora

                infoText.innerHTML = lang.t('home.repairing', {
                    percent: ((feitos / total) * 100).toFixed(0)
                })
                progressBar.value = feitos
                progressBar.max = total
            })
        } catch (err) {
            console.error('[modpack] a verificação falhou:', err)
            resultado = null
        }

        infoBox.style.display = 'none'
        playInstanceBTN.style.display = 'flex'
        progressBar.value = 0

        await this.refreshState(instance)

        let quebrados = (resultado?.broken || 0) + (resultado?.missing || 0)
        new popup().openPopup({
            title: lang.t('home.repair'),
            content: !resultado
                ? lang.t('home.repair_failed')
                : quebrados
                    ? lang.t('home.repair_found', { count: quebrados, checked: resultado.checked })
                    : lang.t('home.repair_clean', { checked: resultado.checked }),
            color: quebrados ? 'var(--gold)' : 'var(--success)',
            options: true
        })
    }

    /**
     * Junta log, crash-report e diagnóstico num zip e abre a pasta. É o que a
     * staff sempre pede; assim a pessoa manda tudo de uma vez.
     */
    async reportProblem(instance, base) {
        document.querySelector('.instance-popup').style.display = 'none'

        let configClient = await this.db.readData('configClient')
        let remote = await modpack.remoteVersion(instance.url)

        try {
            let diagnostico = await suporte.diagnostico({
                basePath: base,
                instanceName: instance.name,
                configClient,
                remote
            })

            let { arquivo } = await suporte.relatorio({
                basePath: base,
                instanceName: instance.name,
                diagnostico,
                versaoLauncher: pkg.version
            })

            shell.showItemInFolder(arquivo)

            new popup().openPopup({
                title: lang.t('support.title'),
                content: lang.t('support.done', { file: arquivo }) +
                    (diagnostico.avisos.length
                        ? '<br><br>' + diagnostico.avisos.map(a => lang.t(`support.warn_${a}`)).join('<br>')
                        : ''),
                color: 'var(--gold)',
                options: true
            })
        } catch (err) {
            console.error('[suporte] não consegui montar o relatório:', err)
            new popup().openPopup({
                title: lang.t('common.error'),
                content: lang.t('support.failed'),
                color: 'red',
                options: true
            })
        }
    }

    /**
     * Traduz o "tipo" que a minecraft-java-core informa para algo que o jogador
     * entenda. Para os arquivos do modpack o tipo é a primeira pasta do caminho
     * ("mods", "config", "shaderpacks"), então na prática a barra passa a dizer
     * o que está baixando de verdade.
     */
    nomeDoQue(element) {
        if (!element) return ''

        let conhecidos = {
            Libraries: 'home.part_libraries',
            Assets: 'home.part_assets',
            Java: 'home.part_java',
            CFILE: 'home.part_files',
            mods: 'home.part_mods',
            config: 'home.part_config',
            shaderpacks: 'home.part_shaders',
            resourcepacks: 'home.part_resources',
            kubejs: 'home.part_scripts'
        }

        return conhecidos[element] ? lang.t(conhecidos[element]) : String(element)
    }

    /**
     * Argumentos que fazem o Minecraft já entrar no servidor, pulando o menu
     * de multijogador.
     *
     * O --quickPlayMultiplayer é do 1.20 para cima; em versão mais antiga o
     * jogo ignoraria, então só mandamos quando a versão comporta. Sem IP
     * configurado na instância não há para onde ir.
     */
    quickPlayArgs(configClient, options) {
        if (configClient?.launcher_config?.quickPlay === false) return []

        let ip = options?.status?.ip
        if (!ip) return []

        let versao = String(options?.loader?.minecraft_version || '')
        let [maior, menor] = versao.split('.').map(Number)
        if (!(maior > 1 || (maior === 1 && menor >= 20))) return []

        let porta = Number(options.status.port) || 25565
        return ['--quickPlayMultiplayer', porta === 25565 ? ip : `${ip}:${porta}`]
    }

    /* ------------------------------------------- instalar / atualizar ---- */

    /**
     * Baixa o modpack e para por aí. Não abre o jogo.
     *
     * A conferência dos arquivos já existentes é a parte lenta — 5 mil
     * arquivos, 1,66 GB — e é justamente onde a biblioteca fica muda. Aqui ela
     * mostra progresso desde o primeiro segundo.
     */
    async updatePack() {
        let instance = await this.currentInstance()
        if (!instance) return

        let base = await this.basePath()
        let configClient = await this.db.readData('configClient')

        let playInstanceBTN = document.querySelector('.play-instance')
        let infoBox = document.querySelector('.info-starting-game')
        let infoText = document.querySelector('.info-starting-game-text')
        let progressBar = document.querySelector('.progress-bar')
        let speedElement = document.querySelector('.download-speed')
        let etaElement = document.querySelector('.download-eta')

        playInstanceBTN.style.display = 'none'
        infoBox.style.display = 'block'
        progressBar.style.display = ''
        progressBar.value = 0
        ipcRenderer.send('main-window-progress-load')

        // Antes de mexer nos arquivos, guarda uma cópia das pastas do jogador.
        // Na primeira instalação não há nada para guardar.
        if (instance.backup?.length && this.packState !== 'install') {
            infoText.innerHTML = lang.t('home.backup')
            try {
                await backup.run(base, instance.name, instance.backup)
            } catch (err) {
                console.error('[backup] falhou, seguindo mesmo assim:', err)
            }
        }

        let userProtected = configClient?.launcher_config?.protected || []
        let protegidos = await modpack.expandProtected(instance.url, userProtected)

        // A versão que estava aqui antes: é a partir dela que o changelog
        // conta o que a pessoa perdeu.
        let versaoAnterior = modpack.readLocal(base, instance.name)?.version ?? null

        let ultimoBytes = 0
        let ultimoInstante = inicio

        try {
            let resultado = await modpack.sync(base, instance, {
                ignored: protegidos,
                concorrencia: configClient?.launcher_config?.download_multi || 5,
                aoProgresso: dados => {
                    // Redesenhar a cada arquivo (são milhares) e a cada pedaço
                    // baixado custa mais que o próprio trabalho. Dez vezes por
                    // segundo já é mais rápido do que o olho acompanha.
                    let agora = Date.now()
                    let ultimo = dados.fase === 'conferindo' && dados.feitos === dados.total
                    if (!ultimo && agora - (this.ultimoDesenho || 0) < 100) return
                    this.ultimoDesenho = agora

                    if (dados.fase === 'conferindo') {
                        let porcento = ((dados.feitos / dados.total) * 100).toFixed(0)
                        infoText.innerHTML = lang.t('home.checking', { percent: porcento })
                        progressBar.value = dados.feitos
                        progressBar.max = dados.total
                        ipcRenderer.send('main-window-progress', { progress: dados.feitos, size: dados.total })
                        return
                    }

                    infoText.innerHTML = lang.t('home.downloading_what', {
                        percent: dados.bytesTotais ? ((dados.bytes / dados.bytesTotais) * 100).toFixed(0) : '0',
                        what: this.nomeDoQue(String(dados.arquivo || '').split('/')[0])
                    })
                    progressBar.value = dados.bytes
                    progressBar.max = dados.bytesTotais || 1
                    ipcRenderer.send('main-window-progress', { progress: dados.bytes, size: dados.bytesTotais || 1 })

                    // Velocidade e tempo restante a partir do que já veio.
                    if (agora - ultimoInstante > 700) {
                        let velocidade = (dados.bytes - ultimoBytes) / ((agora - ultimoInstante) / 1000)
                        ultimoBytes = dados.bytes
                        ultimoInstante = agora

                        if (speedElement) speedElement.textContent = `${(velocidade / 131072).toFixed(1)} Mb/s`
                        if (etaElement && velocidade > 0) {
                            let faltam = Math.max(0, (dados.bytesTotais - dados.bytes) / velocidade)
                            etaElement.textContent = lang.t('home.eta', { time: this.tempoCurto(faltam) })
                        }
                    }
                }
            })

            // Só agora o modpack está em dia: anota a versão.
            let remote = await modpack.remoteVersion(instance.url)
            if (remote) {
                modpack.writeLocal(base, instance.name, {
                    version: remote.version,
                    publishedAt: remote.publishedAt,
                    syncedAt: new Date().toISOString()
                })
            }

            let anterior = this.packState
            await this.refreshState(instance)

            if (resultado.falhas?.length) {
                new popup().openPopup({
                    title: lang.t('common.error'),
                    content: lang.t('home.sync_partial', { count: resultado.falhas.length }),
                    color: 'red',
                    options: true
                })
            } else {
                new popup().openPopup({
                    title: lang.t(anterior === 'install' ? 'home.install' : 'home.update'),
                    content: lang.t('home.sync_done', { count: resultado.baixados }),
                    color: 'var(--success)',
                    options: true
                })
            }

            // Atualizou de verdade? Conta o que mudou.
            if (anterior === 'update' && versaoAnterior !== null) await this.showChangelog(instance, versaoAnterior)
        } finally {
            infoBox.style.display = 'none'
            playInstanceBTN.style.display = 'flex'
            progressBar.value = 0
            if (speedElement) speedElement.textContent = ''
            if (etaElement) etaElement.textContent = ''
            ipcRenderer.send('main-window-progress-reset')
        }
    }

    /** "3m 20s" a partir de segundos. */
    tempoCurto(segundos) {
        let h = Math.floor(segundos / 3600)
        let m = Math.floor((segundos - h * 3600) / 60)
        let s = Math.floor(segundos - h * 3600 - m * 60)
        return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`
    }

    /**
     * Alguma coisa quebrou antes ou durante o começo do jogo.
     *
     * Devolve a tela ao estado de repouso — senão o botão fica escondido atrás
     * de uma barra parada — e diz o que houve, com o caminho do log.
     */
    falhouAoIniciar(err) {
        registro.erro('ao começar o jogo', err)

        let playInstanceBTN = document.querySelector('.play-instance')
        let infoStartingBOX = document.querySelector('.info-starting-game')

        if (playInstanceBTN) playInstanceBTN.style.display = 'flex'
        if (infoStartingBOX) infoStartingBOX.style.display = 'none'
        ipcRenderer.send('main-window-progress-reset')

        new popup().openPopup({
            title: lang.t('error.start_title'),
            content: `${lang.t('error.start_text')}<br><br><code>${String(err?.message || err).slice(0, 300)}</code>` +
                (registro.caminho() ? `<br><br><small>${registro.caminho()}</small>` : ''),
            color: 'red',
            options: true
        })
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
        let ignored = [
            ...(options.ignored || []),
            // Os arquivos de controle do launcher não fazem parte do modpack,
            // então o modo estrito os apagaria — e sem eles o launcher esquece
            // qual versão está instalada e reconfere tudo do zero.
            '.atena-version.json',
            '.atena-hashes.json',
            ...await modpack.expandProtected(options.url, userProtected)
        ]

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
            GAME_ARGS: [...(options.game_args || []), ...this.quickPlayArgs(configClient, options)],

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

        // A biblioteca confere o SHA-1 de todos os arquivos já baixados ANTES
        // de emitir qualquer evento. Num modpack de 5 mil arquivos isso leva
        // minutos, e sem esta mensagem a tela fica parada dizendo "atualizando"
        // com a barra no zero — que é indistinguível de travado.
        if (state !== 'install') {
            infoStarting.innerHTML =
                `${lang.t('home.preparing')}<br><small>${lang.t('home.preparing_hint')}</small>`
            progressBar.removeAttribute('value')   // barra indeterminada: está andando, só não dá para medir
        }

        launch.Launch(opt);

        launch.on('extract', extract => {
            ipcRenderer.send('main-window-progress-load')
            console.log(extract);
        });

        launch.on('progress', (progress, size, element) => {
            progressBar.value = 0   // sai do modo indeterminado assim que há o que medir
            infoStarting.innerHTML = lang.t('home.downloading_what', {
                percent: ((progress / size) * 100).toFixed(0),
                what: this.nomeDoQue(element)
            })
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

                // O modpack agora é sincronizado no botão Atualizar, não aqui.
                // Ainda assim vale reanotar a versão: o jogo abriu, então o
                // que está em disco é o que o servidor publicou.
                let remote = await modpack.remoteVersion(options.url)

                if (remote) {
                    modpack.writeLocal(base, options.name, {
                        version: remote.version,
                        publishedAt: remote.publishedAt,
                        syncedAt: new Date().toISOString()
                    })
                }
            }

            // Enquanto o jogo roda, o perfil do Discord mostra isso.
            presenca.definir({
                detalhes: lang.t('presence.playing', { pack: options.displayName || options.name }),
                estado: lang.t('presence.on_server'),
                desde: Math.floor(Date.now() / 1000),
                convite: 'https://discord.gg/92cDk8rZKK'
            })

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

            presenca.definir({
                detalhes: lang.t('presence.in_launcher'),
                convite: 'https://discord.gg/92cDk8rZKK'
            })

            console.log('Close');
        });

        launch.on('error', err => {
            registro.erro('durante o download ou o jogo', err?.error || err)
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
