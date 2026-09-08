#!/usr/bin/env node
/**
 * Cria (ou reseta a senha de) uma conta de staff pelo terminal.
 * Útil quando ninguém consegue mais entrar no painel.
 *
 *   node scripts/criar-usuario.js
 *   node scripts/criar-usuario.js meunome admin
 */
const readline = require('readline');
const crypto = require('crypto');
const auth = require('../src/lib/auth');

function ask(question, { hidden = false } = {}) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise(resolve => {
        if (!hidden) {
            rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
            return;
        }

        // Esconde a senha enquanto é digitada.
        process.stdout.write(question);
        const onData = char => {
            if (['\n', '\r', ''].includes(char.toString())) return;
            readline.moveCursor(process.stdout, -1000, 0);
            readline.clearLine(process.stdout, 1);
            process.stdout.write(question + '*'.repeat(rl.line.length));
        };
        process.stdin.on('data', onData);

        rl.question('', answer => {
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            rl.close();
            resolve(answer.trim());
        });
    });
}

(async () => {
    const username = process.argv[2] || await ask('Usuário: ');
    if (username.length < 3) {
        console.error('O usuário precisa de pelo menos 3 caracteres.');
        process.exit(1);
    }

    const role = (process.argv[3] || await ask('Cargo (admin/staff) [admin]: ') || 'admin') === 'staff' ? 'staff' : 'admin';

    const password = await ask('Senha: ', { hidden: true });
    if (password.length < 8) {
        console.error('A senha precisa de pelo menos 8 caracteres.');
        process.exit(1);
    }

    const confirmation = await ask('Confirme a senha: ', { hidden: true });
    if (password !== confirmation) {
        console.error('As senhas não conferem.');
        process.exit(1);
    }

    const users = auth.users();
    const existing = users.find(u => u.username.toLowerCase() === username.toLowerCase());

    if (existing) {
        existing.password = auth.hashPassword(password);
        existing.role = role;
        auth.saveUsers(users);
        console.log(`Senha de "${username}" redefinida (cargo: ${role}).`);
    } else {
        auth.saveUsers([...users, {
            id: crypto.randomUUID(),
            username,
            password: auth.hashPassword(password),
            role,
            createdAt: new Date().toISOString()
        }]);
        console.log(`Usuário "${username}" criado (cargo: ${role}).`);
    }
    process.exit(0);
})();
