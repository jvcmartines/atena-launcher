/**
 * Atena Launcher — trazer um modpack que já está no computador
 *
 * Quem já jogou no launcher antigo (ou instalou o pack pelo CurseForge, pelo
 * Prism, na mão) tem 1,6 GB de mods parados no disco. Baixar tudo de novo é
 * meia hora de espera por arquivos que a pessoa já tem.
 *
 * Aqui a cópia é feita com desconfiança, e é isso que torna a coisa segura:
 * nada é copiado por estar numa pasta com nome bonito. Percorremos o
 * MANIFESTO — a lista de arquivos que a staff publicou — e, para cada arquivo,
 * procuramos um candidato na pasta de origem. O candidato só entra se o
 * tamanho bater E o SHA-1 for exatamente o publicado.
 *
 * Consequências disso, que são o ponto todo:
 *
 *   - um mod trocado, adulterado ou de versão diferente não passa;
 *   - arquivo que a pessoa tinha a mais (um mod dela, um vírus, um .exe)
 *     nunca é copiado, porque não está no manifesto;
 *   - o resultado é bit a bit igual ao de um download limpo.
 *
 * O que não puder ser aproveitado simplesmente fica faltando, e o download
 * normal cuida dele depois.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

class Importar {

    /* ------------------------------------------- achar as pastas ---------- */

    /**
     * Lugares onde um modpack de 1.20.1 costuma estar.
     *
     * Cada entrada é uma pasta para olhar (`pasta`) ou uma pasta cujos filhos
     * de primeiro nível são instalações (`filhos`), que é como CurseForge,
     * Prism e companhia organizam as coisas. `dentro` cobre os launchers que
     * escondem o jogo num subdiretório da instância.
     */
    lugares(appDataPath) {
        const casa = os.homedir();
        const appData = appDataPath || process.env.APPDATA || path.join(casa, 'AppData', 'Roaming');
        const local = process.env.LOCALAPPDATA || path.join(casa, 'AppData', 'Local');

        return [
            { nome: 'Minecraft', pasta: path.join(appData, '.minecraft') },

            // O launcher antigo do Atena, e qualquer outra pasta nossa que
            // tenha sobrado com outro nome.
            { nome: 'Atena', filhos: path.join(appData, '.Atena', 'instances') },
            { nome: 'Atena', filhos: path.join(appData, '.atena-launcher', 'instances') },
            { nome: 'Atena', filhos: path.join(appData, '.AtenaLauncher', 'instances') },
            { nome: 'Atena', filhos: path.join(appData, 'Atena', 'instances') },

            { nome: 'CurseForge', filhos: path.join(casa, 'curseforge', 'minecraft', 'Instances') },
            { nome: 'CurseForge', filhos: path.join(casa, 'Documents', 'curseforge', 'minecraft', 'Instances') },
            { nome: 'CurseForge', filhos: path.join(casa, 'Documentos', 'curseforge', 'minecraft', 'Instances') },

            { nome: 'Modrinth', filhos: path.join(appData, 'com.modrinth.theseus', 'profiles') },
            { nome: 'Modrinth', filhos: path.join(appData, 'ModrinthApp', 'profiles') },

            { nome: 'Prism Launcher', filhos: path.join(appData, 'PrismLauncher', 'instances'), dentro: ['.minecraft', 'minecraft'] },
            { nome: 'Prism Launcher', filhos: path.join(casa, 'PrismLauncher', 'instances'), dentro: ['.minecraft', 'minecraft'] },
            { nome: 'MultiMC', filhos: path.join(casa, 'MultiMC', 'instances'), dentro: ['.minecraft', 'minecraft'] },
            { nome: 'ATLauncher', filhos: path.join(casa, 'ATLauncher', 'instances') },
            { nome: 'GDLauncher', filhos: path.join(appData, 'gdlauncher_next', 'instances') },
            { nome: 'GDLauncher', filhos: path.join(local, 'gdlauncher_carbon', 'data', 'instances') },
            { nome: 'Technic', filhos: path.join(appData, '.technic', 'modpacks') },
            { nome: 'FTB', filhos: path.join(casa, '.ftba', 'instances') }
        ];
    }

    /**
     * Varre os lugares conhecidos e devolve o que parece ser uma instalação
     * com mods.
     *
     * `ignorar` é a pasta da instância atual: encontrar a si mesma e oferecer
     * "importe de você mesmo" seria só confusão.
     */
    async candidatos(appDataPath, ignorar) {
        const alvo = ignorar ? path.resolve(ignorar).toLowerCase() : null;
        const achados = [];
        const vistos = new Set();

        for (const lugar of this.lugares(appDataPath)) {
            const pastas = [];

            if (lugar.pasta) {
                pastas.push({ caminho: lugar.pasta, rotulo: lugar.nome });
            } else if (lugar.filhos) {
                for (const filho of await this.listarPastas(lugar.filhos)) {
                    const base = path.join(lugar.filhos, filho);
                    // Prism e MultiMC guardam o jogo num subdiretório.
                    const dentro = (lugar.dentro || []).map(d => path.join(base, d)).find(d => this.eDiretorio(d));
                    pastas.push({ caminho: dentro || base, rotulo: `${lugar.nome} · ${filho}` });
                }
            }

            for (const { caminho, rotulo } of pastas) {
                const chave = path.resolve(caminho).toLowerCase();
                if (vistos.has(chave) || chave === alvo) continue;
                vistos.add(chave);

                const resumo = await this.olhar(caminho);
                if (resumo) achados.push({ caminho, rotulo, ...resumo });
            }
        }

        // Quem tem mais mods aparece primeiro: é o palpite mais provável.
        return achados.sort((a, b) => b.mods - a.mods);
    }

    /**
     * Vale a pena oferecer esta pasta? Só se ela tiver mods dentro.
     *
     * A conta é rasa de propósito — um readdir de mods/ — porque isto roda
     * para vinte pastas de uma vez, antes de a pessoa escolher qualquer coisa.
     */
    async olhar(pasta) {
        const modsDir = path.join(pasta, 'mods');
        if (!this.eDiretorio(modsDir)) return null;

        let mods = 0;
        let bytes = 0;

        try {
            for (const nome of await fsp.readdir(modsDir)) {
                if (!nome.toLowerCase().endsWith('.jar')) continue;
                mods += 1;
                try {
                    bytes += (await fsp.stat(path.join(modsDir, nome))).size;
                } catch { /* arquivo sumiu no meio da varredura: ignora */ }
            }
        } catch {
            return null;
        }

        if (!mods) return null;
        return { mods, bytes };
    }

    async listarPastas(caminho) {
        try {
            const itens = await fsp.readdir(caminho, { withFileTypes: true });
            return itens.filter(i => i.isDirectory()).map(i => i.name);
        } catch {
            return [];
        }
    }

    eDiretorio(caminho) {
        try {
            return fs.statSync(caminho).isDirectory();
        } catch {
            return false;
        }
    }

    /* --------------------------------------------------- o índice --------- */

    /**
     * Mapa do que existe na pasta de origem.
     *
     * Só percorremos as pastas que o manifesto menciona (mods, config,
     * kubejs...). Isso deixa de fora saves/ e screenshots/, que costumam ter
     * mais arquivos que o modpack inteiro e não interessam em nada aqui.
     *
     * Dois índices, porque a origem nem sempre tem o mesmo formato:
     *   porCaminho — o caminho relativo bate exatamente;
     *   porNome    — o arquivo está noutro lugar, mas com o mesmo nome.
     */
    async indexar(origem, arquivos) {
        const raizes = new Set();
        for (const arquivo of arquivos) {
            const primeiro = String(arquivo.path).split('/')[0];
            if (primeiro) raizes.add(primeiro);
        }

        const porCaminho = new Map();
        const porNome = new Map();

        const anotar = (relativo, completo, tamanho) => {
            porCaminho.set(relativo, { completo, tamanho });
            const nome = path.basename(relativo);
            if (!porNome.has(nome)) porNome.set(nome, []);
            porNome.get(nome).push({ completo, tamanho });
        };

        const andar = async (relativo, profundidade) => {
            if (profundidade > 8) return;   // pack nenhum é tão fundo; isto é o freio contra links em círculo

            let itens;
            try {
                itens = await fsp.readdir(path.join(origem, relativo), { withFileTypes: true });
            } catch {
                return;
            }

            for (const item of itens) {
                const filho = relativo ? `${relativo}/${item.name}` : item.name;

                if (item.isDirectory()) {
                    await andar(filho, profundidade + 1);
                    continue;
                }
                if (!item.isFile()) continue;   // link simbólico: não seguimos

                try {
                    anotar(filho, path.join(origem, filho), (await fsp.stat(path.join(origem, filho))).size);
                } catch { /* sumiu no meio do caminho */ }
            }
        };

        // Raiz: só os arquivos soltos, sem descer em pasta nenhuma que o
        // manifesto não peça.
        try {
            for (const item of await fsp.readdir(origem, { withFileTypes: true })) {
                if (item.isFile()) {
                    try {
                        anotar(item.name, path.join(origem, item.name), (await fsp.stat(path.join(origem, item.name))).size);
                    } catch { /* idem */ }
                }
            }
        } catch { /* origem ilegível: o resultado sai vazio e ninguém copia nada */ }

        for (const raiz of raizes) {
            if (this.eDiretorio(path.join(origem, raiz))) await andar(raiz, 1);
        }

        return { porCaminho, porNome };
    }

    /* ---------------------------------------------------- a importação ---- */

    /**
     * Copia da origem tudo o que bater com o manifesto.
     *
     * Devolve `{ copiados, bytes, faltando, hashes }`. `hashes` é o que
     * alimenta o cache do modpack: já sabemos o SHA-1 de cada arquivo que
     * entrou, então a conferência do próximo Jogar não precisa recalcular
     * 1,6 GB — sem isso, a importação economizaria o download e devolveria a
     * espera na forma de leitura de disco.
     */
    async importar({ origem, destino, arquivos, protegidos = [], pausa, aoProgresso }) {
        const bloqueados = new Set((protegidos || []).map(p => String(p).replace(/\\/g, '/')));
        const indice = await this.indexar(origem, arquivos);

        const hashes = {};
        let copiados = 0;
        let bytes = 0;
        let faltando = 0;
        let conferidos = 0;

        // Quanto há para conferir: serve só para a barra ter um fim.
        const total = arquivos.length;

        for (const arquivo of arquivos) {
            conferidos += 1;

            // O laço lê e faz hash de milhares de arquivos. Sem devolver a vez
            // ao navegador de vez em quando, a tela congela do início ao fim.
            if (conferidos % 25 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
                if (pausa) await pausa.esperar();
            }
            if (aoProgresso) {
                aoProgresso({ feitos: conferidos, total, copiados, bytes, arquivo: arquivo.path });
            }

            if (bloqueados.has(arquivo.path)) continue;

            // Já está no lugar com o tamanho certo: a sincronização confere o
            // hash depois. Copiar por cima seria trabalho jogado fora.
            const alvo = path.join(destino, arquivo.path);
            try {
                if ((await fsp.stat(alvo)).size === arquivo.size) continue;
            } catch { /* não existe: é justamente o que viemos resolver */ }

            const candidato = await this.escolher(indice, arquivo);
            if (!candidato) { faltando += 1; continue; }

            try {
                await this.copiar(candidato.completo, alvo);
                const stat = await fsp.stat(alvo);
                hashes[arquivo.path] = { size: stat.size, mtimeMs: stat.mtimeMs, hash: arquivo.hash };
                copiados += 1;
                bytes += arquivo.size || 0;
            } catch (err) {
                console.error('[importar] não consegui copiar', arquivo.path, err.message);
                faltando += 1;
            }
        }

        if (aoProgresso) aoProgresso({ feitos: total, total, copiados, bytes, arquivo: '' });
        return { copiados, bytes, faltando, hashes };
    }

    /**
     * Procura, entre os arquivos da origem, um que SEJA este arquivo.
     *
     * A ordem importa pelo custo: tamanho é de graça, SHA-1 custa ler o
     * arquivo inteiro. Então o tamanho peneira, e só quem passa é lido.
     */
    async escolher(indice, arquivo) {
        const tentativas = [];

        const noCaminho = indice.porCaminho.get(arquivo.path);
        if (noCaminho) tentativas.push(noCaminho);

        for (const outro of indice.porNome.get(path.basename(arquivo.path)) || []) {
            if (outro !== noCaminho) tentativas.push(outro);
        }

        for (const candidato of tentativas) {
            if (arquivo.size && candidato.tamanho !== arquivo.size) continue;

            // Sem hash publicado não há como ter certeza, e "quase certo" aqui
            // significa um mod adulterado carregado com a nossa bênção.
            if (!arquivo.hash) continue;
            if (await this.sha1(candidato.completo) !== arquivo.hash) continue;

            return candidato;
        }
        return null;
    }

    /**
     * Copia para um `.parte` e só então renomeia — se faltar espaço ou o disco
     * falhar no meio, o que sobra é lixo com outro nome, não um .jar pela
     * metade que o Forge tentaria carregar.
     */
    async copiar(origem, destino) {
        const temporario = `${destino}.parte`;
        await fsp.mkdir(path.dirname(destino), { recursive: true });

        try {
            await fsp.copyFile(origem, temporario);
            await fsp.rm(destino, { force: true });
            await fsp.rename(temporario, destino);
        } catch (err) {
            await fsp.rm(temporario, { force: true }).catch(() => { });
            throw err;
        }
    }

    sha1(arquivo) {
        return new Promise(resolve => {
            const hash = crypto.createHash('sha1');
            const stream = fs.createReadStream(arquivo);
            stream.on('error', () => resolve(null));
            stream.on('data', pedaco => hash.update(pedaco));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }
}

export default new Importar;
