/**
 * Atena Launcher — mods opcionais
 *
 * O modpack é o mesmo para todo mundo: é o que faz o servidor funcionar. Mas
 * existe um punhado de mods que é só do lado do cliente — cosméticos, amigos,
 * prints — e que muita gente quer ter. O Essential é o caso clássico.
 *
 * Instalar isso na mão dá errado de dois jeitos, e os dois já aconteceram com
 * jogador nosso:
 *
 *   1. a pessoa baixa de um site qualquer e traz um .jar adulterado;
 *   2. o launcher, na atualização seguinte, apaga o mod por não reconhecê-lo,
 *      e ela reinstala. Todo mês.
 *
 * Aqui os dois somem. O download vem da API oficial do próprio mod, e o
 * arquivo só é aceito se o checksum publicado bater. Depois disso o caminho
 * entra na lista de ignorados do jogo, então a sincronização do modpack passa
 * ao largo dele.
 *
 * Acrescentar outro mod à lista é acrescentar uma entrada no CATALOGO — não há
 * código novo a escrever.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MARCADOR = '.atena-extras.json';

const CATALOGO = [
    {
        id: 'essential',
        nome: 'Essential',
        site: 'https://essential.gg',
        // Nome fixo: assim atualizar é sobrescrever, e desinstalar é apagar um
        // arquivo com nome conhecido. Nada de acumular versão velha em mods/.
        arquivo: 'mods/essential.jar',
        loaders: ['forge', 'fabric', 'neoforge'],
        // A API devolve { url, checksum } — o checksum é MD5.
        api: 'https://api.essential.gg/mods/v1/essential:essential/versions/stable/platforms/{plataforma}/download',
        versaoApi: 'https://api.essential.gg/mods/v1/essential:essential/versions/stable/platforms/{plataforma}',
        algoritmo: 'md5'
    }
];

class Extras {

    /** "forge_1.20.1" — é assim que a API do Essential nomeia as versões. */
    plataforma(instance) {
        const loader = String(instance?.loader?.loader_type || '').toLowerCase();
        const versao = String(instance?.loader?.minecraft_version || '');
        if (!loader || loader === 'none' || !versao) return null;
        return `${loader}_${versao}`;
    }

    pastaDaInstancia(basePath, instanceName) {
        return path.join(basePath, 'instances', instanceName);
    }

    /** Os mods que fazem sentido para esta instância. */
    doPack(instance) {
        const loader = String(instance?.loader?.loader_type || '').toLowerCase();
        return CATALOGO.filter(item => item.loaders.includes(loader));
    }

    /* ------------------------------------------------------- o estado ----- */

    /**
     * O que está instalado, o que dá para instalar.
     *
     * Quem manda é o disco, não o marcador: se a pessoa apagar o .jar na mão,
     * ou reinstalar o modpack (o que limpa mods/ inteiro), o launcher precisa
     * perceber que o mod não está mais lá — um marcador teimando que está
     * seria pior que marcador nenhum.
     *
     * `arquivosDoPack` é a lista do manifesto: se o modpack já traz um arquivo
     * com o mesmo caminho, o opcional sai de cena. Duas mãos escrevendo no
     * mesmo .jar termina com o jogo sem abrir.
     */
    async estado(basePath, instance, arquivosDoPack = []) {
        const pasta = this.pastaDaInstancia(basePath, instance.name);
        const plataforma = this.plataforma(instance);
        const doPack = new Set(arquivosDoPack.map(a => String(a.path).replace(/\\/g, '/')));
        const marcador = this.lerMarcador(pasta);

        const lista = [];

        for (const item of this.doPack(instance)) {
            if (doPack.has(item.arquivo)) continue;

            const completo = path.join(pasta, item.arquivo);
            let instalado = false;
            let tamanho = 0;

            try {
                tamanho = (await fsp.stat(completo)).size;
                instalado = true;
            } catch { /* não instalado */ }

            lista.push({
                id: item.id,
                nome: item.nome,
                site: item.site,
                arquivo: item.arquivo,
                instalado,
                tamanho,
                versao: instalado ? marcador?.[item.id]?.versao || null : null,
                plataforma,
                // Sem loader compatível não há o que baixar; a interface mostra
                // o motivo em vez de um botão que só daria erro.
                disponivel: Boolean(plataforma)
            });
        }

        return lista;
    }

    /** A versão publicada agora, para mostrar antes de instalar. Offline: null. */
    async versaoRemota(id, plataforma) {
        const item = CATALOGO.find(i => i.id === id);
        if (!item || !plataforma || !item.versaoApi) return null;

        try {
            const resposta = await fetch(item.versaoApi.replace('{plataforma}', plataforma));
            if (!resposta.ok) return null;
            const dados = await resposta.json();
            return dados?.version || null;
        } catch {
            return null;
        }
    }

    /* ---------------------------------------------------- instalar -------- */

    /**
     * Pergunta à API oficial onde está o arquivo desta versão.
     * Devolve `{ url, checksum }`, ou null se a plataforma não for suportada.
     */
    async resolver(item, plataforma) {
        const resposta = await fetch(item.api.replace('{plataforma}', plataforma));

        // 404 aqui quer dizer "não existe build para este loader/versão", que é
        // informação, não falha.
        if (resposta.status === 404) return null;
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const dados = await resposta.json();
        if (!dados?.url) return null;

        return { url: dados.url, checksum: String(dados.checksum || '').toLowerCase() };
    }

    /**
     * Baixa e põe no lugar.
     *
     * O checksum é conferido enquanto o arquivo desce, e o `.parte` só vira
     * .jar se bater. Um download interrompido ou um arquivo trocado no meio do
     * caminho morre aqui, e não dentro do jogo.
     */
    async instalar(basePath, instance, id, aoProgresso) {
        const item = CATALOGO.find(i => i.id === id);
        if (!item) throw new Error('mod desconhecido');

        const plataforma = this.plataforma(instance);
        if (!plataforma) throw new Error('sem-plataforma');

        const alvo = await this.resolver(item, plataforma);
        if (!alvo) throw new Error('sem-versao');

        const pasta = this.pastaDaInstancia(basePath, instance.name);
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
                // Contrapressão: sem isto o arquivo inteiro (50 MB) fica na
                // memória enquanto o disco não acompanha.
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

        const marcador = this.lerMarcador(pasta);
        marcador[item.id] = {
            arquivo: item.arquivo,
            checksum: obtido,
            plataforma,
            versao: await this.versaoRemota(item.id, plataforma),
            instaladoEm: new Date().toISOString()
        };
        this.gravarMarcador(pasta, marcador);

        return { arquivo: item.arquivo, bytes: baixado, versao: marcador[item.id].versao };
    }

    /** Tira o mod de mods/. O jogo volta a abrir sem ele no próximo Jogar. */
    async remover(basePath, instance, id) {
        const item = CATALOGO.find(i => i.id === id);
        if (!item) return false;

        const pasta = this.pastaDaInstancia(basePath, instance.name);
        await fsp.rm(path.join(pasta, item.arquivo), { force: true });

        const marcador = this.lerMarcador(pasta);
        delete marcador[item.id];
        this.gravarMarcador(pasta, marcador);
        return true;
    }

    /* ------------------------------------------------ proteção ------------ */

    /**
     * Os caminhos que o launcher NÃO pode apagar ao sincronizar o modpack.
     *
     * Vai direto para a lista de ignorados do minecraft-java-core. Sem isto, a
     * primeira atualização do modpack varreria o mod opcional junto com
     * qualquer outro arquivo que não esteja no manifesto — e a pessoa
     * reinstalaria toda semana sem entender por quê.
     *
     * Síncrono porque `startGame` monta a lista de ignorados de uma vez, e
     * porque a pergunta é só "este arquivo existe?".
     */
    caminhosProtegidos(basePath, instance) {
        const pasta = this.pastaDaInstancia(basePath, instance.name);
        const caminhos = [];

        for (const item of CATALOGO) {
            if (fs.existsSync(path.join(pasta, item.arquivo))) caminhos.push(item.arquivo);
        }
        // A pasta que o Essential usa em tempo de execução também não é do
        // modpack, e apagá-la faria o mod baixar tudo de novo a cada partida.
        if (caminhos.length) caminhos.push('essential');

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

    gravarMarcador(pasta, dados) {
        try {
            fs.mkdirSync(pasta, { recursive: true });
            fs.writeFileSync(path.join(pasta, MARCADOR), JSON.stringify(dados, null, 2), 'utf8');
        } catch (err) {
            console.error('[extras] não consegui salvar o marcador:', err.message);
        }
    }
}

export default new Extras;
