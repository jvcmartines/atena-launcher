/**
 * Atena Launcher — backups das pastas do jogador
 *
 * Quando o modo estrito (`verify`) está ligado, o launcher apaga do PC do
 * jogador tudo que não está no modpack publicado. Isso mantém todo mundo igual
 * ao servidor, mas significa que uma pasta que a staff esqueceu de colocar na
 * lista de ignorados é perdida sem aviso.
 *
 * Antes de cada atualização a gente copia as pastas configuradas para
 *   <pasta do jogo>/backups/<instância>/<data-hora>/
 * e mantém apenas as mais recentes.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const KEEP = 5;

class Backup {
    constructor() {
        // Só serve para saber quando devolver a vez ao navegador.
        this.desdeAPausa = 0;
    }

    /** Onde ficam os backups de uma instância. */
    folderFor(basePath, instanceName) {
        return path.join(basePath, 'backups', instanceName);
    }

    /**
     * Copia as pastas/arquivos pedidos. Devolve o caminho criado, ou null se
     * não havia nada para guardar.
     *
     * Isto usava `fs.cpSync`, e essa era a travada de que todo mundo
     * reclamava: a pasta config/ deste modpack tem 3.410 arquivos e 535 MB, e
     * a versão síncrona bloqueia a thread da interface do primeiro ao último —
     * medi 14,5 segundos de janela completamente congelada, a cada Jogar e a
     * cada Atualizar. Não era lentidão de download: era o backup.
     *
     * Agora a cópia é assíncrona e arquivo a arquivo, o que dá duas coisas de
     * graça: a tela continua viva, e dá para dizer em que ponto está.
     */
    async run(basePath, instanceName, entries, aoProgresso) {
        if (!Array.isArray(entries) || !entries.length) return null;

        const source = path.join(basePath, 'instances', instanceName);
        if (!fs.existsSync(source)) return null;

        // Só vale a pena criar a pasta se algo existir de verdade.
        const present = entries
            .map(entry => String(entry).replace(/\\/g, '/').replace(/^\/+|\.\.\//g, '').trim())
            .filter(entry => entry && fs.existsSync(path.join(source, entry)));

        if (!present.length) return null;

        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const target = path.join(this.folderFor(basePath, instanceName), stamp);

        // Contar antes custa um readdir e transforma "aguarde" em "vai em 40%".
        let total = 0;
        for (const entry of present) total += await this.contar(path.join(source, entry));

        let feitos = 0;
        for (const entry of present) {
            try {
                await this.copiar(path.join(source, entry), path.join(target, entry), () => {
                    feitos += 1;
                    if (aoProgresso) aoProgresso(feitos, total);
                });
            } catch (err) {
                // Um arquivo travado pelo sistema não pode impedir o jogo de abrir.
                console.error(`[backup] não consegui copiar ${entry}:`, err.message);
            }
        }

        await this.prune(this.folderFor(basePath, instanceName));
        return target;
    }

    /** Quantos arquivos há aqui dentro. Só readdir: não abre nenhum. */
    async contar(alvo) {
        let itens;
        try {
            itens = await fsp.readdir(alvo, { withFileTypes: true });
        } catch {
            // Não é pasta: ou é um arquivo só, ou não existe.
            try {
                return (await fsp.stat(alvo)).isFile() ? 1 : 0;
            } catch {
                return 0;
            }
        }

        let total = 0;
        for (const item of itens) {
            if (item.isDirectory()) total += await this.contar(path.join(alvo, item.name));
            else if (item.isFile()) total += 1;
        }
        return total;
    }

    /**
     * Cópia recursiva, um arquivo por vez.
     *
     * A cada cem arquivos devolve a vez ao navegador: sem isso a fila de
     * promessas ficaria tão cheia que a tela pararia de repintar mesmo sendo
     * tudo assíncrono.
     */
    async copiar(origem, destino, aoArquivo) {
        let itens;
        try {
            itens = await fsp.readdir(origem, { withFileTypes: true });
        } catch {
            await fsp.mkdir(path.dirname(destino), { recursive: true });
            await fsp.copyFile(origem, destino);
            if (aoArquivo) aoArquivo();
            return;
        }

        await fsp.mkdir(destino, { recursive: true });

        for (const item of itens) {
            const de = path.join(origem, item.name);
            const para = path.join(destino, item.name);

            if (item.isDirectory()) {
                await this.copiar(de, para, aoArquivo);
                continue;
            }
            if (!item.isFile()) continue;   // link simbólico: não seguimos

            try {
                await fsp.copyFile(de, para);
            } catch (err) {
                console.error('[backup] pulei', item.name, err.message);
            }

            if (aoArquivo) aoArquivo();
            if (++this.desdeAPausa % 100 === 0) await new Promise(r => setTimeout(r, 0));
        }
    }

    /** Mantém só os KEEP backups mais recentes. */
    async prune(root) {
        if (!fs.existsSync(root)) return;

        // Os nomes são timestamps ISO, então a ordem alfabética é a cronológica.
        let nomes;
        try {
            nomes = (await fsp.readdir(root, { withFileTypes: true }))
                .filter(i => i.isDirectory())
                .map(i => i.name)
                .sort();
        } catch {
            return;
        }

        for (const old of nomes.slice(0, Math.max(0, nomes.length - KEEP))) {
            try {
                await fsp.rm(path.join(root, old), { recursive: true, force: true });
            } catch (err) {
                console.error(`[backup] não consegui apagar ${old}:`, err.message);
            }
        }
    }

    /** Quantos backups existem e quanto ocupam — mostrado nas configurações. */
    stats(root) {
        if (!fs.existsSync(root)) return { count: 0, size: 0 };

        const backups = fs.readdirSync(root)
            .filter(name => fs.statSync(path.join(root, name)).isDirectory());

        return { count: backups.length, size: this.sizeOf(root) };
    }

    sizeOf(dir) {
        let total = 0;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            try {
                if (entry.isDirectory()) total += this.sizeOf(full);
                else if (entry.isFile()) total += fs.statSync(full).size;
            } catch {
                // arquivo sumiu no meio da contagem
            }
        }
        return total;
    }
}

export default new Backup;
