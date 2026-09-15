/**
 * Atena Launcher — conferência e reparo dos arquivos do Forge
 *
 * Por que isto existe: o downloader do minecraft-java-core cria o arquivo de
 * destino ANTES de começar a baixar. Quando a conexão estoura o tempo, sobra
 * um arquivo vazio ou pela metade no lugar. Na abertura seguinte, os arquivos
 * do Minecraft e do Java são conferidos por hash e baixados de novo — mas as
 * bibliotecas do Forge só são conferidas com "o arquivo existe?". O arquivo
 * quebrado existe, então nunca é substituído, e o patcher do Forge (que roda
 * com essas bibliotecas) termina com código 1 em TODA tentativa.
 *
 * Aconteceu com um jogador em 14/09: downloads abortados às 19:03, e dali em
 * diante "Le patcher Forge s'est terminé avec le code 1" a cada clique em
 * jogar. A saída a mão era apagar %appdata%/.Atena/loader/forge.
 *
 * O que este módulo faz, antes de cada partida:
 *   - lê a lista de bibliotecas do Forge (a da versão instalada e a do
 *     install_profile.json de dentro do instalador), cada uma com tamanho e
 *     SHA-1;
 *   - apaga as que estão com tamanho ou hash errado, para a biblioteca baixar
 *     de novo — ela baixa tudo o que não existe;
 *   - faz o mesmo com as saídas do patcher que têm hash declarado.
 *
 * E, se o patcher falhar mesmo assim, `refazer` apaga a pasta do Forge
 * inteira: ela é refeita do zero na próxima tentativa, sem tocar no modpack.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

// Arquivo onde fica anotado o que já foi conferido e não mudou desde então.
// Sem ele, hashear ~100 MB de bibliotecas a cada partida atrasaria o jogo à
// toa: só confere de novo o que mudou de tamanho ou de data.
const CACHE = '.atena-conferido.json';

class Forge {
    pasta(base) {
        return path.join(base, 'loader', 'forge');
    }

    /* --------------------------------------------------- leitura de zip -- */

    /**
     * Um arquivo de dentro de um .jar, sem dependência nenhuma.
     *
     * O launcher empacotado não tem biblioteca de zip (o yauzl daqui só existe
     * no desenvolvimento, trazido pelo Electron), e a do minecraft-java-core
     * não é exportada. Para ler um JSON pequeno do instalador, o diretório
     * central do zip e o zlib do Node bastam.
     *
     * Devolve `null` se o arquivo não estiver lá, e `false` se o zip estiver
     * truncado (sem o registro de fim) — é esse caso que indica download
     * interrompido.
     */
    lerDoZip(buffer, nome) {
        const inicioBusca = Math.max(0, buffer.length - 65557);
        let fim = -1;
        for (let i = buffer.length - 22; i >= inicioBusca; i--) {
            if (buffer.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
        }
        if (fim < 0) return false;

        const total = buffer.readUInt16LE(fim + 10);
        let p = buffer.readUInt32LE(fim + 16);

        for (let n = 0; n < total; n++) {
            if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== 0x02014b50) return false;
            const metodo = buffer.readUInt16LE(p + 10);
            const comprimido = buffer.readUInt32LE(p + 20);
            const tamNome = buffer.readUInt16LE(p + 28);
            const tamExtra = buffer.readUInt16LE(p + 30);
            const tamComentario = buffer.readUInt16LE(p + 32);
            const local = buffer.readUInt32LE(p + 42);
            const entrada = buffer.toString('utf8', p + 46, p + 46 + tamNome);

            if (entrada === nome) {
                const inicio = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
                const dados = buffer.subarray(inicio, inicio + comprimido);
                if (metodo === 0) return dados;
                if (metodo === 8) return zlib.inflateRawSync(dados);
                return null;
            }
            p += 46 + tamNome + tamExtra + tamComentario;
        }
        return null;
    }

    /* ------------------------------------------ o que deveria existir --- */

    /** `grupo:artefato:versão[:classificador][@ext]` → caminho em libraries/. */
    caminhoMaven(coordenada) {
        const limpa = String(coordenada).replace(/^\[|\]$/g, '');
        const [semExt, ext = 'jar'] = limpa.split('@');
        const [grupo, artefato, versao, classificador] = semExt.split(':');
        if (!grupo || !artefato || !versao) return null;
        const arquivo = `${artefato}-${versao}${classificador ? `-${classificador}` : ''}.${ext}`;
        return path.posix.join(grupo.replace(/\./g, '/'), artefato, versao, arquivo);
    }

    async lerJson(caminho) {
        try {
            return JSON.parse(await fsp.readFile(caminho, 'utf8'));
        } catch {
            return null;
        }
    }

    /**
     * Tudo o que o Forge declara com tamanho e/ou hash.
     *
     * Duas fontes, e as duas importam: a versão instalada lista as bibliotecas
     * do jogo; o install_profile.json, dentro do instalador, lista as que o
     * PATCHER usa — e são estas as que derrubaram o jogador.
     */
    async esperados(pastaForge) {
        const lista = new Map();
        const instaladoresQuebrados = [];

        const adicionar = libs => {
            for (const lib of libs || []) {
                const a = lib?.downloads?.artifact;
                if (a?.path && (a.sha1 || a.size)) lista.set(a.path, { size: a.size, sha1: a.sha1 });
            }
        };

        const versoes = path.join(pastaForge, 'versions');
        for (const id of await fsp.readdir(versoes).catch(() => [])) {
            const json = await this.lerJson(path.join(versoes, id, `${id}.json`));
            adicionar(json?.libraries);
        }

        const instaladores = path.join(pastaForge, 'libraries', 'net', 'minecraftforge', 'installer');
        for (const nome of await fsp.readdir(instaladores).catch(() => [])) {
            if (!nome.endsWith('.jar')) continue;
            const caminho = path.join(instaladores, nome);

            let buffer;
            try {
                buffer = await fsp.readFile(caminho);
            } catch {
                continue;
            }

            const perfil = this.lerDoZip(buffer, 'install_profile.json');
            if (perfil === false) {
                // Sem o registro de fim do zip: o instalador veio pela metade.
                instaladoresQuebrados.push(caminho);
                continue;
            }
            if (!perfil) continue;

            let profile;
            try {
                profile = JSON.parse(perfil.toString('utf8'));
            } catch {
                continue;
            }
            adicionar(profile.libraries);

            // Saídas do patcher com hash declarado: PATCHED + PATCHED_SHA etc.
            for (const [chave, valor] of Object.entries(profile.data || {})) {
                const hash = profile.data[`${chave}_SHA`]?.client;
                const coordenada = valor?.client;
                if (!hash || !coordenada || !/^\[.*\]$/.test(coordenada)) continue;
                const relativo = this.caminhoMaven(coordenada);
                if (relativo) lista.set(relativo, { sha1: String(hash).replace(/'/g, '') });
            }
        }

        return { lista, instaladoresQuebrados };
    }

    /* ------------------------------------------------------ conferência -- */

    sha1(caminho) {
        return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha1');
            fs.createReadStream(caminho)
                .on('data', pedaco => hash.update(pedaco))
                .on('end', () => resolve(hash.digest('hex')))
                .on('error', reject);
        });
    }

    /**
     * Confere e apaga o que estiver quebrado. Devolve o que foi apagado.
     *
     * Nunca apaga o que não sabe conferir: arquivo sem hash nem tamanho
     * declarado fica onde está. E nunca falha a partida por causa disto — uma
     * conferência que quebra é pior do que nenhuma.
     */
    async conferir(base) {
        const pastaForge = this.pasta(base);
        const apagados = [];
        if (!fs.existsSync(pastaForge)) return apagados;

        const arquivoCache = path.join(pastaForge, CACHE);
        const cache = (await this.lerJson(arquivoCache)) || {};
        const novoCache = {};

        const { lista, instaladoresQuebrados } = await this.esperados(pastaForge);

        // Instalador pela metade: sem ele não dá para ler a lista das
        // bibliotecas do patcher, e então uma biblioteca zerada no mesmo
        // download abortado passaria despercebida. Não sabendo o que conferir,
        // o certo é refazer a pasta toda.
        if (instaladoresQuebrados.length) {
            await this.refazer(base);
            return ['loader/forge (instalador corrompido: pasta refeita)'];
        }

        for (const [relativo, esperado] of lista) {
            const caminho = path.join(pastaForge, 'libraries', relativo);

            let info;
            try {
                info = await fsp.stat(caminho);
            } catch {
                continue;   // não existe: a biblioteca vai baixar sozinha
            }

            const marca = `${info.size}:${Math.floor(info.mtimeMs)}`;
            let quebrado = Boolean(esperado.size) && info.size !== esperado.size;

            if (!quebrado && esperado.sha1) {
                if (cache[relativo] === marca) {
                    novoCache[relativo] = marca;
                    continue;
                }
                try {
                    quebrado = (await this.sha1(caminho)) !== esperado.sha1;
                } catch {
                    quebrado = true;
                }
            }

            if (quebrado) {
                await fsp.rm(caminho, { force: true }).catch(() => {});
                apagados.push(relativo);
            } else {
                novoCache[relativo] = marca;
            }
        }

        await fsp.writeFile(arquivoCache, JSON.stringify(novoCache)).catch(() => {});
        return apagados;
    }

    /**
     * O último recurso: apaga a pasta do Forge inteira.
     *
     * Ela é refeita do zero na próxima partida (~110 MB e o patch). Não toca
     * no modpack, nas configurações nem nos mundos, que ficam em instances/.
     */
    async refazer(base) {
        await fsp.rm(this.pasta(base), { recursive: true, force: true });
    }
}

export default new Forge;
