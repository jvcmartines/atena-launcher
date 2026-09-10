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
        this.cancelada = false;
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

    /**
     * Desiste da tarefa.
     *
     * Cancelar é a mesma ideia de pausar, levada até o fim: em vez de segurar
     * quem trabalha, avisa que não há mais o que fazer. Como o aviso só chega
     * nos mesmos pontos seguros, o que já veio para o disco fica lá inteiro e
     * é reaproveitado no próximo download — cancelar não joga fora o que já
     * foi baixado.
     */
    cancelar() {
        this.cancelada = true;
        this.retomar();   // solta quem estava parado, para poder ver o cancelamento
    }

    /**
     * Chamado por quem trabalha, nos pontos onde parar é seguro.
     *
     * Lança quando foi cancelado: a exceção é o que interrompe o laço de
     * verdade, sem cada ponto de parada precisar lembrar de conferir.
     */
    esperar() {
        if (this.cancelada) return Promise.reject(new Pausa.Cancelado());
        if (!this.ativa) return Promise.resolve();

        return new Promise((seguir, falhar) => {
            this.aguardando.push(() => {
                if (this.cancelada) falhar(new Pausa.Cancelado());
                else seguir();
            });
        });
    }

    /** Volta ao estado inicial, para a próxima tarefa começar limpa. */
    reiniciar() {
        this.retomar();
        this.cancelada = false;
        this.aoMudar = null;
    }
}

/**
 * O erro que diz "a pessoa desistiu".
 *
 * Tem nome próprio para quem trata o erro conseguir distinguir desistência de
 * falha — uma merece um aviso vermelho, a outra não merece aviso nenhum.
 */
Pausa.Cancelado = class Cancelado extends Error {
    constructor() {
        super('cancelado');
        this.name = 'Cancelado';
        this.cancelado = true;
    }
};

export default Pausa;
