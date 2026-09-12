/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 *
 * Tela inicial. O botão principal muda de nome conforme o estado do modpack na
 * máquina do jogador: Instalar (primeira vez), Atualizar (a staff publicou uma
 * versão nova) ou Jogar (está tudo em dia).
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup, lang, backup, modpack, discord, serverStatus, getLastStatus, showDiscordIdentity, news, suporte, presenca, registro, Pausa, importar, extras, desempenho, pacote, preferencias } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

class Home {
    static id = "home";

    async init(config) {
        this.config = config;
        this.db = new database();
        this.socialLick()
        this.copyServerIp()
        this.estatisticasBotao()

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
        this.interruptores()
        this.ouvirAAba()
        this.mostrarHoras()
        this.vigia()
        this.contaBotao()
        this.suporteBotao()
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

        // Sem nenhum modpack visivel nao ha o que jogar. Acontece quando a
        // staff restringe tudo por cargo, ou desativa o unico modpack.
        if (!instancesList.length) {
            return this.blockPlay(lang.t('blocked.no_pack_title'), lang.t('blocked.no_pack_text'))
        }

        // A lista fica mesmo com um modpack so: o cartao continua dizendo qual
        // e e em que estado esta, o que a lista de nomes em texto nao dizia.

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

        // O botao do modpack agora abre a aba, nao um popup.
        packMenuBTN.addEventListener('click', () => changePanel('modpack'))

        // Baixar e jogar são dois passos separados de propósito: quem clicou em
        // Atualizar quer o modpack em dia, não o Minecraft abrindo na cara.
        // Terminada a atualização, o botão vira Jogar e a pessoa decide.
        //
        // O catch não é decoração: sem ele, qualquer erro antes da tela mudar
        // deixava o botão vivo e nada acontecia — a pessoa clicava, clicava, e
        // concluía que travou.
        playBTN.addEventListener('click', () => this.executar(() =>
            this.packState === 'install' || this.packState === 'update'
                ? this.updatePack()
                : this.startGame()
        ))
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

        // O aviso mais recente aparece na propria tela inicial. Atras de um
        // icone no rodape, quem nao clicava nunca ficava sabendo de nada.
        let faixa = document.querySelector('.news-strip')
        if (faixa) {
            faixa.querySelector('.news-strip-title').textContent = avisos[0].title
            faixa.hidden = false
            faixa.addEventListener('click', () => botao.click())
        }

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

        // O nome e o estado do pack moraram aqui ate virarem a aba do modpack;
        // hoje quem os mostra e ela. Aqui sobrou o que e desta tela: o botao.
        let playBTN = document.querySelector('.play-btn')
        if (playBTN) {
            playBTN.textContent = lang.t(
                state === 'install' ? 'home.install' : state === 'update' ? 'home.update' : 'home.play'
            )
        }

        void remote
    }

    async repairPack(instance, base) {

        let infoText = document.querySelector('.info-starting-game-text')
        let progressBar = document.querySelector('.progress-bar')

        await this.entrarEmProgresso()

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

        this.sairDoProgresso()
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

    /* ------------------------------------- interruptores do jogo --------- */

    /**
     * Os três interruptores embaixo do botão: entrar direto, FPS Boost,
     * Essential.
     *
     * Todos os três já existiam, cada um escondido num canto diferente — um
     * nas configurações, dois no menu do modpack. Só que nenhum deles é uma
     * decisão que se toma uma vez na vida: hoje quero entrar direto, hoje o
     * computador está pesado, hoje quero jogar sem cosméticos. Decisão que se
     * revê toda partida mora ao lado do botão de jogar.
     *
     * Os do modpack mexem em disco, então ficam escondidos até dar para saber
     * se são possíveis — e travam enquanto trabalham.
     */
    async interruptores() {
        let instance = await this.currentInstance()
        let base = await this.basePath()

        await this.ligarAutoJoin()
        if (!instance) return

        await this.ligarFps(instance, base)
        await this.ligarEssential(instance, base)
    }

    /** Entrar no servidor sem passar pelo menu de multijogador. */
    async ligarAutoJoin() {
        let campo = document.querySelector('.autojoin-input')
        if (!campo) return

        let config = await this.db.readData('configClient')
        campo.checked = config?.launcher_config?.quickPlay !== false
        document.querySelector('[data-toggle="autojoin"]')?.removeAttribute('hidden')

        campo.addEventListener('change', async () => {
            let config = await this.db.readData('configClient')
            config.launcher_config.quickPlay = campo.checked
            await this.db.updateData('configClient', config)
        })
    }

    /** FPS Boost. Só aparece quando há arquivos onde mexer. */
    async ligarFps(instance, base) {
        let campo = document.querySelector('.fps-input')
        let linha = document.querySelector('[data-toggle="fps"]')
        if (!campo || !linha) return

        let pasta = modpack.dir(base, instance.name)
        let estado = await desempenho.estado(pasta)

        // Antes da primeira partida o Minecraft ainda não escreveu nada: um
        // interruptor que não faria efeito é pior que interruptor nenhum.
        if (!estado.possivel) return

        campo.checked = estado.ligado
        linha.hidden = false

        campo.addEventListener('change', async () => {
            linha.classList.add('ocupado')
            try {
                if (campo.checked) await desempenho.ligar(pasta)
                else await desempenho.desligar(pasta)
            } catch (err) {
                console.error('[fps] falhou pelo interruptor:', err)
                campo.checked = !campo.checked   // não mente sobre o que está valendo
            } finally {
                linha.classList.remove('ocupado')
            }
        })
    }

    /** Jogar com ou sem o Essential (ou o que mais estiver no catálogo). */
    async ligarEssential(instance, base) {
        let campo = document.querySelector('.essential-input')
        let linha = document.querySelector('[data-toggle="essential"]')
        if (!campo || !linha) return

        let arquivos = await modpack.manifest(instance.url)
        let itens = await extras.estado(base, instance, arquivos)

        // Só o que já está em disco vira interruptor: baixar 50 MB não é coisa
        // para acontecer atrás de um clique sem aviso. Para isso existe a
        // lista completa no menu do modpack.
        let item = itens.find(i => !i.ausente && i.disponivel)
        if (!item) return

        campo.checked = item.ligado
        linha.querySelector('.toggle-text').textContent = item.nome
        linha.hidden = false

        campo.addEventListener('change', async () => {
            linha.classList.add('ocupado')
            try {
                await extras.alternar(base, instance, item.id, campo.checked)
                item.ligado = campo.checked
            } catch (err) {
                console.error('[extras] falhou pelo interruptor:', err)
                campo.checked = !campo.checked
            } finally {
                linha.classList.remove('ocupado')
            }
        })
    }

    /* -------------------------------------------------------- a vigia ---- */

    /**
     * Fica de olho no modpack enquanto o launcher está aberto.
     *
     * Antes a versão publicada era lida uma vez, na abertura. Quem deixa o
     * launcher aberto — e é o normal, ele fica ali atrás do navegador — só
     * descobria que saiu modpack novo fechando e abrindo. Agora o botão muda
     * sozinho, e o sistema avisa.
     *
     * A notificação sai uma vez por versão: repetir a cada checagem seria
     * transformar um aviso útil em algo que se aprende a ignorar.
     */
    vigia() {
        const DE_CINCO_EM_CINCO = 5 * 60 * 1000

        // Avisos do launcher (a checagem em si mora no processo principal).
        ipcRenderer.on('launcher-update', (_, versao) => {
            if (this.avisadoLauncher === versao) return
            this.avisadoLauncher = versao

            ipcRenderer.send('notificar', {
                titulo: lang.t('notify.launcher_title'),
                corpo: lang.t('notify.launcher_text', { version: versao || '' })
            })
        })

        setInterval(() => this.conferirModpack(), DE_CINCO_EM_CINCO)
    }

    async conferirModpack() {
        // No meio de um download não é hora: o estado está mudando de qualquer
        // forma, e trocar o texto do botão por baixo atrapalharia.
        if (this.pausaAtual) return

        try {
            let instance = await this.currentInstance()
            if (!instance) return

            let remote = await modpack.remoteVersion(instance.url)
            if (!remote?.version) return

            let local = modpack.readLocal(await this.basePath(), instance.name)
            if (!local || local.version === remote.version) return

            // O botão passa a dizer Atualizar sem ninguém reiniciar nada.
            await this.refreshState(instance)

            if (this.avisadoModpack === remote.version) return
            this.avisadoModpack = remote.version

            ipcRenderer.send('notificar', {
                titulo: lang.t('notify.pack_title'),
                corpo: lang.t('notify.pack_text', { version: remote.version })
            })
        } catch (err) {
            // Sem internet a vigia simplesmente não faz nada nesta rodada.
            console.error('[vigia] não consegui conferir o modpack:', err.message)
        }
    }

    /* ---------------------------------------------- horas jogadas -------- */

    /**
     * Quantas horas este nick já jogou no Atena.
     *
     * Os números saem do mundo do servidor — o mesmo lugar de onde o site tira
     * o ranking. Quem nunca entrou não tem linha lá, e aí a faixa simplesmente
     * não aparece: melhor do que mostrar "0h" para quem está chegando agora.
     *
     * Nada disso é essencial para jogar, então qualquer falha é silenciosa.
     */
    async mostrarHoras() {
        let selo = document.querySelector('.player-hours')
        if (!selo) return

        try {
            let configClient = await this.db.readData('configClient')
            let conta = await this.db.readData('accounts', configClient?.account_selected)
            if (!conta?.name) return

            let resposta = await fetch(`https://atenasmp.com/api/jogador?nick=${encodeURIComponent(conta.name)}`)
            if (!resposta.ok) return

            let dados = await resposta.json()
            if (!dados?.horas) return

            selo.textContent = lang.t('home.playtime', { hours: Math.round(dados.horas) })
            // A posicao no ranking cabe no titulo: no selo ela deixaria a
            // barra apertada, e nao e o numero que a pessoa procura ali.
            selo.title = lang.t('home.playtime_rank', { position: dados.posicao, total: dados.de })
            selo.hidden = false
        } catch (err) {
            console.error('[horas] não consegui buscar:', err.message)
        }
    }

    /* ------------------------------------------------- barra de baixo ---- */

    /** O cartão do jogador leva às contas, que é onde se troca e se acrescenta. */
    contaBotao() {
        let chip = document.querySelector('.account-chip')
        if (!chip) return

        chip.addEventListener('click', () => {
            changePanel('settings')
            // As configurações abrem na aba que estava aberta da última vez;
            // quem clicou no próprio nick quer as contas.
            document.querySelector('#account')?.click()
        })
    }

    /**
     * Estatísticas: a ficha da pessoa no mundo do servidor, e o placar.
     *
     * Fica fora da ramificação de banido de propósito — os números são do que
     * já aconteceu, e continuar podendo vê-los não custa nada.
     */
    estatisticasBotao() {
        document.querySelector('.stats-btn')?.addEventListener('click', () => changePanel('estatisticas'))
    }

    /** Suporte: o mesmo relatório do menu do modpack, a um clique da barra. */
    suporteBotao() {
        document.querySelector('.support-btn')?.addEventListener('click', async () => {
            let instance = await this.currentInstance()
            if (!instance) return
            this.reportProblem(instance, await this.basePath())
        })
    }

    /* ------------------------------------------ pedidos da aba do pack --- */

    /**
     * A aba do modpack pede, a tela inicial executa.
     *
     * Tudo o que precisa da barra de progresso mora aqui, porque a barra está
     * aqui. Duplicar a barra na outra página daria duas barras que podem
     * discordar uma da outra; mandar a pessoa de volta para esta tela é mais
     * honesto — ela precisa VER o que pediu acontecendo.
     */
    ouvirAAba() {
        document.addEventListener('atena:modpack', async e => {
            let acao = e.detail?.acao
            changePanel('home')

            let instance = await this.currentInstance()
            if (!instance) return
            let base = await this.basePath()

            if (acao === 'repair') return this.executar(() => this.repairPack(instance, base))
            if (acao === 'report') return this.reportProblem(instance, base)
            if (acao === 'reinstall') return this.executar(() => this.reinstalar(instance, base))
            if (acao === 'changelog') return this.showChangelog(instance, null)
            if (acao === 'import' && e.detail.pasta) {
                return this.executar(() => this.importarDe(instance, base, e.detail.pasta))
            }
        })

        // Trocou de pack, ligou o Essential, mexeu no FPS Boost: o botão e os
        // interruptores desta tela falam de outro estado agora.
        document.addEventListener('atena:trocou-pack', async () => {
            let instance = await this.currentInstance()
            if (!instance) return

            this.currentStatusInstance = instance
            await setStatus(instance.status, instance)
            await this.refreshState(instance)
            await this.interruptores()
        })
    }

    /**
     * Apaga o modpack para ele ser baixado de novo do zero.
     *
     * Antes de apagar qualquer coisa, guarda uma cópia — é a única ação do
     * launcher que destrói arquivo de propósito, e a rede de segurança é o que
     * torna aceitável oferecê-la com um clique.
     */
    async reinstalar(instance, base) {
        if (!confirm(lang.t('home.reinstall_confirm'))) return

        let configClient = await this.db.readData('configClient')
        let userProtected = configClient?.launcher_config?.protected || []

        let infoText = document.querySelector('.info-starting-game-text')
        let progressBar = document.querySelector('.progress-bar')
        await this.entrarEmProgresso()

        try {
            infoText.innerHTML = lang.t('home.backup')
            try {
                await backup.run(base, instance.name, instance.backup || [], (feitos, total) => {
                    let agora = Date.now()
                    if (feitos !== total && agora - (this.ultimoDesenho || 0) < 120) return
                    this.ultimoDesenho = agora
                    infoText.innerHTML = lang.t('home.backup_progress', {
                        percent: ((feitos / Math.max(1, total)) * 100).toFixed(0)
                    })
                    progressBar.value = feitos
                    progressBar.max = total
                })
            } catch (err) {
                console.error('[backup] falhou antes de reinstalar:', err)
            }

            // Mundos, prints e o que o jogador protegeu sobrevivem.
            await modpack.reinstall(base, instance.name, [...(instance.ignored || []), ...userProtected])
            await this.refreshState(instance)
        } finally {
            this.sairDoProgresso()
        }

        new popup().openPopup({
            title: lang.t('home.pack_options'),
            content: lang.t('home.reinstall_done'),
            color: 'var(--gold)',
            options: true
        })
    }

    /* --------------------------------------------- a saída do botão ------ */

    /**
     * O botão de jogar se dissolve antes de a barra aparecer.
     *
     * Sem isso a troca acontece de um quadro para o outro, e num clique que
     * pode demorar a responder essa piscada é a única confirmação de que o
     * clique foi registrado.
     */
    animarSaida() {
        let alvo = document.querySelector('.play-instance')
        if (!alvo) return Promise.resolve()

        alvo.classList.add('leaving')
        return new Promise(seguir => setTimeout(() => {
            alvo.classList.remove('leaving')
            seguir()
        }, 260))
    }

    /* ------------------------------------ importar um modpack do disco --- */

    /**
     * Copia da pasta escolhida tudo o que bater com o manifesto.
     *
     * Usa a mesma barra e o mesmo botão de pausa do download, porque a
     * conferência é do mesmo tamanho: 5 mil arquivos, 1,6 GB de SHA-1.
     */
    async importarDe(instance, base, origem) {
        const path = require('path')
        let destino = modpack.dir(base, instance.name)

        if (path.resolve(origem).toLowerCase() === path.resolve(destino).toLowerCase()) {
            return new popup().openPopup({
                title: lang.t('import.title'),
                content: lang.t('import.same_folder'),
                color: 'red',
                options: true
            })
        }

        let arquivos = await modpack.manifest(instance.url)
        if (!arquivos.length) {
            return new popup().openPopup({
                title: lang.t('import.title'),
                content: lang.t('import.no_manifest'),
                color: 'red',
                options: true
            })
        }

        let configClient = await this.db.readData('configClient')
        let protegidos = await modpack.expandProtected(
            instance.url, configClient?.launcher_config?.protected || []
        )

        let infoText = document.querySelector('.info-starting-game-text')
        let progressBar = document.querySelector('.progress-bar')
        let speedElement = document.querySelector('.download-speed')

        await this.entrarEmProgresso()

        let pausa = new Pausa()
        this.pausaAtual = pausa
        let soltarControles = this.ligarControles(pausa, infoText)

        try {
            let resultado = await importar.importar({
                origem,
                destino,
                arquivos,
                protegidos,
                pausa,
                aoProgresso: dados => {
                    if (pausa.ativa) return

                    let agora = Date.now()
                    if (dados.feitos !== dados.total && agora - (this.ultimoDesenho || 0) < 100) return
                    this.ultimoDesenho = agora

                    infoText.innerHTML = lang.t('import.working', {
                        percent: ((dados.feitos / dados.total) * 100).toFixed(0),
                        count: dados.copiados
                    })
                    progressBar.value = dados.feitos
                    progressBar.max = dados.total
                    if (speedElement) speedElement.textContent = this.tamanhoCurto(dados.bytes)
                    ipcRenderer.send('main-window-progress', { progress: dados.feitos, size: dados.total })
                }
            })

            // O hash de cada arquivo copiado já é conhecido. Passar isso ao
            // cache é o que impede o próximo Jogar de reler 1,6 GB para
            // descobrir o que a importação acabou de garantir.
            modpack.semearCache(destino, resultado.hashes)

            await this.refreshState(instance)

            new popup().openPopup({
                title: lang.t('import.title'),
                content: resultado.cancelado
                    ? lang.t('import.cancelled', { count: resultado.copiados })
                    : resultado.copiados
                        ? lang.t('import.done', {
                            count: resultado.copiados,
                            size: this.tamanhoCurto(resultado.bytes),
                            missing: resultado.faltando
                        })
                        : lang.t('import.empty'),
                color: resultado.copiados ? 'var(--success)' : 'var(--gold)',
                options: true
            })
        } finally {
            soltarControles()
            this.sairDoProgresso()
        }
    }

    /* --------------------------------------------------- o pacote -------- */

    /**
     * Baixa o modpack em pacote, quando o servidor oferece um.
     *
     * São 5.668 arquivos. Baixá-los um a um custa 5.668 conexões, e o servidor
     * do Atena entrega 4 MB/s — medi. Como pacote é UM download, e ele pode
     * morar num CDN que entrega 27 MB/s. É a diferença entre sete minutos e um.
     *
     * Não substitui a sincronização: ela roda depois, confere tudo contra o
     * manifesto e completa o que faltar. O pacote é um atalho, não uma
     * autoridade — se ele vier pela metade, o passo seguinte conserta.
     *
     * Devolve quantos arquivos entraram, ou 0 se não havia pacote.
     */
    async baixarPacote(instance, base, oferta, { pausa, infoText, progressBar, speedElement, etaElement }) {
        if (!oferta?.partes?.length) return 0

        let pasta = modpack.dir(base, instance.name)
        let arquivos = await modpack.manifest(instance.url)

        // O que a pessoa mexeu não pode ser sobrescrito pelo pacote — mesma
        // regra da sincronização, só que perguntada de uma vez, antes.
        infoText.innerHTML = lang.t('home.pack_checking')
        let meus = await modpack.preservaveis(pasta, arquivos)

        let porCaminho = new Map(arquivos.map(a => [a.path, a]))
        let escritos = []
        let bytesAntes = 0
        let ultimoBytes = 0
        let ultimoInstante = Date.now()

        for (let i = 0; i < oferta.partes.length; i++) {
            let parte = oferta.partes[i]

            let resultado = await pacote.baixarEExtrair(parte.url, pasta, {
                pausa,
                hashEsperado: parte.hash,
                tamanhoEsperado: parte.tamanho,
                decidir: caminho => meus.has(caminho) ? 'pular' : 'gravar',
                aoProgresso: dados => {
                    if (pausa.ativa) return

                    let agora = Date.now()
                    if (agora - (this.ultimoDesenho || 0) < 100) return
                    this.ultimoDesenho = agora

                    let bytes = bytesAntes + dados.bytes
                    infoText.innerHTML = lang.t(
                        oferta.tipo === 'delta' ? 'home.pack_delta' : 'home.pack_full',
                        {
                            percent: oferta.tamanho ? ((bytes / oferta.tamanho) * 100).toFixed(0) : '0',
                            part: i + 1, parts: oferta.partes.length
                        }
                    )
                    progressBar.value = bytes
                    progressBar.max = oferta.tamanho || 1
                    ipcRenderer.send('main-window-progress', { progress: bytes, size: oferta.tamanho || 1 })

                    if (agora - ultimoInstante > 700) {
                        let velocidade = (bytes - ultimoBytes) / ((agora - ultimoInstante) / 1000)
                        ultimoBytes = bytes
                        ultimoInstante = agora

                        if (speedElement) speedElement.textContent = `${(velocidade / 131072).toFixed(1)} Mb/s`
                        if (etaElement && velocidade > 0) {
                            etaElement.textContent = lang.t('home.eta', {
                                time: this.tempoCurto(Math.max(0, (oferta.tamanho - bytes) / velocidade))
                            })
                        }
                    }
                }
            })

            bytesAntes += parte.tamanho
            escritos.push(...resultado.escritos)
        }

        // O hash de cada arquivo que veio no pacote já é conhecido: é o do
        // manifesto. Passar isso ao cache é o que impede a conferência
        // seguinte de reler 1,7 GB para descobrir o que o pacote garantiu.
        let semente = {}
        for (let relativo of escritos) {
            let arquivo = porCaminho.get(relativo)
            if (!arquivo) continue

            try {
                let stat = await require('fs/promises').stat(require('path').join(pasta, relativo))
                semente[relativo] = {
                    size: stat.size, mtimeMs: stat.mtimeMs,
                    hash: arquivo.hash, servidor: arquivo.hash
                }
            } catch { /* sumiu logo depois de escrito: o sync resolve */ }
        }
        modpack.semearCache(pasta, semente)

        return escritos.length
    }

    /**
     * Roda uma tarefa longa, e só uma por vez.
     *
     * O botão volta a aparecer assim que um download é cancelado, e clicar de
     * novo começava um segundo download por cima do primeiro — dois conjuntos
     * de trabalhadores gravando na mesma pasta. A trava é marcada antes de
     * qualquer `await`, senão dois cliques rápidos passariam os dois.
     */
    async executar(tarefa) {
        if (this.ocupado) return
        this.ocupado = true

        try {
            await tarefa()
        } catch (err) {
            // Desistir não é falha: quem apertou cancelar já sabe o que houve.
            if (!err?.cancelado) this.falhouAoIniciar(err)
        } finally {
            this.ocupado = false
        }
    }

    /** "1,6 GB" a partir de bytes. */
    tamanhoCurto(bytes) {
        let n = Number(bytes) || 0
        if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`
        if (n >= 1048576) return `${Math.round(n / 1048576)} MB`
        return `${Math.max(1, Math.round(n / 1024))} KB`
    }

    /* ------------------------------------------ a área de progresso ------ */

    /**
     * Troca o botão de jogar pela barra de progresso.
     *
     * Estava copiado em quatro lugares — atualizar, reparar, importar e jogar —
     * e cada cópia esquecia de esconder uma coisa diferente. Aqui é um lugar só,
     * e a animação de saída do botão vem junto de graça.
     */
    async entrarEmProgresso({ animar = true } = {}) {
        if (animar) await this.animarSaida()

        for (let seletor of ['.play-instance', '.toggles', '.news-strip']) {
            let elemento = document.querySelector(seletor)
            if (elemento) elemento.style.display = 'none'
        }

        let infoBox = document.querySelector('.info-starting-game')
        let progressBar = document.querySelector('.progress-bar')

        infoBox.style.display = 'block'
        progressBar.style.display = ''
        progressBar.value = 0
        ipcRenderer.send('main-window-progress-load')
    }

    /** Devolve a tela ao repouso. Roda em `finally`: erro ou não, o botão volta. */
    sairDoProgresso() {
        let infoBox = document.querySelector('.info-starting-game')
        if (infoBox) infoBox.style.display = 'none'

        let play = document.querySelector('.play-instance')
        if (play) play.style.display = 'flex'

        for (let seletor of ['.toggles', '.news-strip']) {
            let elemento = document.querySelector(seletor)
            // Só devolve o que estava lá antes: a faixa de avisos e as horas
            // podem nunca ter aparecido.
            if (elemento && !elemento.hidden) elemento.style.display = ''
        }

        let progressBar = document.querySelector('.progress-bar')
        if (progressBar) progressBar.value = 0

        for (let seletor of ['.download-speed', '.download-eta']) {
            let elemento = document.querySelector(seletor)
            if (elemento) elemento.textContent = ''
        }

        ipcRenderer.send('main-window-progress-reset')
    }

    /**
     * Liga os botões de pausar e cancelar a uma tarefa.
     *
     * Devolve a função que os desliga — chamar no `finally`, senão o botão
     * continua ligado à tarefa antiga e o clique seguinte pausa um download
     * que já acabou.
     */
    ligarControles(pausa, infoText) {
        let pauseBTN = document.querySelector('.pause-btn')
        let cancelBTN = document.querySelector('.cancel-btn')

        if (pauseBTN) {
            pauseBTN.hidden = false
            pauseBTN.textContent = lang.t('home.pause')
            pauseBTN.classList.remove('paused')
            pauseBTN.onclick = () => {
                let pausado = pausa.alternar()
                pauseBTN.textContent = lang.t(pausado ? 'home.resume' : 'home.pause')
                pauseBTN.classList.toggle('paused', pausado)

                if (pausado) {
                    infoText.innerHTML = lang.t('home.paused')
                    for (let seletor of ['.download-speed', '.download-eta']) {
                        let elemento = document.querySelector(seletor)
                        if (elemento) elemento.textContent = ''
                    }
                    ipcRenderer.send('main-window-progress-reset')
                }
            }
        }

        if (cancelBTN) {
            cancelBTN.hidden = false
            cancelBTN.textContent = lang.t('home.cancel')
            cancelBTN.onclick = () => {
                cancelBTN.disabled = true
                infoText.innerHTML = lang.t('home.cancelling')
                pausa.cancelar()
            }
        }

        return () => {
            for (let botao of [pauseBTN, cancelBTN]) {
                if (!botao) continue
                botao.hidden = true
                botao.disabled = false
                botao.onclick = null
                botao.classList.remove('paused')
            }
            pausa.reiniciar()
            this.pausaAtual = null
        }
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

        let infoText = document.querySelector('.info-starting-game-text')
        let progressBar = document.querySelector('.progress-bar')
        let speedElement = document.querySelector('.download-speed')
        let etaElement = document.querySelector('.download-eta')

        await this.entrarEmProgresso()

        // Pausar e cancelar são cooperativos: o download para entre um arquivo
        // e outro, então nada fica pela metade e nada é rebaixado depois.
        let pausa = new Pausa()
        this.pausaAtual = pausa
        let soltarControles = this.ligarControles(pausa, infoText)

        // Antes de mexer nos arquivos, guarda uma cópia das pastas do jogador.
        // Na primeira instalação não há nada para guardar.
        if (instance.backup?.length && this.packState !== 'install') {
            infoText.innerHTML = lang.t('home.backup')
            try {
                await backup.run(base, instance.name, instance.backup, (feitos, total) => {
                    // São milhares de arquivos: sem número, isto parecia travado.
                    let agora = Date.now()
                    if (feitos !== total && agora - (this.ultimoDesenho || 0) < 120) return
                    this.ultimoDesenho = agora

                    infoText.innerHTML = lang.t('home.backup_progress', {
                        percent: ((feitos / Math.max(1, total)) * 100).toFixed(0)
                    })
                    progressBar.value = feitos
                    progressBar.max = total
                })
            } catch (err) {
                console.error('[backup] falhou, seguindo mesmo assim:', err)
            }
        }

        let userProtected = configClient?.launcher_config?.protected || []
        let protegidos = await modpack.expandProtected(instance.url, userProtected)

        // A versão que estava aqui antes: é a partir dela que o changelog
        // conta o que a pessoa perdeu.
        let versaoAnterior = modpack.readLocal(base, instance.name)?.version ?? null

        // Guardado antes: depois do sync o estado ja mudou, e o aviso de
        // cancelamento precisa saber se era instalacao ou atualizacao.
        let anteriorAoSync = this.packState

        let ultimoBytes = 0
        let ultimoInstante = Date.now()

        try {
            // Se o servidor publicou um pacote, ele vem primeiro: um download
            // em vez de 5.668. A sincronizacao logo abaixo confere o resultado
            // e completa o que faltar, entao um pacote incompleto nao quebra
            // nada — so deixa mais trabalho para ela.
            let doPacote = 0
            try {
                let oferta = (await modpack.remoteVersion(instance.url, versaoAnterior))?.pacote
                doPacote = await this.baixarPacote(instance, base, oferta, {
                    pausa, infoText, progressBar, speedElement, etaElement
                })
            } catch (err) {
                if (err?.cancelado) throw err
                console.error('[pacote] nao consegui usar o pacote, indo arquivo a arquivo:', err.message)
            }

            let resultado = await modpack.sync(base, instance, {
                ignored: protegidos,
                // O que o launcher oferece como opcional nunca e apagado por
                // ter saido do pack: e o caso do Essential.
                naoApagar: extras.caminhosDoCatalogo(),
                concorrencia: Number(configClient?.launcher_config?.download_multi) || 16,
                pausa,
                aoProgresso: dados => {
                    // Pausado: a tela fica dizendo isso, não voltando a mostrar
                    // o progresso do último arquivo que ainda estava terminando.
                    if (pausa.ativa) return
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

            // O modpack acabou de chegar (ou de mudar), entao os arquivos dos
            // mods sao os de fabrica. As escolhas da pessoa entram agora, e nao
            // so na proxima partida.
            try {
                await preferencias.aplicar(modpack.dir(base, instance.name), configClient?.setup?.escolhas)
            } catch (err) {
                console.error('[ajustes] nao consegui aplicar depois da sincronizacao:', err.message)
            }

            // Só agora o modpack está em dia: anota a versão.
            let remote = await modpack.remoteVersion(instance.url)
            if (remote) {
                modpack.writeLocal(base, instance.name, {
                    version: remote.version,
                    publishedAt: remote.publishedAt,
                    syncedAt: new Date().toISOString()
                })
            }

            let anterior = anteriorAoSync
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
                    content: lang.t('home.sync_done', { count: resultado.baixados }) +
                        // Tirar mod tambem e mudanca, e some sem deixar rastro
                        // se ninguem disser.
                        (resultado.removidos?.length
                            ? '<br><br>' + lang.t('home.sync_removed', { count: resultado.removidos.length })
                            : '') +
                        // Dizer que os arquivos da pessoa ficaram e o que
                        // transforma "confie em mim" em algo verificavel.
                        (resultado.preservados?.length
                            ? '<br><br>' + lang.t('home.sync_kept', { count: resultado.preservados.length })
                            : ''),
                    color: 'var(--success)',
                    options: true
                })
            }

            // Atualizou de verdade? Conta o que mudou.
            if (anterior === 'update' && versaoAnterior !== null) await this.showChangelog(instance, versaoAnterior)
        } catch (err) {
            // Desistir não é falha: quem apertou cancelar já sabe o que houve.
            if (!err?.cancelado) throw err

            await this.refreshState(instance)
            new popup().openPopup({
                title: lang.t(anteriorAoSync === 'install' ? 'home.install' : 'home.update'),
                content: lang.t('home.cancelled'),
                color: 'var(--gold)',
                options: true
            })
        } finally {
            soltarControles()
            this.sairDoProgresso()
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

        this.sairDoProgresso()

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

        // Conta selecionada que não existe mais (ou que foi salva quebrada) não
        // tem como autenticar. Melhor dizer isso aqui, com o que fazer, do que
        // deixar o minecraft-java-core responder "Authenticator not found".
        if (!authenticator?.name || !authenticator?.uuid) {
            registro.erro('ao começar o jogo', `conta selecionada invalida (id ${configClient.account_selected})`)
            new popup().openPopup({
                title: lang.t('account.invalid_title'),
                content: lang.t('account.invalid_text'),
                color: 'red',
                options: true
            })
            // A área de progresso só abre mais adiante; aqui não há o que fechar.
            return
        }
        let options = instance.find(i => i.name == configClient.instance_select)

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
            '.atena-extras.json',
            '.atena-fps.json',
            // Os mods opcionais nao estao no manifesto. Sem esta linha, a
            // primeira atualizacao do modpack apagaria o Essential junto com o
            // resto do que "sobrou" - e a pessoa reinstalaria toda semana.
            ...extras.caminhosProtegidos(base, options),
            ...await modpack.expandProtected(options.url, userProtected)
        ]

        let opt = {
            // A sincronizacao do modpack e nossa. Passar a URL aqui faria a
            // biblioteca conferir os 5.668 arquivos DE NOVO e, pior, rebaixar
            // por cima de tudo que a pessoa tiver mexido - era a segunda razao
            // de as configuracoes voltarem ao padrao.
            //
            // Com o modo estrito ligado a URL precisa ir: e ela que diz a
            // biblioteca o que PODE existir, e sem ela o checkFiles apagaria o
            // modpack inteiro.
            url: options.verify ? options.url : null,
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

        await this.entrarEmProgresso()

        infoStarting.innerHTML = lang.t(
            state === 'install' ? 'home.installing' : state === 'update' ? 'home.updating' : 'home.connecting'
        )

        // O backup existe por causa do modo estrito: com ele ligado, qualquer
        // arquivo fora do modpack é apagado, e a cópia é a rede de segurança
        // para o que a staff esqueceu de ignorar.
        //
        // Com o modo estrito DESLIGADO, jogar não apaga nada — e então copiar
        // 535 MB antes de cada partida é espera pura, por uma proteção contra
        // um risco que não existe. O download já tem o seu próprio backup.
        if (options.backup?.length && state !== 'install' && options.verify) {
            infoStarting.innerHTML = lang.t('home.backup')
            try {
                await backup.run(base, options.name, options.backup, (feitos, total) => {
                    let agora = Date.now()
                    if (feitos !== total && agora - (this.ultimoDesenho || 0) < 120) return
                    this.ultimoDesenho = agora
                    infoStarting.innerHTML = lang.t('home.backup_progress', {
                        percent: ((feitos / Math.max(1, total)) * 100).toFixed(0)
                    })
                    progressBar.value = feitos
                    progressBar.max = total
                })
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

        // O FPS Boost e os ajustes dos mods mexem em arquivos que vem do
        // modpack, entao uma atualizacao os devolve ao padrao. Reaplicar aqui e
        // o que impede os dois de sumirem sozinhos, sem a pessoa entender por
        // que.
        try {
            await desempenho.reaplicar(modpack.dir(base, options.name))
        } catch (err) {
            console.error('[fps] nao consegui reaplicar:', err.message)
        }

        try {
            await preferencias.aplicar(modpack.dir(base, options.name), configClient?.setup?.escolhas)
        } catch (err) {
            console.error('[ajustes] nao consegui reaplicar:', err.message)
        }

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
            this.sairDoProgresso()
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
            this.sairDoProgresso()
            infoStarting.innerHTML = lang.t('home.verifying')
            if (speedElement) speedElement.textContent = ''
            if (etaElement) etaElement.textContent = ''
            new logger(pkg.name, '#7289da');
            this.marked = false
            console.log(err);
        });

        // Por último, e não logo depois de montar `opt`.
        //
        // O minecraft-java-core confere o autenticador DENTRO do Launch() e
        // dispara `emit('error')` na mesma hora, antes de qualquer `await`.
        // Com o Launch() chamado antes dos ouvintes, esse erro saía sem
        // ninguém escutando: o Node o transformava em "Unhandled error", o
        // jogo não abria e a pessoa não via mensagem nenhuma — só o log.
        launch.Launch(opt);
    }
}
export default Home;
