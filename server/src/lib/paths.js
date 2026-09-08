/**
 * Utilidades de caminho. Tudo que vem do navegador passa por aqui antes de
 * virar um caminho real em disco — é a defesa contra `../../etc/passwd`
 * e contra zip-slip nos uploads de .zip.
 */
const path = require('path');

/** Normaliza um caminho relativo vindo do cliente (sempre com barra normal). */
function normalizeRelative(relative) {
    if (!relative) return '';
    return String(relative)
        .replace(/\\/g, '/')
        .split('/')
        .filter(part => part && part !== '.' && part !== '..')
        .join('/');
}

/** Junta `relative` dentro de `root` garantindo que o resultado não escape. */
function safeJoin(root, relative) {
    const clean = normalizeRelative(relative);
    const full = path.resolve(root, clean);
    const rootResolved = path.resolve(root);

    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
        throw Object.assign(new Error('Caminho inválido'), { status: 400 });
    }
    return full;
}

/** Id seguro para instâncias: minúsculas, sem acento, sem espaço. */
function slugify(name) {
    return String(name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
}

/** Codifica cada segmento para montar a URL de download do arquivo. */
function encodePath(relative) {
    return normalizeRelative(relative)
        .split('/')
        .map(encodeURIComponent)
        .join('/');
}

/**
 * Nome de pasta seguro preservando maiúsculas — é o caso do dataDirectory,
 * onde "Atena" precisa continuar "Atena" (vira %appdata%/.Atena).
 */
function safeFolderName(name) {
    return String(name || '')
        .replace(/[^A-Za-z0-9 ._-]+/g, '')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        .slice(0, 48);
}

module.exports = { normalizeRelative, safeJoin, slugify, encodePath, safeFolderName };
