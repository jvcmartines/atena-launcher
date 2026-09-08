# Atena Launcher

Launcher do servidor **Atena** (Minecraft Forge 1.20.1), com painel web para a staff
publicar novas versões do modpack sem precisar mexer em arquivo nenhum no servidor.

Fork do [Selvania-Launcher](https://github.com/luuxis/Selvania-Launcher) do Luuxis.

---

## O que tem aqui

O projeto são **duas partes**:

| Pasta | O que é | Onde roda |
|---|---|---|
| `src/` | O launcher em si (Electron). É o programa que o jogador instala. | PC do jogador |
| `server/` | API + painel de administração. | Sua VPS |

E o fluxo do dia a dia é este:

```
   STAFF                        SUA VPS                        JOGADOR
     |                             |                              |
     |  1. sobe o .zip do modpack  |                              |
     |---------------------------->|                              |
     |                             |                              |
     |  2. clica em "Publicar"     |                              |
     |---------------------------->|                              |
     |                        gera a lista de                     |
     |                        arquivos + SHA-1                    |
     |                             |                              |
     |                             |   3. abre o launcher         |
     |                             |<-----------------------------|
     |                             |                              |
     |                             |   baixa SÓ o que mudou       |
     |                             |----------------------------->|
     |                             |                              |
     |                             |   4. clica em Jogar          |
```

O ponto principal: o launcher compara o **SHA-1** de cada arquivo do PC do jogador com
o da lista publicada. Se você trocar um mod de 2 MB num modpack de 3 GB, o jogador
baixa 2 MB — não 3 GB.

---

## Parte 1 — Subir o servidor na VPS

Assumindo Ubuntu/Debian. Ajuste se a sua VPS for outra coisa.

### 1.1 Instalar o Node

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
node -v
```

### 1.2 Baixar o projeto

```bash
sudo mkdir -p /opt/atena-launcher
sudo chown $USER:$USER /opt/atena-launcher
git clone https://github.com/SEU-USUARIO/atena-launcher.git /opt/atena-launcher
cd /opt/atena-launcher/server
npm install --omit=dev
```

### 1.3 Configurar

```bash
cp .env.example .env
nano .env
```

O que **precisa** ser preenchido:

```ini
ATENA_PUBLIC_URL=https://launcher.seudominio.com.br
ATENA_SESSION_SECRET=<cole aqui uma chave longa e aleatória>
ATENA_SECURE_COOKIES=true
ATENA_TRUST_PROXY=true
```

Gere o segredo com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> **`ATENA_PUBLIC_URL` é o campo mais importante do arquivo.** Ele entra nos links de
> download que o launcher recebe. Se estiver errado (ou apontando para `localhost`),
> os jogadores não conseguem baixar o modpack.

### 1.4 Rodar como serviço

```bash
sudo useradd -r -s /bin/false atena
sudo chown -R atena:atena /opt/atena-launcher

sudo cp deploy/atena-launcher.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now atena-launcher
sudo systemctl status atena-launcher
```

Para ver os logs ao vivo: `journalctl -u atena-launcher -f`

### 1.5 nginx + HTTPS

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/atena-launcher
sudo nano /etc/nginx/sites-available/atena-launcher     # troque o server_name
sudo ln -s /etc/nginx/sites-available/atena-launcher /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d launcher.seudominio.com.br
```

Repare no `client_max_body_size 8G` do arquivo do nginx: sem isso, o upload do modpack
morre no meio com erro 413.

### 1.6 Primeiro acesso

Abra `https://launcher.seudominio.com.br/admin`. Na primeira vez a tela pede para você
**criar a conta de administrador** — essa tela fecha sozinha depois disso.

Se um dia ninguém conseguir mais entrar:

```bash
cd /opt/atena-launcher/server
sudo -u atena npm run criar-usuario
```

---

## Parte 2 — Configurar o launcher

### 2.1 Apontar para a sua VPS

No `package.json` da **raiz** do projeto:

```json
{
    "url": "https://launcher.seudominio.com.br/api",
    "repository": {
        "url": "git+https://github.com/SEU-USUARIO/atena-launcher.git"
    }
}
```

- **`url`** — onde o launcher busca configuração, notícias e modpacks.
- **`repository.url`** — de onde o launcher baixa as próprias atualizações. Obrigatório.

### 2.2 Rodar em modo de desenvolvimento

```bash
npm install
npm run dev
```

Para testar contra um servidor local sem alterar o `package.json`:

```bash
ATENA_API=http://localhost:3000/api npm start
```

---

## Parte 3 — Publicar uma versão do modpack

Este é o fluxo que a staff vai repetir toda semana.

### 3.1 Criar o modpack (só na primeira vez)

No painel → **Modpacks** → **Novo modpack** → nome `Atena`.

Vá na aba **Configurações** e confira:

| Campo | Valor |
|---|---|
| Versão do Minecraft | `1.20.1` |
| Loader | `forge` |
| Versão do loader | `1.20.1-47.3.0` (a mesma do seu servidor) |
| IP / Porta | o IP do servidor de jogo |

> Prefira **fixar** a versão do Forge em vez de deixar `latest`. Assim todo mundo roda
> exatamente o mesmo Forge que o servidor, e uma atualização do Forge não quebra o
> modpack de surpresa.

### 3.2 Montar o .zip

Pegue a pasta `.minecraft` do cliente que você já testou e zipe **o conteúdo do
modpack**:

```
mods/
config/
kubejs/
defaultconfigs/
resourcepacks/
```

**Não coloque** no zip: `saves/`, `logs/`, `screenshots/`, `options.txt`,
`usercache.json`, `crash-reports/`. Isso é do jogador — e já está na lista de ignorados
da instância.

### 3.3 Subir e publicar

1. Painel → **Modpacks** → clique no Atena → aba **Arquivos**
2. **Enviar .zip**
   - se o zip tem uma pasta `.minecraft/` envolvendo tudo, escolha **"1 — o zip tem uma
     pasta envolvendo tudo"**
   - marque **"Apagar tudo antes de extrair"** quando o zip é o modpack completo
     (é o caso normal)
3. Aba **Publicar** → escreva o que mudou → **Publicar atualização**

Pronto. O próximo jogador que abrir o launcher já baixa a atualização.

> Enquanto você não clicar em **Publicar**, nada muda para os jogadores. Dá para subir
> arquivos com calma, conferir e só depois liberar. O painel avisa com um selo laranja
> quando há mudanças não publicadas.

### 3.4 Ajustes pequenos

Para trocar um mod só, não precisa refazer o zip: navegue até `mods/`, apague o antigo,
use **Enviar arquivos** para mandar o novo, e publique.

---

## Parte 4 — Gerar o instalador

### Na sua máquina

```bash
npm install
npm run build:local
```

Isso gera **`dist/win-unpacked/Atena Launcher.exe`** — o launcher pronto,
que abre com um duplo clique. Não precisa instalar nada: dá para zipar a pasta
`win-unpacked` inteira e mandar para alguém testar.

> `build:local` compila sem ofuscar o código e sem publicar no GitHub. É o que
> você quer para testar rapidinho.

#### E o instalador (.exe único)?

Para gerar o instalador NSIS o electron-builder precisa criar links simbólicos
no cache dele, e o Windows bloqueia isso para usuários comuns. Você vai ver
`Cannot create symbolic link` no meio do build — a pasta `win-unpacked` sai
certinha mesmo assim, só o instalador não.

Duas saídas:

- **Deixe o GitHub Actions fazer** (recomendado). É o fluxo abaixo, e é de onde
  os jogadores baixam de qualquer jeito.
- **Ative o Modo de Desenvolvedor do Windows** se quiser gerar localmente:
  Configurações → Sistema → Para desenvolvedores → *Modo de desenvolvedor*.
  Depois rode `npm run build` de novo e o instalador aparece em `dist/`.

### Para os jogadores (automático)

O launcher se auto-atualiza pelas **releases do GitHub**. O workflow em
`.github/workflows/build.yml` faz tudo:

1. Suba a `version` no `package.json` (ex.: `1.0.0` → `1.0.1`).
   **Precisa ser maior que a da última release**, senão a auto-atualização não dispara.
2. `git commit` e `git push` para a branch `master`.
3. O GitHub Actions compila para Windows, macOS e Linux e anexa os instaladores
   à release.
4. Mande o link da release para os jogadores.

Da segunda versão em diante ninguém precisa baixar nada de novo: o launcher
detecta a atualização sozinho ao abrir.

### Só quer mexer no código?

```bash
npm run dev
```

Abre o launcher direto do código-fonte, sem compilar nada.

---

## A cara do launcher

A interface foi refeita do zero em cima da identidade do Atena: dourado da logo sobre
roxo-vinho e vidro fosco, tudo em Poppins.

A tela inicial é enxuta de propósito: logo, se o servidor está no ar, quantas pessoas
estão jogando, o IP com botão de copiar, e o botão de jogar. Nada além disso — quem
quiser novidades vai ao site ou ao Discord, que estão no rodapé.

A tela de abertura também é simples: só a logo e o que está acontecendo
("Looking for updates...").

### O que já está instalado

| Arquivo | O que é |
|---|---|
| `src/assets/images/atena-logo.png` | A logo "ATENA LAUNCHER" |
| `src/assets/images/icon/icon.png` | Ícone do aplicativo |
| `src/assets/images/icon/icon-quadrado.png` | Variante alternativa (só o "A") |
| `src/assets/images/background/dark/` | Prints usados de plano de fundo |

### Trocar o ícone

O ícone atual é a logo inteira. Ela fica bonita grande, mas vira um borrão nos 16×16 da
barra de tarefas. Se quiser um ícone mais legível, use a variante quadrada (só o "A" com
a carinha de creeper):

```bash
cp src/assets/images/icon/icon-quadrado.png src/assets/images/icon/icon.png && npm run icon
```

`npm run icon` sempre regenera o `.ico` (Windows) e o `.icns` (macOS) a partir do
`icon.png`.

### Papéis de parede

O launcher sorteia uma imagem a cada abertura:

- `src/assets/images/background/dark/` — tema escuro
- `src/assets/images/background/light/` — tema claro

Basta jogar novos `.jpg`/`.png` nessas pastas. Reduza para 1920px de largura antes:
imagens de 3 MB atrasam a abertura sem ganho visual.

### Cores

Tudo sai de variáveis em `src/assets/css/theme.css` — o dourado, o vinho, os raios de
borda. Mudar `--gold` e `--wine-700` já muda o launcher inteiro.

### Links das redes sociais

`src/panels/home.html`, no bloco `social-list`. Os `data-url` já apontam para o
atenasmp.com; falta preencher o convite do Discord, o TikTok e o YouTube.

### Frase abaixo da logo

Vem do painel: **Modpacks → Configurações → Frase abaixo da logo**. Ela é a mesma coisa
que o campo "nome do servidor" na API.

### Textos

Tudo em português em `src/panels/*.html` e `src/assets/js/panels/*.js`.
As frases da tela de carregamento ficam em `src/assets/js/index.js`.

---

## Como o jogador instala e atualiza

O botão principal muda de nome sozinho, conforme o que a máquina do jogador
precisa:

| Botão | Quando aparece |
|---|---|
| **Instalar** | O modpack ainda não está nesse computador |
| **Atualizar** | Está instalado, mas você publicou uma versão mais nova |
| **Jogar** | Está igual ao que você publicou |

Em todos os casos é o mesmo clique: o launcher baixa o que falta, mostra o
progresso e abre o jogo no fim. O jogador não escolhe entre instalar e
atualizar — o launcher já sabe qual é o caso.

Como ele sabe: depois de cada sincronização o launcher grava
`.atena-version.json` dentro da pasta do modpack, com a versão que ficou
instalada ali. Na próxima abertura ele compara esse número com o de
`/api/instances/:id/version`.

### O menu do modpack

A engrenagem ao lado do botão abre as opções:

- **Trocar de modpack** — só aparece se você tiver mais de um publicado.
- **Reinstalar o modpack** — apaga os mods e os configs e baixa tudo de novo.
  Mundos, prints, teclas e as pastas protegidas **não** são apagados. É o que
  resolve quando a instalação corrompe.
- **Abrir a pasta do jogo** — para o jogador achar os mundos e os prints.

Antes de reinstalar o launcher tira um backup, então nada se perde de vez.

### Pastas que o jogador quer manter

Em **Configurações → Launcher → Pastas que o launcher não pode mexer** o
jogador lista o que deve ficar em paz. Uma pasta por linha, e subpastas valem:
`config/create` protege só aquela, não o `config` inteiro.

Na prática essas pastas entram na lista de ignorados na hora de sincronizar, o
que significa que elas param de ser apagadas **e** de ser sobrescritas. O preço
está escrito na tela: uma pasta protegida deixa de receber as suas atualizações.

> Detalhe de implementação que vale saber: a `minecraft-java-core` compara a
> lista de ignorados com o caminho exato de cada arquivo. Uma entrada
> `config` sozinha evitaria a exclusão da pasta, mas não impediria os
> arquivos de dentro de serem sobrescritos. Por isso o launcher expande as
> pastas escolhidas em caminhos de arquivo usando o manifesto publicado.

---

## Verificação por Discord

Desligada por padrão — sem configurar nada, o launcher funciona como sempre.
Ligando, o jogador conecta a conta do Discord dentro do launcher e você ganha
três coisas: liberar modpacks por cargo, banir alguém do launcher, e saber qual
nick de Minecraft pertence a qual pessoa do Discord.

### Como configurar

1. Vá ao [portal de desenvolvedores do Discord](https://discord.com/developers/applications)
   e crie uma aplicação.
2. Em **OAuth2**, copie o **Client ID** e gere um **Client Secret**.
3. Ainda em OAuth2, adicione a URL de redirecionamento que o painel mostra em
   **Launcher → Verificação por Discord** — precisa ser idêntica, incluindo o
   `https://`.
4. No painel, cole o Client ID e o Secret, ligue a verificação e salve.
5. Para liberar por cargo, preencha também o **ID do seu servidor do Discord**.
   Sem ele o launcher só consegue saber quem a pessoa é, não os cargos dela.

O **Client Secret nunca sai do servidor**: ele não vai para o launcher e o
painel nunca o recebe de volta — só um aviso de que já está preenchido. Editar
as outras opções sem redigitar o segredo não o apaga.

### Como funciona por baixo

O launcher abre a tela oficial do Discord numa janela. Quando a pessoa aprova,
o Discord redireciona para o seu servidor, que troca o código pelo token,
lê o perfil e os cargos, e devolve ao launcher um **token assinado por você**.
Esse token é o que o launcher guarda e manda em cada requisição no cabeçalho
`x-atena-player`.

Nada de senha do Discord passa pelo launcher.

### Liberar um modpack para pessoas específicas

Em **Modpacks → Configurações → Quem pode ver este modpack**:

| Modo | Quem enxerga |
|---|---|
| Todo mundo | Qualquer um, com ou sem Discord |
| Quem conectou o Discord | Só quem verificou |
| Cargo específico | Só quem tem um dos cargos que você listar |
| Jogadores escolhidos | Só quem estiver na lista, por nome de usuário ou ID |

É assim que se faz um pack de testes só para a staff: crie a instância, ponha o
modo em **Cargo específico** e cole o ID do cargo de staff.

> Esse filtro roda **no servidor**. Um modpack que a pessoa não pode ver não
> aparece na lista dela e o manifesto responde 404 — os arquivos também não
> ficam acessíveis. É diferente da whitelist por nick, que é só um filtro
> dentro do launcher e serve para organizar, não para proteger.

Para pegar um ID de cargo: no Discord, ative o Modo Desenvolvedor
(Configurações → Avançado), clique com o botão direito no cargo e escolha
"Copiar ID do cargo".

### Banir alguém do launcher

Na aba **Jogadores** você vê todo mundo que conectou o Discord: nome, avatar,
os nicks de Minecraft que já usou, se está no seu servidor do Discord e quando
apareceu por último.

O botão **Banir** pede um motivo, e é esse texto que a pessoa vê quando tentar
abrir o launcher. Ela para de conseguir entrar imediatamente — a checagem
acontece no servidor, então não adianta mexer no launcher dela.

> Banir aqui bloqueia **o launcher**, não o servidor de Minecraft. Para o
> jogo, use o ban do próprio Minecraft.

**Apagar** desconecta o Discord da pessoa: o token que o launcher dela guarda
deixa de valer e ela precisa conectar de novo. O banimento some junto, então
não use "apagar" para punir alguém.

### Tornar obrigatório

Marcando **Obrigatória**, o jogador não passa da tela de login sem conectar o
Discord — nem chega a escolher a conta de Minecraft.

---

## Idiomas

O launcher abre em **inglês** por padrão. O jogador troca em
**Configurações → Launcher → Idioma**, e a escolha fica salva na máquina dele.

Vêm três idiomas prontos: inglês, português (BR) e espanhol.

### Adicionar um idioma

1. Copie `src/assets/lang/en.json` para, por exemplo, `fr.json`
2. Traduza só os **valores** (o que está à direita dos dois-pontos). As chaves à
   esquerda não mudam.
3. Registre o arquivo em `src/assets/js/utils/lang.js`, na lista `AVAILABLE`:

```js
const AVAILABLE = [
    { code: 'en', label: 'English' },
    { code: 'pt-BR', label: 'Português (BR)' },
    { code: 'es', label: 'Español' },
    { code: 'fr', label: 'Français' }
];
```

Se você esquecer de traduzir alguma frase, ela aparece em inglês em vez de
quebrar. Para mudar o idioma padrão, troque `DEFAULT_LANG` no mesmo arquivo.

---

## Backups

Antes de cada atualização, o launcher copia as pastas configuradas para
`backups/` dentro da pasta do jogo do jogador, guardando as **5 cópias mais
recentes** e apagando as antigas sozinho.

Isso existe porque o modo estrito apaga do PC do jogador tudo que não está no
modpack publicado. A lista de ignorados já protege as coisas óbvias (mundos,
prints, teclas) — o backup é a rede de segurança para o que você esqueceu de
colocar lá.

Configure em **Modpacks → Configurações → Backup antes de atualizar**. O padrão
é `emojis` e `config`.

O jogador vê onde os backups estão, quanto ocupam, e tem um botão para abrir a
pasta em **Configurações → Launcher → Backups**.

> Não precisa repetir aqui o que já está na lista de ignorados: aquilo nunca é
> apagado, então não corre risco.

---

## Detalhes que importam

### Login com conta Microsoft

Está configurado assim por padrão. Duas consequências:

- Seu servidor de jogo **precisa** estar com `online-mode=true` no `server.properties`.
- Só entra quem tem Minecraft original.

Não é preciso registrar nada no Azure: o launcher usa um `client_id` público que já vem
na biblioteca. O campo no painel só existe se você quiser a tela de login com a sua marca.

Para mudar de ideia depois, é no painel → **Launcher** → **Login dos jogadores**.

### Modo estrito (`verify`)

Ligado por padrão. O launcher apaga do PC do jogador qualquer arquivo que não esteja no
modpack publicado — é o que impede mod extra e mantém todo mundo igual ao servidor.

A lista **"Não mexer nestes arquivos e pastas"** (aba Configurações da instância) é o
que protege as coisas do jogador: mundos, prints, teclas, waypoints.

Uma decisão que vale pensar: a pasta **`config`** é sincronizada por padrão, ou seja,
os ajustes que você fizer chegam a todo mundo — mas as alterações do jogador são
desfeitas a cada atualização. Se preferir o contrário, adicione `config` à lista de
ignorados.

### RAM

O padrão é **4 GB de mínimo e 8 GB de máximo**, calibrado para os ~300 mods do
Atena. O jogador ajusta em Configurações → Java e RAM, dentro destes limites:

- **6 GB** é o piso para o modpack rodar sem engasgo
- **8 a 10 GB** é a faixa recomendada
- **24 GB** é o teto do slider — acima disso não há ganho

O slider nunca deixa passar de 80% da RAM da máquina, e se o padrão de 8 GB não
couber (um PC de 8 GB, por exemplo) ele recua sozinho para o maior valor que
cabe. Para mudar esses números, procure `sliderMax` em
`src/assets/js/panels/settings.js`.

### Java

O launcher baixa sozinho o Java 17 certo para o Forge 1.20.1. O jogador não precisa
instalar nada.

### Manutenção

Painel → **Launcher** → marque **Bloquear o launcher**. Ninguém consegue entrar
enquanto estiver marcado. Útil quando você está no meio de uma troca grande de versão.

### Cargos da staff

- **admin** — tudo, incluindo criar contas e apagar modpacks.
- **staff** — sobe arquivos, publica versões e escreve notícias.

Todas as ações ficam registradas no **Histórico**.

---

## Solução de problemas

| Sintoma | Causa provável |
|---|---|
| "Não foi possível falar com o servidor do Atena" | A `url` do `package.json` está errada, o serviço caiu (`systemctl status atena-launcher`) ou o certificado HTTPS venceu. |
| O jogador baixa tudo de novo toda vez | `ATENA_PUBLIC_URL` está errada, então o SHA-1 nunca confere. Confira em `https://.../api/instances/atena/files` se as URLs abrem no navegador. |
| Erro 413 ao subir o zip | `client_max_body_size` do nginx menor que o zip. |
| O upload morre no meio | Timeouts do nginx. Os valores no `nginx.conf.example` já cobrem uploads longos. |
| Os mods não chegam ao jogador | Você subiu mas não clicou em **Publicar**. |
| O jogo abre sem os mods | A pasta do zip estava errada. Confira no painel se `mods/` está na **raiz** da instância, e não dentro de `.minecraft/mods/`. |
| Não consigo entrar no painel | `npm run criar-usuario` na VPS reseta a senha. |
| "Já existe um servidor do Atena rodando" | Você tentou subir um segundo processo sobre a mesma pasta de dados. Isso apagaria dados, então o servidor se recusa a iniciar. Pare o outro (`sudo systemctl stop atena-launcher`) antes. |
| O IP não copia ao clicar | Só acontece em ambiente sem área de transferência. O IP continua visível para digitar à mão. |
| `Cannot create symbolic link` no build | É o instalador NSIS pedindo permissão que o Windows não dá. A pasta `dist/win-unpacked` sai certa mesmo assim. Veja a Parte 4. |
| O launcher abre em inglês | É o padrão. O jogador troca em Configurações → Launcher → Idioma. |

Para ver o que está chegando no servidor, ligue `ATENA_LOG_REQUESTS=true` no `.env` e
reinicie o serviço.

---

## API pública

Se você quiser mostrar informações no site do servidor:

As notícias escritas no painel **não** aparecem no launcher — a tela inicial é enxuta de
propósito. Elas ficam disponíveis em `/api/articles` para o site do Atena consumir.

| Rota | O que devolve |
|---|---|
| `GET /api/config` | Configuração do launcher |
| `GET /api/articles` | Notícias |
| `GET /api/instances` | Modpacks disponíveis |
| `GET /api/instances/:id/files` | Lista de arquivos com SHA-1 |
| `GET /api/instances/:id/version` | Versão publicada e changelog |

Todas liberadas por CORS.

---

## Licença e créditos

Baseado no [Selvania-Launcher](https://github.com/luuxis/Selvania-Launcher) de
**Luuxis**, sob a **Luuxis License v1.0** (`LICENSE.md`).

Três condições da licença que valem destacar, porque afetam o que você pode fazer com
este fork:

1. **O código-fonte precisa continuar público e acessível.** Mantenha este repositório
   público.
2. **O nome do autor original (Luuxis) precisa ser mencionado.** Já está nos cabeçalhos
   dos arquivos e aqui.
3. **Vender o código é proibido.** Monetizar o servidor com microtransações no jogo é
   permitido.

A documentação original do projeto (em francês e inglês) está em `docs/`. Ela descreve
o backend antigo, em PHP, que **não** é o que este fork usa — vale só como referência
histórica.
