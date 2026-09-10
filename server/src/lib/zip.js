/**
 * Escrita de pacotes .zip do modpack.
 *
 * Por que um formato à mão em vez de uma biblioteca: as duas pontas são
 * nossas, e isso deixa escolher o subconjunto mais simples que resolve o
 * problema — entradas ARMAZENADAS, sem compressão.
 *
 * Não comprimir não é preguiça. O modpack é 1,7 GB de .jar, que já são zips
 * comprimidos por dentro; passar deflate por cima gasta minutos de CPU do
 * servidor para economizar quase nada. Sem compressão, escrever o pacote é
 * praticamente copiar arquivo, e o leitor do outro lado vira cem linhas.
 *
 * O que fica de fora de propósito:
 *   - deflate (nada aqui comprime);
 *   - zip64 (o pacote é dividido em partes bem antes dos 4 GB);
 *   - descritor de dados (o tamanho vai no cabeçalho, o que permite ao
 *     launcher extrair enquanto baixa, sem precisar do índice do fim).
 *
 * Essa última é a decisão que importa: o launcher nunca precisa procurar o
 * diretório central, então ele extrai o pacote em fluxo, sem guardar 1,7 GB
 * em lugar nenhum antes de começar.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/* ------------------------------------------------------------- CRC-32 --- */

const TABELA = (() => {
    const tabela = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        tabela[i] = c;
    }
    return tabela;
})();

function crc32(buffer, anterior = 0) {
    let c = ~anterior;
    for (let i = 0; i < buffer.length; i++) c = TABELA[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
    return ~c >>> 0;
}

/* ------------------------------------------------------------- escrita -- */

/**
 * Um zip com estas entradas, gravado em `destino`.
 *
 * `arquivos` são caminhos relativos a `raiz`, com barra normal. Devolve
 * `{ arquivos, bytes, hash }` — o hash é o SHA-1 do pacote inteiro, que é
 * como o launcher confere se o download veio certo.
 */
async function escrever(destino, raiz, arquivos, aoProgresso) {
    const saida = fs.createWriteStream(destino);
    const soma = crypto.createHash('sha1');

    let posicao = 0;
    const centrais = [];

    // Escreve respeitando a contrapressão: sem isto, um disco mais lento que
    // a leitura faria a memória crescer até o processo morrer.
    const gravar = async buffer => {
        soma.update(buffer);
        posicao += buffer.length;
        if (!saida.write(buffer)) await new Promise(r => saida.once('drain', r));
    };

    let feitos = 0;

    for (const relativo of arquivos) {
        const completo = path.join(raiz, relativo);
        let stat;
        try {
            stat = await fsp.stat(completo);
        } catch {
            continue;   // sumiu entre a varredura e agora
        }

        const nome = Buffer.from(relativo.replace(/\\/g, '/'), 'utf8');
        const inicio = posicao;

        // O CRC vai no cabeçalho, antes dos dados, então precisa ser calculado
        // antes de escrever. É uma leitura a mais do arquivo; num disco local
        // isso custa menos que o deflate que estamos evitando.
        let crc = 0;
        await new Promise((ok, erro) => {
            const leitor = fs.createReadStream(completo);
            leitor.on('data', pedaco => { crc = crc32(pedaco, crc); });
            leitor.on('end', ok);
            leitor.on('error', erro);
        });

        const cabecalho = Buffer.alloc(30);
        cabecalho.writeUInt32LE(0x04034b50, 0);     // assinatura
        cabecalho.writeUInt16LE(20, 4);             // versão necessária
        cabecalho.writeUInt16LE(0x0800, 6);         // nome em UTF-8
        cabecalho.writeUInt16LE(0, 8);              // método: armazenado
        cabecalho.writeUInt16LE(0, 10);             // hora
        cabecalho.writeUInt16LE(0x21, 12);          // data (1.1.1996; nada depende dela)
        cabecalho.writeUInt32LE(crc, 14);
        cabecalho.writeUInt32LE(stat.size, 18);     // tamanho comprimido
        cabecalho.writeUInt32LE(stat.size, 22);     // tamanho original
        cabecalho.writeUInt16LE(nome.length, 26);
        cabecalho.writeUInt16LE(0, 28);             // sem campo extra

        await gravar(cabecalho);
        await gravar(nome);

        await new Promise((ok, erro) => {
            const leitor = fs.createReadStream(completo);
            leitor.on('error', erro);
            leitor.on('end', ok);
            leitor.on('data', pedaco => {
                soma.update(pedaco);
                posicao += pedaco.length;
                if (!saida.write(pedaco)) {
                    leitor.pause();
                    saida.once('drain', () => leitor.resume());
                }
            });
        });

        centrais.push({ nome, crc, tamanho: stat.size, inicio });

        feitos += 1;
        if (aoProgresso && feitos % 25 === 0) aoProgresso(feitos, arquivos.length);
    }

    /* --- diretório central ------------------------------------------------ */

    // O launcher não precisa dele (ele lê em fluxo), mas sem isto o arquivo
    // não é um zip válido — e a staff tem que conseguir abrir o pacote no
    // Explorer para conferir o que foi publicado.
    const inicioCentral = posicao;

    for (const entrada of centrais) {
        const registro = Buffer.alloc(46);
        registro.writeUInt32LE(0x02014b50, 0);
        registro.writeUInt16LE(20, 4);              // versão de quem criou
        registro.writeUInt16LE(20, 6);              // versão necessária
        registro.writeUInt16LE(0x0800, 8);
        registro.writeUInt16LE(0, 10);              // armazenado
        registro.writeUInt16LE(0, 12);
        registro.writeUInt16LE(0x21, 14);
        registro.writeUInt32LE(entrada.crc, 16);
        registro.writeUInt32LE(entrada.tamanho, 20);
        registro.writeUInt32LE(entrada.tamanho, 24);
        registro.writeUInt16LE(entrada.nome.length, 28);
        registro.writeUInt16LE(0, 30);              // extra
        registro.writeUInt16LE(0, 32);              // comentário
        registro.writeUInt16LE(0, 34);              // disco
        registro.writeUInt16LE(0, 36);              // atributos internos
        registro.writeUInt32LE(0, 38);              // atributos externos
        registro.writeUInt32LE(entrada.inicio, 42);

        await gravar(registro);
        await gravar(entrada.nome);
    }

    const fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0);
    fim.writeUInt16LE(0, 4);
    fim.writeUInt16LE(0, 6);
    fim.writeUInt16LE(centrais.length, 8);
    fim.writeUInt16LE(centrais.length, 10);
    fim.writeUInt32LE(posicao - inicioCentral, 12);
    fim.writeUInt32LE(inicioCentral, 16);
    fim.writeUInt16LE(0, 20);
    await gravar(fim);

    await new Promise(r => saida.end(r));

    if (aoProgresso) aoProgresso(arquivos.length, arquivos.length);
    return { arquivos: centrais.length, bytes: posicao, hash: soma.digest('hex') };
}

/**
 * Divide uma lista de arquivos em pacotes que caibam no limite.
 *
 * As releases do GitHub aceitam 2 GB por arquivo, e o modpack já está em
 * 1,7 GB — perto demais para fingir que o problema não existe. Dividir desde
 * agora significa que o dia em que o pack passar do limite não vai exigir
 * mexer no launcher: ele já sabe baixar várias partes.
 *
 * Um arquivo sozinho maior que o limite fica na sua própria parte; não há o
 * que fazer, e é melhor publicar e falhar no upload do que dividir um .jar.
 */
function dividir(arquivos, limiteBytes) {
    const partes = [];
    let atual = [];
    let soma = 0;

    for (const arquivo of arquivos) {
        // 30 bytes de cabeçalho + nome, e mais um registro central por entrada.
        const custo = arquivo.size + arquivo.path.length * 2 + 80;

        if (atual.length && soma + custo > limiteBytes) {
            partes.push(atual);
            atual = [];
            soma = 0;
        }

        atual.push(arquivo);
        soma += custo;
    }

    if (atual.length) partes.push(atual);
    return partes;
}

module.exports = { escrever, dividir, crc32 };
