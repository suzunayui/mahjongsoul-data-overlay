import { app, BrowserWindow, ipcMain } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const launchScript = path.join(repoRoot, "mjs-launch.js");

function getAppDataDir() {
  return app.getPath("userData");
}

let mainWindow = null;
let launchProcess = null;

function isRunning(child) {
  return Boolean(child && !child.killed && child.exitCode == null);
}

function getNodeCommand() {
  if (app.isPackaged) {
    return process.execPath;
  }
  return process.env.npm_node_execpath || process.env.NODE || "node";
}

function getChildEnv() {
  if (!app.isPackaged) {
    return process.env;
  }
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    MJS_APPDATA_DIR: getAppDataDir()
  };
}

function sendStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app:status", {
    launchRunning: isRunning(launchProcess)
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 420,
    minWidth: 680,
    minHeight: 360,
    autoHideMenuBar: true,
    backgroundColor: "#11161e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "launch.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startLaunch() {
  if (isRunning(launchProcess)) {
    return launchProcess;
  }

  launchProcess = spawn(getNodeCommand(), [launchScript], {
    cwd: repoRoot,
    env: getChildEnv(),
    stdio: "ignore",
    windowsHide: true
  });

  launchProcess.on("exit", () => {
    sendStatus();
  });

  sendStatus();
  return launchProcess;
}

function stopLaunch() {
  if (!isRunning(launchProcess)) {
    return;
  }

  launchProcess.kill();
  sendStatus();
}

ipcMain.handle("launch:start", async () => {
  startLaunch();
  return { ok: true };
});

ipcMain.handle("launch:stop", async () => {
  stopLaunch();
  return { ok: true };
});

ipcMain.handle("app:getStatus", async () => ({
  launchRunning: isRunning(launchProcess)
}));

app.whenReady().then(() => {
  createWindow();
  sendStatus();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      sendStatus();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopLaunch();
});
