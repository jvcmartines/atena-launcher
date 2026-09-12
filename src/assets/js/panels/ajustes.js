/**
 * Atena Launcher — a tela de ajustes do jogo
 *
 * Dois mods do pack precisam ser configurados antes da primeira partida: o
 * asmp_translate (que idioma a pessoa fala, em que idioma ela lê os balões, o
 * motor de reconhecimento de voz, as cores) e o voicechat (qual microfone).
 *
 * Hoje isso se faz de dentro do jogo, em menus que a pessoa só encontra depois
 * de já ter entrado e não ter entendido nada. Aqui vira uma tela do launcher,
 * que aparece sozinha na primeira vez e fica guardada nas configurações para
 * quando ela quiser mexer de novo.
 *
 * As escolhas moram no `configClient` do launcher, não no arquivo do mod — o
 * arquivo do mod faz parte do modpack, então reinstalar apaga e uma versão nova
 * sobrescreve. O launcher reaplica depois de cada sincronização e antes de cada
 * partida.
 */
import { config, database, changePanel, appdata, lang, modpack, preferencias } from '../utils.js'

/**
 * Quando esta tela precisa aparecer de novo sozinha.
 *
 * Subir este número faz a tela reaparecer uma vez para todo mundo — é o que se
 * usa quando entra uma pergunta nova que ninguém respondeu ainda. Mexer aqui
 * sem ter pergunta nova é só incomodar quem já configurou.
 */
const VERSAO = 1;

class Ajustes {
    static id = "ajustes";

    async init(config) {
        this.config = config
        this.db = new database()

        document.querySelector('.ajustes-voltar')?.addEventListener('click', () => changePanel('home'))
        document.querySelector('.ajustes-salvar')?.addEventListener('click', () => this.salvar())
        document.querySelector('.cores-padrao')?.addEventListener('click', () => this.corPadrao())

        this.motores()
        this.previa()

        document.addEventListener('atena:painel', async e => {
            if (e.detail === 'ajustes') return this.desenhar()

            // Primeira vez — ou primeira vez desde que entrou pergunta nova.
            // A tela aparece sozinha assim que a inicial abre, uma vez por
            // sessão: insistir a cada volta para a home seria armadilha, não
            // ajuda.
            if (e.detail === 'home' && !this.jaOfereci) {
                this.jaOfereci = true
                if (await Ajustes.precisa(this.db)) changePanel('ajustes')
            }
        })
    }

    /** Já respondeu, e na versão atual das perguntas? */
    static async precisa(db) {
        const configClient = await db.readData('configClient')
        return (configClient?.setup?.versao || 0) < VERSAO
    }

    async basePath() {
        return `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`
    }

    async pastaDoPack() {
        const configClient = await this.db.readData('configClient')
        const instancias = await config.getInstanceList()
        const instancia = instancias.find(i => i.name == configClient?.instance_select) || instancias[0]
        if (!instancia) return null
        return modpack.dir(await this.basePath(), instancia.name)
    }

    /* --------------------------------------------------------- desenhar -- */

    async desenhar() {
        const configClient = await this.db.readData('configClient')
        const primeiraVez = (configClient?.setup?.versao || 0) < VERSAO

        const boasVindas = document.querySelector('.ajustes-boasvindas')
        if (boasVindas) boasVindas.hidden = !primeiraVez

        const salvar = document.querySelector('.ajustes-salvar')
        if (salvar) salvar.textContent = lang.t(primeiraVez ? 'ajustes.save_first' : 'ajustes.save')

        // O que vale hoje: primeiro o que a pessoa já escolheu aqui, senão o
        // que está nos arquivos do mod, senão o padrão. Nessa ordem, porque a
        // escolha dela é mais recente que o arquivo quando o pack acabou de ser
        // reinstalado.
        const pasta = await this.pastaDoPack()
        const nosArquivos = pasta ? await preferencias.atuais(pasta) : null

        const semPack = document.querySelector('.ajustes-sem-pack')
        if (semPack) semPack.hidden = Boolean(nosArquivos)

        const atual = {
            falo: 'en', baloes: 'pt', mostrarBaloes: true, motor: 'web_speech',
            corFundo: 'FCFCFC', corTexto: '191919', corBorda: 'B4B4B9',
            microfone: '',
            ...(nosArquivos || {}),
            ...(configClient?.setup?.escolhas || {})
        }

        this.preencherLinguas('ajuste-falo', atual.falo)
        this.preencherLinguas('ajuste-baloes', atual.baloes)
        await this.preencherMicrofones(atual.microfone)

        document.querySelector('#ajuste-mostrar').checked = atual.mostrarBaloes !== false
        this.escolherMotor(atual.motor || 'web_speech')

        this.porCor('#ajuste-cor-fundo', atual.corFundo)
        this.porCor('#ajuste-cor-texto', atual.corTexto)
        this.porCor('#ajuste-cor-borda', atual.corBorda)

        this.pintarPrevia()

        const status = document.querySelector('.ajustes-status')
        if (status) status.textContent = ''
    }

    preencherLinguas(id, escolhido) {
        const campo = document.querySelector(`#${id}`)
        if (!campo) return

        campo.innerHTML = preferencias.LINGUAS
            .map(l => `<option value="${l.codigo}">${l.nome}</option>`)
            .join('')

        // Código que o mod não conhece (config editada à mão) não pode sumir
        // sem aviso: ele entra na lista como está.
        if (escolhido && !preferencias.LINGUAS.some(l => l.codigo === escolhido)) {
            campo.innerHTML += `<option value="${escolhido}">${escolhido}</option>`
        }
        campo.value = escolhido || 'en'
    }

    /**
     * A lista de microfones, com "aparelho padrão" na frente.
     *
     * Padrão primeiro e recomendado porque o nome do aparelho carrega o número
     * da porta USB, que muda se a pessoa trocar o cabo de lugar — e aí o mod
     * não acha mais o microfone escolhido.
     */
    async preencherMicrofones(escolhido) {
        const campo = document.querySelector('#ajuste-microfone')
        if (!campo) return

        const lista = await preferencias.microfones()

        campo.innerHTML = `<option value="">${lang.t('ajustes.mic_default')}</option>`
            + lista.map(m => `<option value="${this.escapar(m.openal)}">${this.escapar(m.nome)}</option>`).join('')

        // O que já estava gravado continua selecionável mesmo que o aparelho
        // não esteja ligado agora.
        if (escolhido && !lista.some(m => m.openal === escolhido)) {
            campo.innerHTML += `<option value="${this.escapar(escolhido)}">${this.escapar(escolhido.replace(/^OpenAL Soft on /, ''))}</option>`
        }
        campo.value = escolhido || ''
    }

    /* ------------------------------------------------------- motor de voz */

    motores() {
        document.querySelector('.ajustes-motores')?.addEventListener('click', e => {
            const motor = e.target.closest('.motor')
            if (motor) this.escolherMotor(motor.dataset.motor)
        })
    }

    escolherMotor(qual) {
        this.motor = qual
        document.querySelectorAll('.ajustes-motores .motor').forEach(m => {
            m.classList.toggle('escolhido', m.dataset.motor === qual)
        })
    }

    /* ------------------------------------------------------------ cores -- */

    previa() {
        for (const id of ['#ajuste-cor-fundo', '#ajuste-cor-texto', '#ajuste-cor-borda']) {
            document.querySelector(id)?.addEventListener('input', () => this.pintarPrevia())
        }
        document.querySelector('#ajuste-mostrar')?.addEventListener('change', () => this.pintarPrevia())
    }

    /** O balão da prévia usa as mesmas cores que vão para o arquivo do mod. */
    pintarPrevia() {
        const balao = document.querySelector('.balao')
        const previa = document.querySelector('.balao-previa')
        if (!balao) return

        balao.style.background = document.querySelector('#ajuste-cor-fundo').value
        balao.style.color = document.querySelector('#ajuste-cor-texto').value
        balao.style.borderColor = document.querySelector('#ajuste-cor-borda').value

        // Balões desligados: a prévia mostra isso apagando, em vez de mentir.
        if (previa) previa.classList.toggle('apagada', !document.querySelector('#ajuste-mostrar').checked)
    }

    corPadrao() {
        this.porCor('#ajuste-cor-fundo', preferencias.CORES_PADRAO.corFundo)
        this.porCor('#ajuste-cor-texto', preferencias.CORES_PADRAO.corTexto)
        this.porCor('#ajuste-cor-borda', preferencias.CORES_PADRAO.corBorda)
        this.pintarPrevia()
    }

    /** O mod grava a cor sem `#`; o campo do navegador exige com. */
    porCor(seletor, hex) {
        const campo = document.querySelector(seletor)
        if (!campo) return
        const limpo = String(hex || '').replace('#', '')
        campo.value = /^[0-9a-f]{6}$/i.test(limpo) ? `#${limpo}` : '#FFFFFF'
    }

    deCor(seletor) {
        return String(document.querySelector(seletor).value).replace('#', '').toUpperCase()
    }

    escapar(texto) {
        return String(texto).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]))
    }

    /* ----------------------------------------------------------- salvar -- */

    async salvar() {
        const botao = document.querySelector('.ajustes-salvar')
        const status = document.querySelector('.ajustes-status')
        botao.disabled = true

        const escolhas = {
            falo: document.querySelector('#ajuste-falo').value,
            baloes: document.querySelector('#ajuste-baloes').value,
            mostrarBaloes: document.querySelector('#ajuste-mostrar').checked,
            motor: this.motor || 'web_speech',
            corFundo: this.deCor('#ajuste-cor-fundo'),
            corTexto: this.deCor('#ajuste-cor-texto'),
            corBorda: this.deCor('#ajuste-cor-borda'),
            microfone: document.querySelector('#ajuste-microfone').value
        }

        try {
            const configClient = await this.db.readData('configClient')
            configClient.setup = { versao: VERSAO, escolhas, em: new Date().toISOString() }
            await this.db.updateData('configClient', configClient)

            // Grava já, se o modpack estiver instalado. Se não estiver, fica
            // guardado e entra sozinho depois do primeiro download.
            const pasta = await this.pastaDoPack()
            const mexidos = pasta ? await preferencias.aplicar(pasta, escolhas) : 0

            if (status) {
                status.textContent = lang.t(mexidos ? 'ajustes.saved' : 'ajustes.saved_later')
                status.classList.add('ok')
            }

            setTimeout(() => changePanel('home'), 900)
        } catch (err) {
            console.error('[ajustes] não consegui salvar:', err)
            if (status) {
                status.textContent = lang.t('ajustes.failed')
                status.classList.remove('ok')
            }
        } finally {
            botao.disabled = false
        }
    }
}

export default Ajustes;
export { VERSAO };
