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
const path = require('path');

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

    /** O manifesto é a lista de arquivos publicada; a URL vem da instância. */
    async manifest(manifestUrl) {
        if (this.manifestCache.has(manifestUrl)) return this.manifestCache.get(manifestUrl);

        try {
            const response = await fetch(manifestUrl);
            if (!response.ok) return [];

            const files = await response.json();
            const list = Array.isArray(files) ? files : [];
            this.manifestCache.set(manifestUrl, list);
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
