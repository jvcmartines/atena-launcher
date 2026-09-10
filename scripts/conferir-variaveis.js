/**
 * Procura variáveis usadas mas nunca declaradas nos módulos do launcher.
 *
 * Existe porque `node --check` só confere sintaxe: um `let x = inicio` com
 * `inicio` inexistente passa na análise e só explode quando aquela linha roda.
 * Foi assim que a atualização do modpack quebrou depois de uma refatoração —
 * o código estava sintaticamente perfeito e mesmo assim morto.
 *
 * Não é um ESLint: é o mínimo que pega essa classe de erro sem trazer uma
 * árvore de dependências para o projeto.
 *
 *   node scripts/conferir-variaveis.js
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const RAIZ = path.resolve(__dirname, '../src/assets/js');

/* O que existe sem ninguém declarar: navegador, Node e Electron. */
const GLOBAIS = new Set([
    'window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage',
    'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'File', 'FileReader',
    'URL', 'URLSearchParams', 'AbortController', 'WebSocket', 'Image', 'Audio',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
    'queueMicrotask', 'structuredClone', 'atob', 'btoa', 'crypto', 'performance',
    'console', 'alert', 'confirm', 'prompt', 'CustomEvent', 'Event', 'DOMParser',
    'require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer',
    'global', 'globalThis', 'TextEncoder', 'TextDecoder',
    // embutidos da linguagem
    'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Math',
    'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
    'ReferenceError', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy',
    'Reflect', 'Intl', 'Function', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
    'undefined', 'NaN', 'Infinity', 'Int32Array', 'Uint8Array', 'Float64Array',
    'ArrayBuffer', 'DataView'
]);

function listarArquivos(dir, saida = []) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, entrada.name);
        if (entrada.isDirectory()) listarArquivos(completo, saida);
        else if (entrada.name.endsWith('.js')) saida.push(completo);
    }
    return saida;
}

/* ------------------------------------------------------- escopos ------- */

function novoEscopo(pai, tipo) {
    return { pai, tipo, nomes: new Set() };
}

function declarar(escopo, nome) {
    if (nome) escopo.nomes.add(nome);
}

function existe(escopo, nome) {
    for (let atual = escopo; atual; atual = atual.pai) {
        if (atual.nomes.has(nome)) return true;
    }
    return GLOBAIS.has(nome);
}

/** Nomes declarados por um padrão de destructuring, parâmetro, etc. */
function nomesDoPadrao(no, saida = []) {
    if (!no) return saida;
    switch (no.type) {
        case 'Identifier': saida.push(no.name); break;
        case 'ObjectPattern':
            for (const prop of no.properties) {
                nomesDoPadrao(prop.type === 'RestElement' ? prop.argument : prop.value, saida);
            }
            break;
        case 'ArrayPattern':
            for (const elemento of no.elements) nomesDoPadrao(elemento, saida);
            break;
        case 'AssignmentPattern': nomesDoPadrao(no.left, saida); break;
        case 'RestElement': nomesDoPadrao(no.argument, saida); break;
    }
    return saida;
}

function filhos(no) {
    const saida = [];
    for (const chave of Object.keys(no)) {
        if (chave === 'type' || chave === 'start' || chave === 'end' || chave === 'loc') continue;
        const valor = no[chave];
        if (Array.isArray(valor)) {
            for (const item of valor) if (item && typeof item.type === 'string') saida.push(item);
        } else if (valor && typeof valor.type === 'string') {
            saida.push(valor);
        }
    }
    return saida;
}

/** Declarações que valem no escopo inteiro (var, function, class, import). */
function coletarDeclaracoes(no, escopo, ehRaizDeFuncao) {
    for (const filho of filhos(no)) {
        const tipo = filho.type;

        if (tipo === 'VariableDeclaration') {
            const soNesteBloco = filho.kind !== 'var';
            if (soNesteBloco === !ehRaizDeFuncao || filho.kind === 'var') {
                // var sobe para a função; let/const ficam no bloco atual
            }
            if (filho.kind === 'var' ? true : ehRaizDeFuncao !== false) {
                for (const decl of filho.declarations) {
                    for (const nome of nomesDoPadrao(decl.id)) declarar(escopo, nome);
                }
            }
        } else if (tipo === 'FunctionDeclaration' || tipo === 'ClassDeclaration') {
            declarar(escopo, filho.id?.name);
        } else if (tipo === 'ImportDeclaration') {
            for (const spec of filho.specifiers) declarar(escopo, spec.local?.name);
        }

        // Não desce para dentro de outra função: lá é outro escopo.
        if (!/Function|ClassBody|ArrowFunctionExpression/.test(tipo)) {
            coletarDeclaracoes(filho, escopo, ehRaizDeFuncao);
        }
    }
}

function analisar(arquivo) {
    const fonte = fs.readFileSync(arquivo, 'utf8');
    let arvore;
    try {
        arvore = acorn.parse(fonte, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            allowReturnOutsideFunction: true
        });
    } catch (err) {
        return [{ nome: '(não consegui ler)', motivo: err.message, linha: 0 }];
    }

    const problemas = [];
    const linhaDe = pos => fonte.slice(0, pos).split('\n').length;

    function percorrer(no, escopo) {
        const tipo = no.type;

        // Cria escopo novo onde a linguagem cria.
        let atual = escopo;
        if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(tipo)) {
            atual = novoEscopo(escopo, 'funcao');
            declarar(atual, no.id?.name);
            declarar(atual, 'arguments');
            declarar(atual, 'this');
            for (const param of no.params) {
                for (const nome of nomesDoPadrao(param)) declarar(atual, nome);
            }
            coletarDeclaracoes(no.body, atual, true);
        } else if (tipo === 'BlockStatement' || tipo === 'Program') {
            atual = novoEscopo(escopo, 'bloco');
            coletarDeclaracoes(no, atual, true);
        } else if (tipo === 'CatchClause') {
            atual = novoEscopo(escopo, 'catch');
            for (const nome of nomesDoPadrao(no.param)) declarar(atual, nome);
        } else if (tipo === 'ForStatement' || tipo === 'ForOfStatement' || tipo === 'ForInStatement') {
            atual = novoEscopo(escopo, 'for');
            const init = no.init || no.left;
            if (init && init.type === 'VariableDeclaration') {
                for (const decl of init.declarations) {
                    for (const nome of nomesDoPadrao(decl.id)) declarar(atual, nome);
                }
            }
        } else if (tipo === 'ClassDeclaration' || tipo === 'ClassExpression') {
            atual = novoEscopo(escopo, 'classe');
            declarar(atual, no.id?.name);
        }

        // O uso propriamente dito.
        if (tipo === 'Identifier' && no._ehUso && !existe(atual, no.name)) {
            problemas.push({ nome: no.name, linha: linhaDe(no.start) });
        }

        for (const filho of filhos(no)) {
            marcarUsos(no, filho);
            percorrer(filho, atual);
        }
    }

    /** Marca os identificadores que são leitura de variável, não nome de campo. */
    function marcarUsos(pai, filho) {
        if (filho.type !== 'Identifier') return;

        if (pai.type === 'MemberExpression' && pai.property === filho && !pai.computed) return;
        if (pai.type === 'Property' && pai.key === filho && !pai.computed) return;
        if (pai.type === 'MethodDefinition' && pai.key === filho && !pai.computed) return;
        if (pai.type === 'PropertyDefinition' && pai.key === filho && !pai.computed) return;
        if (/Function|ClassDeclaration|ClassExpression/.test(pai.type) && pai.id === filho) return;
        if (pai.type === 'VariableDeclarator' && pai.id === filho) return;
        if (/ImportSpecifier|ImportDefaultSpecifier|ImportNamespaceSpecifier/.test(pai.type)) return;
        if (pai.type === 'ExportSpecifier') return;
        if (pai.type === 'LabeledStatement' || pai.type === 'BreakStatement' || pai.type === 'ContinueStatement') return;

        filho._ehUso = true;
    }

    percorrer(arvore, novoEscopo(null, 'raiz'));
    return problemas;
}

/* ---------------------------------------------------------------- saída - */

let total = 0;
for (const arquivo of listarArquivos(RAIZ)) {
    const problemas = analisar(arquivo);
    if (!problemas.length) continue;

    const relativo = path.relative(path.resolve(__dirname, '..'), arquivo).replace(/\\/g, '/');
    for (const p of problemas) {
        console.log(`${relativo}:${p.linha}  ${p.nome} ${p.motivo || 'não foi declarado em lugar nenhum'}`);
        total += 1;
    }
}

if (total) {
    console.log(`\n${total} variável(is) usada(s) sem declaração.`);
    process.exit(1);
}
console.log('nenhuma variável usada sem declaração.');
