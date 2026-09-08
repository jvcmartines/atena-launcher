/* Painel de administração do Atena Launcher — front-end sem framework. */
(() => {
    'use strict';

    const $ = sel => document.querySelector(sel);
    const $$ = sel => [...document.querySelectorAll(sel)];

    const state = {
        user: null,
        instances: [],
        current: null,     // instância aberta
        path: '',          // pasta atual no navegador de arquivos
        publishTimer: null
    };

    /* ----------------------------------------------------------- helpers - */

    async function api(method, url, body) {
        const options = { method, headers: {}, credentials: 'same-origin' };
        if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }

        const res = await fetch(`/admin/api${url}`, options);
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }

        if (!res.ok) {
            const err = new Error((data && data.error) || `Erro ${res.status}`);
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data;
    }

    function toast(message, kind = '') {
        const el = document.createElement('div');
        el.className = `toast ${kind}`;
        el.textContent = message;
        $('#toasts').appendChild(el);
        setTimeout(() => el.remove(), kind === 'error' ? 7000 : 4000);
    }

    function fmtSize(bytes) {
        if (bytes === null || bytes === undefined) return '—';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let value = bytes, i = 0;
        while (value >= 1024 && i < units.length - 1) { value /= 1024; i += 1; }
        return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
        ));
    }

    function openModal(html) {
        $('#modal-body').innerHTML = html;
        $('#modal').classList.add('open');
        const first = $('#modal-body input, #modal-body textarea, #modal-body select');
        if (first) first.focus();
    }

    function closeModal() {
        $('#modal').classList.remove('open');
        $('#modal-body').innerHTML = '';
    }

    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

    /** Confirmação com digitação de uma palavra, para ações destrutivas. */
    function confirmDangerous({ title, message, word, action }) {
        openModal(`
            <h3>${escapeHtml(title)}</h3>
            <p class="hint">${message}</p>
            <label class="field">
                <span>Digite <b>${escapeHtml(word)}</b> para confirmar</span>
                <input type="text" id="confirm-word" autocomplete="off">
            </label>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="danger" id="confirm-go" disabled>Confirmar</button>
            </div>
        `);

        const input = $('#confirm-word');
        const go = $('#confirm-go');
        input.addEventListener('input', () => { go.disabled = input.value.trim() !== word; });
        go.addEventListener('click', async () => {
            go.disabled = true;
            try { await action(); closeModal(); } catch (err) { toast(err.message, 'error'); go.disabled = false; }
        });
    }

    document.addEventListener('click', e => {
        if (e.target.matches('[data-close]')) closeModal();
    });

    /* -------------------------------------------------------------- auth - */

    async function boot() {
        try {
            const me = await api('GET', '/me');
            state.user = me.user;
            showApp();
        } catch (err) {
            showAuth(err.data && err.data.needsSetup);
        }
    }

    function showAuth(needsSetup) {
        $('#auth').style.display = 'flex';
        $('#app').classList.remove('visible');
        $('#setup-confirm').hidden = !needsSetup;
        $('#auth-subtitle').textContent = needsSetup
            ? 'Primeiro acesso: crie a conta de administrador.'
            : 'Painel de administração do launcher';
        $('#login-submit').textContent = needsSetup ? 'Criar administrador' : 'Entrar';
        $('#login-form').dataset.mode = needsSetup ? 'setup' : 'login';
    }

    function showApp() {
        $('#auth').style.display = 'none';
        $('#app').classList.add('visible');
        $('#current-user').textContent = `${state.user.username} (${state.user.role})`;
        loadInstances();
    }

    $('#login-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        const setup = form.dataset.mode === 'setup';

        if (setup && data.password !== data.confirm) return toast('As senhas não conferem.', 'error');

        try {
            const res = await api('POST', setup ? '/setup' : '/login', {
                username: data.username,
                password: data.password
            });
            state.user = res.user;
            form.reset();
            showApp();
        } catch (err) {
            toast(err.message, 'error');
        }
    });

    $('#logout').addEventListener('click', async () => {
        await api('POST', '/logout').catch(() => {});
        location.reload();
    });

    $('#change-password').addEventListener('click', () => {
        openModal(`
            <h3>Trocar minha senha</h3>
            <label class="field"><span>Senha atual</span><input type="password" id="pw-current"></label>
            <label class="field"><span>Nova senha (mínimo 8 caracteres)</span><input type="password" id="pw-new"></label>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="primary" id="pw-save">Salvar</button>
            </div>
        `);
        $('#pw-save').addEventListener('click', async () => {
            try {
                await api('POST', '/me/password', {
                    currentPassword: $('#pw-current').value,
                    newPassword: $('#pw-new').value
                });
                closeModal();
                toast('Senha alterada.', 'success');
            } catch (err) { toast(err.message, 'error'); }
        });
    });

    /* ---------------------------------------------------------- navegação - */

    $$('.nav-item').forEach(item => item.addEventListener('click', () => {
        $$('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        const page = item.dataset.page;
        $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));

        if (page === 'news') loadNews();
        if (page === 'launcher') loadConfig();
        if (page === 'players') loadPlayers();
        if (page === 'staff') loadUsers();
        if (page === 'log') loadLog();
    }));

    $$('.tab').forEach(tab => tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab.dataset.tab}`));
    }));

    /* ---------------------------------------------------------- modpacks - */

    async function loadInstances() {
        try {
            state.instances = await api('GET', '/instances');
        } catch (err) {
            return toast(err.message, 'error');
        }

        const list = $('#instance-list');
        if (!state.instances.length) {
            list.innerHTML = `<div class="card"><h3>Nenhum modpack ainda</h3>
                <p class="hint" style="margin:0">Clique em "Novo modpack" para criar o Atena.</p></div>`;
            return;
        }

        list.innerHTML = state.instances.map(instance => {
            const published = instance.published;
            const badge = !published
                ? '<span class="badge dim">nunca publicado</span>'
                : instance.pending
                    ? '<span class="badge amber">mudanças não publicadas</span>'
                    : '<span class="badge green">publicado</span>';

            return `
                <div class="instance-card ${state.current === instance.id ? 'selected' : ''}" data-id="${escapeHtml(instance.id)}">
                    <h4>${escapeHtml(instance.displayName)} ${instance.enabled === false ? '<span class="badge dim">oculto</span>' : ''}</h4>
                    <div class="meta">
                        <span class="mono">${escapeHtml(instance.id)}</span> ·
                        ${escapeHtml(instance.loader.minecraft_version)} ${escapeHtml(instance.loader.loader_type)}<br>
                        ${instance.disk.fileCount} arquivos · ${fmtSize(instance.disk.totalSize)}<br>
                        ${published ? `versão ${published.version} · ${fmtDate(published.publishedAt)}` : 'sem versão publicada'}
                    </div>
                    <div style="margin-top:10px">${badge}</div>
                </div>`;
        }).join('');

        list.querySelectorAll('.instance-card').forEach(card => {
            card.addEventListener('click', () => openInstance(card.dataset.id));
        });

        if (state.current && !state.instances.some(i => i.id === state.current)) closeInstance();
        else if (state.current) renderPublishTab();
    }

    $('#new-instance').addEventListener('click', () => {
        openModal(`
            <h3>Novo modpack</h3>
            <label class="field">
                <span>Nome (ex.: Atena)</span>
                <input type="text" id="instance-name" placeholder="Atena">
            </label>
            <p class="hint">O identificador em disco é gerado a partir do nome e não muda depois.</p>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="primary" id="instance-create">Criar</button>
            </div>
        `);
        $('#instance-create').addEventListener('click', async () => {
            try {
                const created = await api('POST', '/instances', { name: $('#instance-name').value });
                closeModal();
                toast(`Modpack "${created.displayName}" criado.`, 'success');
                await loadInstances();
                openInstance(created.id);
            } catch (err) { toast(err.message, 'error'); }
        });
    });

    function instance() {
        return state.instances.find(i => i.id === state.current);
    }

    async function openInstance(id) {
        state.current = id;
        state.path = '';
        $('#instance-detail').hidden = false;

        const data = instance();
        $('#detail-title').textContent = data.displayName;
        $('#detail-subtitle').textContent = `files/${data.id}`;

        fillInstanceForm(data);
        renderPublishTab();
        await loadFiles();

        $('#instance-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
        loadInstances();
    }

    function closeInstance() {
        state.current = null;
        $('#instance-detail').hidden = true;
        loadInstances();
    }

    $('#close-detail').addEventListener('click', closeInstance);

    /* ---------------------------------------------------------- arquivos - */

    async function loadFiles() {
        if (!state.current) return;

        let data;
        try {
            data = await api('GET', `/instances/${state.current}/files?path=${encodeURIComponent(state.path)}`);
        } catch (err) {
            return toast(err.message, 'error');
        }

        // Trilha de navegação.
        const parts = data.path ? data.path.split('/') : [];
        const crumbs = [`<span class="crumb" data-path="">${escapeHtml(state.current)}</span>`];
        parts.forEach((part, i) => {
            const target = parts.slice(0, i + 1).join('/');
            crumbs.push('<span class="sep">/</span>');
            crumbs.push(`<span class="crumb" data-path="${escapeHtml(target)}">${escapeHtml(part)}</span>`);
        });
        $('#breadcrumb').innerHTML = crumbs.join('');
        $('#breadcrumb').querySelectorAll('.crumb').forEach(crumb => {
            crumb.addEventListener('click', () => { state.path = crumb.dataset.path; loadFiles(); });
        });

        $('#files-empty').hidden = data.entries.length > 0;
        $('#file-rows').innerHTML = data.entries.map(entry => {
            const full = data.path ? `${data.path}/${entry.name}` : entry.name;
            return `
                <tr class="${entry.type === 'dir' ? 'clickable' : ''}" data-name="${escapeHtml(entry.name)}" data-type="${entry.type}">
                    <td>${entry.type === 'dir' ? '📁' : '📄'} ${escapeHtml(entry.name)}</td>
                    <td class="nowrap muted">${entry.type === 'dir' ? '—' : fmtSize(entry.size)}</td>
                    <td class="nowrap muted">${fmtDate(entry.modifiedAt)}</td>
                    <td class="nowrap"><button class="small danger" data-delete="${escapeHtml(full)}">Apagar</button></td>
                </tr>`;
        }).join('');

        $('#file-rows').querySelectorAll('tr').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.matches('[data-delete]')) return;
                if (row.dataset.type !== 'dir') return;
                state.path = state.path ? `${state.path}/${row.dataset.name}` : row.dataset.name;
                loadFiles();
            });
        });

        $('#file-rows').querySelectorAll('[data-delete]').forEach(button => {
            button.addEventListener('click', async e => {
                e.stopPropagation();
                const target = button.dataset.delete;
                confirmDangerous({
                    title: 'Apagar do modpack',
                    message: `Isso remove <code>${escapeHtml(target)}</code> do servidor. Os jogadores só perdem o arquivo depois que você publicar.`,
                    word: 'apagar',
                    action: async () => {
                        await api('DELETE', `/instances/${state.current}/files`, { path: target });
                        toast('Removido.', 'success');
                        await loadFiles();
                        await loadInstances();
                    }
                });
            });
        });
    }

    $('#new-folder').addEventListener('click', () => {
        openModal(`
            <h3>Nova pasta</h3>
            <label class="field"><span>Nome</span><input type="text" id="folder-name" placeholder="mods"></label>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="primary" id="folder-create">Criar</button>
            </div>
        `);
        $('#folder-create').addEventListener('click', async () => {
            const name = $('#folder-name').value.trim();
            if (!name) return;
            try {
                await api('POST', `/instances/${state.current}/folder`, {
                    path: state.path ? `${state.path}/${name}` : name
                });
                closeModal();
                loadFiles();
            } catch (err) { toast(err.message, 'error'); }
        });
    });

    $('#wipe-instance').addEventListener('click', () => {
        confirmDangerous({
            title: 'Apagar todos os arquivos',
            message: 'Remove <b>tudo</b> que está em disco para este modpack. A configuração da instância é mantida. Você vai precisar subir os arquivos de novo e publicar.',
            word: 'apagar tudo',
            action: async () => {
                const data = await api('GET', `/instances/${state.current}/files?path=`);
                for (const entry of data.entries) {
                    await api('DELETE', `/instances/${state.current}/files`, { path: entry.name });
                }
                state.path = '';
                toast('Arquivos removidos.', 'success');
                await loadFiles();
                await loadInstances();
            }
        });
    });

    /* ----------------------------------------------------------- uploads - */

    function uploadWithProgress(url, formData, label) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            $('#upload-progress').hidden = false;
            $('#upload-label').textContent = label;
            $('#upload-bar').value = 0;

            xhr.upload.addEventListener('progress', e => {
                if (!e.lengthComputable) return;
                const percent = (e.loaded / e.total) * 100;
                $('#upload-bar').value = percent;
                $('#upload-label').textContent = `${label} — ${fmtSize(e.loaded)} de ${fmtSize(e.total)}`;
            });

            xhr.addEventListener('load', () => {
                $('#upload-progress').hidden = true;
                let data = null;
                try { data = JSON.parse(xhr.responseText); } catch { /* resposta vazia */ }

                if (xhr.status >= 200 && xhr.status < 300) resolve(data);
                else reject(new Error((data && data.error) || `Erro ${xhr.status}`));
            });

            xhr.addEventListener('error', () => {
                $('#upload-progress').hidden = true;
                reject(new Error('Falha de rede durante o envio.'));
            });

            xhr.open('POST', `/admin/api${url}`);
            xhr.withCredentials = true;
            xhr.send(formData);
        });
    }

    async function sendFiles(files, relativePaths) {
        if (!files.length) return;

        const form = new FormData();
        form.append('path', state.path);
        form.append('relativePaths', JSON.stringify(relativePaths));
        for (const file of files) form.append('files', file);

        try {
            const result = await uploadWithProgress(`/instances/${state.current}/upload`, form,
                `Enviando ${files.length} arquivo(s)`);
            toast(`${result.saved} arquivo(s) enviado(s). Não esqueça de publicar.`, 'success');
            await loadFiles();
            await loadInstances();
        } catch (err) { toast(err.message, 'error'); }
    }

    $('#pick-files').addEventListener('click', () => $('#input-files').click());
    $('#pick-folder').addEventListener('click', () => $('#input-folder').click());
    $('#pick-zip').addEventListener('click', () => $('#input-zip').click());

    $('#input-files').addEventListener('change', e => {
        const files = [...e.target.files];
        sendFiles(files, files.map(f => f.name));
        e.target.value = '';
    });

    $('#input-folder').addEventListener('change', e => {
        const files = [...e.target.files];
        // webkitRelativePath vem como "minhapasta/mods/x.jar"; o primeiro nível é
        // a pasta que a pessoa escolheu, então mantemos ele para não achatar tudo.
        sendFiles(files, files.map(f => f.webkitRelativePath || f.name));
        e.target.value = '';
    });

    $('#input-zip').addEventListener('change', async e => {
        const file = e.target.files[0];
        e.target.value = '';
        if (file) askZipOptions(file);
    });

    function askZipOptions(file) {
        openModal(`
            <h3>Enviar .zip</h3>
            <p class="hint">
                <b>${escapeHtml(file.name)}</b> — ${fmtSize(file.size)}<br>
                O conteúdo será extraído em <code>${escapeHtml(state.path || '/')}</code>.
            </p>
            <label class="field">
                <span>Pastas a ignorar no começo do caminho</span>
                <select id="zip-strip">
                    <option value="0">Nenhuma — o zip já começa em mods/, config/…</option>
                    <option value="1">1 — o zip tem uma pasta envolvendo tudo (ex.: .minecraft/)</option>
                    <option value="2">2 — o zip tem duas pastas antes do conteúdo</option>
                </select>
            </label>
            <label class="checkbox">
                <input type="checkbox" id="zip-wipe">
                <span>Apagar tudo antes de extrair
                    <small>Use quando o zip é o modpack completo. Sem marcar, os arquivos são somados aos que já
                        existem (o zip sobrescreve os de mesmo nome, mas não remove os antigos).</small></span>
            </label>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="primary" id="zip-send">Enviar e extrair</button>
            </div>
        `);

        $('#zip-send').addEventListener('click', async () => {
            const strip = $('#zip-strip').value;
            const wipe = $('#zip-wipe').checked;
            closeModal();

            const form = new FormData();
            form.append('path', state.path);
            form.append('strip', strip);
            form.append('wipe', String(wipe));
            form.append('archive', file);

            try {
                const result = await uploadWithProgress(`/instances/${state.current}/upload-zip`, form,
                    `Enviando ${file.name}`);
                toast(`${result.extracted} arquivo(s) extraído(s). Não esqueça de publicar.`, 'success');
                await loadFiles();
                await loadInstances();
            } catch (err) { toast(err.message, 'error'); }
        });
    }

    // Arrastar e soltar, inclusive pastas inteiras.
    const dropzone = $('#dropzone');
    ['dragenter', 'dragover'].forEach(type => dropzone.addEventListener(type, e => {
        e.preventDefault();
        dropzone.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(type => dropzone.addEventListener(type, e => {
        e.preventDefault();
        dropzone.classList.remove('over');
    }));

    dropzone.addEventListener('drop', async e => {
        const items = [...(e.dataTransfer.items || [])];
        const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);

        if (!entries.length) {
            const files = [...e.dataTransfer.files];
            return sendFiles(files, files.map(f => f.name));
        }

        const collected = [];
        for (const entry of entries) await walkEntry(entry, '', collected);

        if (collected.length === 1 && collected[0].file.name.toLowerCase().endsWith('.zip')) {
            return askZipOptions(collected[0].file);
        }
        sendFiles(collected.map(c => c.file), collected.map(c => c.path));
    });

    function walkEntry(entry, prefix, out) {
        return new Promise(resolve => {
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isFile) {
                entry.file(file => { out.push({ file, path: relative }); resolve(); }, resolve);
                return;
            }

            const reader = entry.createReader();
            const batch = [];
            const readMore = () => reader.readEntries(async results => {
                if (!results.length) {
                    for (const child of batch) await walkEntry(child, relative, out);
                    return resolve();
                }
                batch.push(...results);
                readMore();
            }, resolve);
            readMore();
        });
    }

    /* --------------------------------------------------------- publicação - */

    function renderPublishTab() {
        const data = instance();
        if (!data) return;

        $('#pub-version').textContent = data.published ? `v${data.published.version}` : '—';
        $('#pub-files').textContent = data.disk.fileCount;
        $('#pub-size').textContent = fmtSize(data.disk.totalSize);

        $('#pub-status').innerHTML = !data.published
            ? '<span class="badge dim">nunca publicado</span> — os jogadores ainda não recebem nada deste modpack.'
            : data.pending
                ? '<span class="badge amber">mudanças não publicadas</span> — o que está em disco é diferente da versão que os jogadores baixam.'
                : '<span class="badge green">em dia</span> — o que está em disco é exatamente o que os jogadores recebem.';

        $('#pub-history').innerHTML = data.published
            ? `Versão <b>${data.published.version}</b> publicada por <b>${escapeHtml(data.published.publishedBy)}</b>
               em ${fmtDate(data.published.publishedAt)}<br>
               ${data.published.fileCount} arquivos · ${fmtSize(data.published.totalSize)}
               ${data.published.changelog ? `<br><br>${escapeHtml(data.published.changelog).replace(/\n/g, '<br>')}` : ''}`
            : 'Nenhuma versão publicada ainda.';
    }

    $('#do-publish').addEventListener('click', async () => {
        const button = $('#do-publish');
        button.disabled = true;
        $('#publish-feedback').textContent = 'Lendo os arquivos e calculando as assinaturas…';
        $('#publish-progress').hidden = false;
        $('#publish-bar').removeAttribute('value');

        try {
            await api('POST', `/instances/${state.current}/publish`, {
                changelog: $('#pub-changelog').value
            });
            pollPublish();
        } catch (err) {
            button.disabled = false;
            $('#publish-progress').hidden = true;
            $('#publish-feedback').textContent = '';
            toast(err.message, 'error');
        }
    });

    function pollPublish() {
        clearInterval(state.publishTimer);

        state.publishTimer = setInterval(async () => {
            let job;
            try {
                job = await api('GET', `/instances/${state.current}/publish`);
            } catch (err) {
                clearInterval(state.publishTimer);
                $('#do-publish').disabled = false;
                return toast(err.message, 'error');
            }

            if (job.state === 'running') {
                if (job.total) {
                    $('#publish-bar').max = job.total;
                    $('#publish-bar').value = job.done;
                    $('#publish-feedback').textContent = `Verificando ${job.done} de ${job.total} arquivos…`;
                }
                return;
            }

            clearInterval(state.publishTimer);
            $('#do-publish').disabled = false;
            $('#publish-progress').hidden = true;

            if (job.state === 'error') {
                $('#publish-feedback').textContent = '';
                return toast(`Falha ao publicar: ${job.error}`, 'error');
            }

            if (job.state === 'done') {
                $('#publish-feedback').textContent = '';
                $('#pub-changelog').value = '';
                toast(job.result.changed
                    ? `Versão ${job.result.version} publicada! Os jogadores recebem a atualização ao abrir o launcher.`
                    : 'Nada mudou desde a última publicação — nenhuma versão nova foi gerada.',
                    'success');
                await loadInstances();
                renderPublishTab();
            }
        }, 1000);
    }

    /* ------------------------------------------------ configuração da inst. */

    function fillInstanceForm(data) {
        const form = $('#instance-form');
        form.displayName.value = data.displayName || '';
        form.id.value = data.id;
        form.enabled.checked = data.enabled !== false;
        form.minecraft_version.value = data.loader.minecraft_version || '';
        form.loader_type.value = data.loader.loader_type || 'forge';
        form.loader_version.value = data.loader.loader_version || '';
        form.nameServer.value = data.status.nameServer || '';
        form.ip.value = data.status.ip || '';
        form.port.value = data.status.port || 25565;
        form.verify.checked = data.verify !== false;
        form.ignored.value = (data.ignored || []).join('\n');
        form.backup.value = (data.backup || []).join('\n');
        form.accessMode.value = data.access?.mode || 'public';
        form.accessRoles.value = (data.access?.roles || []).join('\n');
        form.accessPlayers.value = (data.access?.players || []).join('\n');
        syncAccessVisibility(form.accessMode.value);
        form.whitelistActive.checked = !!data.whitelistActive;
        form.whitelist.value = (data.whitelist || []).join('\n');
        form.jvm_args.value = (data.jvm_args || []).join('\n');
        form.game_args.value = (data.game_args || []).join('\n');
    }

    /** Mostra apenas os campos que fazem sentido para o modo escolhido. */
    function syncAccessVisibility(mode) {
        $('#instance-form [data-access]').forEach(el => {
            el.hidden = !el.dataset.access.split(' ').includes(mode);
        });
    }

    $('#instance-form').addEventListener('change', e => {
        if (e.target.name === 'accessMode') syncAccessVisibility(e.target.value);
    });

    $('#instance-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;

        try {
            await api('PUT', `/instances/${state.current}`, {
                displayName: form.displayName.value,
                enabled: form.enabled.checked,
                loader: {
                    minecraft_version: form.minecraft_version.value,
                    loader_type: form.loader_type.value,
                    loader_version: form.loader_version.value
                },
                verify: form.verify.checked,
                ignored: form.ignored.value,
                backup: form.backup.value,
                access: {
                    mode: form.accessMode.value,
                    roles: form.accessRoles.value,
                    players: form.accessPlayers.value
                },
                whitelist: form.whitelist.value,
                whitelistActive: form.whitelistActive.checked,
                status: {
                    nameServer: form.nameServer.value,
                    ip: form.ip.value,
                    port: form.port.value
                },
                jvm_args: form.jvm_args.value,
                game_args: form.game_args.value
            });
            toast('Configurações salvas.', 'success');
            await loadInstances();
            $('#detail-title').textContent = form.displayName.value;
        } catch (err) { toast(err.message, 'error'); }
    });

    $('#delete-instance').addEventListener('click', () => {
        const data = instance();
        confirmDangerous({
            title: `Apagar o modpack "${escapeHtml(data.displayName)}"`,
            message: 'Remove a instância, todos os arquivos em disco e o manifesto publicado. Não dá para desfazer.',
            word: data.id,
            action: async () => {
                await api('DELETE', `/instances/${data.id}`);
                toast('Modpack apagado.', 'success');
                closeInstance();
            }
        });
    });

    /* --------------------------------------------------------------- news - */

    async function loadNews() {
        let news;
        try { news = await api('GET', '/news'); } catch (err) { return toast(err.message, 'error'); }

        $('#news-empty').hidden = news.length > 0;
        $('#news-rows').innerHTML = news.map(item => `
            <tr>
                <td>${escapeHtml(item.title)}</td>
                <td class="nowrap muted">${escapeHtml(item.author)}</td>
                <td class="nowrap muted">${fmtDate(item.publish_date)}</td>
                <td class="nowrap">${item.published === false
                    ? '<span class="badge dim">rascunho</span>'
                    : '<span class="badge green">publicada</span>'}</td>
                <td class="nowrap">
                    <button class="small" data-edit="${escapeHtml(item.id)}">Editar</button>
                    <button class="small danger" data-remove="${escapeHtml(item.id)}">Apagar</button>
                </td>
            </tr>`).join('');

        $('#news-rows').querySelectorAll('[data-edit]').forEach(button => {
            button.addEventListener('click', () => newsModal(news.find(n => n.id === button.dataset.edit)));
        });
        $('#news-rows').querySelectorAll('[data-remove]').forEach(button => {
            button.addEventListener('click', () => confirmDangerous({
                title: 'Apagar notícia',
                message: 'Ela some da tela inicial do launcher.',
                word: 'apagar',
                action: async () => {
                    await api('DELETE', `/news/${button.dataset.remove}`);
                    loadNews();
                }
            }));
        });
    }

    function newsModal(item) {
        const editing = !!item;
        openModal(`
            <h3>${editing ? 'Editar notícia' : 'Nova notícia'}</h3>
            <label class="field"><span>Título</span>
                <input type="text" id="news-title" value="${escapeHtml(item ? item.title : '')}"></label>
            <label class="field"><span>Texto</span>
                <textarea id="news-content" rows="7">${escapeHtml(item ? item.content : '')}</textarea></label>
            <label class="field"><span>Autor</span>
                <input type="text" id="news-author" value="${escapeHtml(item ? item.author : state.user.username)}"></label>
            <label class="checkbox">
                <input type="checkbox" id="news-published" ${!item || item.published !== false ? 'checked' : ''}>
                <span>Publicada <small>Desmarque para guardar como rascunho.</small></span>
            </label>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="primary" id="news-save">Salvar</button>
            </div>
        `);

        $('#news-save').addEventListener('click', async () => {
            const payload = {
                title: $('#news-title').value,
                content: $('#news-content').value,
                author: $('#news-author').value,
                published: $('#news-published').checked
            };
            try {
                if (editing) await api('PUT', `/news/${item.id}`, payload);
                else await api('POST', '/news', payload);
                closeModal();
                loadNews();
            } catch (err) { toast(err.message, 'error'); }
        });
    }

    $('#new-news').addEventListener('click', () => newsModal(null));

    /* ------------------------------------------------ config do launcher -- */

    function syncConfigVisibility(mode) {
        $$('#config-form [data-when]').forEach(el => {
            el.hidden = el.dataset.when !== mode;
        });
    }

    async function loadConfig() {
        let config;
        try { config = await api('GET', '/config'); } catch (err) { return toast(err.message, 'error'); }

        const form = $('#config-form');
        form.maintenance.checked = !!config.maintenance;
        form.maintenance_message.value = config.maintenance_message || '';
        form.dataDirectory.value = config.dataDirectory || 'Atena';
        form.client_id.value = config.client_id || '';
        form.rss.value = config.rss || '';

        form.discordEnabled.checked = !!config.discord?.enabled;
        form.discordRequired.checked = !!config.discord?.required;
        form.discordClientId.value = config.discord?.clientId || '';
        form.discordClientSecret.value = '';
        form.discordClientSecret.placeholder = config.discord?.hasSecret
            ? 'já configurado — deixe vazio para manter'
            : 'cole o Client Secret aqui';
        form.discordGuildId.value = config.discord?.guildId || '';
        form.discordRequireGuild.checked = !!config.discord?.requireGuild;
        $('#discord-redirect').textContent = config.redirectUri || '—';

        const mode = typeof config.online === 'string' ? 'azauth' : (config.online ? 'microsoft' : 'offline');
        form.onlineMode.value = mode;
        form.azauthUrl.value = typeof config.online === 'string' ? config.online : '';
        syncConfigVisibility(mode);
        updateDataDirPreview();
    }

    function updateDataDirPreview() {
        const value = $('#config-form').dataDirectory.value.trim() || 'Atena';
        $('#datadir-preview').textContent = `%appdata%\\.${value}`;
    }

    $('#config-form').addEventListener('input', e => {
        if (e.target.name === 'onlineMode') syncConfigVisibility(e.target.value);
        if (e.target.name === 'dataDirectory') updateDataDirPreview();
    });

    $('#config-form').addEventListener('submit', async e => {
        e.preventDefault();
        const form = e.currentTarget;
        const mode = form.onlineMode.value;

        const payload = {
            maintenance: form.maintenance.checked,
            maintenance_message: form.maintenance_message.value,
            dataDirectory: form.dataDirectory.value,
            client_id: mode === 'microsoft' ? form.client_id.value : null,
            rss: form.rss.value,
            discord: {
                enabled: form.discordEnabled.checked,
                required: form.discordRequired.checked,
                clientId: form.discordClientId.value,
                // vazio significa "mantenha o que já está salvo"
                clientSecret: form.discordClientSecret.value,
                guildId: form.discordGuildId.value,
                requireGuild: form.discordRequireGuild.checked
            },
            online: mode === 'azauth' ? form.azauthUrl.value : (mode === 'microsoft')
        };

        try {
            await api('PUT', '/config', payload);
            toast('Configuração salva.', 'success');
            loadConfig();
        } catch (err) { toast(err.message, 'error'); }
    });

    /* ---------------------------------------------------------- jogadores - */

    async function loadPlayers() {
        let list;
        try { list = await api('GET', '/players'); } catch (err) { return toast(err.message, 'error'); }

        $('#players-empty').hidden = list.length > 0;
        $('#player-rows').innerHTML = list.map(player => {
            const nicks = (player.nicknames || []);
            const avatar = player.avatar
                ? `<img src="${escapeHtml(player.avatar)}" alt="" class="player-avatar">`
                : '<div class="player-avatar"></div>';

            return `
            <tr class="${player.banned ? 'banned-row' : ''}">
                <td>
                    <div class="player-cell">
                        ${avatar}
                        <div>
                            <div><b>${escapeHtml(player.globalName || player.username)}</b></div>
                            <div class="mono muted" style="font-size:11px">${escapeHtml(player.username)} · ${escapeHtml(player.id)}</div>
                        </div>
                    </div>
                </td>
                <td>${nicks.length ? nicks.map(escapeHtml).join(', ') : '<span class="muted">—</span>'}</td>
                <td class="nowrap">${player.inGuild
                    ? '<span class="badge green">sim</span>'
                    : '<span class="badge dim">não</span>'}</td>
                <td class="nowrap muted">${fmtDate(player.lastSeen)}</td>
                <td class="nowrap">
                    ${player.banned
                        ? `<button class="small" data-unban="${escapeHtml(player.id)}">Desbanir</button>`
                        : `<button class="small danger" data-ban="${escapeHtml(player.id)}">Banir</button>`}
                    <button class="small danger" data-forget="${escapeHtml(player.id)}">Apagar</button>
                </td>
            </tr>
            ${player.banned && player.banReason
                ? `<tr class="banned-row"><td colspan="5" class="muted" style="padding-top:0">
                     Motivo: ${escapeHtml(player.banReason)}</td></tr>`
                : ''}`;
        }).join('');

        $('#player-rows').querySelectorAll('[data-ban]').forEach(button => {
            button.addEventListener('click', () => banPlayer(button.dataset.ban));
        });

        $('#player-rows').querySelectorAll('[data-unban]').forEach(button => {
            button.addEventListener('click', async () => {
                try {
                    await api('POST', `/players/${button.dataset.unban}/ban`, { banned: false });
                    toast('Jogador desbanido.', 'success');
                    loadPlayers();
                } catch (err) { toast(err.message, 'error'); }
            });
        });

        $('#player-rows').querySelectorAll('[data-forget]').forEach(button => {
            button.addEventListener('click', () => confirmDangerous({
                title: 'Apagar o registro',
                message: 'O Discord dessa pessoa é desconectado e ela precisa conectar de novo no launcher. O banimento também some.',
                word: 'apagar',
                action: async () => {
                    await api('DELETE', `/players/${button.dataset.forget}`);
                    loadPlayers();
                }
            }));
        });
    }

    function banPlayer(id) {
        openModal(`
            <h3>Banir do launcher</h3>
            <p class="hint">A pessoa para de conseguir abrir o launcher e vê a mensagem abaixo. Isso não bane
                ela do servidor de Minecraft — só do launcher.</p>
            <label class="field">
                <span>Motivo (aparece para ela)</span>
                <input type="text" id="ban-reason" placeholder="Ex.: uso de mods não permitidos">
            </label>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="danger" id="ban-go">Banir</button>
            </div>
        `);

        $('#ban-go').addEventListener('click', async () => {
            try {
                await api('POST', `/players/${id}/ban`, { banned: true, reason: $('#ban-reason').value });
                closeModal();
                toast('Jogador banido do launcher.', 'success');
                loadPlayers();
            } catch (err) { toast(err.message, 'error'); }
        });
    }

    $('#reload-players').addEventListener('click', loadPlayers);

    /* -------------------------------------------------------------- staff - */

    async function loadUsers() {
        if (state.user.role !== 'admin') {
            $('#staff-denied').hidden = false;
            $('#user-rows').innerHTML = '';
            $('#new-user').hidden = true;
            return;
        }
        $('#staff-denied').hidden = true;
        $('#new-user').hidden = false;

        let users;
        try { users = await api('GET', '/users'); } catch (err) { return toast(err.message, 'error'); }

        $('#user-rows').innerHTML = users.map(user => `
            <tr>
                <td>${escapeHtml(user.username)}</td>
                <td class="nowrap"><span class="badge ${user.role === 'admin' ? 'green' : 'dim'}">${user.role}</span></td>
                <td class="nowrap muted">${fmtDate(user.createdAt)}</td>
                <td class="nowrap">
                    <button class="small" data-reset="${escapeHtml(user.id)}">Resetar senha</button>
                    ${user.id === state.user.id ? '' : `<button class="small danger" data-remove="${escapeHtml(user.id)}">Apagar</button>`}
                </td>
            </tr>`).join('');

        $('#user-rows').querySelectorAll('[data-reset]').forEach(button => {
            button.addEventListener('click', () => {
                openModal(`
                    <h3>Resetar senha</h3>
                    <label class="field"><span>Nova senha (mínimo 8 caracteres)</span>
                        <input type="password" id="reset-pw"></label>
                    <div class="row end">
                        <button type="button" data-close>Cancelar</button>
                        <button class="primary" id="reset-save">Salvar</button>
                    </div>
                `);
                $('#reset-save').addEventListener('click', async () => {
                    try {
                        await api('PUT', `/users/${button.dataset.reset}`, { password: $('#reset-pw').value });
                        closeModal();
                        toast('Senha redefinida.', 'success');
                    } catch (err) { toast(err.message, 'error'); }
                });
            });
        });

        $('#user-rows').querySelectorAll('[data-remove]').forEach(button => {
            button.addEventListener('click', () => confirmDangerous({
                title: 'Apagar conta',
                message: 'A pessoa perde o acesso ao painel imediatamente.',
                word: 'apagar',
                action: async () => {
                    await api('DELETE', `/users/${button.dataset.remove}`);
                    loadUsers();
                }
            }));
        });
    }

    $('#new-user').addEventListener('click', () => {
        openModal(`
            <h3>Nova conta de staff</h3>
            <label class="field"><span>Usuário</span><input type="text" id="user-name"></label>
            <label class="field"><span>Senha (mínimo 8 caracteres)</span><input type="password" id="user-pw"></label>
            <label class="field"><span>Cargo</span>
                <select id="user-role">
                    <option value="staff">staff — sobe arquivos, publica e escreve notícias</option>
                    <option value="admin">admin — tudo, incluindo gerenciar contas</option>
                </select>
            </label>
            <div class="row end">
                <button type="button" data-close>Cancelar</button>
                <button class="primary" id="user-save">Criar</button>
            </div>
        `);
        $('#user-save').addEventListener('click', async () => {
            try {
                await api('POST', '/users', {
                    username: $('#user-name').value,
                    password: $('#user-pw').value,
                    role: $('#user-role').value
                });
                closeModal();
                loadUsers();
            } catch (err) { toast(err.message, 'error'); }
        });
    });

    /* ---------------------------------------------------------- histórico - */

    async function loadLog() {
        let entries;
        try { entries = await api('GET', '/log'); } catch (err) { return toast(err.message, 'error'); }

        $('#log-rows').innerHTML = entries.map(entry => `
            <tr>
                <td class="nowrap muted">${fmtDate(entry.at)}</td>
                <td class="nowrap">${escapeHtml(entry.user)}</td>
                <td><span class="mono muted">${escapeHtml(entry.action)}</span> ${escapeHtml(entry.detail)}</td>
            </tr>`).join('') || '<tr><td colspan="3" class="empty">Nada registrado ainda.</td></tr>';
    }

    $('#reload-log').addEventListener('click', loadLog);

    boot();
})();
