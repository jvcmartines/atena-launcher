/**
 * Avisos da staff e o que mudou no modpack.
 *
 * São duas coisas parecidas mas de origens diferentes:
 *
 *   avisos    — texto escrito no painel ("manutenção às 20h", "evento sábado").
 *               Fica em /api/articles e não tem nada a ver com versão.
 *   changelog — o que mudou em cada versão publicada do modpack. Vem de
 *               /api/instances/:id/changelog, e o launcher pede só o que saiu
 *               depois da versão que o jogador tem instalada.
 *
 * O segundo é o que responde "atualizou o quê?" — pergunta que hoje só tinha
 * resposta no Discord.
 */
import config from './config.js';

class News {
    /** Avisos publicados, mais recentes primeiro. */
    async articles() {
        try {
            const response = await fetch(`${config.getApiUrl()}/articles`, { headers: config.headers() });
            if (!response.ok) return [];

            const list = await response.json();
            return Array.isArray(list) ? list : [];
        } catch (err) {
            console.error('[news] não consegui buscar os avisos:', err.message);
            return [];
        }
    }

    /**
     * Versões publicadas depois da que o jogador tem.
     * `since` nulo devolve o histórico inteiro.
     */
    async changelog(manifestUrl, since) {
        try {
            const [base, query] = String(manifestUrl).split('?');
            let url = base.replace(/\/files$/, '/changelog');

            const params = new URLSearchParams(query || '');
            if (Number.isFinite(Number(since))) params.set('since', String(since));
            const busca = params.toString();
            if (busca) url += `?${busca}`;

            const response = await fetch(url, { headers: config.headers() });
            if (!response.ok) return [];

            const list = await response.json();
            return Array.isArray(list) ? list : [];
        } catch (err) {
            console.error('[news] não consegui buscar o changelog:', err.message);
            return [];
        }
    }
}

export default new News;
