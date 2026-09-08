/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */
const { AZauth, Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

import { popup, database, changePanel, accountSelect, addAccount, config, setStatus, lang, discord } from '../utils.js';

class Login {
    static id = "login";
    async init(config) {
        this.config = config;
        this.db = new database();

        // Com a verificação obrigatória e o Discord ainda não conectado, esta é
        // a única tela que aparece — nem dá para escolher a conta antes.
        if (this.config.discord?.required && !this.config.discord?.linked) {
            return this.getDiscord();
        }

        if (typeof this.config.online == 'boolean') {
            this.config.online ? this.getMicrosoft() : this.getCrack()
        } else if (typeof this.config.online == 'string') {
            if (this.config.online.match(/^(http|https):\/\/[^ "]+$/)) {
                this.getAZauth();
            }
        }
        
        document.querySelector('.cancel-home').addEventListener('click', () => {
            document.querySelector('.cancel-home').style.display = 'none'
            changePanel('settings')
        })
    }

    /**
     * Tela de conexão com o Discord. Depois de conectar, recarregamos a janela:
     * o servidor passa a responder com os modpacks liberados para esta pessoa,
     * e o launcher segue o fluxo normal de login.
     */
    async getDiscord() {
        console.log('Initializing Discord verification...');

        let tab = document.querySelector('.login-discord');
        let button = document.querySelector('.connect-discord');
        let status = document.querySelector('.discord-status');
        tab.style.display = 'block';

        button.addEventListener('click', async () => {
            button.disabled = true;
            status.className = 'discord-status working';
            status.textContent = lang.t('discord.waiting');

            let result = await discord.link();

            if (result.error) {
                button.disabled = false;
                status.className = 'discord-status error';
                status.textContent = result.detail
                    ? `${lang.t(result.error)} — ${result.detail}`
                    : lang.t(result.error);
                return;
            }

            let configClient = await this.db.readData('configClient');
            configClient.discord = { token: result.token, player: result.player };
            await this.db.updateData('configClient', configClient);

            status.className = 'discord-status';
            status.textContent = lang.t('discord.linked_as', { name: result.player.globalName });

            setTimeout(() => require('electron').ipcRenderer.send('main-window-reload'), 900);
        });
    }

    async getMicrosoft() {
        console.log('Initializing Microsoft login...');
        let popupLogin = new popup();
        let loginHome = document.querySelector('.login-home');
        let microsoftBtn = document.querySelector('.connect-home');
        loginHome.style.display = 'block';

        microsoftBtn.addEventListener("click", () => {
            popupLogin.openPopup({
                title: lang.t('login.signing_in'),
                content: lang.t('common.wait'),
                color: 'var(--color)'
            });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id).then(async account_connect => {
                if (account_connect == 'cancel' || !account_connect) {
                    popupLogin.closePopup();
                    return;
                } else {
                    await this.saveData(account_connect)
                    popupLogin.closePopup();
                }

            }).catch(err => {
                popupLogin.openPopup({
                    title: lang.t('common.error'),
                    content: err,
                    options: true
                });
            });
        })
    }

    async getCrack() {
        console.log('Initializing offline login...');
        let popupLogin = new popup();
        let loginOffline = document.querySelector('.login-offline');

        let emailOffline = document.querySelector('.email-offline');
        let connectOffline = document.querySelector('.connect-offline');
        loginOffline.style.display = 'block';

        connectOffline.addEventListener('click', async () => {
            if (emailOffline.value.length < 3) {
                popupLogin.openPopup({
                    title: lang.t('common.error'),
                    content: lang.t('login.nick_short'),
                    options: true
                });
                return;
            }

            if (emailOffline.value.match(/ /g)) {
                popupLogin.openPopup({
                    title: lang.t('common.error'),
                    content: lang.t('login.nick_spaces'),
                    options: true
                });
                return;
            }

            let MojangConnect = await Mojang.login(emailOffline.value);

            if (MojangConnect.error) {
                popupLogin.openPopup({
                    title: lang.t('common.error'),
                    content: MojangConnect.message,
                    options: true
                });
                return;
            }
            await this.saveData(MojangConnect)
            popupLogin.closePopup();
        });
    }

    async getAZauth() {
        console.log('Initializing AZauth login...');
        let AZauthClient = new AZauth(this.config.online);
        let PopupLogin = new popup();
        let loginAZauth = document.querySelector('.login-AZauth');
        let loginAZauthA2F = document.querySelector('.login-AZauth-A2F');

        let AZauthEmail = document.querySelector('.email-AZauth');
        let AZauthPassword = document.querySelector('.password-AZauth');
        let AZauthA2F = document.querySelector('.A2F-AZauth');
        let connectAZauthA2F = document.querySelector('.connect-AZauth-A2F');
        let AZauthConnectBTN = document.querySelector('.connect-AZauth');
        let AZauthCancelA2F = document.querySelector('.cancel-AZauth-A2F');

        loginAZauth.style.display = 'block';

        AZauthConnectBTN.addEventListener('click', async () => {
            PopupLogin.openPopup({
                title: lang.t('login.connecting'),
                content: lang.t('common.wait'),
                color: 'var(--color)'
            });

            if (AZauthEmail.value == '' || AZauthPassword.value == '') {
                PopupLogin.openPopup({
                    title: lang.t('common.error'),
                    content: lang.t('login.fill_fields'),
                    options: true
                });
                return;
            }

            let AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value);

            if (AZauthConnect.error) {
                PopupLogin.openPopup({
                    title: lang.t('common.error'),
                    content: AZauthConnect.message,
                    options: true
                });
                return;
            } else if (AZauthConnect.A2F) {
                loginAZauthA2F.style.display = 'block';
                loginAZauth.style.display = 'none';
                PopupLogin.closePopup();

                AZauthCancelA2F.addEventListener('click', () => {
                    loginAZauthA2F.style.display = 'none';
                    loginAZauth.style.display = 'block';
                });

                connectAZauthA2F.addEventListener('click', async () => {
                    PopupLogin.openPopup({
                        title: lang.t('login.connecting'),
                        content: lang.t('common.wait'),
                        color: 'var(--color)'
                    });

                    if (AZauthA2F.value == '') {
                        PopupLogin.openPopup({
                            title: lang.t('common.error'),
                            content: lang.t('login.enter_2fa'),
                            options: true
                        });
                        return;
                    }

                    AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value, AZauthA2F.value);

                    if (AZauthConnect.error) {
                        PopupLogin.openPopup({
                            title: lang.t('common.error'),
                            content: AZauthConnect.message,
                            options: true
                        });
                        return;
                    }

                    await this.saveData(AZauthConnect)
                    PopupLogin.closePopup();
                });
            } else if (!AZauthConnect.A2F) {
                await this.saveData(AZauthConnect)
                PopupLogin.closePopup();
            }
        });
    }

    async saveData(connectionData) {
        let configClient = await this.db.readData('configClient');
        let account = await this.db.createData('accounts', connectionData)
        let instanceSelect = configClient.instance_select
        let instancesList = await config.getInstanceList()
        configClient.account_selected = account.ID;

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist == account.name)
                if (whitelist !== account.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        configClient.instance_select = newInstanceSelect.name
                        await setStatus(newInstanceSelect.status)
                    }
                }
            }
        }

        await this.db.updateData('configClient', configClient);
        await addAccount(account);
        await accountSelect(account);

        // O servidor guarda o nick para a staff conseguir ligar o Discord da
        // pessoa ao personagem dela no jogo.
        discord.heartbeat(account.name);

        changePanel('home');
    }
}
export default Login;