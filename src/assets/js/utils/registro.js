/**
 * Registro de erros do launcher.
 *
 * O motivo de isto existir: quando algo falha dentro de um `await` sem
 * try/catch, a promessa é rejeitada em silêncio. Para quem está usando, o
 * launcher simplesmente não reage — o botão continua lá, nada aparece na tela,
 * e a conclusão natural é "travou". Foi exatamente o que aconteceu com o
 * download, e não havia como saber o que tinha acontecido sem abrir o DevTools.
 *
 * Então: todo erro não tratado passa a ir para um arquivo, e a pessoa vê uma
 * mensagem em vez de um botão morto. O arquivo entra no zip de
 * "Relatar um problema", que é o que a staff pede.
 */

const fs = require('fs');
const path = require('path');

const LIMITE_BYTES = 512 * 1024;   // o log não pode crescer sem fim

class Registro {
    constructor() {
        this.arquivo = null;
        this.aoErro = null;
    }

    /**
     * `basePath` é a pasta do jogo (%appdata%/.Atena). `aoErro` é chamado para
     * cada erro não tratado, para a interface poder mostrar alguma coisa.
     */
    iniciar(basePath, aoErro) {
        this.aoErro = aoErro;

        try {
            fs.mkdirSync(basePath, { recursive: true });
            this.arquivo = path.join(basePath, 'launcher.log');

            // Rotação simples: passou do limite, recomeça guardando o anterior.
            if (fs.existsSync(this.arquivo) && fs.statSync(this.arquivo).size > LIMITE_BYTES) {
                fs.renameSync(this.arquivo, `${this.arquivo}.old`);
            }
        } catch (err) {
            console.error('[registro] não consegui abrir o arquivo de log:', err.message);
            this.arquivo = null;
        }

        this.escrever('--- launcher aberto ---');
        this.capturarGlobais();
        return this;
    }

    /** Erros que ninguém pegou: exceções soltas e promessas rejeitadas. */
    capturarGlobais() {
        window.addEventListener('error', evento => {
            this.erro('erro não tratado', evento.error || evento.message);
        });

        window.addEventListener('unhandledrejection', evento => {
            this.erro('promessa rejeitada sem tratamento', evento.reason);
        });
    }

    escrever(texto) {
        const linha = `[${new Date().toISOString()}] ${texto}\n`;

        if (this.arquivo) {
            try {
                fs.appendFileSync(this.arquivo, linha, 'utf8');
            } catch { /* disco cheio ou sem permissão: não vale derrubar nada por isso */ }
        }
        return linha;
    }

    /**
     * Registra um erro e avisa a interface.
     * `contexto` diz de onde veio ("ao começar o jogo", "ao buscar o manifesto").
     */
    erro(contexto, erro) {
        const mensagem = erro?.message || String(erro || 'erro desconhecido');
        const pilha = erro?.stack || '';

        console.error(`[${contexto}]`, erro);
        this.escrever(`ERRO em ${contexto}: ${mensagem}${pilha ? '\n' + pilha : ''}`);

        try {
            if (this.aoErro) this.aoErro(contexto, mensagem);
        } catch { /* o avisador quebrou; o log já foi gravado, que é o que importa */ }
    }

    caminho() {
        return this.arquivo;
    }
}

export default new Registro;
