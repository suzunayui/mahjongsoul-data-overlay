import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const collectScript = path.join(repoRoot, "mjs-collect-with-overlay.js");
const htmlDir = path.join(repoRoot, "html");
function getAppDataDir() {
  return app.getPath("userData");
}

const configDir = path.join(getAppDataDir(), "config");
const settingsPath = path.join(configDir, "settings.json");
const recordsDir = path.join(getAppDataDir(), "records");
const pointsDir = path.join(getAppDataDir(), "points");
const hanEventsPath = path.join(recordsDir, "han-events.json");
const hanSeenKeysPath = path.join(recordsDir, "seen-han-keys.json");
const hanSummaryPath = path.join(recordsDir, "han-summary.json");
const recordsSummaryPath = path.join(recordsDir, "summary.json");

const defaultSettings = {
  hanCountScope: "all_players"
};

let mainWindow = null;
let collectProcess = null;

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

async function readSettings() {
  try {
    const raw = await fs.promises.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaultSettings,
      ...parsed
    };
  } catch {
    return { ...defaultSettings };
  }
}

async function writeSettings(nextSettings) {
  const merged = {
    ...defaultSettings,
    ...(nextSettings || {})
  };
  await fs.promises.mkdir(configDir, { recursive: true });
  await fs.promises.writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
}

async function writeJsonFile(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(filePath, fallback = null) {
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function getDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sendStatus() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("app:status", {
    collectRunning: isRunning(collectProcess),
    htmlDir
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 560,
    minWidth: 740,
    minHeight: 480,
    autoHideMenuBar: true,
    backgroundColor: "#11161e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "collect.html"));
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function startCollect() {
  if (isRunning(collectProcess)) {
    return collectProcess;
  }

  collectProcess = spawn(getNodeCommand(), [collectScript], {
    cwd: repoRoot,
    env: getChildEnv(),
    stdio: "ignore",
    windowsHide: true
  });

  collectProcess.on("exit", () => {
    sendStatus();
  });

  sendStatus();
  return collectProcess;
}

function stopCollect() {
  if (!isRunning(collectProcess)) {
    return;
  }

  collectProcess.kill();
  sendStatus();
}

ipcMain.handle("collect:start", async () => {
  startCollect();
  return { ok: true };
});

ipcMain.handle("collect:stop", async () => {
  stopCollect();
  return { ok: true };
});

ipcMain.handle("folder:openHtml", async () => {
  if (!fs.existsSync(htmlDir)) {
    return { ok: false, message: "html フォルダが見つかりません" };
  }

  await shell.openPath(htmlDir);
  return { ok: true };
});

ipcMain.handle("settings:get", async () => {
  return await readSettings();
});

ipcMain.handle("settings:save", async (_event, settings) => {
  const saved = await writeSettings(settings);
  return { ok: true, settings: saved };
});

ipcMain.handle("han:reset", async () => {
  const settings = await readSettings();
  await writeJsonFile(hanEventsPath, []);
  await writeJsonFile(hanSeenKeysPath, []);
  await writeJsonFile(hanSummaryPath, {
    updatedAt: new Date().toISOString(),
    scope:
      settings.hanCountScope === "self_with_ron_loss"
        ? "self_with_ron_loss"
        : settings.hanCountScope === "all_players"
          ? "all_players"
          : "self_only",
    totalHan: 0,
    counts: Object.fromEntries([
      ["1", 0],
      ["2", 0],
      ["3", 0],
      ["4", 0],
      ["5", 0],
      ["6", 0],
      ["7", 0],
      ["8", 0],
      ["9", 0],
      ["10", 0],
      ["11", 0],
      ["12", 0],
      ["13", 0],
      ["13+", 0]
    ])
  });
  return { ok: true };
});

ipcMain.handle("records:reset", async () => {
  const previous = await readJsonFile(recordsSummaryPath, {});
  await writeJsonFile(recordsSummaryPath, {
    updatedAt: new Date().toISOString(),
    selfAccountId: previous?.selfAccountId ?? null,
    selfNickname: previous?.selfNickname ?? null,
    counts: {
      "1": 0,
      "2": 0,
      "3": 0,
      "4": 0
    }
  });
  return { ok: true };
});

ipcMain.handle("points:reset", async () => {
  const dateKey = getDateKey();
  const startPath = path.join(pointsDir, `${dateKey}-start.json`);
  const latestPath = path.join(pointsDir, `${dateKey}-latest-change.json`);
  const latest = await readJsonFile(latestPath, null);
  const start = await readJsonFile(startPath, null);
  const nextBase = latest || start;

  if (!nextBase) {
    return { ok: false, message: "表示に使える段位ポイントデータがありません" };
  }

  await writeJsonFile(startPath, nextBase);
  if (!latest) {
    await writeJsonFile(latestPath, nextBase);
  }
  return { ok: true };
});

ipcMain.handle("app:getStatus", async () => ({
  collectRunning: isRunning(collectProcess),
  htmlDir
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
  stopCollect();
});
