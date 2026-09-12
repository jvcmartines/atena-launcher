/**
 * Atena Launcher — as preferências dos mods do servidor
 *
 * Dois mods do pack precisam ser configurados antes de a pessoa jogar, e hoje
 * isso se faz de dentro do jogo, em menus que ela só encontra depois de já ter
 * entrado e não ter entendido nada:
 *
 *   asmp_translate — que idioma ela fala, em que idioma quer ler os balões,
 *                    qual motor de reconhecimento de voz, e as cores;
 *   voicechat      — qual microfone usar.
 *
 * Aqui as duas coisas viram uma tela no launcher, antes da primeira partida.
 *
 * A escolha da pessoa mora no `configClient` do launcher, não no arquivo do
 * mod. É de propósito: o arquivo do mod faz parte do modpack, então ele é
 * substituível — reinstalar apaga, e uma versão nova do pack sobrescreve. O
 * launcher reaplica a escolha depois de cada sincronização e antes de cada
 * partida, do mesmo jeito que faz com o FPS Boost.
 *
 * Os idiomas abaixo são exatamente os que o mod conhece; conferi na tabela
 * dentro do .jar. Oferecer um que ele não tem seria oferecer uma opção que não
 * funciona.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const ARQUIVO_TRADUCAO = 'config/asmp_translate-common.toml';
const ARQUIVO_VOZ = 'config/voicechat/voicechat-client.properties';

const LINGUAS = [
    { codigo: 'en', nome: 'English (United States)' },
    { codigo: 'pt', nome: 'Português (Brasil)' },
    { codigo: 'es', nome: 'Español' },
    { codigo: 'es-MX', nome: 'Español (México)' },
    { codigo: 'fr', nome: 'Français' },
    { codigo: 'de', nome: 'Deutsch' },
    { codigo: 'de-AT', nome: 'Deutsch (Österreich)' },
    { codigo: 'it', nome: 'Italiano' },
    { codigo: 'nl', nome: 'Nederlands' },
    { codigo: 'nl-BE', nome: 'Nederlands (België)' },
    { codigo: 'pl', nome: 'Polski' },
    { codigo: 'sv', nome: 'Svenska' },
    { codigo: 'da', nome: 'Dansk' },
    { codigo: 'lb', nome: 'Lëtzebuergesch' },
    { codigo: 'tr', nome: 'Türkçe' },
    { codigo: 'uk', nome: 'Українська' },
    { codigo: 'ru', nome: 'Русский' },
    { codigo: 'ar', nome: 'العربية' },
    { codigo: 'zh', nome: '中文' },
    { codigo: 'ja', nome: '日本語' },
    { codigo: 'ko', nome: '한국어' },
    { codigo: 'en-AU', nome: 'English (Australia)' },
    { codigo: 'fil-PH', nome: 'Filipino (Pilipinas)' }
];

/**
 * As cores que o mod usa de fábrica. Servem de "voltar ao padrão".
 *
 * São as três que pintam o balão acima dos jogadores — o
 * `SpeechBubbleRenderer` do mod lê fundo, texto e borda, e mais nada. A cor de
 * destaque (`balloonAccentColor`) existe no arquivo mas é da caixa de legendas
 * do HUD, não do balão; quem quiser mudá-la faz isso pela tela do mod dentro
 * do jogo, e o launcher não encosta nela.
 */
const CORES_PADRAO = {
    corFundo: 'FCFCFC',
    corTexto: '191919',
    corBorda: 'B4B4B9'
};

class Preferencias {
    constructor() {
        // No objeto, e nao so como export solto: quem recebe `preferencias`
        // recebe junto a lista de idiomas e as cores de fabrica.
        this.LINGUAS = LINGUAS;
        this.CORES_PADRAO = CORES_PADRAO;
    }


    /* ------------------------------------------------- edição de arquivo -- */

    /**
     * Troca valores num TOML sem reescrever o arquivo.
     *
     * `mudancas` é `{ 'secao.chave': valorJaFormatado }`. Só a parte depois do
     * `=` é trocada: a indentação (tabulação), os comentários e as quebras de
     * linha do arquivo continuam exatamente como estavam. O arquivo original
     * vem com CRLF e tabulação, e reescrevê-lo inteiro marcaria como alterada
     * cada uma das suas 59 linhas.
     */
    editarToml(texto, mudancas) {
        const linhas = texto.split(/\r?\n/);
        const fimDeLinha = texto.includes('\r\n') ? '\r\n' : '\n';
        let secao = '';

        const saida = linhas.map(linha => {
            const semEspaco = linha.trim();

            const cabecalho = semEspaco.match(/^\[([^\]]+)\]$/);
            if (cabecalho) { secao = cabecalho[1]; return linha; }

            if (!semEspaco || semEspaco.startsWith('#')) return linha;

            const igual = linha.indexOf('=');
            if (igual === -1) return linha;

            const chave = linha.slice(0, igual).trim();
            const alvo = `${secao}.${chave}`;
            if (!(alvo in mudancas)) return linha;

            // Tudo antes do `=` fica; só o valor muda.
            return `${linha.slice(0, igual + 1)} ${mudancas[alvo]}`;
        });

        return saida.join(fimDeLinha);
    }

    /** O mesmo, para os `.properties` do voicechat. */
    editarProperties(texto, mudancas) {
        const fimDeLinha = texto.includes('\r\n') ? '\r\n' : '\n';
        const pendentes = new Map(Object.entries(mudancas));

        const linhas = texto.split(/\r?\n/).map(linha => {
            const semEspaco = linha.trim();
            if (!semEspaco || semEspaco.startsWith('#')) return linha;

            const igual = linha.indexOf('=');
            if (igual === -1) return linha;

            const chave = linha.slice(0, igual).trim();
            if (!pendentes.has(chave)) return linha;

            const valor = pendentes.get(chave);
            pendentes.delete(chave);
            return `${chave}=${valor}`;
        });

        // Chave que o arquivo ainda não tinha entra no fim.
        for (const [chave, valor] of pendentes) linhas.push(`${chave}=${valor}`);
        return linhas.join(fimDeLinha);
    }

    /** Lê um par `chave = valor` de um TOML, já sem as aspas. */
    lerDoToml(texto, secaoAlvo, chaveAlvo) {
        let secao = '';
        for (const linha of texto.split(/\r?\n/)) {
            const semEspaco = linha.trim();

            const cabecalho = semEspaco.match(/^\[([^\]]+)\]$/);
            if (cabecalho) { secao = cabecalho[1]; continue; }
            if (!semEspaco || semEspaco.startsWith('#')) continue;

            const igual = semEspaco.indexOf('=');
            if (igual === -1) continue;

            if (secao === secaoAlvo && semEspaco.slice(0, igual).trim() === chaveAlvo) {
                return semEspaco.slice(igual + 1).trim().replace(/^"(.*)"$/, '$1');
            }
        }
        return null;
    }

    lerDoProperties(texto, chaveAlvo) {
        for (const linha of texto.split(/\r?\n/)) {
            const semEspaco = linha.trim();
            if (!semEspaco || semEspaco.startsWith('#')) continue;

            const igual = semEspaco.indexOf('=');
            if (igual === -1) continue;
            if (semEspaco.slice(0, igual).trim() === chaveAlvo) return semEspaco.slice(igual + 1);
        }
        return null;
    }

    /* ----------------------------------------------------------- ler ----- */

    /**
     * O que está valendo hoje nos arquivos do mod.
     *
     * Serve para a tela abrir já preenchida com a verdade, e não com um padrão
     * que talvez não seja o que a pessoa tem. Sem o modpack instalado devolve
     * null — não há arquivo do qual ler.
     */
    async atuais(pasta) {
        const traducao = await this.lerArquivo(pasta, ARQUIVO_TRADUCAO);
        const voz = await this.lerArquivo(pasta, ARQUIVO_VOZ);
        if (!traducao && !voz) return null;

        const escolhas = {};

        if (traducao) {
            escolhas.falo = this.lerDoToml(traducao, 'languages', 'sourceLanguage');
            escolhas.baloes = this.lerDoToml(traducao, 'languages', 'balloonLanguage');
            escolhas.alvo = this.lerDoToml(traducao, 'languages', 'defaultTargetLanguage');
            escolhas.mostrarBaloes = this.lerDoToml(traducao, 'balloons', 'showBalloons') === 'true';
            escolhas.motor = this.lerDoToml(traducao, 'speech', 'speechEngine');
            escolhas.corFundo = this.lerDoToml(traducao, 'balloons', 'balloonBgColor');
            escolhas.corTexto = this.lerDoToml(traducao, 'balloons', 'balloonTextColor');
            escolhas.corBorda = this.lerDoToml(traducao, 'balloons', 'balloonBorderColor');
        }

        if (voz) escolhas.microfone = this.lerDoProperties(voz, 'microphone') ?? '';

        return escolhas;
    }

    async lerArquivo(pasta, relativo) {
        try {
            return await fsp.readFile(path.join(pasta, relativo), 'utf8');
        } catch {
            return null;
        }
    }

    /** Há arquivos onde escrever? Antes de instalar o modpack, não há. */
    possivel(pasta) {
        return fs.existsSync(path.join(pasta, ARQUIVO_TRADUCAO))
            || fs.existsSync(path.join(pasta, ARQUIVO_VOZ));
    }

    /* -------------------------------------------------------- aplicar ---- */

    /**
     * Grava as escolhas nos arquivos dos mods.
     *
     * Campo ausente em `escolhas` não é tocado: quem mexeu só nas cores não
     * tem o idioma reescrito por tabela.
     *
     * Devolve quantos arquivos foram alterados.
     */
    async aplicar(pasta, escolhas) {
        if (!escolhas) return 0;
        let mexidos = 0;

        /* --- tradução ------------------------------------------------- */

        const traducao = await this.lerArquivo(pasta, ARQUIVO_TRADUCAO);
        if (traducao) {
            const mudancas = {};
            const texto = (secao, chave, valor) => {
                if (valor === undefined || valor === null || valor === '') return;
                mudancas[`${secao}.${chave}`] = `"${String(valor).replace(/"/g, '')}"`;
            };

            texto('languages', 'sourceLanguage', escolhas.falo);
            texto('languages', 'balloonLanguage', escolhas.baloes);
            texto('languages', 'defaultTargetLanguage', escolhas.alvo ?? escolhas.baloes);

            texto('balloons', 'balloonBgColor', escolhas.corFundo);
            texto('balloons', 'balloonTextColor', escolhas.corTexto);
            texto('balloons', 'balloonBorderColor', escolhas.corBorda);

            if (escolhas.mostrarBaloes !== undefined) {
                mudancas['balloons.showBalloons'] = escolhas.mostrarBaloes ? 'true' : 'false';
            }

            // Os dois andam juntos: o motor diz qual usar, e a chave antiga diz
            // se é o do navegador. Gravar só um deixaria o mod em desacordo
            // consigo mesmo.
            if (escolhas.motor) {
                mudancas['speech.speechEngine'] = `"${escolhas.motor}"`;
                mudancas['speech.useWebSpeechApi'] = escolhas.motor === 'web_speech' ? 'true' : 'false';
            }

            // A tela do launcher fez o papel da configuração inicial do mod.
            mudancas['ui.firstTimeSetupDone'] = 'true';

            if (Object.keys(mudancas).length) {
                await this.gravar(path.join(pasta, ARQUIVO_TRADUCAO), this.editarToml(traducao, mudancas));
                mexidos += 1;
            }
        }

        /* --- microfone ------------------------------------------------ */

        const voz = await this.lerArquivo(pasta, ARQUIVO_VOZ);
        if (voz && escolhas.microfone !== undefined) {
            await this.gravar(
                path.join(pasta, ARQUIVO_VOZ),
                this.editarProperties(voz, { microphone: escolhas.microfone })
            );
            mexidos += 1;
        }

        return mexidos;
    }

    /**
     * Escreve num temporário e renomeia.
     *
     * Uma queda no meio da escrita deixaria o mod sem conseguir ler a própria
     * configuração, e o jogo abriria sem tradução nenhuma.
     */
    async gravar(completo, texto) {
        const temporario = `${completo}.parte`;
        await fsp.mkdir(path.dirname(completo), { recursive: true });
        await fsp.writeFile(temporario, texto, 'utf8');
        await fsp.rm(completo, { force: true });
        await fsp.rename(temporario, completo);
    }

    /* ------------------------------------------------------ microfones --- */

    /**
     * Os microfones do computador, com o nome que o mod de voz espera.
     *
     * O mod guarda o nome que o OpenAL dá ao aparelho — `OpenAL Soft on
     * Microfone (2- USB Audio Device)` — e o navegador dá outro: ele acrescenta
     * o identificador USB no fim (`(0d8c:0012)`) e prefixos `Default - ` e
     * `Communications - `. Então o nome é limpo e recebe o prefixo do OpenAL.
     *
     * Vale dizer o que isto NÃO garante: o nome do Windows carrega o número da
     * porta USB (`2-`, `3-`), que muda se a pessoa trocar o cabo de lugar.
     * Quando isso acontece o mod não acha o aparelho e volta ao padrão do
     * sistema — por isso "aparelho padrão" é a primeira opção da lista, e a
     * recomendada para quem não tem motivo para escolher outro.
     */
    async microfones() {
        try {
            const aparelhos = await navigator.mediaDevices.enumerateDevices();

            const vistos = new Set();
            const lista = [];

            for (const aparelho of aparelhos) {
                if (aparelho.kind !== 'audioinput') continue;
                if (!aparelho.label) continue;   // sem permissão não há nome para mostrar

                const limpo = this.nomeLimpo(aparelho.label);
                if (!limpo || vistos.has(limpo)) continue;
                vistos.add(limpo);

                lista.push({ nome: limpo, openal: `OpenAL Soft on ${limpo}` });
            }

            return lista;
        } catch (err) {
            console.error('[preferencias] não consegui listar os microfones:', err.message);
            return [];
        }
    }

    /** Tira os prefixos e o identificador USB que o navegador acrescenta. */
    nomeLimpo(rotulo) {
        return String(rotulo)
            .replace(/^(Default|Communications|Padrão|Comunicações)\s+-\s+/i, '')
            .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '')
            .trim();
    }
}

export default new Preferencias;
export { LINGUAS, CORES_PADRAO };
