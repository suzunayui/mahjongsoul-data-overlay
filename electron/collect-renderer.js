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
const obsEnabled = document.querySelector("#obs-enabled");
const obsWebsocketUrl = document.querySelector("#obs-websocket-url");
const obsPassword = document.querySelector("#obs-password");
const obsMediaSourceName = document.querySelector("#obs-media-source-name");
const obsInputList = document.querySelector("#obs-input-list");
const obsInputSelect = document.querySelector("#obs-input-select");
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
  obsStatus.textContent = obs.connecting ? "接続中" : obs.connected ? "接続済み" : "未接続";
  obsStatus.style.color = obs.connecting ? "#59a6ff" : obs.connected ? "#3dd598" : "#ebf2ff";
  obsStatusMessage.textContent = obs.message || "";
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

function applySettings(settings) {
  const scope = settings?.hanCountScope || "all_players";
  hanScopeInputs.forEach((input) => {
    input.checked = input.value === scope;
  });

  const obs = settings?.obsIntegration || {};
  obsEnabled.checked = obs.enabled === true;
  obsWebsocketUrl.value = obs.websocketUrl || "ws://127.0.0.1:4455";
  obsPassword.value = obs.password || "";
  obsMediaSourceName.value = obs.mediaSourceName || "";
}

function collectFormSettings() {
  return {
    hanCountScope: hanScopeInputs.find((input) => input.checked)?.value || "all_players",
    obsIntegration: {
      enabled: obsEnabled.checked,
      websocketUrl: obsWebsocketUrl.value.trim(),
      password: obsPassword.value,
      mediaSourceName: obsMediaSourceName.value.trim()
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
  applySettings(settings);
}

function setSettingsMessage(message) {
  settingsStatus.textContent = message;
}

function setObsSettingsMessage(message) {
  obsSettingsStatus.textContent = message;
}

function renderObsInputOptions(inputs) {
  obsInputList.replaceChildren();
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
    const option = document.createElement("option");
    option.value = input.inputName;
    const kind = input.unversionedInputKind || input.inputKind;
    if (kind) {
      option.label = `${input.inputName} (${kind})`;
    }
    obsInputList.append(option);

    const selectOption = document.createElement("option");
    selectOption.value = input.inputName;
    selectOption.textContent = kind ? `${input.inputName} (${kind})` : input.inputName;
    obsInputSelect.append(selectOption);
  }
}

obsInputSelect.addEventListener("change", () => {
  if (obsInputSelect.value) {
    obsMediaSourceName.value = obsInputSelect.value;
  }
});

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

document.querySelector("#open-html").addEventListener("click", async () => {
  await window.mahjongOverlayApp.openHtmlFolder();
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    switchTab(button.dataset.tabTarget);
  });
});

document.querySelector("#save-settings").addEventListener("click", async () => {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    hanCountScope: hanScopeInputs.find((input) => input.checked)?.value || "all_players"
  };
  await window.mahjongOverlayApp.saveSettings(next);
  setSettingsMessage("設定を保存しました");
});

document.querySelector("#save-obs-settings").addEventListener("click", async () => {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    obsIntegration: collectFormSettings().obsIntegration
  };
  await window.mahjongOverlayApp.saveSettings(next);
  setObsSettingsMessage("OBS設定を保存しました");
  await refreshStatus();
});

document.querySelector("#obs-connect").addEventListener("click", async () => {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    obsIntegration: collectFormSettings().obsIntegration
  };
  await window.mahjongOverlayApp.saveSettings(next);
  try {
    await window.mahjongOverlayApp.connectObs();
    setObsSettingsMessage("OBSに接続しました");
  } catch (error) {
    setObsSettingsMessage(error?.message || String(error));
  }
  await refreshStatus();
});

document.querySelector("#obs-disconnect").addEventListener("click", async () => {
  await window.mahjongOverlayApp.disconnectObs();
  setObsSettingsMessage("OBSを切断しました");
  await refreshStatus();
});

document.querySelector("#obs-play-test").addEventListener("click", async () => {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    obsIntegration: collectFormSettings().obsIntegration
  };
  await window.mahjongOverlayApp.saveSettings(next);
  try {
    await window.mahjongOverlayApp.playObsRiichi();
    setObsSettingsMessage("メディアをテスト再生しました");
  } catch (error) {
    setObsSettingsMessage(error?.message || String(error));
  }
  await refreshStatus();
});

document.querySelector("#obs-refresh-inputs").addEventListener("click", async () => {
  const current = await window.mahjongOverlayApp.getSettings();
  const next = {
    ...current,
    obsIntegration: collectFormSettings().obsIntegration
  };
  await window.mahjongOverlayApp.saveSettings(next);
  try {
    const result = await window.mahjongOverlayApp.listObsInputs();
    renderObsInputOptions(result?.inputs || []);
    setObsSettingsMessage(`${(result?.inputs || []).length} 件のソースを取得しました`);
  } catch (error) {
    setObsSettingsMessage(error?.message || String(error));
  }
  await refreshStatus();
});

document.querySelector("#reset-han").addEventListener("click", async () => {
  const confirmed = window.confirm("役数をリセットしますか？");
  if (!confirmed) {
    return;
  }

  await window.mahjongOverlayApp.resetHan();
  setSettingsMessage("役数をリセットしました");
});

document.querySelector("#reset-records").addEventListener("click", async () => {
  const confirmed = window.confirm("順位をリセットしますか？");
  if (!confirmed) {
    return;
  }

  await window.mahjongOverlayApp.resetRecords();
  setSettingsMessage("順位をリセットしました");
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
