/**
 * Diagnóstico e relatório de problema.
 *
 * Quase todo pedido de ajuda começa igual: "não abre". Aí a staff pede o log,
 * a pessoa não sabe onde fica, manda print da tela errada, e leva três dias.
 *
 * Aqui o launcher junta sozinho o que a staff sempre acaba pedindo — o log do
 * jogo, o crash-report mais recente, a versão do modpack, a RAM alocada, o
 * Java em uso — num zip só, e abre a pasta onde ele ficou.
 *
 * Nada é enviado para lugar nenhum: o arquivo fica no PC e a pessoa decide
 * para quem manda. Ele carrega o nick e caminhos do computador dela.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class Suporte {
    /* ------------------------------------------------------ diagnóstico -- */

    /**
     * O retrato da máquina que explica a maioria dos travamentos: RAM total
     * contra RAM alocada, e se sobra espaço em disco para o modpack.
     */
    async diagnostico({ basePath, instanceName, configClient, remote }) {
        const totalGb = os.totalmem() / 1073741824;
        const livreGb = os.freemem() / 1073741824;
        const memoria = configClient?.java_config?.java_memory || {};

        const pasta = instanceName ? path.join(basePath, 'instances', instanceName) : basePath;

        const avisos = [];

        // Alocar mais da metade da RAM sufoca o Windows, e aí o jogo trava
        // mais do que travaria com um limite menor.
        if (memoria.max && memoria.max > totalGb / 2) {
            avisos.push('ram_alta');
        }
        if (memoria.max && memoria.max < 6) {
            avisos.push('ram_baixa');
        }
        if (totalGb < 8) {
            avisos.push('pc_pouca_ram');
        }

        const disco = await this.espacoLivre(basePath);
        if (disco !== null && disco < 5) avisos.push('disco_cheio');

        return {
            sistema: `${os.type()} ${os.release()} (${os.arch()})`,
            cpu: os.cpus()[0]?.model?.trim() || 'desconhecida',
            nucleos: os.cpus().length,
            ramTotalGb: totalGb,
            ramLivreGb: livreGb,
            ramAlocadaGb: memoria.max || null,
            ramMinimaGb: memoria.min || null,
            java: configClient?.java_config?.java_path || null,
            discoLivreGb: disco,
            versaoModpack: remote?.version ?? null,
            pastaJogo: pasta,
            tamanhoPastaGb: await this.tamanhoPasta(pasta),
            avisos
        };
    }

    /** Espaço livre em GB no disco onde o jogo está, ou null se não der para saber. */
    async espacoLivre(alvo) {
        try {
            const stat = await fs.promises.statfs(alvo);
            return (stat.bavail * stat.bsize) / 1073741824;
        } catch {
            return null;   // statfs não existe em Node antigo nem em todo sistema
        }
    }

    /** Tamanho da pasta, em GB. Para não demorar, só desce até certo ponto. */
    async tamanhoPasta(pasta, profundidade = 0) {
        if (profundidade > 4) return 0;

        let total = 0;
        let entradas;
        try {
            entradas = await fs.promises.readdir(pasta, { withFileTypes: true });
        } catch {
            return 0;
        }

        for (const entrada of entradas) {
            const completo = path.join(pasta, entrada.name);
            try {
                if (entrada.isDirectory()) {
                    total += await this.tamanhoPasta(completo, profundidade + 1) * 1073741824;
                } else if (entrada.isFile()) {
                    total += (await fs.promises.stat(completo)).size;
                }
            } catch { /* arquivo sumiu no meio da conta */ }
        }
        return total / 1073741824;
    }

    /* -------------------------------------------------- relatar problema -- */

    /**
     * Junta os arquivos que a staff sempre pede num zip.
     * Devolve o caminho do arquivo criado.
     */
    async relatorio({ basePath, instanceName, diagnostico, versaoLauncher }) {
        const pastaJogo = path.join(basePath, 'instances', instanceName || '');
        const destino = path.join(basePath, 'relatorios');
        fs.mkdirSync(destino, { recursive: true });

        const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const arquivo = path.join(destino, `atena-relatorio-${carimbo}.zip`);

        const itens = [];

        // O log da sessão atual e o da anterior: quando o jogo fecha sozinho,
        // o motivo costuma estar no anterior.
        this.juntar(itens, path.join(pastaJogo, 'logs', 'latest.log'), 'logs/latest.log');
        this.juntar(itens, path.join(pastaJogo, 'logs', 'debug.log'), 'logs/debug.log');

        // Os três crash-reports mais recentes.
        for (const crash of this.maisRecentes(path.join(pastaJogo, 'crash-reports'), 3)) {
            this.juntar(itens, crash.completo, `crash-reports/${crash.nome}`);
        }

        // Opções do jogo ajudam a explicar travamento por render distance.
        this.juntar(itens, path.join(pastaJogo, 'options.txt'), 'options.txt');

        // O log do próprio launcher: é onde caem os erros que não aparecem na
        // tela, e costuma ser o que responde "por que não abriu?".
        this.juntar(itens, path.join(basePath, 'launcher.log'), 'launcher.log');
        this.juntar(itens, path.join(basePath, 'launcher.log.old'), 'launcher.log.old');

        const resumo = {
            geradoEm: new Date().toISOString(),
            launcher: versaoLauncher,
            modpack: instanceName,
            ...diagnostico
        };

        return this.zipar(arquivo, itens, resumo);
    }

    juntar(lista, origem, nomeNoZip) {
        try {
            if (fs.existsSync(origem) && fs.statSync(origem).isFile()) {
                lista.push({ origem, nomeNoZip });
            }
        } catch { /* sem permissão, ignora */ }
    }

    maisRecentes(pasta, quantos) {
        try {
            return fs.readdirSync(pasta)
                .map(nome => ({ nome, completo: path.join(pasta, nome) }))
                .filter(item => fs.statSync(item.completo).isFile())
                .sort((a, b) => fs.statSync(b.completo).mtimeMs - fs.statSync(a.completo).mtimeMs)
                .slice(0, quantos);
        } catch {
            return [];
        }
    }

    /**
     * Escreve o zip. Sem dependência nova: o formato "stored" (sem compressão)
     * é simples o bastante para montar à mão, e o que vai dentro é texto que o
     * suporte lê na hora — não vale acrescentar uma biblioteca por isso.
     */
    zipar(destino, itens, resumo) {
        const entradas = [];

        for (const item of itens) {
            try {
                entradas.push({ nome: item.nomeNoZip, dados: fs.readFileSync(item.origem) });
            } catch { /* arquivo em uso, segue sem ele */ }
        }
        entradas.push({ nome: 'diagnostico.json', dados: Buffer.from(JSON.stringify(resumo, null, 2), 'utf8') });

        const locais = [];
        const central = [];
        let posicao = 0;

        for (const entrada of entradas) {
            const nome = Buffer.from(entrada.nome, 'utf8');
            const crc = this.crc32(entrada.dados);

            const cabecalho = Buffer.alloc(30);
            cabecalho.writeUInt32LE(0x04034b50, 0);   // assinatura de arquivo local
            cabecalho.writeUInt16LE(20, 4);           // versão necessária
            cabecalho.writeUInt16LE(0x0800, 6);       // nomes em UTF-8
            cabecalho.writeUInt16LE(0, 8);            // sem compressão
            cabecalho.writeUInt32LE(crc, 14);
            cabecalho.writeUInt32LE(entrada.dados.length, 18);
            cabecalho.writeUInt32LE(entrada.dados.length, 22);
            cabecalho.writeUInt16LE(nome.length, 26);

            locais.push(cabecalho, nome, entrada.dados);

            const dir = Buffer.alloc(46);
            dir.writeUInt32LE(0x02014b50, 0);         // assinatura do diretório central
            dir.writeUInt16LE(20, 4);
            dir.writeUInt16LE(20, 6);
            dir.writeUInt16LE(0x0800, 8);
            dir.writeUInt16LE(0, 10);
            dir.writeUInt32LE(crc, 16);
            dir.writeUInt32LE(entrada.dados.length, 20);
            dir.writeUInt32LE(entrada.dados.length, 24);
            dir.writeUInt16LE(nome.length, 28);
            dir.writeUInt32LE(posicao, 42);

            central.push(dir, nome);
            posicao += cabecalho.length + nome.length + entrada.dados.length;
        }

        const corpoCentral = Buffer.concat(central);
        const fim = Buffer.alloc(22);
        fim.writeUInt32LE(0x06054b50, 0);
        fim.writeUInt16LE(entradas.length, 8);
        fim.writeUInt16LE(entradas.length, 10);
        fim.writeUInt32LE(corpoCentral.length, 12);
        fim.writeUInt32LE(posicao, 16);

        fs.writeFileSync(destino, Buffer.concat([...locais, corpoCentral, fim]));
        return { arquivo: destino, itens: entradas.length };
    }

    crc32(buffer) {
        if (!this.tabelaCrc) {
            this.tabelaCrc = new Int32Array(256);
            for (let i = 0; i < 256; i += 1) {
                let c = i;
                for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
                this.tabelaCrc[i] = c;
            }
        }

        let crc = -1;
        for (let i = 0; i < buffer.length; i += 1) {
            crc = (crc >>> 8) ^ this.tabelaCrc[(crc ^ buffer[i]) & 0xff];
        }
        return (crc ^ -1) >>> 0;
    }
}

export default new Suporte;
