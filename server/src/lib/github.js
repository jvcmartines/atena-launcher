/**
 * Publicação dos pacotes do modpack numa release do GitHub.
 *
 * A razão de existir está medida: daqui saem 2,9 MB/s numa conexão; o CDN do
 * GitHub entrega 26,9 MB/s. Os 1,84 GB do modpack levam 10 minutos por aqui e
 * pouco mais de um minuto por lá.
 *
 * Quem baixa não precisa de token nenhum — o repositório é público, e é essa
 * a razão de ele ser público. O token daqui serve só para SUBIR, e por isso
 * ele deve ser fine-grained, com permissão de conteúdo apenas neste
 * repositório: se vazar, o estrago possível é alguém publicar release num
 * repositório que só guarda cópia de arquivos que já são públicos.
 *
 * Sem token configurado, tudo aqui vira não-operação. O servidor continua
 * publicando o modpack normalmente e o launcher continua baixando arquivo a
 * arquivo — mais devagar, mas funcionando.
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const API = 'api.github.com';
const AGENTE = 'AtenaLauncher-Server';

function config() {
    return {
        token: process.env.ATENA_GITHUB_TOKEN || '',
        repo: process.env.ATENA_GITHUB_REPO || 'jvcmartines/atena-modpack'
    };
}

function configurado() {
    return Boolean(config().token && config().repo.includes('/'));
}

/* ------------------------------------------------------------- HTTP ----- */

function pedir(metodo, caminho, { corpo, host = API, cabecalhos = {} } = {}) {
    const { token } = config();

    return new Promise((ok, erro) => {
        const dados = corpo ? Buffer.from(JSON.stringify(corpo)) : null;

        const req = https.request({
            host,
            path: caminho,
            method: metodo,
            headers: {
                'authorization': `Bearer ${token}`,
                'accept': 'application/vnd.github+json',
                'x-github-api-version': '2022-11-28',
                'user-agent': AGENTE,
                ...(dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {}),
                ...cabecalhos
            }
        }, res => {
            const pedacos = [];
            res.on('data', p => pedacos.push(p));
            res.on('end', () => {
                const texto = Buffer.concat(pedacos).toString('utf8');
                let json = null;
                try { json = texto ? JSON.parse(texto) : null; } catch { /* nem toda resposta é JSON */ }
                ok({ status: res.statusCode, json, texto });
            });
        });

        req.on('error', erro);
        if (dados) req.write(dados);
        req.end();
    });
}

/* ---------------------------------------------------------- releases ---- */

/** A release desta tag, criando-a se ainda não existir. */
async function release(tag, titulo, corpo) {
    const { repo } = config();

    const achada = await pedir('GET', `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
    if (achada.status === 200) return achada.json;

    const criada = await pedir('POST', `/repos/${repo}/releases`, {
        corpo: { tag_name: tag, name: titulo, body: corpo, draft: false, prerelease: false }
    });

    if (criada.status !== 201) {
        throw new Error(`não consegui criar a release ${tag}: HTTP ${criada.status} ${criada.texto.slice(0, 200)}`);
    }
    return criada.json;
}

/**
 * Sobe um arquivo como anexo, substituindo o de mesmo nome se já existir.
 *
 * O envio é em fluxo, com o tamanho no cabeçalho: são 1,8 GB, e carregá-los na
 * memória para depois mandar derrubaria o servidor.
 */
function enviarAnexo(uploadUrl, arquivo, aoProgresso) {
    const { token } = config();
    const nome = path.basename(arquivo);
    const tamanho = fs.statSync(arquivo).size;

    // O upload_url vem no formato template: ".../assets{?name,label}"
    const base = uploadUrl.split('{')[0];
    const url = new URL(`${base}?name=${encodeURIComponent(nome)}`);

    return new Promise((ok, erro) => {
        const req = https.request({
            host: url.host,
            path: `${url.pathname}${url.search}`,
            method: 'POST',
            headers: {
                'authorization': `Bearer ${token}`,
                'accept': 'application/vnd.github+json',
                'user-agent': AGENTE,
                'content-type': 'application/octet-stream',
                'content-length': tamanho
            }
        }, res => {
            const pedacos = [];
            res.on('data', p => pedacos.push(p));
            res.on('end', () => {
                const texto = Buffer.concat(pedacos).toString('utf8');
                if (res.statusCode !== 201) {
                    return erro(new Error(`upload de ${nome}: HTTP ${res.statusCode} ${texto.slice(0, 200)}`));
                }
                try {
                    ok(JSON.parse(texto));
                } catch (e) {
                    erro(e);
                }
            });
        });

        req.on('error', erro);

        let enviados = 0;
        const leitor = fs.createReadStream(arquivo);
        leitor.on('data', pedaco => {
            enviados += pedaco.length;
            if (aoProgresso) aoProgresso(enviados, tamanho);
        });
        leitor.on('error', erro);
        leitor.pipe(req);
    });
}

async function apagarAnexo(id) {
    const { repo } = config();
    await pedir('DELETE', `/repos/${repo}/releases/assets/${id}`);
}

/* ------------------------------------------------------------ publicar -- */

/**
 * Sobe as partes de um registro de pacotes e devolve o mesmo registro com as
 * URLs do CDN preenchidas.
 *
 * É `parte.url` que faz o servidor passar a anunciar o pacote ao launcher —
 * sem ela, ele fica quieto e o download continua arquivo a arquivo. Ou seja:
 * um upload que falhe no meio não deixa ninguém com um pacote quebrado, só
 * sem pacote.
 */
async function publicar(instanceId, registro, pasta, aoProgresso) {
    if (!configurado()) return registro;

    const tag = `${instanceId}-v${registro.versao}`;
    const alvo = await release(
        tag,
        `${instanceId} v${registro.versao}`,
        'Arquivos do modpack publicados pelo painel do Atena. Baixados pelo launcher; não é para instalar à mão.'
    );

    const existentes = new Map((alvo.assets || []).map(a => [a.name, a.id]));

    const todas = [
        ...(registro.pacote?.partes || []),
        ...Object.values(registro.deltas || {}).flatMap(d => d.partes)
    ];

    for (const parte of todas) {
        const arquivo = path.join(pasta, parte.arquivo);
        if (!fs.existsSync(arquivo)) continue;

        // Republicar a mesma versão tem que substituir, não duplicar.
        if (existentes.has(parte.arquivo)) await apagarAnexo(existentes.get(parte.arquivo));

        const anexo = await enviarAnexo(alvo.upload_url, arquivo, (enviados, total) => {
            if (aoProgresso) aoProgresso(parte.arquivo, enviados, total);
        });

        // É esta linha que liga o CDN: só com ela o servidor passa a anunciar
        // o pacote ao launcher.
        parte.url = anexo.browser_download_url;
    }

    return registro;
}

module.exports = { configurado, config, release, enviarAnexo, apagarAnexo, publicar, pedir };
