/**
 * Links de download assinados.
 *
 * O manifesto é filtrado por cargo, mas os arquivos em /files/ eram servidos a
 * qualquer um que soubesse o caminho — bastava alguém repassar a lista para o
 * modpack vazar. Agora cada link do manifesto vai assinado e com prazo.
 *
 * A assinatura é a mesma do módulo secure_link do nginx, de propósito: assim o
 * nginx confere sozinho e serve o arquivo estático direto, sem o Node no meio
 * de um download de 1,6 GB. O confere() daqui é a mesma conta, para quando o
 * nginx não estiver na frente (desenvolvimento, ou acesso direto à porta).
 *
 *   nginx:  secure_link_md5 "$secure_link_expires$uri SEGREDO"
 *   aqui:   md5(`${expires}${uri} ${segredo}`) em base64url
 *
 * O $uri do nginx vem decodificado e normalizado, então a conta é feita sobre
 * o caminho decodificado — "/files/atena/mods/[1.20.1] Create.jar", não a
 * versão com %20 e %5B.
 */
const crypto = require('crypto');

const { FILES_SECRET, SIGNED_URL_TTL_HOURS } = require('../config');

/** base64 do jeito que o nginx espera na URL: sem +, / nem =. */
function toUrlSafe(base64) {
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signature(uri, expires) {
    return toUrlSafe(
        crypto.createHash('md5').update(`${expires}${uri} ${FILES_SECRET}`).digest('base64')
    );
}

/** Segundos desde a época em que o link deixa de valer. */
function expiryFrom(ttlHours) {
    const hours = Number(ttlHours) > 0 ? Number(ttlHours) : SIGNED_URL_TTL_HOURS;
    return Math.floor(Date.now() / 1000) + Math.round(hours * 3600);
}

/**
 * Assina um caminho já montado (decodificado) e devolve a query a acrescentar.
 * O chamador é quem sabe como escapar o caminho na URL final.
 */
function queryFor(decodedUri, ttlHours) {
    const expires = expiryFrom(ttlHours);
    return `md5=${signature(decodedUri, expires)}&expires=${expires}`;
}

/**
 * Confere a assinatura de um pedido. Devolve 'ok', 'expirado' ou 'invalido' —
 * os três casos que o nginx distingue, para a resposta poder ser a mesma.
 */
function check(decodedUri, md5, expires) {
    const deadline = Number(expires);
    if (!md5 || !Number.isFinite(deadline)) return 'invalido';

    const expected = Buffer.from(signature(decodedUri, String(expires)));
    const received = Buffer.from(String(md5));

    if (expected.length !== received.length) return 'invalido';
    if (!crypto.timingSafeEqual(expected, received)) return 'invalido';

    return deadline < Math.floor(Date.now() / 1000) ? 'expirado' : 'ok';
}

module.exports = { queryFor, check, signature };
