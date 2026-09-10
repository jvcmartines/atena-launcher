/**
 * Atena Launcher — a aba do modpack
 *
 * Era um popup de 440 px pendurado no botão de jogar. Tudo o que dizia
 * respeito ao modpack tinha que caber ali dentro: a lista de packs virava uma
 * coluna de nomes sem imagem, e as oito ações viviam no limite de precisar
 * rolar — foi preciso encolher fonte, espaçamento e texto três vezes só para
 * não esconder a última.
 *
 * Como página, cada coisa tem o tamanho que precisa: os packs aparecem com
 * capa e estado, e as ações respiram.
 *
 * O que não mora aqui, e por quê: qualquer tarefa que use a barra de
 * progresso — baixar, reparar, importar — continua na tela inicial, porque é
 * lá que a barra vive. Esta página pede, a inicial executa. O caminho é o
 * evento 'atena:modpack'.
 */
import { config, database, changePanel, appdata, popup, lang, modpack, extras, desempenho, importar } from '../utils.js'

const { shell, ipcRenderer } = require('electron')

class Modpack {
    static id = "modpack";

    async init(config) {
        this.config = config
        this.db = new database()

        document.querySelector('.modpack-back')?.addEventListener('click', () => changePanel('home'))

        this.acoes()
        this.extrasPopup()
        this.importPopup()
        this.fpsPopup()

        // A página é montada uma vez, na abertura do launcher, mas o estado do
        // pack muda o tempo todo. Redesenhar a cada visita é o que evita
        // mostrar "não instalado" para quem acabou de instalar.
        document.addEventListener('atena:painel', e => {
            if (e.detail === 'modpack') this.desenhar()
        })
    }

    /* ------------------------------------------------------- a página ---- */

    async instanciaAtual() {
        let configClient = await this.db.readData('configClient')
        let instances = this.lista || await config.getInstanceList()
        return instances.find(i => i.name == configClient?.instance_select)
    }

    async basePath() {
        return `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`
    }

    async desenhar() {
        let configClient = await this.db.readData('configClient')
        let auth = await this.db.readData('accounts', configClient?.account_selected)

        this.lista = await config.getInstanceList()
        let escolhido = configClient?.instance_select
        let base = await this.basePath()

        let grade = document.querySelector('.modpack-panel .instances-List')
        if (!grade) return

        grade.innerHTML = ''

        for (let instance of this.lista) {
            // Pack restrito a quem está na whitelist não aparece para os outros.
            let visivel = !instance.whitelistActive || instance.whitelist.includes(auth?.name)
            if (!visivel) continue

            let nome = instance.displayName || instance.name
            let arte = instance.image
                ? `<div class="instance-art" style="background-image:url('${this.escapar(instance.image)}')"></div>`
                : `<div class="instance-art sem-foto">${this.escapar(nome.trim()[0] || '?')}</div>`

            grade.innerHTML += `
                <div id="${instance.name}" class="instance-elements${instance.name == escolhido ? ' active-instance' : ''}">
                    ${arte}
                    <span class="instance-name">${this.escapar(nome)}</span>
                    <span class="instance-badge" data-pack="${this.escapar(instance.name)}"></span>
                </div>`
        }

        // O estado de cada pack vem depois: são chamadas de rede, e a lista não
        // pode ficar em branco esperando por elas.
        for (let instance of this.lista) {
            let selo = grade.querySelector(`.instance-badge[data-pack="${instance.name}"]`)
            if (!selo) continue

            modpack.state(base, instance).then(estado => {
                selo.textContent = lang.t(
                    estado === 'install' ? 'home.state_install'
                        : estado === 'update' ? 'home.badge_update' : 'home.badge_ready'
                )
                selo.classList.toggle('novo', estado !== 'ready')
            }).catch(() => { })
        }

        grade.onclick = e => {
            let cartao = e.target.closest('.instance-elements')
            if (cartao) this.escolher(cartao)
        }

        this.desenharLado()
    }

    /** O resumo do menu lateral: qual pack, em que estado, que versão. */
    async desenharLado() {
        let instance = await this.instanciaAtual()
        if (!instance) return

        let base = await this.basePath()
        let nome = document.querySelector('.pack-side-name')
        let estado = document.querySelector('.pack-side-state')
        let versao = document.querySelector('.pack-side-version')

        if (nome) nome.textContent = instance.displayName || instance.name
        if (estado) estado.textContent = lang.t('modpack.checking')

        let [qual, remoto] = await Promise.all([
            modpack.state(base, instance),
            modpack.remoteVersion(instance.url)
        ])

        if (estado) {
            estado.textContent = lang.t(
                qual === 'install' ? 'home.state_install'
                    : qual === 'update' ? 'home.badge_update' : 'home.badge_ready'
            )
            estado.classList.toggle('novo', qual !== 'ready')
        }
        if (versao) versao.textContent = remoto?.version ? `v${remoto.version}` : ''
    }

    async escolher(cartao) {
        let configClient = await this.db.readData('configClient')
        configClient.instance_select = cartao.id
        await this.db.updateData('configClient', configClient)

        document.querySelector('.modpack-panel .active-instance')?.classList.remove('active-instance')
        cartao.classList.add('active-instance')

        await this.desenharLado()
        // A tela inicial precisa saber: o botão e os interruptores são de outro pack agora.
        document.dispatchEvent(new CustomEvent('atena:trocou-pack'))
    }

    escapar(texto) {
        return String(texto).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    }

    tamanhoCurto(bytes) {
        let n = Number(bytes) || 0
        if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`
        if (n >= 1048576) return `${Math.round(n / 1048576)} MB`
        return `${Math.max(1, Math.round(n / 1024))} KB`
    }

    /* --------------------------------------------------------- ações ----- */

    acoes() {
        document.querySelector('.modpack-panel .pack-actions')?.addEventListener('click', async e => {
            let alvo = e.target.closest('.pack-action')
            if (!alvo) return

            let instance = await this.instanciaAtual()
            if (!instance) return
            let base = await this.basePath()

            // O que se resolve aqui mesmo.
            if (alvo.dataset.action === 'folder') {
                let pasta = modpack.dir(base, instance.name)
                require('fs').mkdirSync(pasta, { recursive: true })
                return shell.openPath(pasta)
            }
            if (alvo.dataset.action === 'extras') return this.mostrarExtras(instance, base)
            if (alvo.dataset.action === 'fps') return this.mostrarFps(instance, base)
            if (alvo.dataset.action === 'import') return this.mostrarImport(instance, base)

            // O resto precisa da barra de progresso, que mora na tela inicial.
            this.pedirParaHome(alvo.dataset.action)
        })
    }

    /**
     * Manda a tela inicial executar. Ela troca de painel sozinha, porque a
     * pessoa precisa VER o que pediu acontecendo.
     */
    pedirParaHome(acao, extra = {}) {
        document.dispatchEvent(new CustomEvent('atena:modpack', { detail: { acao, ...extra } }))
    }

    /* ------------------------------------------------- mods opcionais ---- */

    extrasPopup() {
        let caixa = document.querySelector('.modpack-panel .extras-popup')
        if (!caixa) return

        let fechar = () => caixa.style.display = 'none'
        document.querySelector('.modpack-panel .close-extras').addEventListener('click', fechar)
        caixa.addEventListener('click', e => { if (e.target === caixa) fechar() })
    }

    async mostrarExtras(instance, base) {
        let caixa = document.querySelector('.modpack-panel .extras-popup')
        let lista = document.querySelector('.modpack-panel .extras-list')
        caixa.style.display = 'flex'
        lista.innerHTML = `<div class="players-empty">${lang.t('extras.loading')}</div>`

        let arquivos = await modpack.manifest(instance.url)
        let itens = await extras.estado(base, instance, arquivos)

        if (!itens.length) {
            lista.innerHTML = `<div class="players-empty">${lang.t('extras.none')}</div>`
            return
        }

        lista.innerHTML = itens.map(item => `
            <div class="extra-item" data-id="${item.id}">
                <div class="extra-info">
                    <strong>${this.escapar(item.nome)}</strong>
                    <small>${lang.t(`extras.about_${item.id}`)}</small>
                    <span class="extra-meta"></span>
                </div>
                <button class="extra-toggle"></button>
            </div>`).join('')

        for (let item of itens) {
            let linha = lista.querySelector(`.extra-item[data-id="${item.id}"]`)
            this.desenharExtra(linha, item)

            linha.querySelector('.extra-toggle').addEventListener('click', () => {
                this.alternarExtra(instance, base, item, linha)
            })

            if (item.ausente && item.disponivel) {
                extras.versaoRemota(item.id, item.plataforma).then(versao => {
                    if (!versao) return
                    item.versaoRemota = versao
                    this.desenharExtra(linha, item)
                })
            }
        }
    }

    desenharExtra(linha, item) {
        if (!linha) return

        let meta = linha.querySelector('.extra-meta')
        let botao = linha.querySelector('.extra-toggle')

        if (!item.disponivel) {
            meta.textContent = lang.t('extras.unsupported')
            botao.textContent = lang.t('extras.turn_on')
            botao.disabled = true
            return
        }

        botao.disabled = false
        linha.classList.toggle('installed', item.ligado)

        meta.textContent = [
            lang.t(item.ligado ? 'extras.on' : item.ausente ? 'extras.absent' : 'extras.off'),
            // Um mod do pack não tem versão própria: ele acompanha o modpack.
            item.modo === 'pack'
                ? lang.t('extras.from_pack')
                : (item.versao || item.versaoRemota ? `v${item.versao || item.versaoRemota}` : null),
            item.tamanho ? this.tamanhoCurto(item.tamanho) : null
        ].filter(Boolean).join(' · ')

        botao.textContent = lang.t(item.ligado ? 'extras.turn_off' : item.ausente ? 'extras.install' : 'extras.turn_on')
    }

    async alternarExtra(instance, base, item, linha) {
        let botao = linha.querySelector('.extra-toggle')
        botao.disabled = true

        try {
            let feito = await extras.alternar(base, instance, item.id, !item.ligado, ({ bytes, bytesTotais }) => {
                let agora = Date.now()
                if (agora - (this.ultimoExtra || 0) < 120) return
                this.ultimoExtra = agora
                botao.textContent = bytesTotais
                    ? `${((bytes / bytesTotais) * 100).toFixed(0)}%`
                    : this.tamanhoCurto(bytes)
            })

            item.ligado = feito.acao !== 'desligado'
            if (feito.bytes) { item.tamanho = feito.bytes; item.ausente = false }
            document.dispatchEvent(new CustomEvent('atena:trocou-pack'))
        } catch (err) {
            console.error('[extras] falhou:', err)
            let motivo = {
                'sem-versao': 'extras.no_build',
                'sem-plataforma': 'extras.no_build',
                checksum: 'extras.checksum'
            }[err.message]

            new popup().openPopup({
                title: lang.t('extras.title'),
                content: motivo ? lang.t(motivo, { name: item.nome }) : lang.t('extras.failed', { name: item.nome }),
                color: 'red',
                options: true
            })
        } finally {
            botao.disabled = false
            this.desenharExtra(linha, item)
        }
    }

    /* ----------------------------------------------------- FPS Boost ----- */

    fpsPopup() {
        let caixa = document.querySelector('.modpack-panel .fps-popup')
        if (!caixa) return

        let fechar = () => caixa.style.display = 'none'
        document.querySelector('.modpack-panel .close-fps').addEventListener('click', fechar)
        caixa.addEventListener('click', e => { if (e.target === caixa) fechar() })
    }

    async mostrarFps(instance, base) {
        let caixa = document.querySelector('.modpack-panel .fps-popup')
        caixa.style.display = 'flex'
        document.querySelector('.modpack-panel .fps-changes').innerHTML = ''
        await this.desenharFps(instance, base)
    }

    async desenharFps(instance, base) {
        let pasta = modpack.dir(base, instance.name)
        let estado = await desempenho.estado(pasta)

        let texto = document.querySelector('.modpack-panel .fps-state-text')
        let botao = document.querySelector('.modpack-panel .fps-toggle')
        let lista = document.querySelector('.modpack-panel .fps-changes')

        if (!estado.possivel) {
            // Antes da primeira partida o Minecraft ainda não escreveu nada.
            texto.textContent = lang.t('fps.not_yet')
            botao.hidden = true
            lista.innerHTML = ''
            return
        }

        botao.hidden = false
        texto.innerHTML = lang.t(estado.ligado ? 'fps.on' : 'fps.off')
        botao.textContent = lang.t(estado.ligado ? 'fps.turn_off' : 'fps.turn_on')
        botao.classList.toggle('on', estado.ligado)

        lista.innerHTML = estado.mudancas.map(m => `
            <div class="fps-row${m.aplicado ? ' done' : ''}">
                <span class="fps-label">${lang.t(m.rotulo)}</span>
                <span class="fps-values">${this.escapar(m.atual)} <i>→</i> ${this.escapar(m.alvo)}</span>
            </div>`).join('')

        botao.onclick = () => this.alternarFps(instance, base, estado.ligado)
    }

    async alternarFps(instance, base, estavaLigado) {
        let botao = document.querySelector('.modpack-panel .fps-toggle')
        botao.disabled = true

        try {
            let pasta = modpack.dir(base, instance.name)
            if (estavaLigado) await desempenho.desligar(pasta)
            else await desempenho.ligar(pasta)
            document.dispatchEvent(new CustomEvent('atena:trocou-pack'))
        } catch (err) {
            console.error('[fps] falhou:', err)
            new popup().openPopup({
                title: lang.t('fps.title'),
                content: lang.t('fps.failed'),
                color: 'red',
                options: true
            })
        } finally {
            botao.disabled = false
            await this.desenharFps(instance, base)
        }
    }

    /* -------------------------------------------------------- importar --- */

    importPopup() {
        let caixa = document.querySelector('.modpack-panel .import-popup')
        if (!caixa) return

        let fechar = () => caixa.style.display = 'none'
        document.querySelector('.modpack-panel .close-import').addEventListener('click', fechar)
        caixa.addEventListener('click', e => { if (e.target === caixa) fechar() })

        document.querySelector('.modpack-panel .import-browse').addEventListener('click', async () => {
            let escolhida = await ipcRenderer.invoke('choose-folder', lang.t('import.title'))
            if (!escolhida) return

            fechar()
            // Copiar mostra progresso, e a barra mora na tela inicial.
            this.pedirParaHome('import', { pasta: escolhida })
        })
    }

    async mostrarImport(instance, base) {
        let caixa = document.querySelector('.modpack-panel .import-popup')
        let lista = document.querySelector('.modpack-panel .import-list')
        caixa.style.display = 'flex'
        lista.innerHTML = `<div class="players-empty">${lang.t('import.searching')}</div>`

        let achados = await importar.candidatos(await appdata(), modpack.dir(base, instance.name))

        if (!achados.length) {
            lista.innerHTML = `<div class="players-empty">${lang.t('import.nothing')}</div>`
            return
        }

        lista.innerHTML = achados.map((achado, i) => `
            <div class="import-item" data-i="${i}">
                <strong>${this.escapar(achado.rotulo)}</strong>
                <span class="import-meta">${lang.t('import.found', {
                    mods: achado.mods, size: this.tamanhoCurto(achado.bytes)
                })}</span>
                <span class="import-path">${this.escapar(achado.caminho)}</span>
            </div>`).join('')

        lista.querySelectorAll('.import-item').forEach(linha => {
            linha.addEventListener('click', () => {
                caixa.style.display = 'none'
                this.pedirParaHome('import', { pasta: achados[Number(linha.dataset.i)].caminho })
            })
        })
    }
}

export default Modpack;
