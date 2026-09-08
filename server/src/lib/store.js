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

const cache = new Map();

function file(name) {
    return path.join(DATA_DIR, `${name}.json`);
}

function read(name, fallback) {
    if (cache.has(name)) return cache.get(name);

    const p = file(name);
    let value = fallback;

    if (fs.existsSync(p)) {
        try {
            value = JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch (err) {
            console.error(`[store] ${name}.json está corrompido, usando o padrão:`, err.message);
            value = fallback;
        }
    } else {
        writeToDisk(name, fallback);
    }

    cache.set(name, value);
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
    cache.set(name, value);
    return value;
}

function invalidate(name) {
    if (name) cache.delete(name);
    else cache.clear();
}

module.exports = { read, write, invalidate };
