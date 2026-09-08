/**
 * Atena Launcher — troca de skin
 *
 * Fala direto com a API oficial da Mojang (api.minecraftservices.com) usando o
 * access_token que já veio do login com a Microsoft. É a mesma rota que o site
 * minecraft.net usa, então a skin muda em todo lugar, não só aqui.
 *
 * Só funciona com conta Microsoft: contas offline não existem para a Mojang e
 * não têm skin para trocar.
 */

const fs = require('fs');

const API = 'https://api.minecraftservices.com/minecraft/profile';

class SkinChanger {
    /** Contas offline não têm skin na Mojang; o botão nem aparece para elas. */
    canChange(account) {
        return account?.meta?.type === 'Xbox' && !!account?.access_token;
    }

    headers(account) {
        return { Authorization: `Bearer ${account.access_token}` };
    }

    /**
     * Confere se o arquivo é mesmo um PNG com tamanho de skin.
     *
     * A API devolve um erro genérico para arquivo errado; conferir aqui deixa a
     * mensagem clara. As dimensões vivem nos bytes 16..24 do PNG.
     */
    validate(buffer) {
        const assinatura = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        if (buffer.length < 24 || !buffer.subarray(0, 8).equals(assinatura)) {
            return { ok: false, error: 'skin.not_png' };
        }

        const width = buffer.readUInt32BE(16);
        const height = buffer.readUInt32BE(20);

        // 64x64 é o formato atual; 64x32 são as skins antigas, ainda aceitas.
        if (width !== 64 || (height !== 64 && height !== 32)) {
            return { ok: false, error: 'skin.wrong_size', detail: `${width}x${height}` };
        }
        return { ok: true, width, height };
    }

    /** Perfil atual: nome, uuid e a URL da skin em uso. */
    async profile(account) {
        try {
            const response = await fetch(API, { headers: this.headers(account) });
            if (!response.ok) return null;

            const data = await response.json();
            const skin = (data.skins || []).find(item => item.state === 'ACTIVE');

            return {
                name: data.name,
                id: data.id,
                skinUrl: skin?.url || null,
                variant: (skin?.variant || 'CLASSIC').toLowerCase()
            };
        } catch (err) {
            console.error('[skin] não consegui ler o perfil:', err.message);
            return null;
        }
    }

    /** Envia um PNG do disco como skin nova. */
    async upload(account, filePath, variant = 'classic') {
        let buffer;
        try {
            buffer = fs.readFileSync(filePath);
        } catch {
            return { error: 'skin.read_failed' };
        }

        const check = this.validate(buffer);
        if (!check.ok) return { error: check.error, detail: check.detail };

        const form = new FormData();
        form.append('variant', variant);
        form.append('file', new Blob([buffer], { type: 'image/png' }), 'skin.png');

        try {
            const response = await fetch(`${API}/skins`, {
                method: 'POST',
                headers: this.headers(account),
                body: form
            });

            if (!response.ok) {
                // 401 quase sempre é token vencido: reabrir o launcher renova.
                if (response.status === 401) return { error: 'skin.expired' };

                const detail = await response.text();
                return { error: 'skin.failed', detail: detail.slice(0, 160) };
            }

            return { ok: true };
        } catch (err) {
            return { error: 'skin.no_connection', detail: err.message };
        }
    }

    /** Volta para a skin padrão (Steve/Alex). */
    async reset(account) {
        try {
            const response = await fetch(`${API}/skins/active`, {
                method: 'DELETE',
                headers: this.headers(account)
            });

            if (!response.ok) {
                if (response.status === 401) return { error: 'skin.expired' };
                return { error: 'skin.failed' };
            }
            return { ok: true };
        } catch (err) {
            return { error: 'skin.no_connection', detail: err.message };
        }
    }
}

export default new SkinChanger;
