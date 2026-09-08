<div align="center">

<img src="src/assets/images/atena-logo.png" width="360" alt="Atena Launcher">

O launcher oficial do **Atena**, um servidor de Minecraft com modpack próprio.

[![Downloads](https://img.shields.io/github/downloads/jvcmartines/atena-launcher/total?label=downloads&color=e8c26a&style=for-the-badge)](https://github.com/jvcmartines/atena-launcher/releases)
[![Versão](https://img.shields.io/github/v/release/jvcmartines/atena-launcher?label=vers%C3%A3o&color=7c5cff&style=for-the-badge)](https://github.com/jvcmartines/atena-launcher/releases/latest)
[![Plataformas](https://img.shields.io/badge/windows%20%7C%20macos%20%7C%20linux-2b2b2b?style=for-the-badge)](https://github.com/jvcmartines/atena-launcher/releases/latest)
[![Minecraft](https://img.shields.io/badge/forge%201.20.1-3ecf8e?style=for-the-badge)](https://atenasmp.com)
[![Discord](https://img.shields.io/discord/1410636816024998059?label=discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge)](https://discord.gg/92cDk8rZKK)

[Site](https://atenasmp.com) · [Wiki](https://wiki.atenasmp.com) · [Discord](https://discord.gg/92cDk8rZKK)

[![Entrar no Discord do Atena](https://discord.com/api/guilds/1410636816024998059/widget.png?style=banner2)](https://discord.gg/92cDk8rZKK)

</div>

---

## O que é

Um clique para jogar no Atena. O launcher instala o modpack, mantém ele igual ao
do servidor, baixa a versão certa do Java e abre o jogo.

O jogador não precisa ter Java instalado, não precisa saber o que é uma pasta
`mods`, e não precisa baixar zip nenhum a cada atualização.

Do outro lado tem um **painel web** onde a staff publica uma versão nova do
modpack arrastando um `.zip` — sem tocar em arquivo no servidor, sem SSH.

---

## Recursos

### Jogar

- **Instalar, atualizar ou jogar.** O botão se nomeia sozinho conforme o que
  falta na máquina. O jogador não escolhe entre instalar e atualizar — o
  launcher já sabe qual é o caso.
- **Atualização só do que mudou.** Cada arquivo é conferido pelo SHA-1 contra o
  manifesto publicado. Trocar um mod de 2 MB baixa 2 MB, não o pack inteiro.
- **Java automático.** A versão certa é baixada e usada sozinha; nada de
  instalar Java na mão nem descobrir por que a arquitetura está errada.
- **Backup antes de cada atualização.** As pastas do jogador são copiadas para
  `backups/`, mantendo as 5 mais recentes.
- **Pastas protegidas.** O jogador lista o que o launcher não pode sobrescrever
   — inclusive subpastas, como `config/create`.
- **Reinstalar sem perder nada.** Apaga mods e configs e baixa de novo; mundos,
  prints e teclas continuam onde estavam.
- **RAM calibrada para o pack.** Padrão de 4/8 GB, teto de 24 GB, sempre
  deixando 2 GB para o sistema.

### Comunidade

- **Trocar a skin no launcher.** Prévia do boneco, modelo clássico ou fino, e um
  PNG. Fala direto com a Mojang, então a skin muda em todo lugar.
- **Quem está jogando.** Lista de quem está no servidor agora, com a cabeça de
  cada um, direto da tela inicial.
- **Status do servidor.** No ar ou não, ping e vagas ocupadas.
- **IP com um clique** para copiar.
- **Três idiomas:** inglês (padrão), português e espanhol, trocáveis pelo
  jogador.

### Para a staff

- **Publicar por `.zip`.** Arrasta o pack no painel, clica em publicar, e os
  jogadores recebem na próxima abertura.
- **Verificação por Discord.** O jogador conecta a conta e a staff passa a saber
  qual nick de Minecraft é de quem.
- **Modpacks fechados por cargo.** Uma versão de testes que só a staff enxerga —
  o filtro roda no servidor, então não há como contornar.
- **Banir do launcher**, com o motivo aparecendo para a pessoa.
- **Notícias e modo manutenção**, sem reiniciar nada.

---

## Rodando

**Jogadores** baixam o instalador na
[última release](https://github.com/jvcmartines/atena-launcher/releases/latest).

**Para mexer no código:**

```bash
npm install
npm run dev
```

**Para subir o servidor e o painel:**

```bash
cd server
npm install
cp .env.example .env    # ajuste ATENA_PUBLIC_URL
npm start
```

O passo a passo completo — VPS, nginx, HTTPS, publicar o modpack, gerar o
instalador — está no **[manual](docs/MANUAL.md)**.

---

## Como é feito

São duas partes que conversam por HTTP:

| | |
|---|---|
| `src/` | O launcher. Electron + [minecraft-java-core](https://github.com/luuxis/minecraft-java-core). |
| `server/` | A API e o painel. Node + Express, sem banco de dados — os dados vivem em JSON e os arquivos do modpack em disco. |

O servidor publica um **manifesto**: a lista de arquivos do modpack com tamanho
e SHA-1. O launcher compara com o que tem na máquina e baixa a diferença. É esse
manifesto que faz a atualização ser incremental e o modo estrito ser possível.

---

## Licença e créditos

Fork do **[Selvania-Launcher](https://github.com/luuxis/Selvania-Launcher)** de
**[Luuxis](https://github.com/luuxis)**, sob a **Luuxis License v1.0**
([`LICENSE.md`](LICENSE.md)). O histórico completo do projeto original está
preservado neste repositório, desde o primeiro commit dele em 2021.

Três condições da licença que valem destacar:

1. **O código-fonte precisa continuar público.** Mantenha este repositório
   público.
2. **O nome do autor original (Luuxis) precisa ser mencionado.** Está aqui, nos
   cabeçalhos dos arquivos e no histórico do git.
3. **Vender o código é proibido.** Monetizar o servidor com microtransações no
   jogo é permitido.

A documentação original do projeto (francês e inglês) está em `docs/`, e
descreve o backend antigo em PHP — que **não** é o que este fork usa.
