/**
 * Pacotes do modpack — o modpack inteiro num arquivo só, e o que mudou entre
 * duas versões noutro.
 *
 * Por que isto existe: medi as duas pontas. Este servidor entrega ~4 MB/s; o
 * CDN do GitHub entrega 27 MB/s. Mas a diferença não é só banda — o modpack
 * tem 5.668 arquivos, e cada um custa uma conexão, um aperto de mão TLS e uma
 * ida e volta. Baixar como UM arquivo resolve as duas coisas.
 *
 * Dois tipos de pacote, e a razão de existirem os dois:
 *
 *   pacote  — o modpack inteiro. É o que uma instalação nova baixa.
 *   delta   — só os arquivos que mudaram desde a versão anterior. Uma
 *             atualização que troca dois mods vira um download de dois mods,
 *             e não de 1,7 GB.
 *
 * Sem o delta, atualizar custaria o pack inteiro toda vez. Sem o pacote, uma
 * instalação nova voltaria a ser 5.668 requisições.
 *
 * As partes existem porque uma release do GitHub aceita 2 GB por arquivo e o
 * pack já está em 1,7 GB. Dividir desde agora significa que o dia em que ele
 * passar do limite não vai exigir mexer no launcher.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const zip = require('./zip');
const store = require('./store');
const github = require('./github');
const { FILES_DIR, DATA_DIR } = require('../config');

// Abaixo do limite de 2 GB do GitHub com folga para os cabeçalhos do zip.
const LIMITE_PARTE = Number(process.env.ATENA_PACOTE_LIMITE_MB || 1800) * 1024 * 1024;

function pastaDePacotes(instanceId) {
    const dir = path.join(DATA_DIR, 'pacotes', instanceId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function instanceDir(instanceId) {
    return path.join(FILES_DIR, instanceId);
}

/** O índice do que já foi empacotado, por instância. */
function ler(instanceId) {
    return store.read(`pacotes-${instanceId}`, { versoes: {} });
}

function gravar(instanceId, dados) {
    store.write(`pacotes-${instanceId}`, dados);
}

/* --------------------------------------------------------- construção --- */

/**
 * Monta o pacote de uma versão, e o delta desde a anterior.
 *
 * `anterior` é o manifesto da versão passada (ou null na primeira). Devolve o
 * registro que vai para o índice.
 */
async function construir(instanceId, manifesto, anterior, aoProgresso) {
    const raiz = instanceDir(instanceId);
    const pasta = pastaDePacotes(instanceId);
    const versao = manifesto.version;

    const registro = { versao, criadoEm: new Date().toISOString(), pacote: null, deltas: {} };

    /* --- o modpack inteiro --------------------------------------------- */

    const partes = zip.dividir(manifesto.files, LIMITE_PARTE);
    registro.pacote = { partes: [], arquivos: manifesto.files.length, tamanho: 0 };

    for (let i = 0; i < partes.length; i++) {
        const nome = partes.length === 1
            ? `pacote-v${versao}.zip`
            : `pacote-v${versao}.parte${i + 1}de${partes.length}.zip`;

        const feito = await zip.escrever(
            path.join(pasta, nome), raiz, partes[i].map(f => f.path),
            (feitos, total) => aoProgresso && aoProgresso('pacote', i * 1000 + feitos, partes.length * total)
        );

        registro.pacote.partes.push({ arquivo: nome, tamanho: feito.bytes, hash: feito.hash });
        registro.pacote.tamanho += feito.bytes;
    }

    /* --- só o que mudou ------------------------------------------------- */

    if (anterior) {
        const antes = new Map(anterior.files.map(f => [f.path, f.hash]));
        // Arquivo novo, ou com hash diferente. O que sumiu não entra: o launcher
        // não apaga nada com base no pacote, e o modo estrito continua sendo
        // quem cuida disso.
        const mudaram = manifesto.files.filter(f => antes.get(f.path) !== f.hash);

        if (mudaram.length && mudaram.length < manifesto.files.length) {
            const partesDelta = zip.dividir(mudaram, LIMITE_PARTE);
            const delta = { partes: [], arquivos: mudaram.length, tamanho: 0 };

            for (let i = 0; i < partesDelta.length; i++) {
                const nome = partesDelta.length === 1
                    ? `delta-v${anterior.version}-v${versao}.zip`
                    : `delta-v${anterior.version}-v${versao}.parte${i + 1}de${partesDelta.length}.zip`;

                const feito = await zip.escrever(
                    path.join(pasta, nome), raiz, partesDelta[i].map(f => f.path),
                    (feitos, total) => aoProgresso && aoProgresso('delta', feitos, total)
                );

                delta.partes.push({ arquivo: nome, tamanho: feito.bytes, hash: feito.hash });
                delta.tamanho += feito.bytes;
            }

            registro.deltas[anterior.version] = delta;
        }
    }

    /* --- sobe para o CDN ------------------------------------------------ */

    // Sem token configurado isto e uma nao-operacao, e o pacote fica so aqui —
    // onde o servidor nao vai anuncia-lo, porque de uma conexao so ele seria
    // mais lento que o download arquivo a arquivo. Falhar aqui tambem nao
    // quebra a publicacao: o modpack ja esta publicado e funcionando.
    if (github.configurado()) {
        try {
            await github.publicar(instanceId, registro, pasta,
                (arquivo, enviados, total) => aoProgresso && aoProgresso('enviando', enviados, total));
        } catch (err) {
            console.error('[pacotes] nao consegui subir para o GitHub:', err.message);
        }
    }

    /* --- guarda, e joga fora o que envelheceu --------------------------- */

    const indice = ler(instanceId);
    indice.versoes[String(versao)] = registro;
    gravar(instanceId, indice);

    await limpar(instanceId, indice, versao);
    return registro;
}

/**
 * Só as duas últimas versões ficam em disco.
 *
 * Cada versão custa 1,7 GB. Guardar histórico aqui encheria o disco do
 * servidor em três publicações — e quem está muitas versões atrás baixa o
 * pacote inteiro da versão nova, que é o caminho certo mesmo.
 */
async function limpar(instanceId, indice, versaoAtual) {
    const manter = new Set([String(versaoAtual), String(versaoAtual - 1)]);
    const pasta = pastaDePacotes(instanceId);

    const vivos = new Set();
    for (const [versao, registro] of Object.entries(indice.versoes)) {
        if (!manter.has(versao)) {
            delete indice.versoes[versao];
            continue;
        }
        for (const parte of registro.pacote?.partes || []) vivos.add(parte.arquivo);
        for (const delta of Object.values(registro.deltas || {})) {
            for (const parte of delta.partes) vivos.add(parte.arquivo);
        }
    }
    gravar(instanceId, indice);

    let nomes;
    try {
        nomes = await fsp.readdir(pasta);
    } catch {
        return;
    }

    for (const nome of nomes) {
        if (vivos.has(nome)) continue;
        await fsp.rm(path.join(pasta, nome), { force: true }).catch(() => { });
    }
}

/* ------------------------------------------------------------- consulta -- */

/**
 * O que oferecer a quem está na versão `de` (null = instalação nova).
 *
 * Devolve `{ tipo, partes, tamanho, arquivos }`, ou null quando não há pacote
 * publicado — nesse caso o launcher volta ao download arquivo a arquivo, que
 * continua funcionando.
 */
function paraVersao(instanceId, versaoAtual, de) {
    const registro = ler(instanceId).versoes[String(versaoAtual)];
    if (!registro) return null;

    if (de != null) {
        const delta = registro.deltas?.[String(de)];
        // Delta maior que o pacote inteiro não faz sentido; nesse caso o
        // pacote ganha.
        if (delta && delta.tamanho < (registro.pacote?.tamanho || Infinity)) {
            return { tipo: 'delta', de, ...delta };
        }
    }

    // O pacote inteiro só vale a pena de um CDN, e isso é medida, não
    // opinião: daqui saem 2,9 MB/s numa conexão e ~3,9 MB/s em paralelo. Os
    // 1,84 GB do pacote numa conexão levariam 10,4 minutos, contra 7,8 do
    // download arquivo a arquivo que já existe. Oferecê-lo servido por nós
    // seria trocar uma coisa por outra PIOR.
    //
    // O delta é diferente e por isso passa acima: ele são poucos arquivos
    // pequenos, e aí o custo é o número de conexões, não a banda.
    if (!registro.pacote) return null;
    if (!registro.pacote.partes.every(parte => parte.url)) return null;

    return { tipo: 'pacote', ...registro.pacote };
}

/** O arquivo em disco de uma parte, para o servidor poder entregá-la. */
function caminhoDaParte(instanceId, arquivo) {
    // Nome vem da URL: nada de subir de pasta.
    if (!/^[A-Za-z0-9._-]+$/.test(arquivo)) return null;

    const completo = path.join(pastaDePacotes(instanceId), arquivo);
    return fs.existsSync(completo) ? completo : null;
}

module.exports = { construir, paraVersao, caminhoDaParte, ler, LIMITE_PARTE };
