/**
 * Ping do servidor de Minecraft (Server List Ping).
 *
 * A minecraft-java-core só devolve a contagem de jogadores. Aqui a gente fala o
 * protocolo direto para pegar também a lista de quem está online, o MOTD e o
 * ícone — é o mesmo que o Minecraft faz ao mostrar o servidor na lista.
 *
 * O resultado fica em cache por alguns segundos: dezenas de launchers abertos
 * não podem virar um flood no servidor.
 */

const net = require('net');

const CACHE_MS = 10_000;
const TIMEOUT_MS = 4000;

const cache = new Map();

/* ------------------------------------------------- codificação varint -- */

function writeVarInt(value) {
    const bytes = [];
    do {
        let byte = value & 0x7f;
        value >>>= 7;
        if (value !== 0) byte |= 0x80;
        bytes.push(byte);
    } while (value !== 0);
    return Buffer.from(bytes);
}

function writeString(text) {
    const body = Buffer.from(text, 'utf8');
    return Buffer.concat([writeVarInt(body.length), body]);
}

/** Lê um varint de um buffer. Devolve o valor e quantos bytes consumiu. */
function readVarInt(buffer, offset = 0) {
    let value = 0;
    let size = 0;

    while (true) {
        if (offset + size >= buffer.length) return null;

        const byte = buffer[offset + size];
        value |= (byte & 0x7f) << (7 * size);
        size += 1;

        if ((byte & 0x80) === 0) break;
        if (size > 5) throw new Error('varint longo demais');
    }
    return { value, size };
}

/* ---------------------------------------------------------- o ping ----- */

function ping(host, port) {
    return new Promise(resolve => {
        const started = Date.now();
        const socket = net.createConnection({ host, port, timeout: TIMEOUT_MS });

        let chunks = Buffer.alloc(0);
        let done = false;

        function finish(result) {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(result);
        }

        socket.on('connect', () => {
            // Handshake: id 0x00, versão do protocolo (-1 = qualquer), host,
            // porta e o próximo estado (1 = status).
            const handshake = Buffer.concat([
                Buffer.from([0x00]),
                writeVarInt(767),   // versao do protocolo (1.20.1+); o servidor aceita qualquer uma no status
                writeString(host),
                Buffer.from([(port >> 8) & 0xff, port & 0xff]),
                writeVarInt(1)
            ]);

            socket.write(Buffer.concat([writeVarInt(handshake.length), handshake]));
            // Pedido de status: pacote vazio de id 0x00.
            socket.write(Buffer.from([0x01, 0x00]));
        });

        socket.on('data', data => {
            chunks = Buffer.concat([chunks, data]);

            try {
                const length = readVarInt(chunks, 0);
                if (!length) return;

                const total = length.size + length.value;
                if (chunks.length < total) return;   // ainda faltam bytes

                let offset = length.size;
                const packetId = readVarInt(chunks, offset);
                offset += packetId.size;

                const jsonLength = readVarInt(chunks, offset);
                offset += jsonLength.size;

                const json = JSON.parse(chunks.subarray(offset, offset + jsonLength.value).toString('utf8'));
                finish({ ok: true, ping: Date.now() - started, raw: json });
            } catch (err) {
                finish({ ok: false, error: err.message });
            }
        });

        socket.on('timeout', () => finish({ ok: false, error: 'timeout' }));
        socket.on('error', err => finish({ ok: false, error: err.message }));
    });
}

/* ------------------------------------------------------- normalização -- */

/** O MOTD pode vir como string, como {text, extra} ou como lista. */
function flattenMotd(description) {
    if (!description) return '';
    if (typeof description === 'string') return description;

    let text = description.text || '';
    if (Array.isArray(description.extra)) {
        text += description.extra.map(flattenMotd).join('');
    }
    if (Array.isArray(description)) {
        text = description.map(flattenMotd).join('');
    }
    // Remove os códigos de cor do Minecraft (§a, §l, ...).
    return text.replace(/§[0-9a-fk-or]/gi, '');
}

async function status(host, port = 25565) {
    const key = `${host}:${port}`;
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

    const result = await ping(host, port);

    let value;
    if (!result.ok) {
        value = { online: false, error: result.error, players: { online: 0, max: 0, sample: [] } };
    } else {
        const raw = result.raw;
        value = {
            online: true,
            ping: result.ping,
            version: raw.version?.name || null,
            motd: flattenMotd(raw.description).trim(),
            players: {
                online: raw.players?.online ?? 0,
                max: raw.players?.max ?? 0,
                // O servidor decide se manda a lista; muitos escondem ou
                // limitam a 12 nomes. Quando vem, é isso que mostramos.
                sample: (raw.players?.sample || [])
                    .map(player => ({ name: player.name, id: player.id }))
                    .filter(player => player.name && !player.name.startsWith('§'))
            }
        };
    }

    cache.set(key, { at: Date.now(), value });
    return value;
}

module.exports = { status };
