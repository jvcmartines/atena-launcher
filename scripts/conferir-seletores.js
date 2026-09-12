/**
 * Procura `document.querySelector('.algo')` apontando para marcação que não
 * existe mais.
 *
 * Existe por causa do mesmo refatoramento que já custou duas correções: ao
 * transformar o menu do modpack numa aba, o `.instance-popup` deixou de
 * existir no HTML, mas duas funções continuaram fazendo
 * `document.querySelector('.instance-popup').style.display = 'none'`. O
 * arquivo era válido, os outros dois conferidores passavam — um olha
 * variáveis, o outro métodos — e "Verificar e reparar" ia ao ar quebrado com
 * "Cannot read properties of null".
 *
 * O que ele confere: toda busca por classe ou id que é usada SEM proteção
 * (sem `?.`, sem guardar numa variável para testar depois) precisa existir em
 * algum HTML, ou ser criada por `innerHTML` em algum JS.
 *
 * O que ele deixa passar de propósito:
 *   - `querySelector(...)?.algo` — quem escreveu já sabe que pode não existir;
 *   - `let x = querySelector(...)` — o valor vai para uma variável, e o padrão
 *     da casa é testar antes de usar. O conferidor de variáveis não alcança
 *     isso, mas um `if (x)` logo abaixo é o suficiente e é o que se usa aqui;
 *   - seletores montados com variável, que não dá para resolver sem rodar.
 *
 *   node scripts/conferir-seletores.js
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', 'src');

function listar(dir, filtro, saida = []) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, item.name);
        if (item.isDirectory()) listar(completo, filtro, saida);
        else if (filtro.test(item.name)) saida.push(completo);
    }
    return saida;
}

/* ------------------------------------------- o que existe de marcação --- */

const conhecidos = new Set();

function colher(texto) {
    // class="a b c" e id="x", tanto no HTML quanto dentro de template string.
    for (const m of texto.matchAll(/class\s*=\s*["'`]([^"'`]+)["'`]/g)) {
        for (const nome of m[1].split(/\s+/)) if (nome) conhecidos.add(`.${nome}`);
    }
    for (const m of texto.matchAll(/id\s*=\s*["'`]([^"'`\s]+)["'`]/g)) conhecidos.add(`#${m[1]}`);

    // classList.add('x') e classList.toggle('x') também criam estado real.
    for (const m of texto.matchAll(/classList\.(?:add|toggle|replace)\(\s*['"`]([^'"`]+)['"`]/g)) {
        conhecidos.add(`.${m[1]}`);
    }
}

for (const arquivo of listar(RAIZ, /\.html$/)) colher(fs.readFileSync(arquivo, 'utf8'));
for (const arquivo of listar(RAIZ, /\.js$/)) colher(fs.readFileSync(arquivo, 'utf8'));

/* ------------------------------------------------ o que o código busca -- */

// querySelector('...') seguido de algo que desreferencia na mesma expressão.
const BUSCA = /document\.querySelector\(\s*(['"])([^'"]+)\1\s*\)\s*(\??\.|\[)/g;

/**
 * Listas de seletores percorridas num laço.
 *
 * `for (const s of ['.a', '.b']) document.querySelector(s)` escapava da
 * conferência acima, porque ali o seletor é uma variável — e foi assim que
 * `.autojoin` continuou sendo escondido depois de virar `.toggles`, deixando
 * os interruptores na tela durante o download.
 *
 * Uma lista só conta como lista de seletores quando TODOS os itens têm a
 * forma de um, e nenhum é extensão de arquivo — senão `['.html', '.js']`
 * viraria falso alarme.
 */
const EXTENSOES = new Set([
    '.html', '.js', '.mjs', '.cjs', '.css', '.json', '.jar', '.zip', '.txt',
    '.log', '.png', '.jpg', '.toml', '.properties', '.disabled', '.parte', '.gz'
]);

const LISTA = /\[\s*((?:['"][.#][^'"]+['"]\s*,\s*)+['"][.#][^'"]+['"])\s*\]/g;

let problemas = 0;

for (const arquivo of listar(RAIZ, /\.js$/)) {
    const codigo = fs.readFileSync(arquivo, 'utf8');

    if (codigo.includes('querySelector(')) {
        for (const achado of codigo.matchAll(LISTA)) {
            const itens = [...achado[1].matchAll(/['"]([^'"]+)['"]/g)].map(m => m[1]);
            if (itens.some(i => EXTENSOES.has(i.toLowerCase()))) continue;
            if (!itens.every(i => /^[.#][A-Za-z0-9_-]+$/.test(i))) continue;

            for (const seletor of itens) {
                if (conhecidos.has(seletor)) continue;
                const linha = codigo.slice(0, achado.index).split('\n').length;
                console.log(`${path.relative(RAIZ, arquivo)}:${linha}  '${seletor}' na lista de seletores não existe em nenhum HTML`);
                problemas += 1;
            }
        }
    }

    for (const achado of codigo.matchAll(BUSCA)) {
        const seletor = achado[2];
        const depois = achado[3];

        if (depois.startsWith('?')) continue;               // já protegido
        if (!/^[.#][A-Za-z0-9_-]+$/.test(seletor)) continue; // composto: não dá para conferir assim

        if (conhecidos.has(seletor)) continue;

        const linha = codigo.slice(0, achado.index).split('\n').length;
        console.log(`${path.relative(RAIZ, arquivo)}:${linha}  querySelector('${seletor}') não existe em nenhum HTML`);
        problemas += 1;
    }
}

if (problemas) {
    console.log(`\n${problemas} seletor(es) apontando para marcação inexistente.`);
    process.exit(1);
}

console.log('nenhum seletor apontando para marcação inexistente.');
