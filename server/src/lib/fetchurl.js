/**
 * Baixa um arquivo de uma URL direto para o disco do servidor.
 *
 * Serve para publicar o modpack a partir de um link (uma release do GitHub,
 * por exemplo) em vez de subir o .zip pelo navegador: o arquivo vai do GitHub
 * para a VPS na velocidade do datacenter, sem passar pela internet de casa.
 *
 * ATENÇÃO ao motivo de tanta checagem: quem usa o painel escolhe a URL, e o
 * servidor é quem faz o pedido. Sem filtro isso vira um SSRF — daria para pedir
 * http://127.0.0.1:6379 (Redis), http://localhost:8080 (Wings) ou o endpoint de
 * metadados do provedor e ler a resposta. Então:
 *
 *   1. só http e https;
 *   2. o DNS é resolvido AQUI, e todo endereço que sair privado é recusado;
 *   3. a conexão é fixada no endereço já conferido (`lookup`), senão um DNS que
 *      responde diferente na segunda consulta contornaria o passo 2;
 *   4. cada redirecionamento passa pelos mesmos três testes.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const https = require('https');
const dns = require('dns/promises');
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const { TMP_DIR, MAX_UPLOAD_MB } = require('../config');

const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 20_000;

/* --------------------------------------------------- endereços proibidos -- */

function ipv4IsPrivate(ip) {
    const [a, b] = ip.split('.').map(Number);

    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 10) return true;                         // rede privada
    if (a === 127) return true;                        // loopback
    if (a === 169 && b === 254) return true;           // link-local (metadados!)
    if (a === 172 && b >= 16 && b <= 31) return true;  // rede privada
    if (a === 192 && b === 168) return true;           // rede privada
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true;             // 192.0.0.0/24 e teste
    if (a >= 224) return true;                         // multicast e reservado
    return false;
}

function ipv6IsPrivate(ip) {
    const lower = ip.toLowerCase();

    if (lower === '::' || lower === '::1') return true;

    // Endereço IPv4 embrulhado em IPv6 (::ffff:127.0.0.1) vale pelas regras v4.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return ipv4IsPrivate(mapped[1]);

    const head = lower.split(':')[0];
    if (/^f[cd]/.test(head)) return true;              // fc00::/7, uso local
    if (/^fe[89ab]/.test(head)) return true;           // fe80::/10, link-local
    return false;
}

function isPrivateAddress(ip) {
    const family = net.isIP(ip);
    if (family === 4) return ipv4IsPrivate(ip);
    if (family === 6) return ipv6IsPrivate(ip);
    return true;   // não é um IP reconhecível: recusa por precaução
}

function reject(message) {
    return Object.assign(new Error(message), { status: 400 });
}

/**
 * Confere o endereço e devolve o IP já resolvido, para a conexão ser fixada
 * nele. Um hostname que resolve para vários endereços só passa se TODOS forem
 * públicos: assim não dá para esconder o 127.0.0.1 atrás de um IP válido.
 */
async function resolveSafely(hostname) {
    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) throw reject(`Endereço não permitido: ${hostname}`);
        return { address: hostname, family: net.isIP(hostname) };
    }

    let records;
    try {
        records = await dns.lookup(hostname, { all: true });
    } catch {
        throw reject(`Não consegui resolver o endereço "${hostname}".`);
    }

    if (!records.length) throw reject(`Não consegui resolver o endereço "${hostname}".`);

    for (const record of records) {
        if (isPrivateAddress(record.address)) {
            throw reject(`"${hostname}" aponta para um endereço interno (${record.address}).`);
        }
    }
    return records[0];
}

/** Valida a URL inteira e devolve o que a conexão precisa saber. */
async function prepare(rawUrl) {
    let url;
    try {
        url = new URL(String(rawUrl).trim());
    } catch {
        throw reject('URL inválida.');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw reject('Só aceito links http:// ou https://');
    }

    const resolved = await resolveSafely(url.hostname);
    return { url, resolved };
}

/* ------------------------------------------------------------- o download -- */

/**
 * Puxa a URL para um arquivo temporário.
 *
 * onProgress(baixado, total) — total vem 0 quando o servidor não manda
 * Content-Length (é o caso de algumas releases do GitHub).
 */
async function download(rawUrl, { onProgress, signal } = {}) {
    const target = path.join(TMP_DIR, `url-${crypto.randomUUID()}`);
    const limit = MAX_UPLOAD_MB * 1024 * 1024;

    let current = rawUrl;
    let response = null;

    try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
            const { url, resolved } = await prepare(current);
            response = await request(url, resolved, signal);

            const status = response.statusCode;

            if (status >= 300 && status < 400 && response.headers.location) {
                const next = new URL(response.headers.location, url).toString();
                response.resume();          // descarta o corpo do redirecionamento
                response.destroy();
                current = next;
                continue;
            }

            if (status !== 200) {
                response.resume();
                response.destroy();
                throw reject(`O servidor respondeu ${status} para esse link.`);
            }

            const total = Number(response.headers['content-length'] || 0);
            if (total && total > limit) {
                response.destroy();
                throw reject(`O arquivo tem ${(total / 1048576).toFixed(0)} MB e o limite é ${MAX_UPLOAD_MB} MB.`);
            }

            await pipeToFile(response, target, limit, onProgress, total);
            return { path: target, size: (await fsp.stat(target)).size, url: current };
        }

        throw reject('O link redirecionou vezes demais.');
    } catch (err) {
        await fsp.rm(target, { force: true }).catch(() => {});
        throw err;
    }
}

function request(url, resolved, signal) {
    return new Promise((resolve, rejectPromise) => {
        const client = url.protocol === 'https:' ? https : http;

        const req = client.get(url, {
            signal,
            timeout: CONNECT_TIMEOUT_MS,
            // Fixa a conexão no endereço já conferido: sem isto o hostname
            // seria resolvido de novo e a checagem acima não valeria de nada.
            // Com autoSelectFamily (padrão no Node 20+) o socket chama isto com
            // { all: true } e espera uma lista, não um endereço solto.
            lookup: (_hostname, options, cb) => (options && options.all
                ? cb(null, [{ address: resolved.address, family: resolved.family }])
                : cb(null, resolved.address, resolved.family)),
            headers: {
                // O GitHub recusa pedidos sem User-Agent.
                'user-agent': 'AtenaLauncher-Server',
                accept: '*/*'
            }
        });

        req.on('response', resolve);
        req.on('timeout', () => req.destroy(reject('O servidor demorou demais para responder.')));
        req.on('error', err => rejectPromise(err.status ? err : reject(`Não consegui baixar: ${err.message}`)));
    });
}

function pipeToFile(response, target, limit, onProgress, total) {
    return new Promise((resolve, rejectPromise) => {
        const out = fs.createWriteStream(target);
        let received = 0;
        let lastReport = 0;

        response.on('data', chunk => {
            received += chunk.length;

            if (received > limit) {
                response.destroy();
                out.destroy();
                return rejectPromise(reject(`O arquivo passou do limite de ${MAX_UPLOAD_MB} MB.`));
            }

            // Reportar a cada 4 MB: o painel pergunta de segundo em segundo,
            // não precisa de um evento por pacote.
            if (onProgress && received - lastReport > 4 * 1024 * 1024) {
                lastReport = received;
                onProgress(received, total);
            }
        });

        response.on('error', rejectPromise);
        out.on('error', rejectPromise);
        out.on('finish', () => {
            if (onProgress) onProgress(received, total || received);
            resolve();
        });

        response.pipe(out);
    });
}

module.exports = { download, isPrivateAddress, prepare };
