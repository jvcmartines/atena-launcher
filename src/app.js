/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */

const { app, ipcMain, BrowserWindow, dialog, Notification, shell } = require('electron');
const { Microsoft } = require('minecraft-java-core');
const { autoUpdater } = require('electron-updater')

const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

const UpdateWindow = require("./assets/js/windows/updateWindow.js");
const MainWindow = require("./assets/js/windows/mainWindow.js");

let dev = process.env.NODE_ENV === 'dev';

if (dev) {
    let appPath = path.resolve('./data/Launcher').replace(/\\/g, '/');
    let appdata = path.resolve('./data').replace(/\\/g, '/');
    if (!fs.existsSync(appPath)) fs.mkdirSync(appPath, { recursive: true });
    if (!fs.existsSync(appdata)) fs.mkdirSync(appdata, { recursive: true });
    app.setPath('userData', appPath);
    app.setPath('appData', appdata)
}

Store.initRenderer();

// Sem isto o Windows nao sabe de quem e a notificacao: ela sai sem nome, sem
// icone, e em algumas maquinas nem sai. O id precisa ser exatamente o appId do
// electron-builder - que sai do proprio package.json - senao o sistema trata
// como se fosse outro aplicativo.
if (process.platform === 'win32') {
    try {
        app.setAppUserModelId(require('../package.json').preductname);
    } catch {
        app.setAppUserModelId('Atena Launcher');
    }
}

/**
 * Um aviso do sistema operacional.
 *
 * Serve para quem deixou o launcher aberto atras de outra janela: sem isto a
 * pessoa so descobre que saiu modpack novo quando volta a olhar.
 *
 * Clicar traz o launcher para a frente - uma notificacao que nao leva a lugar
 * nenhum e so barulho.
 */
function notificar(titulo, corpo) {
    if (!Notification.isSupported()) return;

    const aviso = new Notification({ title: titulo, body: corpo, silent: false });
    aviso.on('click', () => {
        const janela = MainWindow.getWindow();
        if (!janela) return;
        if (janela.isMinimized()) janela.restore();
        janela.show();
        janela.focus();
    });
    aviso.show();
}

ipcMain.on('notificar', (_, dados) => notificar(dados?.titulo || 'Atena', dados?.corpo || ''));

if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(() => {
    if (dev) return MainWindow.createWindow()
    UpdateWindow.createWindow()
});

ipcMain.on('main-window-open', () => MainWindow.createWindow())
ipcMain.on('main-window-dev-tools', () => MainWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('main-window-dev-tools-close', () => MainWindow.getWindow().webContents.closeDevTools())
ipcMain.on('main-window-close', () => MainWindow.destroyWindow())
ipcMain.on('main-window-reload', () => MainWindow.getWindow().reload())
ipcMain.on('main-window-progress', (event, options) => MainWindow.getWindow().setProgressBar(options.progress / options.size))
ipcMain.on('main-window-progress-reset', () => MainWindow.getWindow().setProgressBar(-1))
ipcMain.on('main-window-progress-load', () => MainWindow.getWindow().setProgressBar(2))
ipcMain.on('main-window-minimize', () => MainWindow.getWindow().minimize())

ipcMain.on('update-window-close', () => UpdateWindow.destroyWindow())
ipcMain.on('update-window-dev-tools', () => UpdateWindow.getWindow().webContents.openDevTools({ mode: 'detach' }))
ipcMain.on('update-window-progress', (event, options) => UpdateWindow.getWindow().setProgressBar(options.progress / options.size))
ipcMain.on('update-window-progress-reset', () => UpdateWindow.getWindow().setProgressBar(-1))
ipcMain.on('update-window-progress-load', () => UpdateWindow.getWindow().setProgressBar(2))

ipcMain.handle('path-user-data', () => app.getPath('userData'))
ipcMain.handle('appData', e => app.getPath('appData'))

ipcMain.on('main-window-maximize', () => {
    if (MainWindow.getWindow().isMaximized()) {
        MainWindow.getWindow().unmaximize();
    } else {
        MainWindow.getWindow().maximize();
    }
})

ipcMain.on('main-window-hide', () => MainWindow.getWindow().hide())
ipcMain.on('main-window-show', () => MainWindow.getWindow().show())

ipcMain.handle('Microsoft-window', async (_, client_id) => {
    return await new Microsoft(client_id).getAuth();
})

/**
 * Login da Microsoft pelo navegador de verdade, com código de dispositivo.
 *
 * A janelinha acima é um navegador embutido do Electron, e ele não tem acesso
 * ao Windows Hello: quem entra na conta Microsoft com PIN, digital ou rosto
 * simplesmente não consegue passar da tela de senha ali dentro. No navegador
 * do sistema isso funciona.
 *
 * Por que código de dispositivo e não um redirecionamento para o launcher: o
 * servidor não define `client_id`, então vale o ID público do launcher oficial
 * (00000000402b5328), e esse ID só aceita voltar para uma página interna da
 * Microsoft — o navegador não teria como devolver o login para cá. Com o
 * código, a pessoa entra no navegador e o launcher fica perguntando à
 * Microsoft até ela autorizar.
 *
 * O escopo é o MESMO da janelinha (XboxLive.signin offline_access). Isso não é
 * detalhe: o token sai do mesmo tipo, então `getAccount` monta a conta igual e
 * a renovação automática do launcher (`refresh`) continua funcionando.
 *
 * O `device_code` fica aqui no processo principal; a tela só recebe o código
 * curto que a pessoa digita.
 */
const MS_ID_PADRAO = '00000000402b5328';
const MS_ESCOPO = 'XboxLive.signin offline_access';
let loginNavegador = null;

const formulario = campos => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(campos)
});

ipcMain.handle('microsoft-navegador-iniciar', async (_, client_id) => {
    const id = client_id || MS_ID_PADRAO;

    let resposta;
    try {
        resposta = await (await fetch('https://login.live.com/oauth20_connect.srf',
            formulario({ client_id: id, scope: MS_ESCOPO, response_type: 'device_code' }))).json();
    } catch (err) {
        return { error: err.message, errorType: 'network' };
    }

    if (!resposta.device_code) {
        return { error: resposta.error || 'sem-codigo', errorType: 'oauth2', ...resposta };
    }

    // Um login novo substitui o anterior: quem clicou duas vezes não fica com
    // duas consultas correndo em paralelo.
    if (loginNavegador) loginNavegador.cancelado = true;

    loginNavegador = {
        client_id: id,
        device_code: resposta.device_code,
        intervalo: (resposta.interval || 5) * 1000,
        expira: Date.now() + (resposta.expires_in || 900) * 1000,
        cancelado: false
    };

    // `otc` já deixa o código preenchido na página da Microsoft.
    const link = `https://www.microsoft.com/link?otc=${encodeURIComponent(resposta.user_code)}`;
    shell.openExternal(link);

    return { codigo: resposta.user_code, link, expiraEm: resposta.expires_in || 900 };
});

ipcMain.handle('microsoft-navegador-aguardar', async () => {
    const sessao = loginNavegador;
    if (!sessao) return { error: 'sem-sessao', errorType: 'oauth2' };

    while (!sessao.cancelado && Date.now() < sessao.expira) {
        await new Promise(r => setTimeout(r, sessao.intervalo));
        if (sessao.cancelado) break;

        let token;
        try {
            token = await (await fetch('https://login.live.com/oauth20_token.srf', formulario({
                client_id: sessao.client_id,
                device_code: sessao.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            }))).json();
        } catch {
            // A conexão oscilou: tenta de novo no próximo ciclo em vez de
            // desistir de um login que a pessoa ainda está fazendo.
            continue;
        }

        if (token.access_token) {
            if (loginNavegador === sessao) loginNavegador = null;
            return await new Microsoft(sessao.client_id).getAccount(token);
        }
        if (token.error === 'authorization_pending') continue;
        if (token.error === 'slow_down') { sessao.intervalo += 5000; continue; }

        // Recusou, expirou ou outro erro: não adianta insistir.
        if (loginNavegador === sessao) loginNavegador = null;
        return { error: token.error || 'desconhecido', errorType: 'oauth2', ...token };
    }

    if (sessao.cancelado) return 'cancel';
    if (loginNavegador === sessao) loginNavegador = null;
    return { error: 'expired_token', errorType: 'oauth2' };
});

ipcMain.handle('microsoft-navegador-cancelar', () => {
    if (loginNavegador) loginNavegador.cancelado = true;
    loginNavegador = null;
});

/**
 * Janela da tela de autorização do Discord.
 *
 * Ela abre a página oficial do Discord; quando a pessoa aprova, o Discord
 * redireciona para o nosso servidor, que fecha o ciclo. A promessa resolve
 * quando a janela fecha — o resultado em si o launcher pega perguntando ao
 * servidor, então nada sensível passa por aqui.
 */
let discordWindow = null;

ipcMain.handle('discord-window', async (_, url) => {
    if (discordWindow) discordWindow.destroy();

    return await new Promise(resolve => {
        discordWindow = new BrowserWindow({
            width: 520,
            height: 760,
            title: 'Discord',
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                partition: 'discord-login'
            }
        });

        discordWindow.loadURL(url);
        discordWindow.once('ready-to-show', () => discordWindow?.show());

        discordWindow.on('closed', () => {
            discordWindow = null;
            resolve('closed');
        });
    });
});

ipcMain.on('discord-window-close', () => {
    if (discordWindow) discordWindow.destroy();
});

// Escolher uma pasta do computador. Usado pela importacao de um modpack que
// ja esta em disco: o dialogo nativo e a unica forma de o jogador apontar uma
// pasta que o launcher nao conhecia.
ipcMain.handle('choose-folder', async (_, titulo) => {
    const janela = MainWindow.getWindow();
    const escolha = await dialog.showOpenDialog(janela, {
        title: titulo || 'Choose a folder',
        properties: ['openDirectory']
    });
    return escolha.canceled ? null : escolha.filePaths[0];
})

app.on('window-all-closed', () => app.quit());

autoUpdater.autoDownload = false;

ipcMain.handle('update-app', async () => {
    return await new Promise(async (resolve, reject) => {
        autoUpdater.checkForUpdates().then(res => {
            resolve(res);
        }).catch(error => {
            reject({
                error: true,
                message: error
            })
        })
    })
})

autoUpdater.on('update-available', info => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) return updateWindow.webContents.send('updateAvailable');

    // Sem a janela de abertura, a checagem veio do relogio la de baixo: a
    // pessoa esta com o launcher aberto e nao esta olhando para ele.
    if (MainWindow.getWindow()) {
        MainWindow.getWindow().webContents.send('launcher-update', info?.version || '');
    }
});

ipcMain.on('start-update', () => {
    autoUpdater.downloadUpdate();
})

// De hora em hora, enquanto o launcher estiver aberto. Antes a unica checagem
// era na tela de abertura, entao quem deixa o launcher aberto o dia todo so
// via a versao nova no dia seguinte.
const UMA_HORA = 60 * 60 * 1000;
setInterval(() => {
    if (!MainWindow.getWindow()) return;
    autoUpdater.checkForUpdates().catch(err => {
        console.error('[update] checagem periodica falhou:', err?.message || err);
    });
}, UMA_HORA);

autoUpdater.on('update-not-available', () => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('update-not-available');
});

autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall();
});

autoUpdater.on('download-progress', (progress) => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('download-progress', progress);
})

autoUpdater.on('error', (err) => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow) updateWindow.webContents.send('error', err);
});