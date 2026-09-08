/**
 * Atena Launcher
 * Fork de Selvania-Launcher (Luuxis) - Luuxis License v1.0 (ver LICENSE.md)
 *
 * Camada de comunicação com o painel/API do Atena.
 *
 * Endpoints esperados (servidos pela pasta `server/`):
 *   GET {API}/config    -> configuração global do launcher
 *   GET {API}/instances -> mapa de instâncias (modpacks)
 *   GET {API}/articles  -> notícias exibidas na tela inicial
 *
 * A URL base vem de `url` no package.json e pode ser sobrescrita em
 * desenvolvimento com a variável de ambiente ATENA_API.
 *
 * Quando o jogador conecta o Discord, o token dele viaja no cabeçalho
 * x-atena-player. É por ele que o servidor decide quais modpacks aparecem e
 * se a pessoa está banida.
 */

const pkg = require('../package.json');
const nodeFetch = require("node-fetch");
const convert = require('xml-js');

let url = (process.env.ATENA_API || pkg.url || '').replace(/\/+$/, '');

let config = `${url}/config`;
let articles = `${url}/articles`;

let playerToken = null;

class Config {
    getApiUrl() {
        return url;
    }

    /** Token do jogador (vem da conexão com o Discord). */
    setPlayerToken(token) {
        playerToken = token || null;
    }

    headers() {
        return playerToken ? { 'x-atena-player': playerToken } : {};
    }

    /**
     * Traduz a resposta do servidor num erro que o launcher sabe mostrar.
     * O 403 com `banned` é o caso especial: a mensagem vem da staff.
     */
    async toError(response) {
        let body = await response.json().catch(() => ({}));

        if (response.status === 403 && body.error === 'banned') {
            return { error: { code: 'banned', message: body.message || '', banned: true } };
        }
        return { error: { code: response.statusText, message: body.message || 'servidor inacessível' } };
    }

    GetConfig() {
        return new Promise((resolve, reject) => {
            nodeFetch(config, { headers: this.headers() }).then(async response => {
                if (response.status === 200) return resolve(response.json());
                return reject(await this.toError(response));
            }).catch(error => {
                return reject({ error });
            })
        })
    }

    async getInstanceList() {
        let urlInstance = `${url}/instances`
        let instances = await nodeFetch(urlInstance, { headers: this.headers() })
            .then(res => res.json())
            .catch(err => err)
        let instancesList = []

        if (!instances || instances.error) return instancesList
        // A API pode responder tanto com um mapa { nome: {...} } quanto com uma lista [ {...} ].
        if (!Array.isArray(instances)) instances = Object.values(instances)

        for (let data of instances) {
            instancesList.push(data)
        }
        return instancesList
    }

    async getNews(config) {
        if (config.rss) {
            return new Promise((resolve, reject) => {
                nodeFetch(config.rss).then(async config => {
                    if (config.status === 200) {
                        let news = [];
                        let response = await config.text()
                        response = (JSON.parse(convert.xml2json(response, { compact: true })))?.rss?.channel?.item;

                        if (!Array.isArray(response)) response = [response];
                        for (let item of response) {
                            news.push({
                                title: item.title._text,
                                content: item['content:encoded']._text,
                                author: item['dc:creator']._text,
                                publish_date: item.pubDate._text
                            })
                        }
                        return resolve(news);
                    }
                    else return reject({ error: { code: config.statusText, message: 'servidor inacessível' } });
                }).catch(error => reject({ error }))
            })
        } else {
            return new Promise((resolve, reject) => {
                nodeFetch(articles).then(async config => {
                    if (config.status === 200) return resolve(config.json());
                    else return reject({ error: { code: config.statusText, message: 'servidor inacessível' } });
                }).catch(error => {
                    return reject({ error });
                })
            })
        }
    }
}

export default new Config;
