import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { app, BrowserWindow } from "electron";

if (process.env.WAYLAND_DISPLAY) {
  app.commandLine.appendSwitch("ozone-platform", "wayland");
}

function createWindow() {
  const window = new BrowserWindow({
    width: 720,
    height: 480,
    minWidth: 320,
    minHeight: 240,
    title: "Anvil Square Corner Fixture",
    frame: false,
    hasShadow: false,
    transparent: false,
    backgroundColor: "#0d0d16",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.loadFile(fileURLToPath(new URL("window.html", import.meta.url)));
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
