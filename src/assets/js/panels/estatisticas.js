/**
 * Atena Launcher — a aba de estatísticas
 *
 * O Minecraft já conta tudo sozinho: cada jogador tem um
 * `world/stats/<uuid>.json` com horas, blocos minerados, mobs mortos,
 * distância andada. O site lê esses arquivos há tempo, e o launcher já usava
 * um pedaço disso — as horas ao lado do nick na tela inicial. Esta página
 * mostra a ficha inteira, e ao lado dela a de quem está na frente.
 *
 * Por que o lugar importa tanto quanto o número: "4.200 blocos minerados" não
 * diz nada sozinho. "4.200 blocos, 2º lugar" diz. Por isso cada cartão traz a
 * posição junto, e por isso a lista dos dez primeiros fica logo abaixo.
 *
 * Tudo vem de duas rotas públicas do site — `/api/jogador` e
 * `/api/estatisticas`. O launcher roda de `file://`, que para o navegador é a
 * origem "null"; as duas respondem com `access-control-allow-origin: *`
 * justamente por isso.
 *
 * Nada aqui é necessário para jogar. Sem internet, sem servidor, ou com um
 * nick que nunca entrou, a página diz o que houve e não atrapalha mais nada.
 */
import { database, changePanel, lang } from '../utils.js'

const SITE = 'https://atenasmp.com'

/**
 * As categorias, na ordem em que aparecem.
 *
 * `mortes` fica fora do placar de propósito — ser o primeiro em mortes não é
 * conquista — mas continua na ficha da pessoa, porque ali é só um número dela.
 * `casas` é quantas decimais mostrar: km pede uma, o resto é contagem inteira.
 */
const CATEGORIAS = [
    { id: 'horas',     casas: 0, placar: true },
    { id: 'minerados', casas: 0, placar: true },
    { id: 'mobs',      casas: 0, placar: true },
    { id: 'km',        casas: 1, placar: true },
    { id: 'craftados', casas: 0, placar: true },
    { id: 'mortes',    casas: 0, placar: false }
]

class Estatisticas {
    static id = "estatisticas";

    async init(config) {
        this.config = config
        this.db = new database()
        this.categoria = 'horas'

        document.querySelector('.stats-back')?.addEventListener('click', () => changePanel('home'))

        // A página é montada uma vez, na abertura do launcher, mas os números
        // mudam a cada partida de todo mundo. Recarregar a cada visita é o que
        // evita mostrar o placar de ontem.
        document.addEventListener('atena:painel', e => {
            if (e.detail === 'estatisticas') this.carregar()
        })
    }

    /* ----------------------------------------------------- os números ---- */

    /**
     * Busca as duas rotas ao mesmo tempo.
     *
     * Falha de rede e "esse nick nunca entrou" são coisas diferentes, e a tela
     * diz coisas diferentes para cada uma: a primeira é um problema, a segunda
     * é só alguém que ainda não jogou. Por isso 404 vira `null` e não erro.
     */
    async buscar(nick) {
        const pegar = async caminho => {
            const resposta = await fetch(`${SITE}${caminho}`)
            if (resposta.status === 404) return null
            if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
            return resposta.json()
        }

        const [eu, tudo] = await Promise.all([
            nick ? pegar(`/api/jogador?nick=${encodeURIComponent(nick)}`) : null,
            pegar('/api/estatisticas')
        ])

        return { eu, tudo }
    }

    async carregar() {
        const estado = document.querySelector('.stats-state')
        const conteudo = document.querySelector('.stats-content')
        if (!estado || !conteudo) return

        const configClient = await this.db.readData('configClient')
        const conta = await this.db.readData('accounts', configClient?.account_selected)
        this.nick = conta?.name || ''

        this.ficha(conta)

        // Quem reabre a aba quer ver os proprios numeros primeiro. Sem isto
        // ela volta rolada no ponto onde foi deixada, no meio do placar.
        const corpo = document.querySelector('.stats-body')
        if (corpo) corpo.scrollTop = 0

        // Recarregar não pode apagar o que já está na tela: quem volta à aba vê
        // os números de antes enquanto os novos chegam.
        if (!this.dados) {
            estado.textContent = lang.t('stats.loading')
            estado.hidden = false
            conteudo.hidden = true
        }

        try {
            this.dados = await this.buscar(this.nick)
        } catch (err) {
            console.error('[estatisticas] não consegui buscar:', err.message)
            if (!this.dados) {
                estado.textContent = lang.t('stats.offline')
                estado.hidden = false
                conteudo.hidden = true
            }
            return
        }

        estado.hidden = true
        conteudo.hidden = false

        this.ficha(conta, this.dados.eu)
        this.desenharMinhas(this.dados.eu)
        this.desenharAbas()
        this.desenharPlacar()
    }

    /* ------------------------------------------------- coluna esquerda --- */

    /** Cabeça, nick e lugar geral. Funciona antes de os números chegarem. */
    ficha(conta, eu) {
        const cabeca = document.querySelector('.me-head')
        const nome = document.querySelector('.me-name')
        const lugar = document.querySelector('.me-rank')
        if (!cabeca || !nome || !lugar) return

        nome.textContent = conta?.name || lang.t('stats.no_account')

        if (conta?.name) {
            cabeca.style.backgroundImage =
                `url(https://mc-heads.net/avatar/${encodeURIComponent(conta.uuid || conta.name)}/80)`
        }

        if (!eu) {
            lugar.textContent = ''
            return
        }

        lugar.textContent = eu.posicao
            ? lang.t('stats.rank_of', { position: eu.posicao, total: eu.de })
            : lang.t('stats.unranked')
    }

    /* ---------------------------------------------------- meus números --- */

    /**
     * Os seis cartões.
     *
     * Quem nunca entrou no servidor não tem linha no mundo — e aí não são seis
     * zeros, é um aviso de que ainda não há o que mostrar. Zerar tudo faria
     * parecer que a pessoa jogou e não fez nada.
     */
    desenharMinhas(eu) {
        const grade = document.querySelector('.stats-grid')
        if (!grade) return

        if (!eu) {
            grade.innerHTML = `<div class="stats-empty">${lang.t(
                this.nick ? 'stats.never_played' : 'stats.no_account_text'
            )}</div>`
            return
        }

        grade.innerHTML = CATEGORIAS.map(cat => {
            const lugar = eu.posicoes?.[cat.id]
            return `
                <div class="stat-card">
                    <div class="stat-value">${this.numero(eu[cat.id], cat.casas)}</div>
                    <div class="stat-label">${lang.t(`stats.cat_${cat.id}`)}</div>
                    ${lugar ? `<div class="stat-rank">${lang.t('stats.rank_short', { position: lugar })}</div>` : ''}
                </div>`
        }).join('')
    }

    /* --------------------------------------------------------- placar ---- */

    desenharAbas() {
        const abas = document.querySelector('.board-tabs')
        if (!abas) return

        abas.innerHTML = CATEGORIAS.filter(c => c.placar).map(cat => `
            <div class="board-tab${cat.id === this.categoria ? ' active' : ''}" data-cat="${cat.id}">
                ${lang.t(`stats.cat_${cat.id}`)}
            </div>`).join('')

        abas.querySelectorAll('.board-tab').forEach(aba => {
            aba.addEventListener('click', () => {
                this.categoria = aba.dataset.cat
                this.desenharAbas()
                this.desenharPlacar()
            })
        })
    }

    desenharPlacar() {
        const lista = document.querySelector('.board-list')
        if (!lista) return

        const cat = CATEGORIAS.find(c => c.id === this.categoria)
        const linhas = this.dados?.tudo?.rankings?.[this.categoria] || []

        if (!linhas.length) {
            lista.innerHTML = `<div class="stats-empty">${lang.t('stats.board_empty')}</div>`
            return
        }

        const meu = (this.nick || '').toLowerCase()

        lista.innerHTML = linhas.map((linha, i) => {
            // A linha da própria pessoa fica marcada: é o que ela procura ao
            // abrir a lista, e sem marca some entre dez nomes parecidos.
            const sou = linha.nome.toLowerCase() === meu
            return `
                <div class="board-row${sou ? ' me' : ''}">
                    <span class="board-pos">${i + 1}</span>
                    <img class="board-face" alt=""
                        src="https://mc-heads.net/avatar/${encodeURIComponent(linha.nome)}/32"
                        onerror="this.style.visibility='hidden'">
                    <span class="board-name">${linha.nome.replace(/[<>&]/g, '')}</span>
                    <span class="board-value">${this.numero(linha.valor, cat.casas)}</span>
                </div>`
        }).join('')
    }

    /* ---------------------------------------------------------- ajuda ---- */

    /** Separador de milhar no idioma de quem está lendo. */
    numero(valor, casas = 0) {
        const n = Number(valor) || 0
        return n.toLocaleString(lang.code, {
            minimumFractionDigits: casas,
            maximumFractionDigits: casas
        })
    }
}

export default Estatisticas;
