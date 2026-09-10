/**
 * Atena Launcher — estado do modpack na máquina do jogador
 *
 * Guarda um marcador em <instância>/.atena-version.json depois de cada
 * sincronização bem-sucedida. Comparando esse marcador com a versão publicada
 * no servidor, o launcher sabe dizer se precisa:
 *
 *   'install'  — nunca foi baixado aqui
 *   'update'   — existe, mas a staff publicou uma versão nova
 *   'ready'    — está igual ao servidor, é só jogar
 *
 * Também cuida da reinstalação e da lista de pastas que o jogador quer que o
 * launcher não encoste.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MARKER = '.atena-version.json';

class Modpack {
    constructor() {
        // Evita baixar o mesmo manifesto várias vezes na mesma sessão.
        this.manifestCache = new Map();
    }

    dir(basePath, instanceName) {
        return path.join(basePath, 'instances', instanceName);
    }

    /* --------------------------------------------------------- marcador -- */

    readLocal(basePath, instanceName) {
        const file = path.join(this.dir(basePath, instanceName), MARKER);
        if (!fs.existsSync(file)) return null;

        try {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return null;
        }
    }

    writeLocal(basePath, instanceName, data) {
        const folder = this.dir(basePath, instanceName);
        try {
            fs.mkdirSync(folder, { recursive: true });
            fs.writeFileSync(path.join(folder, MARKER), JSON.stringify(data, null, 2), 'utf8');
        } catch (err) {
            console.error('[modpack] não consegui salvar o marcador de versão:', err.message);
        }
    }

    clearLocal(basePath, instanceName) {
        const file = path.join(this.dir(basePath, instanceName), MARKER);
        try {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        } catch (err) {
            console.error('[modpack] não consegui apagar o marcador:', err.message);
        }
    }

    /**
     * Instalado = o modpack publicado está de fato em disco.
     *
     * Não dá para olhar só se a pasta tem arquivos: depois de uma reinstalação
     * sobram os mundos e os prints do jogador, e aí a pasta parece cheia mesmo
     * sem nenhum mod. Então conferimos uma amostra do manifesto — se a maior
     * parte dela não está aqui, é instalação, não atualização.
     */
    async isInstalled(basePath, instance) {
        const folder = this.dir(basePath, instance.name);
        if (!fs.existsSync(folder)) return false;

        const files = await this.manifest(instance.url);

        // Sem manifesto publicado não há como comparar: qualquer conteúdo conta.
        if (!files.length) {
            try {
                return fs.readdirSync(folder).some(name => name !== MARKER);
            } catch {
                return false;
            }
        }

        const step = Math.max(1, Math.ceil(files.length / 40));
        const sample = files.filter((_, index) => index % step === 0);
        const present = sample.filter(file => fs.existsSync(path.join(folder, file.path))).length;

        return present > sample.length / 2;
    }

    /* -------------------------------------------------------- servidor --- */

    /**
     * O manifesto é a lista de arquivos publicada; a URL vem da instância.
     *
     * O cache é indexado pelo endereço SEM a query. A URL vem assinada, e cada
     * chamada a /api/instances devolve uma assinatura nova — indexar pela URL
     * inteira faria o cache errar sempre, e o launcher rebaixaria 1,5 MB de
     * manifesto a cada passo da mesma ação.
     */
    async manifest(manifestUrl) {
        const chave = String(manifestUrl).split('?')[0];
        if (this.manifestCache.has(chave)) return this.manifestCache.get(chave);

        try {
            const response = await fetch(manifestUrl);
            if (!response.ok) return [];

            const files = await response.json();
            const list = Array.isArray(files) ? files : [];
            this.manifestCache.set(chave, list);
            return list;
        } catch (err) {
            console.error('[modpack] não consegui ler o manifesto:', err.message);
            return [];
        }
    }

    /**
     * Troca o /files do fim da URL do manifesto por outro endpoint da mesma
     * instância. A URL vem assinada (…/files?md5=…&expires=…), então a query
     * precisa sair antes — senão o replace não acha o /files no fim.
     */
    siblingUrl(manifestUrl, endpoint) {
        const [base, query] = String(manifestUrl).split('?');
        const url = base.replace(/\/files$/, endpoint);
        return query ? `${url}?${query}` : url;
    }

    async remoteVersion(manifestUrl) {
        try {
            const response = await fetch(this.siblingUrl(manifestUrl, '/version'));
            if (!response.ok) return null;
            return await response.json();
        } catch {
            return null;
        }
    }

    /* ----------------------------------------------------------- estado -- */

    async state(basePath, instance) {
        if (!await this.isInstalled(basePath, instance)) return 'install';

        const remote = await this.remoteVersion(instance.url);
        // Sem conexão ou modpack ainda não publicado: deixa jogar.
        if (!remote) return 'ready';

        const local = this.readLocal(basePath, instance.name);
        if (!local || local.version !== remote.version) return 'update';

        return 'ready';
    }

    /* ------------------------------------------- pastas protegidas ------- */

    /**
     * Transforma as pastas escolhidas pelo jogador em caminhos de arquivo.
     *
     * A minecraft-java-core compara a lista de ignorados com o caminho exato de
     * cada arquivo, então uma entrada "config" sozinha evita que a pasta seja
     * apagada, mas não impede que os arquivos dentro dela sejam sobrescritos.
     * Expandindo pelo manifesto a proteção passa a valer de verdade.
     */
    async expandProtected(manifestUrl, entries) {
        const clean = (entries || [])
            .map(entry => String(entry).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim())
            .filter(Boolean);

        if (!clean.length) return [];

        const files = await this.manifest(manifestUrl);
        const expanded = new Set(clean);

        for (const file of files) {
            for (const entry of clean) {
                if (file.path === entry || file.path.startsWith(`${entry}/`)) {
                    expanded.add(file.path);
                }
            }
        }
        return [...expanded];
    }

    /* ---------------------------------------------- baixar o modpack ----- */

    /**
     * Sincroniza o modpack com o servidor SEM abrir o jogo.
     *
     * Existe porque a minecraft-java-core faz tudo de uma vez: ela baixa e já
     * inicia o Minecraft. Quem só queria atualizar acabava com o jogo aberto na
     * cara. Aqui a atualização é um passo próprio, e jogar é outro.
     *
     * De quebra, isto dá o que a biblioteca não dá: progresso durante a
     * conferência, que num modpack de 5 mil arquivos é a parte mais demorada.
     *
     * `aoProgresso({ fase, feitos, total, bytes, bytesTotais, arquivo })`
     */
    async sync(basePath, instance, { ignored = [], concorrencia = 5, aoProgresso, pausa } = {}) {
        const pasta = this.dir(basePath, instance.name);
        const arquivos = await this.manifest(instance.url);

        if (!arquivos.length) return { baixados: 0, mantidos: 0, bytes: 0 };

        const protegidos = new Set(ignored.map(e => String(e).replace(/\\/g, '/')));
        const cache = this.readHashCache(pasta);
        const cacheNovo = {};

        // O cache e gravado aconteca o que acontecer. Cancelar no meio de um
        // download de 1,6 GB nao pode significar jogar fora a conferencia do
        // que ja estava certo: sem isto, quem desiste uma vez paga a espera
        // inteira de novo na tentativa seguinte.
        try {
            return await this.sincronizar({
                pasta, arquivos, protegidos, cache, cacheNovo,
                concorrencia, aoProgresso, pausa
            });
        } finally {
            this.writeHashCache(pasta, cacheNovo);
        }
    }

    /** O trabalho em si. Separado so para o cache acima ter um `finally`. */
    async sincronizar({ pasta, arquivos, protegidos, cache, cacheNovo, concorrencia, aoProgresso, pausa }) {

        /* --- 1. o que precisa vir do servidor ------------------------------ */

        const faltando = [];
        const preservados = [];
        let mantidos = 0;

        // Primeira instalação: a pasta nem existe, então não há o que conferir.
        // Sem este atalho, o launcher gastaria segundos perguntando ao disco por
        // 5 mil arquivos que com certeza não estão lá.
        const jaTemPasta = fs.existsSync(pasta);

        if (!jaTemPasta) {
            faltando.push(...arquivos.filter(a => !protegidos.has(a.path)));
            mantidos = arquivos.length - faltando.length;
            if (aoProgresso) {
                aoProgresso({ fase: 'conferindo', feitos: arquivos.length, total: arquivos.length });
            }
        } else {
            for (let i = 0; i < arquivos.length; i += 1) {
                const arquivo = arquivos[i];

                // Devolver a vez ao navegador de tempos em tempos. Este laço faz
                // milhares de idas ao disco; sem as pausas ele segura a thread da
                // interface do começo ao fim e o launcher parece travado — que foi
                // exatamente o que aconteceu.
                if (i % 200 === 0) {
                    await this.respirar();
                    if (pausa) await pausa.esperar();
                }
                if (aoProgresso) aoProgresso({ fase: 'conferindo', feitos: i + 1, total: arquivos.length });

                // O que o jogador protegeu não é tocado, nem para conferir.
                if (protegidos.has(arquivo.path)) { mantidos += 1; continue; }

                const completo = path.join(pasta, arquivo.path);

                let stat;
                try {
                    // Assíncrono de propósito: a versão síncrona bloqueia a
                    // interface a cada arquivo, e são milhares.
                    stat = await fsp.stat(completo);
                } catch {
                    faltando.push(arquivo);
                    continue;
                }

                // O SHA-1 é caro; guardamos o resultado por tamanho+data para a
                // conferência seguinte custar quase nada. É a diferença entre
                // esperar minutos toda vez e esperar só na primeira.
                const chave = arquivo.path;
                const anotado = cache[chave];

                // O que o servidor publicava na última sincronização. É a peça
                // que permite saber DE QUEM foi a mudança. Entradas antigas do
                // cache guardavam só `hash`, que na época era exatamente isso.
                const servidorAntes = anotado ? (anotado.servidor ?? anotado.hash) : null;

                let hash = null;

                // O tamanho é a peneira barata: só vale ler o arquivo inteiro
                // de quem passou por ela.
                if (stat.size === arquivo.size) {
                    hash = (anotado && anotado.size === stat.size && anotado.mtimeMs === stat.mtimeMs)
                        ? anotado.hash
                        : await this.sha1(completo);

                    if (hash === arquivo.hash) {
                        cacheNovo[chave] = { size: stat.size, mtimeMs: stat.mtimeMs, hash, servidor: arquivo.hash };
                        mantidos += 1;
                        continue;
                    }
                }

                // Chegou aqui: o arquivo em disco não é o publicado. A pergunta
                // que importa é quem o mudou.
                //
                // Se o servidor publica hoje o MESMO hash que publicava na
                // última sincronização, então a staff não mexeu neste arquivo —
                // quem mexeu foi a pessoa, jogando. Sobrescrever isso é apagar
                // as configurações dela toda vez que o modpack atualiza, que é
                // exatamente o que estava acontecendo.
                //
                // Se o hash publicado mudou, a atualização é de verdade e ela
                // ganha: é o que "atualizar o modpack" quer dizer.
                if (servidorAntes !== null && servidorAntes === arquivo.hash && this.doJogador(arquivo.path)) {
                    cacheNovo[chave] = {
                        size: stat.size,
                        mtimeMs: stat.mtimeMs,
                        hash: hash ?? await this.sha1(completo),
                        servidor: arquivo.hash
                    };
                    mantidos += 1;
                    preservados.push(arquivo.path);
                    continue;
                }

                faltando.push(arquivo);
            }
        }

        /* --- 2. baixar o que falta ----------------------------------------- */

        const bytesTotais = faltando.reduce((soma, f) => soma + (f.size || 0), 0);
        let bytes = 0;
        let baixados = 0;
        let proximo = 0;
        const falhas = [];

        const trabalhar = async () => {
            while (true) {
                // Entre um arquivo e outro é onde parar não custa nada: nada
                // pela metade em disco, nada baixado duas vezes.
                if (pausa) await pausa.esperar();

                // A conferência do fim da fila TEM que vir depois da espera.
                // Estava antes, e o `await` no meio abria uma janela: com 16
                // trabalhadores, vários passavam pelo teste enquanto sobrava um
                // arquivo só, e os perdedores pegavam `undefined` — o download
                // inteiro morria com "Cannot read properties of undefined" a
                // poucos arquivos do fim. Apareceu no log de um jogador.
                if (proximo >= faltando.length) break;

                const arquivo = faltando[proximo++];
                try {
                    await this.baixarArquivo(pasta, arquivo, pedaco => {
                        bytes += pedaco;
                        if (aoProgresso) {
                            aoProgresso({
                                fase: 'baixando',
                                feitos: baixados,
                                total: faltando.length,
                                bytes,
                                bytesTotais,
                                arquivo: arquivo.path
                            });
                        }
                    });
                    baixados += 1;

                    const stat = await fsp.stat(path.join(pasta, arquivo.path));
                    cacheNovo[arquivo.path] = { size: stat.size, mtimeMs: stat.mtimeMs, hash: arquivo.hash };
                } catch (err) {
                    falhas.push({ path: arquivo.path, erro: err.message });
                }
            }
        };

        const emParalelo = Math.min(32, Math.max(1, Math.round(Number(concorrencia) || 5)));
        await Promise.all(Array.from({ length: emParalelo }, trabalhar));

        return { baixados, mantidos, bytes, falhas, preservados };
    }

    /**
     * Este arquivo pode ser do jogador?
     *
     * Tudo pode, menos os .jar e a pasta mods/. Ninguém edita um .jar à mão, e
     * um jar corrompido precisa poder ser rebaixado sozinho — se ele entrasse
     * nesta regra, o launcher passaria a preservar arquivos quebrados achando
     * que eram escolhas de alguém.
     *
     * Para tudo o mais — config, emotes, resourcepacks, teclas — a regra é a
     * pessoa mandar. "Verificar e reparar" continua devolvendo tudo ao
     * publicado, para quando é isso que se quer.
     */
    doJogador(caminho) {
        const limpo = String(caminho).replace(/\\/g, '/').toLowerCase();
        if (limpo.startsWith('mods/')) return false;
        return !limpo.endsWith('.jar');
    }

    /**
     * Devolve a vez ao navegador para ele desenhar a tela.
     *
     * setTimeout(0) e não uma microtarefa: `await Promise.resolve()` não deixa o
     * navegador repintar, então a barra continuaria congelada mesmo com o laço
     * "cedendo".
     */
    respirar() {
        return new Promise(resolve => setTimeout(resolve, 0));
    }

    /**
     * Baixa um arquivo para o lugar dele.
     *
     * Escreve num `.parte` e só então renomeia: se a internet cair no meio, o
     * que fica no disco é lixo com outro nome, não um .jar pela metade que o
     * jogo tentaria carregar.
     */
    async baixarArquivo(pasta, arquivo, aoPedaco) {
        const destino = path.join(pasta, arquivo.path);
        const temporario = `${destino}.parte`;

        fs.mkdirSync(path.dirname(destino), { recursive: true });

        const resposta = await fetch(arquivo.url);
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const saida = fs.createWriteStream(temporario);
        const leitor = resposta.body.getReader();

        try {
            while (true) {
                const { done, value } = await leitor.read();
                if (done) break;

                // Respeita a contrapressão: sem isto, um download rápido enche
                // a memória enquanto o disco não dá conta.
                if (!saida.write(Buffer.from(value))) {
                    await new Promise(resolve => saida.once('drain', resolve));
                }
                if (aoPedaco) aoPedaco(value.length);
            }
        } finally {
            await new Promise(resolve => saida.end(resolve));
        }

        const tamanho = fs.statSync(temporario).size;
        if (arquivo.size && tamanho !== arquivo.size) {
            fs.rmSync(temporario, { force: true });
            throw new Error(`veio ${tamanho} bytes, esperava ${arquivo.size}`);
        }

        fs.rmSync(destino, { force: true });
        fs.renameSync(temporario, destino);
    }

    /* ------------------------------------------------- cache de hashes --- */

    hashCacheFile(pasta) {
        return path.join(pasta, '.atena-hashes.json');
    }

    readHashCache(pasta) {
        try {
            return JSON.parse(fs.readFileSync(this.hashCacheFile(pasta), 'utf8'));
        } catch {
            return {};
        }
    }

    writeHashCache(pasta, dados) {
        try {
            fs.mkdirSync(pasta, { recursive: true });
            fs.writeFileSync(this.hashCacheFile(pasta), JSON.stringify(dados), 'utf8');
        } catch (err) {
            console.error('[modpack] não consegui guardar o cache de hashes:', err.message);
        }
    }

    /**
     * Acrescenta entradas ao cache sem apagar as que já estavam.
     *
     * Quem usa isto é a importação: ela já calculou o SHA-1 de cada arquivo que
     * copiou, e sem passar esse resultado adiante a conferência seguinte leria
     * os mesmos 1,6 GB de novo — a espera do download voltaria como espera de
     * disco, e a importação teria economizado quase nada.
     */
    semearCache(pasta, novos) {
        if (!novos || !Object.keys(novos).length) return;
        this.writeHashCache(pasta, { ...this.readHashCache(pasta), ...novos });
    }

    /* -------------------------------------------- verificar e reparar ---- */

    /**
     * Confere arquivo por arquivo contra o manifesto e apaga o que não bate.
     *
     * O launcher já baixa só o que mudou, mas ele confia no que está em disco.
     * Quando um arquivo corrompe — queda de energia no meio do download, disco
     * com problema, antivírus mexendo num .jar — o tamanho continua parecendo
     * certo e o jogo quebra sem explicação. Aqui o SHA-1 é recalculado de
     * verdade; o que não bater é apagado, e o próximo Jogar baixa de novo.
     *
     * É mais barato que reinstalar: em vez de 1,6 GB, baixa só o que quebrou.
     */
    async repair(basePath, instance, onProgress) {
        const folder = this.dir(basePath, instance.name);
        const files = await this.manifest(instance.url);

        if (!files.length) return { checked: 0, broken: 0, missing: 0 };

        let checked = 0;
        let broken = 0;
        let missing = 0;

        for (const file of files) {
            const full = path.join(folder, file.path);
            checked += 1;

            // Mesma razão do sync: milhares de idas ao disco em fila seguram a
            // interface se o laço nunca devolver a vez.
            if (checked % 200 === 0) await this.respirar();
            if (onProgress) onProgress(checked, files.length);

            let stat;
            try {
                stat = await fsp.stat(full);
            } catch {
                missing += 1;             // some sozinho no próximo download
                continue;
            }

            // O tamanho é a peneira barata: só vale calcular o SHA-1 de quem
            // passou por ela, senão a verificação levaria minutos a mais.
            let ruim = stat.size !== file.size;

            if (!ruim && file.hash) {
                ruim = await this.sha1(full) !== file.hash;
            }

            if (ruim) {
                try {
                    fs.rmSync(full, { force: true });
                    broken += 1;
                } catch (err) {
                    console.error('[modpack] não consegui apagar o arquivo quebrado:', file.path, err.message);
                }
            }
        }

        // Sem o marcador, o launcher trata como atualização e rebaixa o que falta.
        if (broken || missing) this.clearLocal(basePath, instance.name);

        return { checked, broken, missing };
    }

    sha1(file) {
        return new Promise(resolve => {
            const hash = crypto.createHash('sha1');
            const stream = fs.createReadStream(file);
            stream.on('error', () => resolve(null));
            stream.on('data', chunk => hash.update(chunk));
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }

    /* ------------------------------------------------------ reinstalar --- */

    /**
     * Apaga o conteúdo do modpack para ele ser baixado de novo do zero,
     * preservando o que estiver em `keep` — a lista de ignorados da instância
     * (mundos, prints, teclas) mais as pastas protegidas pelo jogador.
     */
    async reinstall(basePath, instanceName, keep = []) {
        const folder = this.dir(basePath, instanceName);
        if (!fs.existsSync(folder)) return { removed: 0, kept: 0 };

        // Só interessa o primeiro nível de cada caminho preservado: se o jogador
        // protege "config/create", a pasta "config" inteira precisa sobreviver.
        const preserved = new Set(
            keep
                .map(entry => String(entry).replace(/\\/g, '/').split('/')[0])
                .filter(Boolean)
        );

        // Os marcadores do launcher nao sao do modpack. Sem eles, reinstalar
        // fazia o FPS Boost perder os valores originais: o ajuste continuava
        // ligado nos arquivos e nao havia mais como desfazer.
        preserved.add('.atena-fps.json');
        preserved.add('.atena-extras.json');

        let removed = 0;
        let kept = 0;

        for (const name of fs.readdirSync(folder)) {
            if (preserved.has(name)) { kept += 1; continue; }

            try {
                fs.rmSync(path.join(folder, name), { recursive: true, force: true });
                removed += 1;
            } catch (err) {
                console.error(`[modpack] não consegui apagar ${name}:`, err.message);
            }
        }

        this.clearLocal(basePath, instanceName);
        this.manifestCache.clear();
        return { removed, kept };
    }
}

export default new Modpack;
