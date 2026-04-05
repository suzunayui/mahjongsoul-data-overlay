const collectStatus = document.querySelector("#collect-status");
const htmlDir = document.querySelector("#html-dir");
const settingsStatus = document.querySelector("#settings-status");
const tabButtons = [...document.querySelectorAll("[data-tab-target]")];
const tabPanels = [...document.querySelectorAll("[data-tab-panel]")];
const hanScopeInputs = [...document.querySelectorAll('input[name="han-count-scope"]')];

if (!window.mahjongOverlayApp) {
  throw new Error("mahjongOverlayApp is not available");
}

function setStatusText(element, running) {
  element.textContent = running ? "取得中" : "停止中";
  element.style.color = running ? "#3dd598" : "#ebf2ff";
}

function switchTab(target) {
  tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tabTarget === target);
  });
  tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.tabPanel === target);
  });
}

async function refreshStatus() {
  const status = await window.mahjongOverlayApp.getStatus();
  setStatusText(collectStatus, status.collectRunning);
  htmlDir.textContent = `OBS 用 HTML フォルダ: ${status.htmlDir}`;
}

async function loadSettings() {
  const settings = await window.mahjongOverlayApp.getSettings();
  const scope = settings?.hanCountScope || "all_players";
  hanScopeInputs.forEach((input) => {
    input.checked = input.value === scope;
  });
}

function setSettingsMessage(message) {
  settingsStatus.textContent = message;
}

document.querySelector("#collect-start").addEventListener("click", async () => {
  await window.mahjongOverlayApp.startCollect();
  await refreshStatus();
});

document.querySelector("#collect-stop").addEventListener("click", async () => {
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
  const selected = hanScopeInputs.find((input) => input.checked)?.value || "all_players";
  await window.mahjongOverlayApp.saveSettings({
    hanCountScope: selected
  });
  setSettingsMessage("設定を保存しました");
});

document.querySelector("#reset-han").addEventListener("click", async () => {
  const confirmed = window.confirm("飜数をリセットして良いですか？");
  if (!confirmed) {
    return;
  }

  await window.mahjongOverlayApp.resetHan();
  setSettingsMessage("飜数をリセットしました");
});

document.querySelector("#reset-records").addEventListener("click", async () => {
  const confirmed = window.confirm("順位をリセットして良いですか？");
  if (!confirmed) {
    return;
  }

  await window.mahjongOverlayApp.resetRecords();
  setSettingsMessage("順位をリセットしました");
});

document.querySelector("#reset-points").addEventListener("click", async () => {
  const confirmed = window.confirm("段位ポイント増減をリセットして良いですか？");
  if (!confirmed) {
    return;
  }

  const result = await window.mahjongOverlayApp.resetPoints();
  if (result?.ok) {
    setSettingsMessage("段位ポイント増減をリセットしました");
    return;
  }

  setSettingsMessage(result?.message || "段位ポイント増減のリセットに失敗しました");
});

window.mahjongOverlayApp.onStatus((payload) => {
  setStatusText(collectStatus, payload.collectRunning);
  if (payload.htmlDir) {
    htmlDir.textContent = `OBS 用 HTML フォルダ: ${payload.htmlDir}`;
  }
});

Promise.all([refreshStatus(), loadSettings()]);
