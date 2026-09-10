/**
 * Atena Launcher — FPS Boost
 *
 * Derruba as configuracoes graficas do modpack para o minimo. E para quem tem
 * computador fraco e hoje resolve isso entrando no jogo, abrindo cinco menus e
 * mexendo em opcoes que nao sabe o que fazem — quando resolve.
 *
 * Duas decisoes importantes aqui:
 *
 * 1. Antes de mudar qualquer coisa, os valores originais vao para um arquivo.
 *    Sem isso "ligar" seria uma porta de sentido unico, e a pessoa nunca mais
 *    teria de volta a configuracao que a staff escolheu.
 *
 * 2. Dois dos tres arquivos (o do Embeddium e o do Oculus) fazem parte do
 *    modpack, entao a proxima atualizacao os sobrescreve. Por isso o launcher
 *    reaplica antes de cada partida enquanto o boost estiver ligado — senao o
 *    ajuste sumiria sozinho na primeira atualizacao, sem aviso nenhum.
 *
 * Os valores foram escolhidos olhando o que o pack realmente usa hoje:
 * Embeddium, Oculus e o options.txt do proprio Minecraft.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const MARCADOR = '.atena-fps.json';

/**
 * O que o boost muda.
 *
 * `rotulo` e o que aparece na tela — a pessoa tem direito de saber o que o
 * botao vai mexer antes de apertar.
 */
const AJUSTES = [
    // --- options.txt: o proprio Minecraft ---------------------------------
    { arquivo: 'options.txt', tipo: 'mc', chave: 'renderDistance', valor: '4', rotulo: 'fps.render_distance' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'simulationDistance', valor: '5', rotulo: 'fps.simulation_distance' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'graphicsMode', valor: '0', rotulo: 'fps.graphics' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'ao', valor: 'false', rotulo: 'fps.ao' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'entityShadows', valor: 'false', rotulo: 'fps.shadows' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'renderClouds', valor: '"false"', rotulo: 'fps.clouds' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'mipmapLevels', valor: '0', rotulo: 'fps.mipmap' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'biomeBlendRadius', valor: '0', rotulo: 'fps.biome_blend' },
    // 0 = todas, 1 = poucas, 2 = minimo.
    { arquivo: 'options.txt', tipo: 'mc', chave: 'particles', valor: '2', rotulo: 'fps.particles' },
    { arquivo: 'options.txt', tipo: 'mc', chave: 'bobView', valor: 'false', rotulo: 'fps.bob' },

    // --- Embeddium: o renderizador ----------------------------------------
    { arquivo: 'config/embeddium-options.json', tipo: 'json', chave: 'quality.weather_quality', valor: 'FAST', rotulo: 'fps.weather' },
    { arquivo: 'config/embeddium-options.json', tipo: 'json', chave: 'quality.leaves_quality', valor: 'FAST', rotulo: 'fps.leaves' },
    { arquivo: 'config/embeddium-options.json', tipo: 'json', chave: 'quality.enable_vignette', valor: false, rotulo: 'fps.vignette' },
    { arquivo: 'config/embeddium-options.json', tipo: 'json', chave: 'performance.use_entity_culling', valor: true, rotulo: 'fps.culling' },

    // --- Oculus: shaders --------------------------------------------------
    { arquivo: 'config/oculus.properties', tipo: 'props', chave: 'enableShaders', valor: 'false', rotulo: 'fps.shaders' }
];

class Desempenho {

    /* --------------------------------------------------- ler e escrever -- */

    /** options.txt e "chave:valor" por linha; oculus.properties e "chave=valor". */
    lerPares(texto, separador) {
        const mapa = new Map();
        for (const linha of texto.split(/\r?\n/)) {
            if (!linha.trim() || linha.trim().startsWith('#')) continue;
            const corte = linha.indexOf(separador);
            if (corte === -1) continue;
            mapa.set(linha.slice(0, corte).trim(), linha.slice(corte + 1));
        }
        return mapa;
    }

    /**
     * Reescreve so as linhas que mudaram.
     *
     * Linha desconhecida fica exatamente como estava — este arquivo tem
     * centenas de opcoes e o boost so entende meia duzia. Reescrever tudo
     * apagaria o resto.
     */
    escreverPares(texto, separador, mudancas) {
        const pendentes = new Map(mudancas);
        const linhas = texto.split(/\r?\n/).map(linha => {
            const corte = linha.indexOf(separador);
            if (corte === -1) return linha;

            const chave = linha.slice(0, corte).trim();
            if (!pendentes.has(chave)) return linha;

            const valor = pendentes.get(chave);
            pendentes.delete(chave);
            return `${chave}${separador}${valor}`;
        });

        // Opcao que ainda nao existia no arquivo entra no fim.
        for (const [chave, valor] of pendentes) linhas.push(`${chave}${separador}${valor}`);
        return linhas.join('\n');
    }

    fundo(objeto, caminho) {
        return caminho.split('.').reduce((atual, parte) => (atual == null ? undefined : atual[parte]), objeto);
    }

    definirFundo(objeto, caminho, valor) {
        const partes = caminho.split('.');
        const ultima = partes.pop();
        let atual = objeto;
        for (const parte of partes) {
            if (typeof atual[parte] !== 'object' || atual[parte] === null) atual[parte] = {};
            atual = atual[parte];
        }
        atual[ultima] = valor;
    }

    /* ------------------------------------------------------- o estado ---- */

    /**
     * Como cada ajuste esta agora, e se o boost esta ligado.
     *
     * `faltando` sao os arquivos que nem existem — acontece antes da primeira
     * partida, porque o Minecraft so escreve o options.txt quando abre.
     */
    async estado(pasta) {
        const marcador = this.lerMarcador(pasta);
        const porArquivo = new Map();
        const mudancas = [];
        const faltando = new Set();

        for (const ajuste of AJUSTES) {
            if (!porArquivo.has(ajuste.arquivo)) {
                porArquivo.set(ajuste.arquivo, await this.lerArquivo(pasta, ajuste.arquivo));
            }
            const conteudo = porArquivo.get(ajuste.arquivo);

            if (conteudo === null) { faltando.add(ajuste.arquivo); continue; }

            const atual = this.valorAtual(conteudo, ajuste);
            mudancas.push({
                rotulo: ajuste.rotulo,
                atual: String(atual),
                alvo: String(ajuste.valor),
                aplicado: String(atual) === String(ajuste.valor)
            });
        }

        return {
            ligado: Boolean(marcador.ligadoEm),
            mudancas,
            faltando: [...faltando],
            // Sem nenhum arquivo o boost nao tem onde mexer: a interface
            // explica em vez de oferecer um botao que nao faria nada.
            possivel: mudancas.length > 0
        };
    }

    async lerArquivo(pasta, relativo) {
        try {
            return await fsp.readFile(path.join(pasta, relativo), 'utf8');
        } catch {
            return null;
        }
    }

    valorAtual(conteudo, ajuste) {
        if (ajuste.tipo === 'mc') return this.lerPares(conteudo, ':').get(ajuste.chave);
        if (ajuste.tipo === 'props') return this.lerPares(conteudo, '=').get(ajuste.chave);

        try {
            return this.fundo(JSON.parse(conteudo), ajuste.chave);
        } catch {
            return undefined;
        }
    }

    /* ------------------------------------------------------- ligar ------- */

    /**
     * Guarda os valores de agora e aplica os do boost.
     *
     * O backup so e feito uma vez: ligar duas vezes seguidas nao pode gravar
     * como "original" o que ja e o boost, senao desligar nao devolveria nada.
     */
    async ligar(pasta) {
        const marcador = this.lerMarcador(pasta);
        const primeiraVez = !marcador.original;
        const original = marcador.original || {};

        const mexidos = await this.aplicar(pasta, ajuste => ajuste.valor, primeiraVez ? original : null);

        this.gravarMarcador(pasta, {
            ligadoEm: new Date().toISOString(),
            original
        });

        return mexidos;
    }

    /** Devolve tudo ao que era antes. */
    async desligar(pasta) {
        const marcador = this.lerMarcador(pasta);
        const original = marcador.original || {};

        const mexidos = await this.aplicar(pasta, ajuste => {
            const chave = `${ajuste.arquivo}|${ajuste.chave}`;
            return Object.prototype.hasOwnProperty.call(original, chave) ? original[chave] : undefined;
        });

        this.limparMarcador(pasta);
        return mexidos;
    }

    /**
     * Reaplica se estiver ligado. Chamado antes de cada partida.
     *
     * Dois dos arquivos vem do modpack, entao uma atualizacao os devolve ao
     * padrao. Sem esta passada o boost sumiria sozinho e a pessoa acharia que
     * o launcher esqueceu.
     */
    async reaplicar(pasta) {
        if (!this.lerMarcador(pasta).ligadoEm) return 0;
        return this.aplicar(pasta, ajuste => ajuste.valor, null);
    }

    /**
     * Percorre os ajustes, agrupando por arquivo para escrever cada um uma vez.
     *
     * `escolher` diz o valor a gravar (undefined = deixa como esta).
     * `anotarEm`, quando vem, recebe o valor que estava la antes.
     */
    async aplicar(pasta, escolher, anotarEm) {
        let mexidos = 0;

        const porArquivo = new Map();
        for (const ajuste of AJUSTES) {
            if (!porArquivo.has(ajuste.arquivo)) porArquivo.set(ajuste.arquivo, []);
            porArquivo.get(ajuste.arquivo).push(ajuste);
        }

        for (const [relativo, ajustes] of porArquivo) {
            const completo = path.join(pasta, relativo);
            const conteudo = await this.lerArquivo(pasta, relativo);
            if (conteudo === null) continue;   // arquivo ainda nao existe

            const tipo = ajustes[0].tipo;

            if (tipo === 'json') {
                let dados;
                try {
                    dados = JSON.parse(conteudo);
                } catch {
                    continue;   // arquivo quebrado: melhor nao piorar
                }

                let mudou = false;
                for (const ajuste of ajustes) {
                    const novo = escolher(ajuste);
                    if (novo === undefined) continue;

                    const antes = this.fundo(dados, ajuste.chave);
                    if (anotarEm) anotarEm[`${ajuste.arquivo}|${ajuste.chave}`] = antes;
                    if (antes === novo) continue;

                    this.definirFundo(dados, ajuste.chave, novo);
                    mudou = true;
                    mexidos += 1;
                }

                if (mudou) await this.gravarSeguro(completo, JSON.stringify(dados, null, 2));
                continue;
            }

            const separador = tipo === 'mc' ? ':' : '=';
            const atuais = this.lerPares(conteudo, separador);
            const mudancas = new Map();

            for (const ajuste of ajustes) {
                const novo = escolher(ajuste);
                if (novo === undefined) continue;

                const antes = atuais.get(ajuste.chave);
                if (anotarEm) anotarEm[`${ajuste.arquivo}|${ajuste.chave}`] = antes;
                if (String(antes) === String(novo)) continue;

                mudancas.set(ajuste.chave, novo);
                mexidos += 1;
            }

            if (mudancas.size) {
                await this.gravarSeguro(completo, this.escreverPares(conteudo, separador, mudancas));
            }
        }

        return mexidos;
    }

    /**
     * Escreve num temporario e renomeia.
     *
     * Uma queda de energia no meio de um options.txt de 200 linhas deixaria o
     * jogo sem conseguir ler as proprias configuracoes.
     */
    async gravarSeguro(completo, texto) {
        const temporario = `${completo}.parte`;
        await fsp.mkdir(path.dirname(completo), { recursive: true });
        await fsp.writeFile(temporario, texto, 'utf8');
        await fsp.rm(completo, { force: true });
        await fsp.rename(temporario, completo);
    }

    /* ----------------------------------------------------- marcador ------ */

    lerMarcador(pasta) {
        try {
            return JSON.parse(fs.readFileSync(path.join(pasta, MARCADOR), 'utf8')) || {};
        } catch {
            return {};
        }
    }

    gravarMarcador(pasta, dados) {
        try {
            fs.mkdirSync(pasta, { recursive: true });
            fs.writeFileSync(path.join(pasta, MARCADOR), JSON.stringify(dados, null, 2), 'utf8');
        } catch (err) {
            console.error('[fps] nao consegui salvar o marcador:', err.message);
        }
    }

    limparMarcador(pasta) {
        try {
            fs.rmSync(path.join(pasta, MARCADOR), { force: true });
        } catch { /* ja nao estava la */ }
    }
}

export default new Desempenho;
