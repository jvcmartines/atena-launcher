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
const path = require('path');

const KEEP = 5;

class Backup {
    /** Onde ficam os backups de uma instância. */
    folderFor(basePath, instanceName) {
        return path.join(basePath, 'backups', instanceName);
    }

    /**
     * Copia as pastas/arquivos pedidos. Devolve o caminho criado, ou null se
     * não havia nada para guardar.
     */
    async run(basePath, instanceName, entries) {
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

        for (const entry of present) {
            try {
                fs.cpSync(path.join(source, entry), path.join(target, entry), { recursive: true });
            } catch (err) {
                // Um arquivo travado pelo sistema não pode impedir o jogo de abrir.
                console.error(`[backup] não consegui copiar ${entry}:`, err.message);
            }
        }

        this.prune(this.folderFor(basePath, instanceName));
        return target;
    }

    /** Mantém só os KEEP backups mais recentes. */
    prune(root) {
        if (!fs.existsSync(root)) return;

        // Os nomes são timestamps ISO, então a ordem alfabética é a cronológica.
        const backups = fs.readdirSync(root)
            .filter(name => fs.statSync(path.join(root, name)).isDirectory())
            .sort();

        for (const old of backups.slice(0, Math.max(0, backups.length - KEEP))) {
            try {
                fs.rmSync(path.join(root, old), { recursive: true, force: true });
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
