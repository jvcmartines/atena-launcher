/**
 * Leitor de .env minimalista (sem dependência externa).
 * Só define variáveis que ainda não existem no ambiente, então
 * `ATENA_PORT=8080 npm start` continua ganhando do arquivo.
 */
const fs = require('fs');
const path = require('path');

function load(file) {
    const envPath = file || path.resolve(__dirname, '../../.env');
    if (!fs.existsSync(envPath)) return;

    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;

        const eq = line.indexOf('=');
        if (eq === -1) continue;

        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();

        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        if (process.env[key] === undefined) process.env[key] = value;
    }
}

module.exports = { load };
