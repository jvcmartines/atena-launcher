/**
 * Atena Launcher — fork de Selvania-Launcher
 * @author Luuxis (original) — adaptado para o servidor Atena
 * Luuxis License v1.0 (ver LICENSE.md)
 */

"use strict";
const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const os = require("os");
let dev = process.env.DEV_TOOL === 'open';
let updateWindow = undefined;

function getWindow() {
    return updateWindow;
}

function destroyWindow() {
    if (!updateWindow) return;
    updateWindow.close();
    updateWindow = undefined;
}

function createWindow() {
    destroyWindow();
    updateWindow = new BrowserWindow({
        title: "Atualização",
        width: 400,
        height: 440,
        resizable: false,
        icon: `./src/assets/images/icon/icon.${os.platform() === "win32" ? "ico" : "png"}`,
        frame: false,
        show: false,

        // Janela sem fundo: aparecem so a logo e o texto, flutuando sobre o
        // que estiver na tela. Precisa de transparent + backgroundColor
        // totalmente transparente; so um dos dois nao basta no Windows.
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        skipTaskbar: false,
        webPreferences: {
            contextIsolation: false,
            nodeIntegration: true
        },
    });
    Menu.setApplicationMenu(null);
    updateWindow.setMenuBarVisibility(false);
    updateWindow.loadFile(path.join(`${app.getAppPath()}/src/index.html`));
    updateWindow.once('ready-to-show', () => {
        if (updateWindow) {
            if (dev) updateWindow.webContents.openDevTools({ mode: 'detach' })
            updateWindow.show();
        }
    });
}

module.exports = {
    getWindow,
    createWindow,
    destroyWindow,
};