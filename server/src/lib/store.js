/**
 * Armazenamento em arquivos JSON.
 *
 * A escala aqui é pequena (algumas instâncias, notícias e contas de staff),
 * então JSON em disco evita a dependência de um banco. As escritas são
 * atômicas: grava em .tmp e renomeia, para não corromper o arquivo se o
 * processo morrer no meio.
 */
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config');

/**
 * O que já foi lido, com a marca de tempo do arquivo na hora da leitura.
 *
 * O cache existe porque estes arquivos são lidos a cada requisição e mudam
 * raramente. Mas ele nunca expirava, e isso mordeu de verdade: publicar uma
 * versão do modpack por um script fora do processo do servidor gravava o
 * `pacotes-<id>.json` novo em disco enquanto a API continuava servindo o
 * antigo. O resultado é silencioso e caro — a rota /version respondia
 * `pacote: null`, e todo mundo baixava 5.661 arquivos um a um da VPS em vez
 * do pacote de 1,76 GB pronto no GitHub.
 *
 * Guardar o mtime junto resolve sem perder o cache: uma chamada a `statSync`
 * por leitura é barata perto de reanalisar o JSON, e qualquer escrita vinda
 * de fora passa a ser notada na leitura seguinte.
 */
const cache = new Map();

function file(name) {
    return path.join(DATA_DIR, `${name}.json`);
}

/** Quando o arquivo mudou pela última vez, ou null se ele não existe. */
function marca(p) {
    try {
        return fs.statSync(p).mtimeMs;
    } catch {
        return null;
    }
}

function read(name, fallback) {
    const p = file(name);
    const agora = marca(p);
    const guardado = cache.get(name);

    // Só serve o cache se o arquivo continuar exatamente como estava quando
    // ele foi montado. Arquivo apagado por fora também conta como mudança.
    if (guardado && guardado.mtime === agora) return guardado.value;

    let value = fallback;

    if (agora !== null) {
        try {
            value = JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (err) {
            console.error(`[store] ${name}.json está corrompido, usando o padrão:`, err.message);
            value = fallback;
        }
    } else {
        writeToDisk(name, fallback);
    }

    cache.set(name, { value, mtime: marca(p) });
    return value;
}

function writeToDisk(name, value) {
    const p = file(name);
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 4), 'utf8');
    fs.renameSync(tmp, p);
}

function write(name, value) {
    writeToDisk(name, value);
    cache.set(name, { value, mtime: marca(file(name)) });
    return value;
}

function invalidate(name) {
    if (name) cache.delete(name);
    else cache.clear();
}

module.exports = { read, write, invalidate };
