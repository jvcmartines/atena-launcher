/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */
const { AZauth, Mojang } = require('minecraft-java-core');
const { ipcRenderer, shell, clipboard } = require('electron');

import { popup, database, changePanel, accountSelect, addAccount, config, setStatus, lang, discord, registro } from '../utils.js';

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
        let loginHome = document.querySelector('.login-home');
        loginHome.style.display = 'block';

        document.querySelector('.connect-home').addEventListener('click', () => this.entrarPeloNavegador());
        document.querySelector('.connect-janela')?.addEventListener('click', () => this.entrarPelaJanela());

        document.querySelector('.navegador-cancelar')?.addEventListener('click', () => {
            // A tela volta na hora. O processo principal só percebe o
            // cancelamento no próximo ciclo de consulta (até 5 s), e esperar
            // por ele deixava o botão parecendo travado.
            this.tentativa = (this.tentativa || 0) + 1;
            this.mostrarEspera(false);
            ipcRenderer.invoke('microsoft-navegador-cancelar');
        });
        document.querySelector('.navegador-reabrir')?.addEventListener('click', () => {
            if (this.linkNavegador) shell.openExternal(this.linkNavegador);
        });
        document.querySelector('.navegador-copiar')?.addEventListener('click', () => {
            const codigo = document.querySelector('.navegador-codigo')?.textContent;
            if (!codigo) return;
            // O clipboard do Electron, e não navigator.clipboard: este rejeita
            // quando a janela não está em foco — e a pessoa acabou de voltar
            // do navegador —, e a rejeição virava um popup de erro.
            clipboard.writeText(codigo);
            document.querySelector('.navegador-status').textContent = lang.t('login.browser_copied');
        });
    }

    /** Troca os botões pela tela de espera, e volta. */
    mostrarEspera(ligada) {
        document.querySelector('.login-home .login-options').hidden = ligada;
        document.querySelector('.login-navegador').hidden = !ligada;
        if (!ligada) {
            document.querySelector('.navegador-codigo').textContent = '';
            document.querySelector('.navegador-status').textContent = '';
        }
    }

    /**
     * Entrar pelo navegador do sistema, com código de dispositivo.
     *
     * É o caminho principal porque a janela embutida não tem acesso ao Windows
     * Hello: quem usa PIN, digital ou rosto na conta Microsoft não conseguia
     * entrar por ela. A conversa com a Microsoft fica no processo principal
     * (app.js); aqui só aparece o código e o resultado.
     */
    async entrarPeloNavegador() {
        const status = document.querySelector('.navegador-status');

        // Cada tentativa tem um número. Cancelar e clicar de novo em seguida
        // deixa a resposta da tentativa antiga chegando atrasada — e ela não
        // pode fechar a tela de espera da nova.
        const minha = this.tentativa = (this.tentativa || 0) + 1;

        let inicio;
        try {
            inicio = await ipcRenderer.invoke('microsoft-navegador-iniciar', this.config.client_id);
        } catch (err) {
            inicio = { error: err.message, errorType: 'network' };
        }

        if (minha !== this.tentativa) return;
        if (inicio?.error) return this.falhaDoLogin(inicio);

        this.linkNavegador = inicio.link;
        document.querySelector('.navegador-codigo').textContent = inicio.codigo;
        status.textContent = lang.t('login.browser_opened');
        this.mostrarEspera(true);

        const resultado = await ipcRenderer.invoke('microsoft-navegador-aguardar');
        if (minha !== this.tentativa) return;
        this.mostrarEspera(false);

        if (resultado === 'cancel' || !resultado) return;
        if (resultado.error) return this.falhaDoLogin(resultado);

        let popupLogin = new popup();
        popupLogin.openPopup({ title: lang.t('login.signing_in'), content: lang.t('common.wait'), color: 'var(--color)' });
        if (await this.saveData(resultado)) popupLogin.closePopup();
    }

    /** A janela embutida de antes, mantida como alternativa. */
    entrarPelaJanela() {
        let popupLogin = new popup();
        popupLogin.openPopup({
            title: lang.t('login.signing_in'),
            content: lang.t('common.wait'),
            color: 'var(--color)'
        });

        ipcRenderer.invoke('Microsoft-window', this.config.client_id).then(async account_connect => {
            if (account_connect == 'cancel' || !account_connect) {
                popupLogin.closePopup();
                return;
            }

            // Login que falhou não é conta. O minecraft-java-core não lança
            // exceção quando algo dá errado no caminho Microsoft → Xbox →
            // Minecraft: ele DEVOLVE um objeto `{ error, errorType, ... }`.
            // Esse objeto não é vazio, então passava pela conferência de
            // cima e era salvo como conta — sem nome e sem uuid, que é o
            // cartão "undefined".
            if (account_connect.error) return this.falhaDoLogin(account_connect);

            if (await this.saveData(account_connect)) popupLogin.closePopup();

        }).catch(err => {
            popupLogin.openPopup({
                title: lang.t('common.error'),
                content: err,
                options: true
            });
        });
    }

    /** Registra e mostra por que o login não chegou a uma conta. */
    falhaDoLogin(falha) {
        registro.erro('ao adicionar conta', `${falha.errorType || '?'}: ${falha.error}`)
        new popup().openPopup({
            title: lang.t('login.failed_title'),
            content: this.motivoDoLogin(falha),
            color: 'red',
            options: true
        });
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
            if (await this.saveData(MojangConnect)) popupLogin.closePopup();
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

                    if (await this.saveData(AZauthConnect)) PopupLogin.closePopup();
                });
            } else if (!AZauthConnect.A2F) {
                if (await this.saveData(AZauthConnect)) PopupLogin.closePopup();
            }
        });
    }

    /**
     * O que dizer quando o login da Microsoft não chega a uma conta de
     * Minecraft.
     *
     * Os códigos XErr vêm do Xbox Live e são os únicos casos em que a pessoa
     * consegue resolver sozinha — por isso ganham texto próprio. O resto cai
     * numa mensagem genérica com o código, que é o que o suporte precisa.
     */
    motivoDoLogin(falha) {
        const xerr = String(falha.XErr ?? '')
        if (falha.error === 'NO_MINECRAFT_ACCOUNT' || falha.error === 'NO_MINECRAFT_ENTITLEMENTS') {
            return lang.t('login.failed_no_minecraft')
        }
        if (xerr === '2148916233') return lang.t('login.failed_no_xbox')
        if (xerr === '2148916238') return lang.t('login.failed_child')
        if (xerr === '2148916235') return lang.t('login.failed_region')
        if (falha.errorType === 'network') return lang.t('login.failed_network')
        if (falha.error === 'expired_token') return lang.t('login.failed_expired')
        if (falha.error === 'access_denied' || falha.error === 'authorization_declined') return lang.t('login.failed_declined')
        return lang.t('login.failed_generic', { code: `${falha.errorType || '?'} / ${falha.error}` })
    }

    async saveData(connectionData) {
        // Última barreira, valendo para todo tipo de login. Uma conta sem nome
        // ou sem uuid não autentica nunca — salvá-la só adia o erro para a
        // hora de jogar, e ainda a deixa selecionada.
        //
        // Mostra o erro e devolve false em vez de lançar: os quatro caminhos de
        // login chamam isto de dentro de um ouvinte de clique, onde uma
        // exceção vira rejeição sem tratamento — outro erro que só o log vê.
        if (!connectionData?.name || !connectionData?.uuid || connectionData.error) {
            registro.erro('ao salvar conta', 'login devolveu uma conta sem nome/uuid; nada foi salvo')
            new popup().openPopup({
                title: lang.t('login.failed_title'),
                content: lang.t('login.failed_generic', { code: connectionData?.error || 'sem-identidade' }),
                color: 'red',
                options: true
            });
            return false;
        }

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
        return true;
    }
}
export default Login;