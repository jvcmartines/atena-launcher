/**
 * Atena Launcher — baixar o modpack em pacote
 *
 * O servidor do Atena entrega ~4 MB/s; medi. O CDN do GitHub entrega 27 MB/s
 * na mesma máquina, no mesmo minuto — nove vezes mais. Só que a diferença não
 * é só de banda: são 5.668 arquivos, e cada um custa uma conexão, um aperto de
 * mão TLS e uma ida e volta. Baixar isso como UM arquivo muda as duas coisas
 * ao mesmo tempo.
 *
 * Este módulo pega um .zip publicado (o pack inteiro, ou só o que mudou entre
 * duas versões) e o desempacota DIRETO no disco, enquanto ele desce. Nada de
 * guardar 1,7 GB num arquivo temporário para só então abrir: em máquina com
 * pouco espaço isso é a diferença entre funcionar e não funcionar.
 *
 * O formato é o subconjunto mais simples do zip — entradas armazenadas, sem
 * compressão, com o tamanho no cabeçalho de cada uma. É por isso que dá para
 * ler em fluxo: o leitor nunca precisa do índice do fim do arquivo.
 *
 * Quem escreve do outro lado é server/src/lib/zip.js.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const ASSINATURA_ARQUIVO = 0x04034b50;   // PK\x03\x04 — começo de uma entrada
const ASSINATURA_CENTRAL = 0x02014b50;   // PK\x01\x02 — começou o índice: acabou

class Pacote {

    /**
     * Baixa um pacote e escreve o conteúdo na pasta.
     *
     * `decidir(caminho)` diz o que fazer com cada entrada:
     *   'gravar'  — escreve (é o padrão)
     *   'pular'   — não escreve, mas consome os bytes (o fluxo não pode pular)
     *
     * É o gancho que preserva o que o jogador mexeu: um pacote é uma cópia
     * autoritativa do modpack, e sem esta pergunta ele passaria por cima das
     * configurações da pessoa exatamente como a sincronização fazia antes.
     *
     * Devolve `{ gravados, pulados, bytes, hash }`.
     */
    async baixarEExtrair(url, destino, { decidir, aoProgresso, pausa, hashEsperado, tamanhoEsperado } = {}) {
        const resposta = await fetch(url);
        if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);

        const total = tamanhoEsperado || Number(resposta.headers.get('content-length')) || 0;
        const soma = crypto.createHash('sha1');

        const leitor = resposta.body.getReader();
        const estado = {
            sobra: Buffer.alloc(0),
            bytes: 0,
            gravados: 0,
            pulados: 0,
            // Os caminhos que entraram. Servem para o launcher semear o cache
            // de hashes: sem isso a conferencia seguinte releria 1,7 GB para
            // descobrir o que o pacote acabou de garantir.
            escritos: [],
            // Entrada em andamento: para onde vão os próximos bytes.
            atual: null
        };

        try {
            while (true) {
                const { done, value } = await leitor.read();
                if (done) break;

                const pedaco = Buffer.from(value);
                soma.update(pedaco);
                estado.bytes += pedaco.length;

                await this.consumir(estado, pedaco, destino, decidir);

                if (aoProgresso) aoProgresso({ bytes: estado.bytes, bytesTotais: total, gravados: estado.gravados });

                // Pausar e cancelar entre pedaços: é onde parar é seguro, e o
                // arquivo em andamento é apagado se a pessoa desistir.
                if (pausa) await pausa.esperar();
            }
        } catch (err) {
            await this.fecharAtual(estado, true);
            throw err;
        }

        await this.fecharAtual(estado, false);

        const hash = soma.digest('hex');
        if (hashEsperado && hash !== hashEsperado) {
            throw new Error('pacote-corrompido');
        }

        return {
            gravados: estado.gravados, pulados: estado.pulados,
            bytes: estado.bytes, hash, escritos: estado.escritos
        };
    }

    /**
     * Empurra um pedaço do download pela máquina de estados.
     *
     * O fluxo chega picado em qualquer lugar — no meio de um cabeçalho, no meio
     * de um nome de arquivo, no meio dos dados. `sobra` guarda o que ainda não
     * deu para interpretar; sem ela um cabeçalho partido entre dois pedaços
     * quebraria a extração, e é isso que acontece na prática o tempo todo.
     */
    async consumir(estado, pedaco, destino, decidir) {
        let dados = estado.sobra.length ? Buffer.concat([estado.sobra, pedaco]) : pedaco;
        estado.sobra = Buffer.alloc(0);

        let cursor = 0;

        while (true) {
            // Dentro de uma entrada: os bytes são conteúdo até acabar.
            if (estado.atual) {
                const faltam = estado.atual.faltam;
                const quanto = Math.min(faltam, dados.length - cursor);
                if (quanto <= 0) break;

                const fatia = dados.subarray(cursor, cursor + quanto);
                cursor += quanto;
                estado.atual.faltam -= quanto;

                if (estado.atual.saida) {
                    if (!estado.atual.saida.write(fatia)) {
                        await new Promise(r => estado.atual.saida.once('drain', r));
                    }
                }

                if (estado.atual.faltam === 0) await this.fecharAtual(estado, false);
                continue;
            }

            // Fora de uma entrada: o que vem é um cabeçalho.
            if (dados.length - cursor < 30) break;

            const assinatura = dados.readUInt32LE(cursor);
            if (assinatura === ASSINATURA_CENTRAL) {
                // Começou o índice do fim: não há mais conteúdo. O resto do
                // download é descartado sem cerimônia.
                estado.sobra = Buffer.alloc(0);
                estado.acabou = true;
                return;
            }
            if (assinatura !== ASSINATURA_ARQUIVO) {
                if (estado.acabou) return;   // já estamos no rabo do arquivo
                throw new Error('pacote-invalido');
            }

            const tamanho = dados.readUInt32LE(cursor + 18);
            const tamanhoNome = dados.readUInt16LE(cursor + 26);
            const tamanhoExtra = dados.readUInt16LE(cursor + 28);

            // Sem o nome inteiro não dá para decidir nada: espera o próximo pedaço.
            if (dados.length - cursor < 30 + tamanhoNome + tamanhoExtra) break;

            const nome = dados.toString('utf8', cursor + 30, cursor + 30 + tamanhoNome);
            cursor += 30 + tamanhoNome + tamanhoExtra;

            await this.abrir(estado, nome, tamanho, destino, decidir);
        }

        estado.sobra = dados.subarray(cursor);
    }

    /** Começa uma entrada: decide se grava, e abre o arquivo se for o caso. */
    async abrir(estado, nome, tamanho, destino, decidir) {
        // Pasta dentro do zip: não tem conteúdo e não interessa.
        if (nome.endsWith('/')) {
            estado.atual = { faltam: tamanho, saida: null };
            if (tamanho === 0) estado.atual = null;
            return;
        }

        // Nada de escrever fora da pasta da instância. Um pacote é um arquivo
        // baixado da internet; um caminho com ".." nele seria uma forma de
        // escrever em qualquer lugar do computador da pessoa.
        const limpo = nome.replace(/\\/g, '/');
        const alvo = path.resolve(destino, limpo);
        if (!alvo.startsWith(path.resolve(destino) + path.sep)) {
            estado.atual = { faltam: tamanho, saida: null };
            estado.pulados += 1;
            return;
        }

        const querem = decidir ? decidir(limpo) : 'gravar';
        if (querem === 'pular') {
            estado.atual = { faltam: tamanho, saida: null };
            estado.pulados += 1;
            if (tamanho === 0) estado.atual = null;
            return;
        }

        await fsp.mkdir(path.dirname(alvo), { recursive: true });

        // Escreve num `.parte` e só renomeia no fim: se o download cair no meio
        // de um .jar, o que sobra em disco é lixo com outro nome, e não um mod
        // pela metade que o Forge tentaria carregar.
        const temporario = `${alvo}.parte`;
        estado.atual = {
            faltam: tamanho,
            caminho: alvo,
            relativo: limpo,
            temporario,
            saida: fs.createWriteStream(temporario)
        };

        if (tamanho === 0) await this.fecharAtual(estado, false);
    }

    /** Fecha a entrada em andamento. `descartar` apaga em vez de renomear. */
    async fecharAtual(estado, descartar) {
        const atual = estado.atual;
        estado.atual = null;
        if (!atual || !atual.saida) return;

        await new Promise(r => atual.saida.end(r));

        if (descartar) {
            await fsp.rm(atual.temporario, { force: true }).catch(() => { });
            return;
        }

        await fsp.rm(atual.caminho, { force: true }).catch(() => { });
        await fsp.rename(atual.temporario, atual.caminho);
        estado.gravados += 1;
        if (atual.relativo) estado.escritos.push(atual.relativo);
    }
}

export default new Pacote;
