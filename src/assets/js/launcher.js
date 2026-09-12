/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */
// import panel
import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';
import Modpack from './panels/modpack.js';
import Ajustes from './panels/ajustes.js';
import Estatisticas from './panels/estatisticas.js';

// import modules
import { logger, config, changePanel, database, popup, setBackground, accountSelect, addAccount, pkg, lang, discord, registro, appdata } from './utils.js';
const { AZauth, Microsoft, Mojang } = require('minecraft-java-core');

// libs
const { ipcRenderer } = require('electron');
const fs = require('fs');
const os = require('os');

class Launcher {
    async init() {
        this.initLog();
        await this.initErrorLog();
        console.log('Initializing Launcher...');
        this.shortcut()
        await setBackground()
        this.initFrame();
        this.db = new database();
        await this.initConfigClient();

        let configClient = await this.db.readData('configClient');

        // Idioma antes de tudo, para nenhum texto piscar em inglês.
        lang.load(configClient?.launcher_config?.lang || lang.defaultCode);
        lang.apply(document);

        // O token do Discord vai junto de toda requisição: é ele que decide
        // quais modpacks este jogador enxerga e se ele está banido.
        let token = configClient?.discord?.token || null;
        config.setPlayerToken(token);
        discord.configure(config.getApiUrl(), token);

        // Atualiza o registro do jogador guardado localmente: se a staff deu ou
        // tirou um cargo no Discord, o selo acompanha sem precisar reconectar.
        if (token) {
            let atual = await discord.status();
            if (atual?.player) {
                configClient.discord.player = atual.player;
                await this.db.updateData('configClient', configClient);
            }
        }

        this.config = await config.GetConfig().then(res => res).catch(err => err);

        if (await this.config.error) {
            // Banimento nao e falha de conexao: o launcher abre normalmente e
            // mostra o motivo por dentro, com o botao de jogar desativado.
            if (this.config.error.banned) {
                this.config = {
                    dataDirectory: 'Atena',
                    online: false,
                    banned: { message: this.config.error.message }
                };
            } else {
                return this.errorConnect()
            }
        }

        this.createPanels(Login, Home, Settings, Modpack, Ajustes, Estatisticas);
        this.startLauncher();
    }

    initLog() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
                ipcRenderer.send('main-window-dev-tools-close');
                ipcRenderer.send('main-window-dev-tools');
            }
        })
        new logger(pkg.name, '#7289da')
    }

    /**
     * Liga o registro de erros antes de qualquer outra coisa.
     *
     * Sem isto, um erro dentro de um `await` sem try/catch some sem deixar
     * rastro: o launcher para de reagir e ninguém consegue dizer por quê.
     * Agora vai para %appdata%/.Atena/launcher.log e aparece na tela.
     */
    async initErrorLog() {
        try {
            let base = `${await appdata()}/${process.platform == 'darwin' ? 'Atena' : '.Atena'}`;
            registro.iniciar(base, (contexto, mensagem) => {
                new popup().openPopup({
                    title: lang.t('error.unexpected_title'),
                    content: `${lang.t('error.unexpected_text')}<br><br><code>${contexto}: ${String(mensagem).slice(0, 300)}</code>`,
                    color: 'red',
                    options: true
                });
            });
        } catch (err) {
            console.error('não consegui iniciar o registro de erros:', err);
        }
    }

    shortcut() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.keyCode == 87) {
                ipcRenderer.send('main-window-close');
            }
        })
    }


    errorConnect() {
        let banned = this.config.error.banned;

        new popup().openPopup({
            title: banned ? lang.t('discord.banned_title') : this.config.error.code,
            content: banned
                ? `${lang.t('discord.banned_text')}${this.config.error.message ? '<br><br>' + this.config.error.message : ''}`
                : this.config.error.message,
            color: 'red',
            exit: true,
            options: true
        });
    }

    initFrame() {
        console.log('Initializing Frame...')
        const platform = os.platform() === 'darwin' ? "darwin" : "other";

        document.querySelector(`.${platform} .frame`).classList.toggle('hide')

        document.querySelector(`.${platform} .frame #minimize`).addEventListener('click', () => {
            ipcRenderer.send('main-window-minimize');
        });

        let maximized = false;
        let maximize = document.querySelector(`.${platform} .frame #maximize`);
        maximize.addEventListener('click', () => {
            if (maximized) ipcRenderer.send('main-window-maximize')
            else ipcRenderer.send('main-window-maximize');
            maximized = !maximized
            maximize.classList.toggle('icon-maximize')
            maximize.classList.toggle('icon-restore-down')
        });

        document.querySelector(`.${platform} .frame #close`).addEventListener('click', () => {
            ipcRenderer.send('main-window-close');
        })
    }

    async initConfigClient() {
        console.log('Initializing Config Client...')
        let configClient = await this.db.readData('configClient')

        if (configClient) await this.migrarDownloads(configClient)

        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                instance_select: null,
                discord: { token: null, player: null },
                java_config: {
                    java_path: null,
                    java_memory: {
                        min: 4,
                        max: 8
                    }
                },
                game_config: {
                    screen_size: {
                        width: 854,
                        height: 480
                    }
                },
                launcher_config: {
                    download_multi: 16,
                    lang: lang.defaultCode,
                    protected: [],
                    theme: 'auto',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true
                }
            })
        }
    }

    /**
     * Quem instalou o launcher antes de hoje tem download_multi = 5 guardado —
     * o padrão antigo, que ninguém escolheu. Com o servidor falando HTTP/2, 5
     * deixa metade da velocidade na mesa.
     *
     * Corrigido uma vez só, e anotado: se a pessoa depois escolher 5 de
     * propósito, a escolha dela fica de pé.
     */
    async migrarDownloads(configClient) {
        if (configClient.launcher_config?.downloads_migrados) return
        if (!configClient.launcher_config) return

        if (Number(configClient.launcher_config.download_multi) === 5) {
            configClient.launcher_config.download_multi = 16
        }
        configClient.launcher_config.downloads_migrados = true
        await this.db.updateData('configClient', configClient)
    }

    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels')
        for (let panel of panels) {
            console.log(`Initializing ${panel.name} Panel...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id)
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            lang.apply(div);
            panelsElem.appendChild(div);
            new panel().init(this.config);
        }
    }

    async startLauncher() {
        if (this.config.banned) return changePanel('home');

        if (this.config.discord?.required && !this.config.discord?.linked) {
            return changePanel('login');
        }

        let accounts = await this.db.readAllData('accounts')
        let configClient = await this.db.readData('configClient')
        let account_selected = configClient ? configClient.account_selected : null
        let popupRefresh = new popup();

        if (accounts?.length) {
            for (let account of accounts) {
                let account_ID = account.ID

                // Conta salva quebrada: o que sobrou de um login que falhou.
                //
                // Era apagada aqui, mas este era o ÚNICO caminho de exclusão que
                // não limpava `account_selected` — todos os outros limpam. A
                // seleção ficava apontando para um ID que não existe mais, a
                // escolha de uma conta substituta abaixo não disparava (a
                // seleção não estava vazia, só errada), e na hora de jogar o
                // minecraft-java-core recebia `undefined` e respondia
                // "Authenticator not found".
                //
                // Sem `meta` também é quebrada: `account.meta.type` logo abaixo
                // derrubaria a inicialização inteira.
                if (account.error || !account.name || !account.uuid || !account.meta) {
                    console.error(`[Account] conta ${account_ID} salva sem identidade; removida`);
                    await this.db.deleteData('accounts', account_ID)
                    if (account_ID == account_selected) {
                        configClient.account_selected = null
                        await this.db.updateData('configClient', configClient)
                    }
                    continue
                }
                if (account.meta.type === 'Xbox') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: lang.t('login.signing_in'),
                        content: lang.t('login.restoring', { name: account.name }),
                        color: 'var(--color)',
                        background: false
                    });

                    let refresh_accounts = await new Microsoft(this.config.client_id).refresh(account);

                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    await this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'AZauth') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: lang.t('login.signing_in'),
                        content: lang.t('login.restoring', { name: account.name }),
                        color: 'var(--color)',
                        background: false
                    });
                    let refresh_accounts = await new AZauth(this.config.online).verify(account);

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.message}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'Mojang') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: lang.t('login.signing_in'),
                        content: lang.t('login.restoring', { name: account.name }),
                        color: 'var(--color)',
                        background: false
                    });
                    if (account.meta.online == false) {
                        let refresh_accounts = await Mojang.login(account.name);

                        refresh_accounts.ID = account_ID
                        await addAccount(refresh_accounts)
                        this.db.updateData('accounts', refresh_accounts, account_ID)
                        if (account_ID == account_selected) accountSelect(refresh_accounts)
                        continue;
                    }

                    let refresh_accounts = await Mojang.refresh(account);

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else {
                    console.error(`[Account] ${account.name}: Account Type Not Found`);
                    this.db.deleteData('accounts', account_ID)
                    if (account_ID == account_selected) {
                        configClient.account_selected = null
                        this.db.updateData('configClient', configClient)
                    }
                }
            }

            accounts = await this.db.readAllData('accounts')
            configClient = await this.db.readData('configClient')
            account_selected = configClient ? configClient.account_selected : null

            // Sem conta nenhuma: volta ao login.
            //
            // Vinha DEPOIS da escolha de substituta, que fazia `accounts[0].ID`
            // e derrubava a inicialização justamente quando a lista estava
            // vazia. E gravava `config` — o módulo de configuração importado lá
            // em cima — no lugar de `configClient`, apagando as preferências da
            // pessoa (RAM, idioma, tudo) com um objeto sem sentido.
            if (!accounts.length) {
                configClient.account_selected = null
                await this.db.updateData('configClient', configClient);
                popupRefresh.closePopup()
                return changePanel("login");
            }

            // A seleção precisa apontar para uma conta que EXISTE. Vazia não é o
            // único caso ruim: um ID de conta apagada é pior, porque parece
            // válido até a hora de jogar.
            let selecionada = accounts.find(a => a.ID == account_selected)
            if (!selecionada) {
                selecionada = accounts[0]
                configClient.account_selected = selecionada.ID
                await this.db.updateData('configClient', configClient)
                // accountSelect espera a conta inteira, não o ID: com o ID ele
                // procurava `document.getElementById(undefined)` e quebrava.
                await accountSelect(selecionada)
            }

            popupRefresh.closePopup()
            changePanel("home");
        } else {
            popupRefresh.closePopup()
            changePanel('login');
        }
    }
}

new Launcher().init();
