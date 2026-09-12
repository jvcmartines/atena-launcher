<div align="center">

<img src="src/assets/images/atena-logo.png" width="360" alt="Atena Launcher">

The official launcher for **Atena**, a Minecraft server with its own modpack.

[![Downloads](https://img.shields.io/github/downloads/jvcmartines/atena-launcher/total?label=downloads&color=e8c26a&style=for-the-badge)](https://github.com/jvcmartines/atena-launcher/releases)
[![Version](https://img.shields.io/github/v/release/jvcmartines/atena-launcher?label=version&color=7c5cff&style=for-the-badge)](https://github.com/jvcmartines/atena-launcher/releases/latest)
[![Platforms](https://img.shields.io/badge/windows%20%7C%20macos%20%7C%20linux-2b2b2b?style=for-the-badge)](https://github.com/jvcmartines/atena-launcher/releases/latest)
[![Minecraft](https://img.shields.io/badge/forge%201.20.1-3ecf8e?style=for-the-badge)](https://atenasmp.com)
[![Discord](https://img.shields.io/discord/1410636816024998059?label=discord&logo=discord&logoColor=white&color=5865F2&style=for-the-badge)](https://discord.gg/92cDk8rZKK)

[Website](https://atenasmp.com) · [Wiki](https://wiki.atenasmp.com) · [Discord](https://discord.gg/92cDk8rZKK)

[![Join the Atena Discord](https://discord.com/api/guilds/1410636816024998059/widget.png?style=banner2)](https://discord.gg/92cDk8rZKK)

</div>

---

## What it is

One click to play on Atena. The launcher installs the modpack, keeps it in sync
with the server, downloads the right Java version and starts the game.

Players don't need Java installed, don't need to know what a `mods` folder is,
and don't need to download a zip every time the pack changes.

On the other side there's a **web panel** where staff publish a new modpack
version by dragging in a `.zip` — no touching files on the server, no SSH.

---

## Features

### Playing

- **Install, Update or Play.** The button names itself after whatever is
  missing on the machine. Players never choose between installing and
  updating — the launcher already knows which one it is.
- **The whole modpack in one download.** A published version is packed into a
  single archive hosted on a CDN, and the launcher unpacks it while it
  downloads. Measured on the same machine, in the same minute: 2.9 MB/s from
  our server against 26.9 MB/s from the CDN. A fresh install went from about
  eight minutes to a little over one.
- **Updates carry only what changed.** A "delta" package holds just the files
  that differ from the previous version, so swapping one mod downloads one mod.
  When there's no package to use, the launcher falls back to checking every
  file's SHA-1 against the published manifest and fetching the difference.
- **Your settings survive updates.** When the server publishes the same hash it
  published last time, the file didn't change on their side — so whoever
  changed it was you, and it stays. When the published hash *does* change, the
  update wins. That's what "updating the modpack" means.
- **Pause and cancel.** A download stops between files, so nothing is left half
  written and nothing already fetched is thrown away.
- **Import a copy you already have.** Already have this modpack from another
  launcher? The launcher copies from there instead of downloading again — and
  only accepts a file whose SHA-1 matches exactly what was published, so a
  tampered or mismatched mod never gets through.
- **Automatic Java.** The right version is downloaded and used on its own. No
  installing Java by hand, no wondering why the architecture is wrong.
- **Backup before every update.** The player's folders are copied into
  `backups/`, keeping the 5 most recent.
- **Protected folders.** Players list what the launcher must not overwrite —
  subfolders included, like `config/create`.
- **Reinstall without losing anything.** Wipes mods and configs and downloads
  them again; worlds, screenshots and key bindings stay where they were.
- **RAM tuned for the pack.** Defaults to 4/8 GB, caps at 24 GB, and always
  leaves 2 GB for the operating system.

### On the home screen

- **Join the server automatically**, skipping the multiplayer menu.
- **FPS Boost.** Drops fifteen graphics settings to the minimum for weaker
  machines — chosen by looking at what the pack actually uses. It lists every
  change with its current and new value, keeps the originals, and undoes them
  with one click.
- **Optional mods.** Turn Essential and friends on or off. Turning one off by
  hand doesn't work — the file is in the manifest, so the next launch would
  bring it back.
- **Hours played**, pulled from the server's own world files, next to your nick.
- **The latest staff notice**, right on the home screen.
- **A Windows notification** when a new modpack or launcher version comes out,
  and the Play button switches to Update on its own — no restarting anything.

### Community

- **Change your skin from the launcher.** Model preview, classic or slim, and a
  PNG. It talks to Mojang directly, so the skin changes everywhere.
- **Who's playing.** The list of people on the server right now, each with
  their head, straight from the home screen.
- **Server status.** Up or down, ping and slots in use.
- **One-click IP** to copy.
- **Three languages:** English (default), Portuguese and Spanish, switchable by
  the player.


## Running it

**Players** download the installer from the
[latest release](https://github.com/jvcmartines/atena-launcher/releases/latest).

**To work on the code:**

```bash
npm install
npm run dev
```

**To bring up the server and the panel:**

```bash
cd server
npm install
cp .env.example .env    # set ATENA_PUBLIC_URL
npm start
```

The full walkthrough — VPS, nginx, HTTPS, publishing the modpack, building the
installer — is in the **[manual](docs/MANUAL.md)**.

---

## How it's built

Two halves that talk over HTTP:

| | |
|---|---|
| `src/` | The launcher. Electron + [minecraft-java-core](https://github.com/luuxis/minecraft-java-core). |
| `server/` | The API and the panel. Node + Express, no database — data lives in JSON and the modpack files on disk. |

The server publishes a **manifest**: the list of modpack files with their size
and SHA-1. The launcher compares it against what's on the machine and fetches
the difference. That manifest is what makes incremental updates possible, what
lets strict mode exist, and what the packaged download is checked against
afterwards — the package is a shortcut, never an authority.

Two small checkers run before every build (`npm run conferir`): one finds
variables used but never declared, the other finds calls to `this.something()`
that no longer exist. Both exist because a refactor once shipped a perfectly
valid file with a dead button in it.

---

## License and credits

A fork of **[Selvania-Launcher](https://github.com/luuxis/Selvania-Launcher)**
by **[Luuxis](https://github.com/luuxis)**, under the **Luuxis License v1.0**
([`LICENSE.md`](LICENSE.md)). The original project's full history is preserved
in this repository, going back to its first commit in 2021.

Three conditions from the license worth calling out:

1. **The source has to stay public.** Keep this repository public.
2. **The original author (Luuxis) has to be credited.** He is — here, in the
   file headers, and in the git history.
3. **Selling the code is forbidden.** Monetising the server with in-game
   microtransactions is allowed.

The original project's documentation (French and English) is in `docs/`, and
describes the old PHP backend — which is **not** what this fork uses.

### Bundled fonts

- **Poppins** — SIL Open Font License 1.1.
- **[Monocraft](https://github.com/IdreesInc/Monocraft)** by Idrees Hassan —
  SIL Open Font License 1.1, copied in
  [`src/assets/fonts/Monocraft-OFL.txt`](src/assets/fonts/Monocraft-OFL.txt).
  Used only for the speech-bubble preview in Game settings, subset to Latin-1
  and Latin Extended-A. Minecraft's own font is a Mojang asset and is not
  redistributed here.
