/**
 * Valores padrão e normalização dos dados que o launcher consome.
 */

const DEFAULT_CONFIG = {
    maintenance: false,
    maintenance_message: 'O launcher do Atena está em manutenção.<br>Volte daqui a pouco!',

    // true  -> login com conta Microsoft (Minecraft original)
    // false -> login offline, só nick (exige online-mode=false no servidor)
    // "https://seusite.com" -> login via Azuriom/AZauth
    online: true,

    // client_id do seu app no Azure. Deixe null para usar o padrão embutido
    // na minecraft-java-core, que funciona sem registrar nada.
    client_id: null,

    // Nome da pasta do jogo. "Atena" vira %appdata%/.Atena no Windows.
    dataDirectory: 'Atena',

    // Feed RSS opcional. Se preenchido, substitui as notícias do painel.
    rss: null,

    // Verificação por Discord. Desligada por padrão: sem preencher nada, o
    // launcher funciona exatamente como antes.
    discord: {
        enabled: false,
        // true exige que o jogador conecte o Discord antes de conseguir jogar
        required: false,
        clientId: '',
        clientSecret: '',
        // Id do seu servidor do Discord — necessário para ler os cargos
        guildId: '',
        // true recusa quem não está no seu servidor do Discord
        requireGuild: false
    }
};

/**
 * Pastas e arquivos que o launcher NÃO deve apagar nem sobrescrever quando
 * `verify` está ligado. São coisas do jogador (mundos, prints, teclas) e
 * lixo gerado em tempo de execução pelo Forge e por mods populares.
 */
const DEFAULT_IGNORED = [
    'logs',
    'crash-reports',
    'saves',
    'screenshots',
    'backups',
    'schematics',
    'shaderpacks',
    'options.txt',
    'optionsof.txt',
    'optionsshaders.txt',
    'servers.dat',
    'servers.dat_old',
    'usercache.json',
    'usernamecache.json',
    'realms_persistence.json',
    '.mixin.out',
    '.bobby',
    'journeymap',
    'XaeroWaypoints',
    'XaeroWorldMap',
    'essential',
    'local'
];

/**
 * Pastas que o launcher copia para backups/ antes de cada atualização.
 *
 * Não precisa repetir o que já está em DEFAULT_IGNORED: aquilo nunca é apagado.
 * Esta lista é a rede de segurança para conteúdo do jogador que vive dentro de
 * pastas sincronizadas — por exemplo uma pasta `emojis` que o modpack usa.
 */
const DEFAULT_BACKUP = [
    'emojis',
    'config'
];

function defaultInstance(id, name) {
    return {
        id,
        name: name || id,
        displayName: name || id,
        enabled: true,

        loader: {
            minecraft_version: '1.20.1',
            loader_type: 'forge',
            loader_version: 'latest'
        },

        // Com verify ligado o launcher apaga do PC do jogador tudo que não
        // está no manifesto — é o que garante que ninguém jogue com mod extra.
        verify: true,
        ignored: [...DEFAULT_IGNORED],
        backup: [...DEFAULT_BACKUP],

        // Quem enxerga esta instância. 'public' é todo mundo; os outros
        // modos exigem Discord conectado e são conferidos aqui no servidor.
        access: {
            mode: 'public',
            roles: [],
            players: []
        },

        whitelist: [],
        whitelistActive: false,

        status: {
            nameServer: 'Atena',
            ip: 'jogar.seudominio.com.br',
            port: 25565
        },

        jvm_args: [],
        game_args: []
    };
}

/** Formato que o launcher espera receber em GET /api/instances. */
function toLauncherInstance(instance, publicUrl) {
    return {
        name: instance.id,
        displayName: instance.displayName || instance.name || instance.id,
        url: `${publicUrl}/api/instances/${encodeURIComponent(instance.id)}/files`,
        loader: {
            minecraft_version: instance.loader?.minecraft_version || '1.20.1',
            loader_type: instance.loader?.loader_type || 'forge',
            loader_version: instance.loader?.loader_version || 'latest'
        },
        verify: instance.verify !== false,
        ignored: Array.isArray(instance.ignored) ? instance.ignored : [],
        backup: Array.isArray(instance.backup) ? instance.backup : [],
        access: instance.access || { mode: 'public', roles: [], players: [] },
        whitelist: Array.isArray(instance.whitelist) ? instance.whitelist : [],
        whitelistActive: !!instance.whitelistActive,
        status: {
            nameServer: instance.status?.nameServer || instance.displayName || instance.id,
            ip: instance.status?.ip || '127.0.0.1',
            port: Number(instance.status?.port || 25565)
        },
        jvm_args: Array.isArray(instance.jvm_args) ? instance.jvm_args : [],
        game_args: Array.isArray(instance.game_args) ? instance.game_args : []
    };
}

module.exports = { DEFAULT_CONFIG, DEFAULT_IGNORED, DEFAULT_BACKUP, defaultInstance, toLauncherInstance };
