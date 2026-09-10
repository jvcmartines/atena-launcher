/**
 * Procura chamadas a `this.algumaCoisa()` que não existem na classe.
 *
 * Existe por causa de um erro que custou duas versões publicadas: numa
 * refatoração eu apaguei um bloco de métodos do home.js e deixei quatro
 * chamadas a `this.executar(...)` apontando para o vazio. O arquivo continuou
 * sintaticamente perfeito, o conferidor de variáveis passou — ele olha
 * variáveis, não métodos — e o botão de JOGAR foi ao ar morto. Só descobri
 * dirigindo o launcher de verdade.
 *
 * O que ele confere, e só isso: dentro de uma `class`, toda chamada
 * `this.nome(...)` tem que corresponder a um método declarado nessa classe ou
 * numa classe que ela estenda dentro do mesmo arquivo. Propriedades que não
 * são chamadas (`this.config`, `this.db`) ficam de fora — elas são atribuídas
 * em tempo de execução e um conferidor estático não teria como saber.
 *
 * Não é um verificador de tipos. É o mínimo que pega esta classe de erro sem
 * trazer uma árvore de dependências para o projeto.
 *
 *   node scripts/conferir-metodos.js
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const RAIZ = path.resolve(__dirname, '../src/assets/js');

function listarArquivos(dir, saida = []) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const completo = path.join(dir, item.name);
        if (item.isDirectory()) listarArquivos(completo, saida);
        else if (item.name.endsWith('.js')) saida.push(completo);
    }
    return saida;
}

/** Percorre a árvore chamando `visitar` em cada nó. */
function andar(no, visitar, pai = null) {
    if (!no || typeof no.type !== 'string') return;
    visitar(no, pai);

    for (const chave of Object.keys(no)) {
        if (chave === 'type' || chave === 'start' || chave === 'end') continue;
        const valor = no[chave];

        if (Array.isArray(valor)) {
            for (const filho of valor) if (filho && typeof filho.type === 'string') andar(filho, visitar, no);
        } else if (valor && typeof valor.type === 'string') {
            andar(valor, visitar, no);
        }
    }
}

/**
 * As chamadas `this.x()` que aparecem dentro de um corpo de classe.
 *
 * Uma função aninhada dentro de um método continua sendo da classe quando é
 * arrow; quando é `function`, o `this` muda e a checagem passaria a mentir.
 * Por isso o corpo de `function` declarada dentro do método é ignorado.
 */
function analisarClasse(classe, codigo) {
    const declarados = new Set();
    for (const item of classe.body.body) {
        if (item.key && item.key.name) declarados.add(item.key.name);
    }

    // Ganchos: `this.aoMudar = null` no construtor e `this.aoMudar()` depois é
    // um padrão legítimo — quem usa a classe põe a função ali. Qualquer coisa
    // que a classe ATRIBUA a si mesma conta como declarada.
    andar(classe, no => {
        if (no.type === 'AssignmentExpression' &&
            no.left.type === 'MemberExpression' &&
            no.left.object.type === 'ThisExpression' &&
            !no.left.computed &&
            no.left.property.name) {
            declarados.add(no.left.property.name);
        }
    });

    const chamados = [];

    const visitar = (no, pai) => {
        if (no.type === 'FunctionExpression' || no.type === 'FunctionDeclaration') return 'pular';

        if (no.type === 'CallExpression' &&
            no.callee.type === 'MemberExpression' &&
            no.callee.object.type === 'ThisExpression' &&
            !no.callee.computed &&
            no.callee.property.name) {
            chamados.push({ nome: no.callee.property.name, pos: no.start });
        }
        void pai;
    };

    // Andar manualmente para poder podar as `function` internas.
    const pilha = [...classe.body.body];
    while (pilha.length) {
        const no = pilha.pop();
        if (!no || typeof no.type !== 'string') continue;

        if (no !== classe && (no.type === 'FunctionExpression' || no.type === 'FunctionDeclaration')) {
            // O corpo de um método É uma FunctionExpression: só podamos as que
            // não são o próprio método.
            const eMetodo = classe.body.body.some(m => m.value === no);
            if (!eMetodo) continue;
        }

        visitar(no);

        for (const chave of Object.keys(no)) {
            if (chave === 'type' || chave === 'start' || chave === 'end') continue;
            const valor = no[chave];
            if (Array.isArray(valor)) {
                for (const filho of valor) if (filho && typeof filho.type === 'string') pilha.push(filho);
            } else if (valor && typeof valor.type === 'string') {
                pilha.push(valor);
            }
        }
    }

    const faltando = [];
    for (const chamada of chamados) {
        if (declarados.has(chamada.nome)) continue;
        faltando.push({
            nome: chamada.nome,
            linha: codigo.slice(0, chamada.pos).split('\n').length
        });
    }
    return faltando;
}

let problemas = 0;

for (const arquivo of listarArquivos(RAIZ)) {
    const codigo = fs.readFileSync(arquivo, 'utf8');

    let arvore;
    try {
        arvore = acorn.parse(codigo, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
    } catch (err) {
        console.log(`${path.relative(RAIZ, arquivo)}:0  (não consegui ler) ${err.message}`);
        problemas += 1;
        continue;
    }

    andar(arvore, no => {
        if (no.type !== 'ClassDeclaration' && no.type !== 'ClassExpression') return;
        // Classe que estende outra pode herdar métodos de fora deste arquivo.
        if (no.superClass) return;

        for (const falta of analisarClasse(no, codigo)) {
            console.log(`${path.relative(RAIZ, arquivo)}:${falta.linha}  this.${falta.nome}() não existe em ${no.id?.name || 'classe anônima'}`);
            problemas += 1;
        }
    });
}

if (problemas) {
    console.log(`\n${problemas} chamada(s) a método inexistente.`);
    process.exit(1);
}

console.log('nenhuma chamada a método inexistente.');
