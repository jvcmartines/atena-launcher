/**
 * Trava de instância única.
 *
 * O armazenamento é em arquivos JSON com cache em memória: se dois processos
 * apontarem para a mesma pasta de dados, o que tiver o cache velho sobrescreve
 * o do outro e dados somem (contas de staff, instâncias, notícias).
 *
 * Na prática isso acontece quando alguém roda `npm start` na mão enquanto o
 * serviço do systemd já está no ar. A trava transforma esse acidente silencioso
 * numa mensagem de erro clara.
 */
const fs = require('fs');
const path = require('path');

let lockFile = null;

function isRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // EPERM = existe mas é de outro usuário; ESRCH = não existe.
        return err.code === 'EPERM';
    }
}

function acquire(dataDir) {
    lockFile = path.join(dataDir, '.lock');

    if (fs.existsSync(lockFile)) {
        const previous = Number(fs.readFileSync(lockFile, 'utf8').trim());

        if (previous && previous !== process.pid && isRunning(previous)) {
            console.error('');
            console.error(`Já existe um servidor do Atena rodando (PID ${previous}) usando esta mesma pasta de dados.`);
            console.error('Rodar dois ao mesmo tempo faz um sobrescrever os dados do outro.');
            console.error('');
            console.error('Pare o outro antes de continuar:  sudo systemctl stop atena-launcher');
            console.error(`Se tiver certeza de que o processo ${previous} morreu, apague:  ${lockFile}`);
            console.error('');
            process.exit(1);
        }
    }

    fs.writeFileSync(lockFile, String(process.pid), 'utf8');

    process.on('exit', release);
}

function release() {
    if (!lockFile) return;
    try {
        // Só remove se a trava ainda for nossa.
        if (fs.readFileSync(lockFile, 'utf8').trim() === String(process.pid)) {
            fs.unlinkSync(lockFile);
        }
    } catch {
        // Já foi removida, ou a pasta sumiu: nada a fazer.
    }
    lockFile = null;
}

module.exports = { acquire, release };
