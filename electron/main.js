import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const htmlDir = path.join(repoRoot, "html");
const launchScript = path.join(repoRoot, "mjs-launch.js");
const collectScript = path.join(repoRoot, "mjs-collect-with-overlay.js");
const overlayScript = path.join(repoRoot, "overlay-server.js");
const overlayServerUrl = "http://127.0.0.1:4173";

let mainWindow = null;
let launchProcess = null;
let collectProcess = null;
let overlayProcess = null;

function sendStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app:status", {
    launchRunning: isRunning(launchProcess),
    collectRunning: isRunning(collectProcess),
    overlayRunning: isRunning(overlayProcess),
    overlayUrl: overlayServerUrl,
    htmlDir
  });
}

function isRunning(child) {
  return Boolean(child && !child.killed && child.exitCode == null);
}

function getNodeCommand() {
  return process.env.npm_node_execpath || process.env.NODE || "node";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 860,
    minWidth: 980,
    minHeight: 760,
    autoHideMenuBar: true,
    backgroundColor: "#11161e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function makeChildEnv() {
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1"
  };
}

function appendLog(kind, line) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const text = String(line ?? "").trimEnd();
  if (!text) {
    return;
  }

  mainWindow.webContents.send("app:log", {
    kind,
    text
  });
}

function getLabel(kind) {
  if (kind === "launch") {
    return "雀魂起動";
  }
  if (kind === "collect") {
    return "データ取得";
  }
  if (kind === "overlay") {
    return "overlay";
  }
  return kind;
}

function startManagedProcess(scriptPath, currentChild, kind) {
  if (isRunning(currentChild)) {
    return currentChild;
  }

  const command = getNodeCommand();
  appendLog(kind, `${getLabel(kind)}を起動します: ${command} ${path.basename(scriptPath)}`);

  const child = spawn(command, [scriptPath], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => appendLog(kind, chunk));
  child.stderr.on("data", (chunk) => appendLog(`${kind}:error`, chunk));

  child.on("exit", (code, signal) => {
    appendLog(
      kind,
      `${getLabel(kind)}プロセスが終了しました (${signal ? `signal ${signal}` : `code ${code ?? 0}`})`
    );
    sendStatus();
  });

  sendStatus();
  return child;
}

function stopManagedProcess(child, kind) {
  if (!isRunning(child)) {
    return null;
  }

  child.kill();
  appendLog(kind, `${getLabel(kind)}を停止しました`);
  return null;
}

ipcMain.handle("launch:start", async () => {
  launchProcess = startManagedProcess(launchScript, launchProcess, "launch");
  sendStatus();
  return { ok: true };
});

ipcMain.handle("launch:stop", async () => {
  launchProcess = stopManagedProcess(launchProcess, "launch");
  sendStatus();
  return { ok: true };
});

ipcMain.handle("collect:start", async () => {
  collectProcess = startManagedProcess(collectScript, collectProcess, "collect");
  sendStatus();
  return { ok: true };
});

ipcMain.handle("collect:stop", async () => {
  collectProcess = stopManagedProcess(collectProcess, "collect");
  sendStatus();
  return { ok: true };
});

ipcMain.handle("folder:openHtml", async () => {
  if (!fs.existsSync(htmlDir)) {
    return { ok: false, message: "html フォルダが見つかりません" };
  }

  await shell.openPath(htmlDir);
  return { ok: true };
});

ipcMain.handle("overlay:open", async (_event, route) => {
  const url = `${overlayServerUrl}/${route}`;
  await shell.openExternal(url);
  return { ok: true };
});

ipcMain.handle("app:getStatus", async () => ({
  launchRunning: isRunning(launchProcess),
  collectRunning: isRunning(collectProcess),
  overlayRunning: isRunning(overlayProcess),
  overlayUrl: overlayServerUrl,
  htmlDir
}));

app.whenReady().then(() => {
  overlayProcess = startManagedProcess(overlayScript, overlayProcess, "overlay");
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
  overlayProcess = stopManagedProcess(overlayProcess, "overlay");
  launchProcess = stopManagedProcess(launchProcess, "launch");
  collectProcess = stopManagedProcess(collectProcess, "collect");
});
