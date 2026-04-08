const launchStatus = document.querySelector("#launch-status");
const collectStatus = document.querySelector("#collect-status");
const htmlDir = document.querySelector("#html-dir");
const launchStartButton = document.querySelector("#launch-start");
const launchStopButton = document.querySelector("#launch-stop");
const collectStartButton = document.querySelector("#collect-start");
const collectStopButton = document.querySelector("#collect-stop");
const settingsStatus = document.querySelector("#settings-status");
const obsStatus = document.querySelector("#obs-status");
const obsStatusMessage = document.querySelector("#obs-status-message");
const obsSettingsStatus = document.querySelector("#obs-settings-status");
const designSettingsStatus = document.querySelector("#design-settings-status");
const obsWebsocketUrl = document.querySelector("#obs-websocket-url");
const obsPassword = document.querySelector("#obs-password");
const obsInputSelect = document.querySelector("#obs-input-select");
const obsTabOnButton = document.querySelector("#obs-tab-on");
const obsTabOffButton = document.querySelector("#obs-tab-off");
const obsTabContent = document.querySelector("#obs-tab-content");
const quickObsConnectButton = document.querySelector("#quick-obs-connect");
const quickObsDisconnectButton = document.querySelector("#quick-obs-disconnect");
const quickObsSetupSourcesButton = document.querySelector("#quick-obs-setup-sources");
const quickObsStatus = document.querySelector("#quick-obs-status");
const designTextColor = document.querySelector("#design-text-color");
const designBorderColor = document.querySelector("#design-border-color");
const designBorderOpacity = document.querySelector("#design-border-opacity");
const designBorderOpacityValue = document.querySelector("#design-border-opacity-value");
const designCustomBorderColor = document.querySelector("#design-custom-border-color");
const designCustomBorderWidth = document.querySelector("#design-custom-border-width");
const designCustomBorderWidthValue = document.querySelector("#design-custom-border-width-value");
const designCustomBorderRadius = document.querySelector("#design-custom-border-radius");
const designCustomBorderRadiusValue = document.querySelector("#design-custom-border-radius-value");
const designFontFamily = document.querySelector("#design-font-family");
const designFontScale = document.querySelector("#design-font-scale");
const designFontScaleValue = document.querySelector("#design-font-scale-value");
const designGlobalInputs = [...document.querySelectorAll('input[name="design-global"]')];
const tabButtons = [...document.querySelectorAll("[data-tab-target]")];
const tabPanels = [...document.querySelectorAll("[data-tab-panel]")];
const hanScopeInputs = [...document.querySelectorAll('input[name="han-count-scope"]')];

if (!window.mahjongOverlayApp) {
  throw new Error("mahjongOverlayApp is not available");
}

function setStatusText(element, running) {
  element.textContent = running ? "起動中" : "停止中";
  element.style.color = running ? "#3dd598" : "#ebf2ff";
}

function setObsStatus(payload) {
  const obs = payload?.obs || {};
  if (obsStatus) {
    obsStatus.textContent = obs.connecting ? "接続中" : obs.connected ? "接続済み" : "未接続";
    obsStatus.style.color = obs.connecting ? "#59a6ff" : obs.connected ? "#3dd598" : "#ebf2ff";
  }
  if (obsStatusMessage) {
    obsStatusMessage.textContent = obs.message || "";
  }
  if (quickObsStatus) {
    const running = obs.connecting || obs.connected;
    quickObsStatus.textContent = running ? "起動中" : "停止中";
    quickObsStatus.style.color = running ? "#3dd598" : "#ebf2ff";
  }
}

function switchTab(target) {
  tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tabTarget === target);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.tabPanel === target);
  });
}

function renderPaths(status) {
  htmlDir.textContent = `OBS用HTMLフォルダ: ${status.htmlDir || "-"}`;
}

function setLaunchButtonState(running) {
  launchStartButton.disabled = running;
  launchStopButton.disabled = !running;
}

function setCollectButtonState(running) {
  collectStartButton.disabled = running;
  collectStopButton.disabled = !running;
}

function setObsTabEnabled(enabled) {
  if (obsTabContent) {
    obsTabContent.classList.toggle("is-hidden", !enabled);
  }
  if (obsTabOnButton) {
    obsTabOnButton.classList.toggle("primary", enabled);
  }
  if (obsTabOffButton) {
    obsTabOffButton.classList.add("danger");
  }
}

function normalizeDesignValue(value) {
  return value === "frameless_white" ||
    value === "frameless_black" ||
    value === "custom"
    ? value
    : "normal";
}

function getSelectedGlobalDesign() {
  return normalizeDesignValue(designGlobalInputs.find((input) => input.checked)?.value);
}

function normalizeHexColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function normalizeOpacity(value, fallback = 20) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeFontFamilySelection(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "Segoe UI";
  }
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "");
  return first || "Segoe UI";
}

function ensureFontOption(value) {
  const font = normalizeFontFamilySelection(value);
  if (!font) {
    return;
  }
  if ([...designFontFamily.options].some((opt) => opt.value === font)) {
    return;
  }
  const option = document.createElement("option");
  option.value = font;
  option.textContent = font;
  designFontFamily.append(option);
}

async function loadSystemFontOptions(preferredFont = "") {
  const result = await window.mahjongOverlayApp.listSystemFonts();
  const fonts = Array.isArray(result?.fonts) ? result.fonts : [];
  const uniqueFonts = Array.from(
    new Set(
      fonts
        .map((font) => (typeof font === "string" ? font.trim() : ""))
        .filter((font) => font.length > 0)
    )
  );
  designFontFamily.replaceChildren();
  for (const font of uniqueFonts) {
    const option = document.createElement("option");
    option.value = font;
    option.textContent = font;
    designFontFamily.append(option);
  }
  ensureFontOption("Segoe UI");
  ensureFontOption("Meiryo UI");
  const normalizedPreferred = normalizeFontFamilySelection(preferredFont);
  ensureFontOption(normalizedPreferred);
  designFontFamily.value = normalizedPreferred;
}

function applySettings(settings) {
  const scope = settings?.hanCountScope || "all_players";
  hanScopeInputs.forEach((input) => {
    input.checked = input.value === scope;
  });

  const obs = settings?.obsIntegration || {};
  obsWebsocketUrl.value = obs.websocketUrl || "ws://127.0.0.1:4455";
  obsPassword.value = obs.password || "";
  pendingObsMediaSourceName = obs.mediaSourceName || "";
  if ([...obsInputSelect.options].some((option) => option.value === pendingObsMediaSourceName)) {
    obsInputSelect.value = pendingObsMediaSourceName;
  }

  const overlayDesign = settings?.overlayDesign || {};
  const designValue =
    typeof overlayDesign === "string"
      ? normalizeDesignValue(overlayDesign)
      : normalizeDesignValue(overlayDesign.rank);
  for (const input of designGlobalInputs) {
    input.checked = input.value === designValue;
  }

  const overlayStyle = settings?.overlayStyle || {};
  designTextColor.value = normalizeHexColor(overlayStyle.textColor, "#f7f4eb");
  designBorderColor.value = normalizeHexColor(
    overlayStyle.backgroundColor || overlayStyle.borderColor,
    "#ffffff"
  );
  const opacity = normalizeOpacity(
    overlayStyle.backgroundOpacity ?? overlayStyle.borderOpacity,
    20
  );
  designBorderOpacity.value = String(opacity);
  designBorderOpacityValue.textContent = String(opacity);
  const borderWidth = normalizeInt(overlayStyle.borderWidth, 0, 12, 1);
  designCustomBorderColor.value = normalizeHexColor(overlayStyle.borderColor, "#ffffff");
  designCustomBorderWidth.value = String(borderWidth);
  designCustomBorderWidthValue.textContent = String(borderWidth);
  const borderRadius = normalizeInt(overlayStyle.borderRadius, 0, 36, 14);
  designCustomBorderRadius.value = String(borderRadius);
  designCustomBorderRadiusValue.textContent = String(borderRadius);
  const fontFamily = normalizeFontFamilySelection(overlayStyle.fontFamily);
  ensureFontOption(fontFamily);
  designFontFamily.value = fontFamily;
  const fontScale = normalizeInt(overlayStyle.fontScale, 60, 200, 100);
  designFontScale.value = String(fontScale);
  designFontScaleValue.textContent = String(fontScale);
}

function collectFormSettings() {
  const globalDesign = getSelectedGlobalDesign();
  return {
    hanCountScope: hanScopeInputs.find((input) => input.checked)?.value || "all_players",
    overlayDesign: {
      rank: globalDesign,
      points: globalDesign,
      records: globalDesign,
      han: globalDesign
    },
    overlayStyle: {
      textColor: normalizeHexColor(designTextColor.value, "#f7f4eb"),
      backgroundColor: normalizeHexColor(designBorderColor.value, "#ffffff"),
      backgroundOpacity: normalizeOpacity(designBorderOpacity.value, 20),
      borderColor: normalizeHexColor(designCustomBorderColor.value, "#ffffff"),
      borderWidth: normalizeInt(designCustomBorderWidth.value, 0, 12, 1),
      borderRadius: normalizeInt(designCustomBorderRadius.value, 0, 36, 14),
      fontScale: normalizeInt(designFontScale.value, 60, 200, 100),
      fontFamily:
        typeof designFontFamily.value === "string" && designFontFamily.value.trim().length > 0
          ? normalizeFontFamilySelection(designFontFamily.value)
          : "Segoe UI"
    },
    obsIntegration: {
      enabled: true,
      websocketUrl: obsWebsocketUrl.value.trim(),
      password: obsPassword.value,
      mediaSourceName: (obsInputSelect.value || pendingObsMediaSourceName || "").trim()
    }
  };
}

async function refreshStatus() {
  const status = await window.mahjongOverlayApp.getStatus();
  setStatusText(launchStatus, status.launchRunning);
  setStatusText(collectStatus, status.collectRunning);
  setLaunchButtonState(status.launchRunning);
  setCollectButtonState(status.collectRunning);
  renderPaths(status);
  setObsStatus(status);
}

async function loadSettings() {
  const settings = await window.mahjongOverlayApp.getSettings();
  await loadSystemFontOptions(normalizeFontFamilySelection(settings?.overlayStyle?.fontFamily));
  applySettings(settings);
  try {
    await refreshObsInputOptions();
  } catch {
    // Ignore until OBS is connected.
  }
}

function setSettingsMessage(message) {
  settingsStatus.textContent = message;
}

function setObsSettingsMessage(message) {
  obsSettingsStatus.textContent = message;
}

function setDesignSettingsMessage(message) {
  designSettingsStatus.textContent = message;
}

let settingsAutoSaveTimer = null;
let pendingObsMediaSourceName = "";

async function saveGeneralSettingsFromForm() {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    hanCountScope: hanScopeInputs.find((input) => input.checked)?.value || "all_players"
  };
  await window.mahjongOverlayApp.saveSettings(next);
}

function scheduleAutoSaveGeneralSettings() {
  if (settingsAutoSaveTimer) {
    clearTimeout(settingsAutoSaveTimer);
  }
  settingsAutoSaveTimer = setTimeout(() => {
    saveGeneralSettingsFromForm()
      .then(() => {
        setSettingsMessage("設定を自動保存しました");
      })
      .catch((error) => {
        setSettingsMessage(error?.message || String(error));
      });
  }, 120);
}

async function saveObsSettingsFromForm() {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    obsIntegration: collectFormSettings().obsIntegration
  };
  await window.mahjongOverlayApp.saveSettings(next);
}

async function runObsConnect() {
  await saveObsSettingsFromForm();
  try {
    await window.mahjongOverlayApp.connectObs();
    await refreshObsInputOptions();
    setObsSettingsMessage("OBSに接続しました");
  } catch (error) {
    setObsSettingsMessage(error?.message || String(error));
  }
  await refreshStatus();
}

async function runObsSetupSources() {
  await saveObsSettingsFromForm();
  try {
    const result = await window.mahjongOverlayApp.setupObsOverlaySources();
    const createdCount = Array.isArray(result?.created) ? result.created.length : 0;
    const updatedCount = Array.isArray(result?.updated) ? result.updated.length : 0;
    const attachedCount = Array.isArray(result?.linkedToScene) ? result.linkedToScene.length : 0;
    setObsSettingsMessage(
      `OBSソース設定完了: 作成${createdCount}件 / 更新${updatedCount}件 / シーン追加${attachedCount}件`
    );
  } catch (error) {
    setObsSettingsMessage(error?.message || String(error));
  }
  await refreshStatus();
}

let designAutoSaveTimer = null;

async function saveDesignSettings(auto = false) {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    overlayDesign: collectFormSettings().overlayDesign,
    overlayStyle: collectFormSettings().overlayStyle
  };
  await window.mahjongOverlayApp.saveSettings(next);
  setDesignSettingsMessage(auto ? "デザインを自動保存しました" : "デザイン設定を保存しました");
}

function scheduleAutoSaveDesign() {
  if (designAutoSaveTimer) {
    clearTimeout(designAutoSaveTimer);
  }
  designAutoSaveTimer = setTimeout(() => {
    saveDesignSettings(true).catch((error) => {
      setDesignSettingsMessage(error?.message || String(error));
    });
  }, 220);
}

function renderObsInputOptions(inputs) {
  obsInputSelect.replaceChildren();

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = Array.isArray(inputs) && inputs.length > 0
    ? "ソースを選択してください"
    : "ソース一覧を取得してください";
  obsInputSelect.append(placeholder);

  for (const input of Array.isArray(inputs) ? inputs : []) {
    if (!input?.inputName) {
      continue;
    }
    const selectOption = document.createElement("option");
    selectOption.value = input.inputName;
    const kind = input.unversionedInputKind || input.inputKind;
    selectOption.textContent = kind ? `${input.inputName} (${kind})` : input.inputName;
    obsInputSelect.append(selectOption);
  }

  if (pendingObsMediaSourceName) {
    const hasPending = [...obsInputSelect.options].some(
      (option) => option.value === pendingObsMediaSourceName
    );
    if (hasPending) {
      obsInputSelect.value = pendingObsMediaSourceName;
    }
  }
}

obsInputSelect.addEventListener("change", () => {
  pendingObsMediaSourceName = obsInputSelect.value || "";
  saveObsSettingsFromForm().catch((error) => {
    setObsSettingsMessage(error?.message || String(error));
  });
});

async function refreshObsInputOptions() {
  const result = await window.mahjongOverlayApp.listObsInputs();
  renderObsInputOptions(result?.inputs || []);
}

designBorderOpacity.addEventListener("input", () => {
  designBorderOpacityValue.textContent = String(normalizeOpacity(designBorderOpacity.value, 20));
  scheduleAutoSaveDesign();
});
designCustomBorderWidth.addEventListener("input", () => {
  designCustomBorderWidthValue.textContent = String(
    normalizeInt(designCustomBorderWidth.value, 0, 12, 1)
  );
  scheduleAutoSaveDesign();
});
designCustomBorderRadius.addEventListener("input", () => {
  designCustomBorderRadiusValue.textContent = String(
    normalizeInt(designCustomBorderRadius.value, 0, 36, 14)
  );
  scheduleAutoSaveDesign();
});
designFontScale.addEventListener("input", () => {
  designFontScaleValue.textContent = String(normalizeInt(designFontScale.value, 60, 200, 100));
  scheduleAutoSaveDesign();
});

designTextColor.addEventListener("input", scheduleAutoSaveDesign);
designBorderColor.addEventListener("input", scheduleAutoSaveDesign);
designCustomBorderColor.addEventListener("input", scheduleAutoSaveDesign);
designFontFamily.addEventListener("change", scheduleAutoSaveDesign);
for (const input of designGlobalInputs) {
  input.addEventListener("change", scheduleAutoSaveDesign);
}
for (const input of hanScopeInputs) {
  input.addEventListener("change", scheduleAutoSaveGeneralSettings);
}

launchStartButton.addEventListener("click", async () => {
  await window.mahjongOverlayApp.startLaunch();
  await refreshStatus();
});

launchStopButton.addEventListener("click", async () => {
  await window.mahjongOverlayApp.stopLaunch();
  await refreshStatus();
});

collectStartButton.addEventListener("click", async () => {
  await window.mahjongOverlayApp.startCollect();
  await refreshStatus();
});

collectStopButton.addEventListener("click", async () => {
  await window.mahjongOverlayApp.stopCollect();
  await refreshStatus();
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tabTarget);
  });
});

if (obsTabOnButton) {
  obsTabOnButton.addEventListener("click", () => {
    setObsTabEnabled(true);
  });
}

if (obsTabOffButton) {
  obsTabOffButton.addEventListener("click", () => {
    setObsTabEnabled(false);
  });
}

const obsPlayTestButton = document.querySelector("#obs-play-test");
if (obsPlayTestButton) {
  obsPlayTestButton.addEventListener("click", async () => {
    await saveObsSettingsFromForm();
    try {
      await window.mahjongOverlayApp.playObsRiichi();
      setObsSettingsMessage("メディアをテスト再生しました");
    } catch (error) {
      setObsSettingsMessage(error?.message || String(error));
    }
    await refreshStatus();
  });
}

if (quickObsConnectButton) {
  quickObsConnectButton.addEventListener("click", async () => {
    await runObsConnect();
  });
}

if (quickObsDisconnectButton) {
  quickObsDisconnectButton.addEventListener("click", async () => {
    await window.mahjongOverlayApp.disconnectObs();
    setObsSettingsMessage("OBSを切断しました");
    await refreshStatus();
  });
}

if (quickObsSetupSourcesButton) {
  quickObsSetupSourcesButton.addEventListener("click", async () => {
    await runObsSetupSources();
  });
}

document.querySelector("#reset-han").addEventListener("click", async () => {
  const confirmed = window.confirm("翻数をリセットしますか？");
  if (!confirmed) {
    return;
  }

  await window.mahjongOverlayApp.resetHan();
  setSettingsMessage("翻数をリセットしました");
});

document.querySelector("#reset-records").addEventListener("click", async () => {
  const confirmed = window.confirm("戦績をリセットしますか？");
  if (!confirmed) {
    return;
  }

  await window.mahjongOverlayApp.resetRecords();
  setSettingsMessage("戦績をリセットしました");
});

document.querySelector("#reset-points").addEventListener("click", async () => {
  const confirmed = window.confirm("ポイント基準値をリセットしますか？");
  if (!confirmed) {
    return;
  }

  const result = await window.mahjongOverlayApp.resetPoints();
  if (result?.ok) {
    setSettingsMessage("ポイント基準値をリセットしました");
    return;
  }

  setSettingsMessage(result?.message || "ポイント基準値のリセットに失敗しました");
});

window.mahjongOverlayApp.onStatus((payload) => {
  setStatusText(launchStatus, payload.launchRunning);
  setStatusText(collectStatus, payload.collectRunning);
  setLaunchButtonState(payload.launchRunning);
  setCollectButtonState(payload.collectRunning);
  renderPaths(payload);
  setObsStatus(payload);
});

Promise.all([refreshStatus(), loadSettings()]);
setObsTabEnabled(false);
