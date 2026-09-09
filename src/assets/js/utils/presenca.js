/**
 * "Jogando Atena" no perfil do Discord (Rich Presence).
 *
 * Divulgação de graça: quem está jogando aparece para os amigos com o nome do
 * servidor, quantos estão online e um botão para entrar no Discord.
 *
 * Falamos direto com o cliente do Discord, sem biblioteca. O protocolo é
 * simples — um socket local (named pipe no Windows, socket unix no resto) onde
 * cada mensagem é: 4 bytes de operação + 4 bytes de tamanho + JSON.
 *
 * Tudo aqui falha em silêncio de propósito: se o Discord não estiver aberto,
 * ou fechar no meio do jogo, isso não pode atrapalhar quem só quer jogar.
 */

const net = require('net');
const path = require('path');
const os = require('os');

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;

class Presenca {
    constructor() {
        this.socket = null;
        this.pronto = false;
        this.clientId = null;
        this.ultima = null;
    }

    /** Caminhos possíveis do socket. O Discord numera de 0 a 9. */
    *caminhos() {
        const base = process.platform === 'win32'
            ? '\\\\?\\pipe\\'
            : (process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || os.tmpdir()) + path.sep;

        for (let i = 0; i < 10; i += 1) yield `${base}discord-ipc-${i}`;
    }

    async conectar(clientId) {
        if (!clientId) return false;
        if (this.pronto && this.clientId === clientId) return true;

        this.clientId = clientId;
        this.fechar();

        for (const caminho of this.caminhos()) {
            const socket = await this.tentar(caminho);
            if (!socket) continue;

            this.socket = socket;
            socket.on('error', () => this.fechar());
            socket.on('close', () => { this.pronto = false; this.socket = null; });

            this.enviar(OP_HANDSHAKE, { v: 1, client_id: clientId });
            this.pronto = true;

            // Se a conexão foi feita depois de já termos um estado, reaplica.
            if (this.ultima) this.definir(this.ultima);
            return true;
        }
        return false;
    }

    tentar(caminho) {
        return new Promise(resolve => {
            const socket = net.createConnection(caminho);
            const desistir = () => { socket.destroy(); resolve(null); };

            socket.once('connect', () => { socket.removeListener('error', desistir); resolve(socket); });
            socket.once('error', desistir);
            setTimeout(desistir, 800);
        });
    }

    enviar(op, dados) {
        if (!this.socket || this.socket.destroyed) return;

        try {
            const corpo = Buffer.from(JSON.stringify(dados), 'utf8');
            const cabecalho = Buffer.alloc(8);
            cabecalho.writeInt32LE(op, 0);
            cabecalho.writeInt32LE(corpo.length, 4);
            this.socket.write(Buffer.concat([cabecalho, corpo]));
        } catch {
            this.fechar();
        }
    }

    /**
     * Atualiza o que aparece no perfil.
     *
     * `detalhes` é a linha de cima (o modpack), `estado` a de baixo (quantos
     * jogadores). `desde` faz o Discord contar o tempo de jogo sozinho.
     */
    definir({ detalhes, estado, desde, convite }) {
        this.ultima = { detalhes, estado, desde, convite };
        if (!this.pronto) return;

        const atividade = {
            details: detalhes || undefined,
            state: estado || undefined,
            timestamps: desde ? { start: desde } : undefined,
            assets: { large_image: 'atena', large_text: 'Atena SMP' }
        };

        if (convite) {
            atividade.buttons = [{ label: 'Entrar no Discord', url: convite }];
        }

        this.enviar(OP_FRAME, {
            cmd: 'SET_ACTIVITY',
            args: { pid: process.pid, activity: atividade },
            nonce: `${Date.now()}`
        });
    }

    limpar() {
        this.ultima = null;
        if (this.pronto) {
            this.enviar(OP_FRAME, {
                cmd: 'SET_ACTIVITY',
                args: { pid: process.pid, activity: null },
                nonce: `${Date.now()}`
            });
        }
    }

    fechar() {
        this.pronto = false;
        if (this.socket) {
            try { this.socket.destroy(); } catch { /* já morreu */ }
            this.socket = null;
        }
    }
}

export default new Presenca;
