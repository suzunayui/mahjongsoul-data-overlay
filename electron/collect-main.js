import { app, BrowserWindow, ipcMain, shell } from "electron";
import { execFile, spawn } from "node:child_process";
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
const overlayPort = Number(process.env.OVERLAY_PORT || 4173);
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
  overlayDesign: {
    rank: "normal",
    points: "normal",
    records: "normal",
    han: "normal"
  },
  overlayStyle: {
    textColor: "#f7f4eb",
    backgroundColor: "#ffffff",
    backgroundOpacity: 20,
    borderColor: "#ffffff",
    borderWidth: 1,
    borderRadius: 14,
    fontFamily: "Segoe UI, Meiryo UI, sans-serif"
  },
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
let cachedSystemFonts = null;

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

function normalizeOverlayDesignSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const normalizeTheme = (theme) =>
    theme === "frameless_white" ||
    theme === "frameless_black" ||
    theme === "custom"
      ? theme
      : "normal";
  return {
    rank: normalizeTheme(source.rank),
    points: normalizeTheme(source.points),
    records: normalizeTheme(source.records),
    han: normalizeTheme(source.han)
  };
}

function normalizeOverlayStyleSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const textColor =
    typeof source.textColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.textColor)
      ? source.textColor
      : defaultSettings.overlayStyle.textColor;
  const backgroundColor =
    typeof source.backgroundColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.backgroundColor)
      ? source.backgroundColor
      : typeof source.borderColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.borderColor)
        ? source.borderColor
        : defaultSettings.overlayStyle.backgroundColor;
  const backgroundOpacityRaw = Number(
    source.backgroundOpacity != null ? source.backgroundOpacity : source.borderOpacity
  );
  const backgroundOpacity = Number.isFinite(backgroundOpacityRaw)
    ? Math.max(0, Math.min(100, Math.round(backgroundOpacityRaw)))
    : defaultSettings.overlayStyle.backgroundOpacity;
  const borderColor =
    typeof source.borderColor === "string" && /^#[0-9a-fA-F]{6}$/.test(source.borderColor)
      ? source.borderColor
      : defaultSettings.overlayStyle.borderColor;
  const borderWidthRaw = Number(source.borderWidth);
  const borderWidth = Number.isFinite(borderWidthRaw)
    ? Math.max(0, Math.min(12, Math.round(borderWidthRaw)))
    : defaultSettings.overlayStyle.borderWidth;
  const borderRadiusRaw = Number(source.borderRadius);
  const borderRadius = Number.isFinite(borderRadiusRaw)
    ? Math.max(0, Math.min(36, Math.round(borderRadiusRaw)))
    : defaultSettings.overlayStyle.borderRadius;
  const fontFamily =
    typeof source.fontFamily === "string" && source.fontFamily.trim().length > 0
      ? source.fontFamily.trim().slice(0, 120)
      : defaultSettings.overlayStyle.fontFamily;

  return {
    textColor,
    backgroundColor,
    backgroundOpacity,
    borderColor,
    borderWidth,
    borderRadius,
    fontFamily
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
    merged.overlayDesign = normalizeOverlayDesignSettings(merged.overlayDesign);
    merged.overlayStyle = normalizeOverlayStyleSettings(merged.overlayStyle);
    merged.obsIntegration = normalizeObsIntegrationSettings(merged.obsIntegration);
    return merged;
  } catch {
    return {
      ...defaultSettings,
      overlayDesign: normalizeOverlayDesignSettings(defaultSettings.overlayDesign),
      overlayStyle: normalizeOverlayStyleSettings(defaultSettings.overlayStyle),
      obsIntegration: normalizeObsIntegrationSettings(defaultSettings.obsIntegration)
    };
  }
}

async function writeSettings(nextSettings) {
  const merged = {
    ...defaultSettings,
    ...(nextSettings || {})
  };
  merged.overlayDesign = normalizeOverlayDesignSettings(merged.overlayDesign);
  merged.overlayStyle = normalizeOverlayStyleSettings(merged.overlayStyle);
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

function listSystemFonts() {
  if (Array.isArray(cachedSystemFonts)) {
    return Promise.resolve(cachedSystemFonts);
  }

  if (process.platform !== "win32") {
    cachedSystemFonts = [
      "Segoe UI",
      "Meiryo UI",
      "Yu Gothic UI",
      "Yu Gothic",
      "Meiryo"
    ];
    return Promise.resolve(cachedSystemFonts);
  }

  const command = `
$paths = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'
);
$all = @();
foreach ($path in $paths) {
  if (Test-Path $path) {
    $all += (Get-ItemProperty -Path $path | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name);
  }
}
$clean = $all |
  ForEach-Object { ($_ -replace '\\s*\\(.*\\)$','').Trim() } |
  Where-Object { $_ -and $_.Length -gt 0 } |
  Sort-Object -Unique;
$clean -join [Environment]::NewLine
`;

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout) => {
        if (error) {
          cachedSystemFonts = [
            "Segoe UI",
            "Meiryo UI",
            "Yu Gothic UI",
            "Yu Gothic",
            "Meiryo"
          ];
          resolve(cachedSystemFonts);
          return;
        }

        const fonts = String(stdout || "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        const merged = Array.from(
          new Set(["Segoe UI", "Meiryo UI", "Yu Gothic UI", "Yu Gothic", "Meiryo", ...fonts])
        );
        cachedSystemFonts = merged;
        resolve(merged);
      }
    );
  });
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
    throw new Error("OBS連携がOFFです");
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
    message: "接続中..."
  });

  try {
    await obsClient.connect(obsIntegration.password);
    setObsStatus({
      connecting: false,
      connected: true,
      websocketUrl: obsIntegration.websocketUrl,
      message: "接続済み"
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
    message: "未接続"
  });
}

async function playObsRiichiMedia(settings) {
  const obsIntegration = normalizeObsIntegrationSettings(settings?.obsIntegration);
  if (!obsIntegration.mediaSourceName) {
    throw new Error("OBS のメディアソース名が未設定です");
  }

  const client = await ensureObsConnected(settings);
  await client.call("TriggerMediaInputAction", {
    inputName: obsIntegration.mediaSourceName,
    mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"
  });
  setObsStatus({
    message: `再生: ${obsIntegration.mediaSourceName}`
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

function getOverlayBaseUrl() {
  return `http://127.0.0.1:${overlayPort}`;
}

function computeBottomRowLayout(canvasWidth, canvasHeight, sources) {
  const margin = 16;
  const gap = 12;
  const order = [
    "MJS Overlay Han",
    "MJS Overlay Records",
    "MJS Overlay Points",
    "MJS Overlay Rank"
  ];
  const byName = new Map(sources.map((source) => [source.inputName, source]));
  const orderedSources = order.map((name) => byName.get(name)).filter(Boolean);
  const totalWidth =
    orderedSources.reduce((sum, source) => sum + source.width, 0) + gap * (orderedSources.length - 1);
  const maxHeight = Math.max(...orderedSources.map((source) => source.height));
  const usableWidth = Math.max(1, canvasWidth - margin * 2);
  const usableHeight = Math.max(1, canvasHeight - margin * 2);
  const scale = Math.max(0.2, Math.min(1, usableWidth / totalWidth, usableHeight / maxHeight));

  const placements = [];
  let x = margin;
  const y = Math.max(margin, canvasHeight - margin - maxHeight * scale);
  for (const source of orderedSources) {
    placements.push({
      inputName: source.inputName,
      x,
      y,
      scaleX: scale,
      scaleY: scale
    });
    x += source.width * scale + gap;
  }
  return placements;
}

async function setupObsOverlaySources(settings) {
  const client = await ensureObsConnected(settings);
  const currentScene = await client.call("GetCurrentProgramScene");
  const sceneName = currentScene?.responseData?.currentProgramSceneName;
  if (!sceneName) {
    throw new Error("OBS の現在シーン名を取得できませんでした");
  }

  const inputListResponse = await client.call("GetInputList");
  const inputList = Array.isArray(inputListResponse?.responseData?.inputs)
    ? inputListResponse.responseData.inputs
    : [];
  const inputMap = new Map(
    inputList
      .filter((input) => input?.inputName)
      .map((input) => [
        input.inputName,
        (input.unversionedInputKind || input.inputKind || "").toLowerCase()
      ])
  );

  const sceneItemListResponse = await client.call("GetSceneItemList", { sceneName });
  const sceneItemSourceNames = new Set(
    Array.isArray(sceneItemListResponse?.responseData?.sceneItems)
      ? sceneItemListResponse.responseData.sceneItems
          .map((item) => item?.sourceName)
          .filter((name) => typeof name === "string" && name.length > 0)
      : []
  );

  const sources = [
    {
      inputName: "MJS Overlay Rank",
      route: "/obs/rank",
      width: 580,
      height: 150
    },
    {
      inputName: "MJS Overlay Points",
      route: "/obs/points",
      width: 480,
      height: 210
    },
    {
      inputName: "MJS Overlay Records",
      route: "/obs/records",
      width: 330,
      height: 100
    },
    {
      inputName: "MJS Overlay Han",
      route: "/obs/han",
      width: 200,
      height: 100
    }
  ];

  const updated = [];
  const created = [];
  const linkedToScene = [];

  for (const source of sources) {
    const existingKind = inputMap.get(source.inputName);
    const isBrowserSource =
      !existingKind || existingKind === "browser_source" || existingKind === "browser_source_v2";
    if (!isBrowserSource) {
      throw new Error(
        `${source.inputName} は Browser Source ではありません（${existingKind}）`
      );
    }

    const inputSettings = {
      url: `${getOverlayBaseUrl()}${source.route}`,
      width: source.width,
      height: source.height,
      reroute_audio: false,
      restart_when_active: true,
      shutdown: false
    };

    if (existingKind) {
      await client.call("SetInputSettings", {
        inputName: source.inputName,
        inputSettings,
        overlay: true
      });
      updated.push(source.inputName);
    } else {
      await client.call("CreateInput", {
        sceneName,
        inputName: source.inputName,
        inputKind: "browser_source",
        inputSettings,
        sceneItemEnabled: true
      });
      created.push(source.inputName);
      sceneItemSourceNames.add(source.inputName);
    }

    if (!sceneItemSourceNames.has(source.inputName)) {
      await client.call("CreateSceneItem", {
        sceneName,
        sourceName: source.inputName,
        sceneItemEnabled: true
      });
      linkedToScene.push(source.inputName);
      sceneItemSourceNames.add(source.inputName);
    }
  }

  const sceneItemListAfterResponse = await client.call("GetSceneItemList", { sceneName });
  const sceneItems = Array.isArray(sceneItemListAfterResponse?.responseData?.sceneItems)
    ? sceneItemListAfterResponse.responseData.sceneItems
    : [];
  const sceneItemIdBySource = new Map(
    sceneItems
      .filter((item) => typeof item?.sourceName === "string" && Number.isFinite(item?.sceneItemId))
      .map((item) => [item.sourceName, item.sceneItemId])
  );

  let canvasWidth = 1920;
  let canvasHeight = 1080;
  try {
    const videoSettings = await client.call("GetVideoSettings");
    const baseWidth = Number(videoSettings?.responseData?.baseWidth);
    const baseHeight = Number(videoSettings?.responseData?.baseHeight);
    if (Number.isFinite(baseWidth) && baseWidth > 0) {
      canvasWidth = baseWidth;
    }
    if (Number.isFinite(baseHeight) && baseHeight > 0) {
      canvasHeight = baseHeight;
    }
  } catch {
    // Keep default canvas size when OBS does not return video settings.
  }

  const placements = computeBottomRowLayout(canvasWidth, canvasHeight, sources);
  for (const placement of placements) {
    const sceneItemId = sceneItemIdBySource.get(placement.inputName);
    if (!sceneItemId) {
      continue;
    }
    await client.call("SetSceneItemTransform", {
      sceneName,
      sceneItemId,
      sceneItemTransform: {
        positionX: placement.x,
        positionY: placement.y,
        scaleX: placement.scaleX,
        scaleY: placement.scaleY
      }
    });
  }

  return {
    ok: true,
    sceneName,
    updated,
    created,
    linkedToScene,
    sources: sources.map((source) => ({
      name: source.inputName,
      url: `${getOverlayBaseUrl()}${source.route}`,
      width: source.width,
      height: source.height
    })),
    layout: {
      canvasWidth,
      canvasHeight,
      placements
    },
    obs: obsStatus
  };
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

ipcMain.handle("obs:setupOverlaySources", async () => {
  const settings = await readSettings();
  return await setupObsOverlaySources(settings);
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
  launchRunning: isRunning(launchProcess),
  collectRunning: isRunning(collectProcess),
  htmlDir,
  obs: obsStatus
}));

ipcMain.handle("fonts:listSystem", async () => {
  const fonts = await listSystemFonts();
  return { ok: true, fonts };
});

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
