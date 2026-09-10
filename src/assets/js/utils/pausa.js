/**
 * Pausa cooperativa para tarefas longas.
 *
 * Não interrompe nada à força: quem está trabalhando pergunta "posso seguir?"
 * nos pontos em que parar é seguro, e fica esperando aqui até a pessoa mandar
 * continuar. No download isso significa entre um arquivo e outro — nenhum byte
 * é jogado fora, e nenhum `.jar` fica pela metade.
 *
 * O preço é o tempo de resposta: pausar só vale a partir do fim do arquivo em
 * andamento. Com arquivos de uns 300 KB, isso é imperceptível.
 */
class Pausa {
    constructor() {
        this.ativa = false;
        this.aguardando = [];
        this.aoMudar = null;
    }

    pausar() {
        if (this.ativa) return;
        this.ativa = true;
        if (this.aoMudar) this.aoMudar(true);
    }

    retomar() {
        if (!this.ativa) return;
        this.ativa = false;

        // Solta todo mundo que estava esperando, de uma vez.
        const fila = this.aguardando;
        this.aguardando = [];
        for (const seguir of fila) seguir();

        if (this.aoMudar) this.aoMudar(false);
    }

    /** Alterna e devolve o estado novo — é o que o botão precisa. */
    alternar() {
        if (this.ativa) this.retomar();
        else this.pausar();
        return this.ativa;
    }

    /** Chamado por quem trabalha, nos pontos onde parar é seguro. */
    esperar() {
        if (!this.ativa) return Promise.resolve();
        return new Promise(seguir => this.aguardando.push(seguir));
    }

    /** Volta ao estado inicial, para a próxima tarefa começar limpa. */
    reiniciar() {
        this.retomar();
        this.aoMudar = null;
    }
}

export default Pausa;
