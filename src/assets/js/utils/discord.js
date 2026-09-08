/**
 * Atena Launcher — conexão com o Discord
 *
 * Fluxo:
 *   1. pedimos ao servidor um endereço de autorização e um `state`
 *   2. abrimos esse endereço numa janela — é a tela oficial do Discord
 *   3. a pessoa aprova; o Discord redireciona para o nosso servidor, que
 *      troca o código pelo token e guarda o registro do jogador
 *   4. enquanto isso, aqui a gente pergunta ao servidor se já terminou
 *
 * O launcher nunca vê a senha nem o client_secret: só recebe no fim um token
 * assinado pelo servidor, que fica salvo na máquina para se identificar.
 */

const { ipcRenderer } = require('electron');

const POLL_MS = 1500;
const TIMEOUT_MS = 3 * 60 * 1000;

class Discord {
    constructor() {
        this.api = '';
        this.token = null;
    }

    configure(apiUrl, token) {
        this.api = (apiUrl || '').replace(/\/+$/, '');
        this.token = token || null;
        return this;
    }

    headers() {
        return this.token ? { 'x-atena-player': this.token } : {};
    }

    /** Situação atual: está ligado? é obrigatório? quem é a pessoa? */
    async status() {
        try {
            const response = await fetch(`${this.api}/discord/config`, { headers: this.headers() });
            if (!response.ok) return { enabled: false };
            return await response.json();
        } catch {
            return { enabled: false };
        }
    }

    /**
     * Abre a janela do Discord e espera a pessoa aprovar.
     * Devolve { token, player } quando dá certo, ou { error } com uma chave de
     * tradução para mostrar na tela.
     */
    async link() {
        let start;
        try {
            const response = await fetch(`${this.api}/discord/start`, { method: 'POST' });
            if (!response.ok) {
                const detail = await response.json().catch(() => ({}));
                return { error: 'discord.not_configured', detail: detail.error };
            }
            start = await response.json();
        } catch {
            return { error: 'discord.no_connection' };
        }

        // A janela resolve quando fecha; o resultado vem do servidor.
        let windowOpen = true;
        ipcRenderer.invoke('discord-window', start.url).then(() => { windowOpen = false; });

        const deadline = Date.now() + TIMEOUT_MS;

        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, POLL_MS));

            let session;
            try {
                const response = await fetch(`${this.api}/discord/session/${start.state}`);
                session = await response.json();
            } catch {
                continue;
            }

            if (session.status === 'linked') {
                ipcRenderer.send('discord-window-close');
                this.token = session.token;
                return { token: session.token, player: session.player };
            }

            if (session.status === 'banned') {
                ipcRenderer.send('discord-window-close');
                return { error: 'discord.banned', detail: session.message };
            }

            if (session.status === 'not-in-guild') {
                ipcRenderer.send('discord-window-close');
                return { error: 'discord.not_in_guild' };
            }

            if (session.status === 'cancelled' || session.status === 'expired') {
                ipcRenderer.send('discord-window-close');
                return { error: 'discord.cancelled' };
            }

            if (session.status === 'error') {
                ipcRenderer.send('discord-window-close');
                return { error: 'discord.failed', detail: session.message };
            }

            // A pessoa fechou a janela sem aprovar.
            if (!windowOpen) return { error: 'discord.cancelled' };
        }

        ipcRenderer.send('discord-window-close');
        return { error: 'discord.timeout' };
    }

    /** Avisa o servidor qual nick de Minecraft está em uso agora. */
    async heartbeat(nickname) {
        if (!this.token) return null;

        try {
            const response = await fetch(`${this.api}/players/heartbeat`, {
                method: 'POST',
                headers: { ...this.headers(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname })
            });
            return await response.json().catch(() => null);
        } catch {
            return null;
        }
    }
}

export default new Discord;
