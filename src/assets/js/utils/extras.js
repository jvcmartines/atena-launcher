/**
 * Atena Launcher — mods opcionais
 *
 * Existe um punhado de mods que so mexe no lado do cliente — cosmeticos,
 * amigos, prints. O Essential e o caso classico, e ele ja vem dentro do
 * modpack do Atena: sao 5.668 arquivos, e um deles e o mods/essential.jar.
 *
 * Isso muda o que a pessoa precisa. Nao adianta oferecer "instalar" o que ela
 * ja tem; o que falta e poder DESLIGAR. E desligar na mao nao funciona: apagar
 * o .jar faz o launcher rebaixar o arquivo na proxima partida, porque ele esta
 * no manifesto. A pessoa apaga, o launcher devolve, e ela conclui que o
 * launcher esta quebrado.
 *
 * Entao aqui cada mod opcional tem um de dois destinos:
 *
 *   'pack' — vem no modpack. Desligar renomeia para .disabled e poe o caminho
 *            na lista de ignorados, para a sincronizacao nao trazer de volta.
 *   'api'  — nao vem no modpack. Ligar baixa da API oficial do mod, e o
 *            arquivo so e aceito se o checksum publicado bater.
 *
 * Nos dois casos o caminho entra nos ignorados, entao a atualizacao do modpack
 * passa ao largo da escolha da pessoa.
 *
 * Acrescentar outro mod e acrescentar uma entrada no CATALOGO.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MARCADOR = '.atena-extras.json';
const SUFIXO = '.disabled';

const CATALOGO = [
    {
        id: 'essential',
        nome: 'Essential',
        site: 'https://essential.gg',
        arquivo: 'mods/essential.jar',
        loaders: ['forge', 'fabric', 'neoforge'],
        // Pastas que o mod cria sozinho e que nao sao do modpack: apagar
        // faria ele baixar tudo de novo a cada partida.
        runtime: ['essential'],
        api: 'https://api.essential.gg/mods/v1/essential:essential/versions/stable/platforms/{plataforma}/download',
        versaoApi: 'https://api.essential.gg/mods/v1/essential:essential/versions/stable/platforms/{plataforma}',
        algoritmo: 'md5'
    }
];

class Extras {

    /** "forge_1.20.1" — e assim que a API do Essential nomeia as versoes. */
    plataforma(instance) {
        const loader = String(instance?.loader?.loader_type || '').toLowerCase();
        const versao = String(instance?.loader?.minecraft_version || '');
        if (!loader || loader === 'none' || !versao) return null;
        return `${loader}_${versao}`;
    }

    pastaDaInstancia(basePath, instanceName) {
        return path.join(basePath, 'instances', instanceName);
    }

    doLoader(instance) {
        const loader = String(instance?.loader?.loader_type || '').toLowerCase();
        return CATALOGO.filter(item => item.loaders.includes(loader));
    }

    /* ------------------------------------------------------- o estado ----- */

    /**
     * O que da para ligar e desligar, e como cada um esta agora.
     *
     * Quem manda e o disco. Se a pessoa mexer nos arquivos na mao, ou
     * reinstalar o modpack (o que limpa mods/ inteiro), o launcher precisa
     * enxergar o que realmente esta la — um marcador teimando o contrario
     * seria pior que marcador nenhum.
     */
    async estado(basePath, instance, arquivosDoPack = []) {
        const pasta = this.pastaDaInstancia(basePath, instance.name);
        const plataforma = this.plataforma(instance);
        const doPack = new Set(arquivosDoPack.map(a => String(a.path).replace(/\\/g, '/')));
        const marcador = this.lerMarcador(pasta);

        const lista = [];

        for (const item of this.doLoader(instance)) {
            const completo = path.join(pasta, item.arquivo);
            const desativadoPath = `${completo}${SUFIXO}`;

            const ligado = fs.existsSync(completo);
            const desligado = fs.existsSync(desativadoPath);
            const modo = doPack.has(item.arquivo) || marcador[item.id]?.modo === 'pack' ? 'pack' : 'api';

            let tamanho = 0;
            try {
                tamanho = (await fsp.stat(ligado ? completo : desativadoPath)).size;
            } catch { /* nao esta la de jeito nenhum */ }

            lista.push({
                id: item.id,
                nome: item.nome,
                site: item.site,
                arquivo: item.arquivo,
                modo,
                ligado,
                tamanho,
                versao: marcador[item.id]?.versao || null,
                plataforma,
                // Um mod do proprio pack sempre da para ligar de volta: o
                // arquivo esta ali, ou o download do modpack o traz. Um da API
                // precisa de uma build para este loader.
                disponivel: modo === 'pack' ? true : Boolean(plataforma),
                // Nunca esteve aqui e nao vem do pack: so da para ligar
                // baixando.
                ausente: !ligado && !desligado
            });
        }

        return lista;
    }

    /** A versao publicada agora, para mostrar antes de baixar. Offline: null. */
    async versaoRemota(id, plataforma) {
        const item = CATALOGO.find(i => i.id === id);
        if (!item || !plataforma || !item.versaoApi) return null;

        try {
            const resposta = await fetch(item.versaoApi.replace('{plataforma}', plataforma));
            if (!resposta.ok) return null;
            return (await resposta.json())?.version || null;
        } catch {
            return null;
        }
    }

    /* ------------------------------------------------------- alternar ---- */

    /**
     * Liga ou desliga o mod.
     *
     * `aoProgresso` so e usado quando precisa baixar.
     */
    async alternar(basePath, instance, id, ligar, aoProgresso) {
        const item = CATALOGO.find(i => i.id === id);
        if (!item) throw new Error('mod desconhecido');

        const pasta = this.pastaDaInstancia(basePath, instance.name);
        const completo = path.join(pasta, item.arquivo);
        const desativado = `${completo}${SUFIXO}`;

        if (!ligar) return this.desligar(pasta, item, completo, desativado);

        // Ligar: se o arquivo esta so renomeado, e um rename. So baixa quando
        // nao ha nada em disco.
        if (fs.existsSync(desativado)) {
            await fsp.rm(completo, { force: true });
            await fsp.rename(desativado, completo);
            this.anotar(pasta, item.id, { desligado: false });
            return { acao: 'ligado', arquivo: item.arquivo };
        }

        if (fs.existsSync(completo)) return { acao: 'ligado', arquivo: item.arquivo };

        return this.baixar(pasta, item, instance, aoProgresso);
    }

    async desligar(pasta, item, completo, desativado) {
        if (!fs.existsSync(completo)) return { acao: 'desligado', arquivo: item.arquivo };

        await fsp.rm(desativado, { force: true });
        await fsp.rename(completo, desativado);
        this.anotar(pasta, item.id, { desligado: true });
        return { acao: 'desligado', arquivo: item.arquivo };
    }

    /* ---------------------------------------------------- baixar ---------- */

    /**
     * Pergunta a API oficial onde esta o arquivo desta versao.
     * Devolve `{ url, checksum }`, ou null se a plataforma nao for suportada.
     */
    async resolver(item, plataforma) {
        const resposta = await fetch(item.api.replace('{plataforma}', plataforma));

        // 404 aqui quer dizer "nao existe build para este loader/versao", que e
        // informacao, nao falha.
        if (resposta.status === 404) return null;
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const dados = await resposta.json();
        if (!dados?.url) return null;

        return { url: dados.url, checksum: String(dados.checksum || '').toLowerCase() };
    }

    /**
     * O checksum e conferido enquanto o arquivo desce, e o `.parte` so vira
     * .jar se bater. Um download interrompido ou um arquivo trocado no meio do
     * caminho morre aqui, e nao dentro do jogo.
     */
    async baixar(pasta, item, instance, aoProgresso) {
        const plataforma = this.plataforma(instance);
        if (!plataforma) throw new Error('sem-plataforma');

        const alvo = await this.resolver(item, plataforma);
        if (!alvo) throw new Error('sem-versao');

        const destino = path.join(pasta, item.arquivo);
        const temporario = `${destino}.parte`;
        await fsp.mkdir(path.dirname(destino), { recursive: true });

        const resposta = await fetch(alvo.url);
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const esperado = Number(resposta.headers.get('content-length')) || 0;
        const soma = crypto.createHash(item.algoritmo || 'sha1');
        const saida = fs.createWriteStream(temporario);
        const leitor = resposta.body.getReader();
        let baixado = 0;

        try {
            while (true) {
                const { done, value } = await leitor.read();
                if (done) break;

                soma.update(value);
                // Contrapressao: sem isto os 50 MB ficam na memoria enquanto o
                // disco nao acompanha.
                if (!saida.write(Buffer.from(value))) {
                    await new Promise(resolve => saida.once('drain', resolve));
                }

                baixado += value.length;
                if (aoProgresso) aoProgresso({ bytes: baixado, bytesTotais: esperado });
            }
        } finally {
            await new Promise(resolve => saida.end(resolve));
        }

        const obtido = soma.digest('hex').toLowerCase();
        if (alvo.checksum && obtido !== alvo.checksum) {
            await fsp.rm(temporario, { force: true });
            throw new Error('checksum');
        }

        await fsp.rm(destino, { force: true });
        await fsp.rename(temporario, destino);

        this.anotar(pasta, item.id, {
            modo: 'api',
            desligado: false,
            checksum: obtido,
            plataforma,
            versao: await this.versaoRemota(item.id, plataforma),
            instaladoEm: new Date().toISOString()
        });

        return { acao: 'baixado', arquivo: item.arquivo, bytes: baixado };
    }

    /* ------------------------------------------------ protecao ------------ */

    /**
     * Os caminhos que a sincronizacao do modpack nao pode encostar.
     *
     * O caso que importa e o mod desligado: ele esta no manifesto, entao sem
     * esta linha o proximo Jogar o baixaria de volta. A pessoa desligaria, o
     * launcher religaria, e ninguem entenderia por que.
     *
     * Sincrono porque `startGame` monta a lista de ignorados de uma vez, e a
     * pergunta e so "este arquivo existe?".
     */
    caminhosProtegidos(basePath, instance) {
        const pasta = this.pastaDaInstancia(basePath, instance.name);
        const marcador = this.lerMarcador(pasta);
        const caminhos = [];

        for (const item of CATALOGO) {
            const completo = path.join(pasta, item.arquivo);
            const desativado = `${completo}${SUFIXO}`;

            if (fs.existsSync(desativado)) {
                // Os dois: o .disabled para nao ser varrido, e o original para
                // nao ser rebaixado.
                caminhos.push(item.arquivo, `${item.arquivo}${SUFIXO}`);
            } else if (fs.existsSync(completo) && marcador[item.id]?.modo === 'api') {
                // Baixado por fora do modpack: sem isto o modo estrito o varre.
                caminhos.push(item.arquivo);
            }

            if (fs.existsSync(completo) || fs.existsSync(desativado)) {
                caminhos.push(...(item.runtime || []));
            }
        }

        return caminhos;
    }

    /**
     * Os caminhos de tudo que o launcher oferece como opcional.
     *
     * Serve para a sincronizacao nunca apagar um destes quando ele sai do
     * modpack. E exatamente o que aconteceu com o Essential: ele deixou de vir
     * no pack e virou opcional, e apagar de quem ja o tinha seria tirar uma
     * coisa que a pessoa pode ter escolhido ter.
     */
    caminhosDoCatalogo() {
        const caminhos = [];
        for (const item of CATALOGO) {
            caminhos.push(item.arquivo, `${item.arquivo}${SUFIXO}`);
            caminhos.push(...(item.runtime || []));
        }
        return caminhos;
    }

    /* ------------------------------------------------- marcador ----------- */

    lerMarcador(pasta) {
        try {
            return JSON.parse(fs.readFileSync(path.join(pasta, MARCADOR), 'utf8')) || {};
        } catch {
            return {};
        }
    }

    anotar(pasta, id, campos) {
        const marcador = this.lerMarcador(pasta);
        marcador[id] = { ...(marcador[id] || {}), ...campos };
        try {
            fs.mkdirSync(pasta, { recursive: true });
            fs.writeFileSync(path.join(pasta, MARCADOR), JSON.stringify(marcador, null, 2), 'utf8');
        } catch (err) {
            console.error('[extras] nao consegui salvar o marcador:', err.message);
        }
    }
}

export default new Extras;
