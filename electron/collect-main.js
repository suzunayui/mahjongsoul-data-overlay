import { app, BrowserWindow, ipcMain, shell } from "electron";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { readJsonFile, writeJsonFile } from "../mjs-runtime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const launchScript = path.join(repoRoot, "mjs-launch.js");
const collectScript = path.join(repoRoot, "mjs-collect-with-overlay.js");
const htmlDir = path.join(repoRoot, "html");
const debugPort = Number(process.env.CHROME_DEBUG_PORT || 9222);
function getAppDataDir() {
  return app.getPath("userData");
}

const configDir = path.join(getAppDataDir(), "config");
const settingsPath = path.join(configDir, "settings.json");
const recordsDir = path.join(getAppDataDir(), "records");
const pointsDir = path.join(getAppDataDir(), "points");
const latestMatchStatePath = path.join(recordsDir, "match-latest.json");
const hanEventsPath = path.join(recordsDir, "han-events.json");
const hanSeenKeysPath = path.join(recordsDir, "seen-han-keys.json");
const hanSummaryPath = path.join(recordsDir, "han-summary.json");
const recordsSummaryPath = path.join(recordsDir, "summary.json");
const riichiEventsPath = path.join(recordsDir, "riichi-events.json");
const matchPollMs = Number(process.env.MJS_MATCH_POLL_MS || 250);
const riichiWatchPollMs = Number(process.env.MJS_RIICHI_WATCH_POLL_MS || 250);

const defaultSettings = {
  hanCountScope: "all_players",
  obsIntegration: {
    enabled: false,
    websocketUrl: "ws://127.0.0.1:4455",
    password: "",
    mediaSourceName: ""
  }
};

let mainWindow = null;
let launchProcess = null;
let collectProcess = null;
let obsStatus = {
  connected: false,
  connecting: false,
  message: "未接続",
  websocketUrl: defaultSettings.obsIntegration.websocketUrl
};
let obsClient = null;
let riichiWatchInterval = null;
let lastRiichiEventAt = "";
let riichiWatchBusy = false;

function base64Sha256(value) {
  return crypto.createHash("sha256").update(value).digest("base64");
}

class ObsWebSocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.requestId = 0;
    this.pending = new Map();
    this.identified = false;
  }

  async connect(password = "") {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.identified) {
      return;
    }

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      const cleanup = () => {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        this.ws = ws;
        resolve();
      };
      const onError = (event) => {
        cleanup();
        reject(new Error(event?.message || "OBS WebSocket connection failed"));
      };
      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
    });

    this.ws.addEventListener("message", (event) => this.handleMessage(event));
    this.ws.addEventListener("close", () => {
      this.identified = false;
      for (const pending of this.pending.values()) {
        pending.reject(new Error("OBS WebSocket disconnected"));
      }
      this.pending.clear();
    });

    const hello = await this.waitForOp(0);
    const auth = hello?.d?.authentication;
    const identifyPayload = {
      rpcVersion: hello?.d?.rpcVersion || 1,
      eventSubscriptions: 0
    };
    if (auth?.challenge && auth?.salt) {
      const secret = base64Sha256(`${password}${auth.salt}`);
      identifyPayload.authentication = base64Sha256(`${secret}${auth.challenge}`);
    }

    this.send({
      op: 1,
      d: identifyPayload
    });

    const identified = await this.waitForOp(2);
    if (identified?.d?.negotiatedRpcVersion == null) {
      throw new Error("OBS WebSocket identify failed");
    }
    this.identified = true;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.ws = null;
    this.identified = false;
  }

  send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("OBS WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(payload));
  }

  handleMessage(event) {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.op === 7) {
      const requestId = message?.d?.requestId;
      const pending = this.pending.get(requestId);
      if (!pending) {
        return;
      }
      this.pending.delete(requestId);
      if (message?.d?.requestStatus?.result === true) {
        pending.resolve(message.d);
      } else {
        pending.reject(new Error(message?.d?.requestStatus?.comment || "OBS request failed"));
      }
      return;
    }

    if (message.op === 0 || message.op === 2) {
      const key = `op:${message.op}`;
      const pending = this.pending.get(key);
      if (!pending) {
        return;
      }
      this.pending.delete(key);
      pending.resolve(message);
    }
  }

  waitForOp(op) {
    return new Promise((resolve, reject) => {
      this.pending.set(`op:${op}`, { resolve, reject });
    });
  }

  async call(requestType, requestData = {}) {
    if (!this.identified) {
      throw new Error("OBS WebSocket is not identified");
    }
    const requestId = `req-${Date.now()}-${++this.requestId}`;
    this.send({
      op: 6,
      d: {
        requestType,
        requestId,
        requestData
      }
    });
    return await new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
    });
  }
}

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
  return {
    ...process.env,
    ...(app.isPackaged ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    MJS_APPDATA_DIR: getAppDataDir(),
    MJS_MATCH_POLL_MS: String(matchPollMs)
  };
}

function normalizeObsIntegrationSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: source.enabled === true,
    websocketUrl:
      typeof source.websocketUrl === "string" && source.websocketUrl.trim().length > 0
        ? source.websocketUrl.trim()
        : defaultSettings.obsIntegration.websocketUrl,
    password: typeof source.password === "string" ? source.password : "",
    mediaSourceName: typeof source.mediaSourceName === "string" ? source.mediaSourceName.trim() : ""
  };
}

async function readSettings() {
  try {
    const raw = await fs.promises.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    const merged = {
      ...defaultSettings,
      ...parsed
    };
    merged.obsIntegration = normalizeObsIntegrationSettings(merged.obsIntegration);
    return merged;
  } catch {
    return {
      ...defaultSettings,
      obsIntegration: normalizeObsIntegrationSettings(defaultSettings.obsIntegration)
    };
  }
}

async function writeSettings(nextSettings) {
  const merged = {
    ...defaultSettings,
    ...(nextSettings || {})
  };
  merged.obsIntegration = normalizeObsIntegrationSettings(merged.obsIntegration);
  await fs.promises.mkdir(configDir, { recursive: true });
  await fs.promises.writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
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
    launchRunning: isRunning(launchProcess),
    collectRunning: isRunning(collectProcess),
    htmlDir,
    obs: obsStatus
  });
}

function setObsStatus(nextStatus) {
  obsStatus = {
    ...obsStatus,
    ...nextStatus
  };
  sendStatus();
}

async function ensureObsConnected(settings) {
  const obsIntegration = normalizeObsIntegrationSettings(settings?.obsIntegration);
  if (!obsIntegration.enabled) {
    throw new Error("OBS???OFF??");
  }

  if (
    obsClient &&
    obsStatus.connected &&
    obsStatus.websocketUrl === obsIntegration.websocketUrl
  ) {
    return obsClient;
  }

  if (obsClient) {
    obsClient.disconnect();
  }

  obsClient = new ObsWebSocketClient(obsIntegration.websocketUrl);
  setObsStatus({
    connecting: true,
    connected: false,
    websocketUrl: obsIntegration.websocketUrl,
    message: "???..."
  });

  try {
    await obsClient.connect(obsIntegration.password);
    setObsStatus({
      connecting: false,
      connected: true,
      websocketUrl: obsIntegration.websocketUrl,
      message: "????"
    });
    return obsClient;
  } catch (error) {
    obsClient = null;
    setObsStatus({
      connecting: false,
      connected: false,
      websocketUrl: obsIntegration.websocketUrl,
      message: error.message || String(error)
    });
    throw error;
  }
}

async function disconnectObs() {
  if (obsClient) {
    obsClient.disconnect();
    obsClient = null;
  }
  setObsStatus({
    connecting: false,
    connected: false,
    message: "???"
  });
}

async function playObsRiichiMedia(settings) {
  const obsIntegration = normalizeObsIntegrationSettings(settings?.obsIntegration);
  if (!obsIntegration.mediaSourceName) {
    throw new Error("OBS ???????????????");
  }

  const client = await ensureObsConnected(settings);
  await client.call("TriggerMediaInputAction", {
    inputName: obsIntegration.mediaSourceName,
    mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"
  });
  setObsStatus({
    message: `??: ${obsIntegration.mediaSourceName}`
  });
}

async function listObsInputs(settings) {
  const client = await ensureObsConnected(settings);
  const response = await client.call("GetInputList");
  const inputs = Array.isArray(response?.responseData?.inputs) ? response.responseData.inputs : [];
  return inputs.map((input) => ({
    inputName: input.inputName ?? "",
    inputKind: input.inputKind ?? "",
    unversionedInputKind: input.unversionedInputKind ?? ""
  }));
}

async function checkRiichiTrigger() {
  const settings = await readSettings();
  const obsIntegration = settings.obsIntegration;
  if (!obsIntegration.enabled) {
    return;
  }

  const events = await readJsonFile(riichiEventsPath, []);
  if (!Array.isArray(events) || events.length === 0) {
    return;
  }

  const latest = events.at(-1);
  if (!latest?.capturedAt) {
    return;
  }

  if (!lastRiichiEventAt) {
    lastRiichiEventAt = latest.capturedAt;
    return;
  }

  if (latest.capturedAt === lastRiichiEventAt) {
    return;
  }

  const latestMatchState = await readJsonFile(latestMatchStatePath, null);
  const isFreshSelfRiichi =
    latestMatchState?.inGame === true &&
    latestMatchState?.selfJustRiichi === true &&
    latestMatchState?.latestSelfRiichiEvent?.capturedAt === latest.capturedAt;
  if (!isFreshSelfRiichi) {
    lastRiichiEventAt = latest.capturedAt;
    return;
  }

  lastRiichiEventAt = latest.capturedAt;
  try {
    await playObsRiichiMedia(settings);
  } catch (error) {
    setObsStatus({
      connected: false,
      connecting: false,
      message: error.message || String(error)
    });
  }
}

function startRiichiWatch() {
  if (riichiWatchInterval) {
    return;
  }
  riichiWatchInterval = setInterval(() => {
    if (riichiWatchBusy) {
      return;
    }
    riichiWatchBusy = true;
    checkRiichiTrigger().catch((error) => {
      setObsStatus({
        connected: false,
        connecting: false,
        message: error.message || String(error)
      });
    }).finally(() => {
      riichiWatchBusy = false;
    });
  }, riichiWatchPollMs);
}

function stopRiichiWatch() {
  if (!riichiWatchInterval) {
    return;
  }
  clearInterval(riichiWatchInterval);
  riichiWatchInterval = null;
  riichiWatchBusy = false;
}

async function hasRunningMahjongSoulPage() {
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  } catch {
    return false;
  }

  if (!response.ok) {
    return false;
  }

  let targets;
  try {
    targets = await response.json();
  } catch {
    return false;
  }

  if (!Array.isArray(targets)) {
    return false;
  }

  return targets.some((target) => {
    const url = String(target?.url || "").toLowerCase();
    const title = String(target?.title || "").toLowerCase();
    return target?.type === "page" && (url.includes("mahjongsoul") || title.includes("mahjongsoul"));
  });
}

async function maybeAutoStartCollect() {
  if (isRunning(collectProcess)) {
    return false;
  }
  if (!(await hasRunningMahjongSoulPage())) {
    return false;
  }
  startCollect();
  return true;
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

function stopCollect() {
  if (!isRunning(collectProcess)) {
    return;
  }

  collectProcess.kill();
  sendStatus();
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
    return { ok: false, message: "html ????????????" };
  }

  await shell.openPath(htmlDir);
  return { ok: true };
});

ipcMain.handle("settings:get", async () => {
  return await readSettings();
});

ipcMain.handle("settings:save", async (_event, settings) => {
  const saved = await writeSettings(settings);
  if (!saved.obsIntegration.enabled) {
    await disconnectObs();
  } else {
    setObsStatus({
      websocketUrl: saved.obsIntegration.websocketUrl
    });
  }
  return { ok: true, settings: saved };
});

ipcMain.handle("obs:connect", async () => {
  const settings = await readSettings();
  await ensureObsConnected(settings);
  return { ok: true, obs: obsStatus };
});

ipcMain.handle("obs:disconnect", async () => {
  await disconnectObs();
  return { ok: true, obs: obsStatus };
});

ipcMain.handle("obs:playRiichi", async () => {
  const settings = await readSettings();
  await playObsRiichiMedia(settings);
  return { ok: true, obs: obsStatus };
});

ipcMain.handle("obs:listInputs", async () => {
  const settings = await readSettings();
  const inputs = await listObsInputs(settings);
  return { ok: true, inputs, obs: obsStatus };
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
    return { ok: false, message: "?????????????????????" };
  }

  await writeJsonFile(startPath, nextBase);
  if (!latest) {
    await writeJsonFile(latestPath, nextBase);
  }
  return { ok: true };
});

ipcMain.handle("app:getStatus", async () => ({
  launchRunning: isRunning(launchProcess),
  collectRunning: isRunning(collectProcess),
  htmlDir,
  obs: obsStatus
}));

app.whenReady().then(() => {
  createWindow();
  startRiichiWatch();
  sendStatus();
  maybeAutoStartCollect().catch(() => {});
  readSettings()
    .then(async (settings) => {
      if (settings?.obsIntegration?.enabled) {
        await ensureObsConnected(settings);
      }
    })
    .catch((error) => {
      setObsStatus({
        connected: false,
        connecting: false,
        message: error?.message || String(error)
      });
    });

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
  stopCollect();
  stopRiichiWatch();
  disconnectObs().catch(() => {});
});
