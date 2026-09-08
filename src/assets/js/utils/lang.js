/**
 * Atena Launcher — traduções
 *
 * O idioma padrão é o inglês. O jogador troca em Configurações → Launcher e a
 * escolha fica salva no configClient (launcher_config.lang).
 *
 * Para adicionar um idioma novo: copie src/assets/lang/en.json, traduza os
 * valores (as chaves à esquerda não mudam) e registre o arquivo em AVAILABLE.
 */

const fs = require('fs');

const DEFAULT_LANG = 'en';

const AVAILABLE = [
    { code: 'en', label: 'English' },
    { code: 'pt-BR', label: 'Português (BR)' },
    { code: 'es', label: 'Español' }
];

class Lang {
    constructor() {
        this.code = DEFAULT_LANG;
        this.strings = {};
        this.fallback = {};
    }

    get available() {
        return AVAILABLE;
    }

    get defaultCode() {
        return DEFAULT_LANG;
    }

    /** Carrega um idioma. Cai no inglês se o código for desconhecido. */
    load(code) {
        this.fallback = this.read(DEFAULT_LANG);
        this.code = AVAILABLE.some(item => item.code === code) ? code : DEFAULT_LANG;
        this.strings = this.code === DEFAULT_LANG ? this.fallback : this.read(this.code);
        return this;
    }

    read(code) {
        try {
            return JSON.parse(fs.readFileSync(`${__dirname}/assets/lang/${code}.json`, 'utf8'));
        } catch (err) {
            console.error(`[lang] não consegui ler ${code}.json:`, err.message);
            return {};
        }
    }

    /**
     * Devolve o texto de uma chave, trocando {marcadores} pelos valores.
     * Se a chave não existir no idioma escolhido, usa o inglês; se não existir
     * em lugar nenhum, devolve a própria chave (fica óbvio o que faltou).
     */
    t(key, vars) {
        let value = this.strings[key] ?? this.fallback[key] ?? key;

        if (vars) {
            for (const [name, replacement] of Object.entries(vars)) {
                value = value.split(`{${name}}`).join(replacement);
            }
        }
        return value;
    }

    /**
     * Preenche o HTML a partir dos atributos data-i18n:
     *   data-i18n              -> textContent
     *   data-i18n-html         -> innerHTML (para textos com <b>, <br>…)
     *   data-i18n-placeholder  -> placeholder do input
     *   data-i18n-title        -> tooltip
     */
    apply(root = document) {
        root.querySelectorAll('[data-i18n]').forEach(el => {
            el.textContent = this.t(el.dataset.i18n);
        });
        root.querySelectorAll('[data-i18n-html]').forEach(el => {
            el.innerHTML = this.t(el.dataset.i18nHtml);
        });
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.dataset.i18nPlaceholder);
        });
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.dataset.i18nTitle);
        });
        return this;
    }
}

export default new Lang;
