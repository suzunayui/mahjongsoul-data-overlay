const launchStatus = document.querySelector("#launch-status");
const collectStatus = document.querySelector("#collect-status");
const htmlDir = document.querySelector("#html-dir");

if (!window.mahjongOverlayApp) {
  throw new Error("mahjongOverlayApp is not available");
}

function setStatusText(element, running) {
  element.textContent = running ? "動作中" : "停止中";
  element.style.color = running ? "#3dd598" : "#ebf2ff";
}

function updateStatus(payload) {
  setStatusText(launchStatus, payload.launchRunning);
  setStatusText(collectStatus, payload.collectRunning);
  htmlDir.textContent = `OBS 用 HTML フォルダ: ${payload.htmlDir}`;
}

async function refreshStatus() {
  const status = await window.mahjongOverlayApp.getStatus();
  updateStatus(status);
}

document.querySelector("#launch-start").addEventListener("click", async () => {
  await window.mahjongOverlayApp.startLaunch();
  await refreshStatus();
});

document.querySelector("#launch-stop").addEventListener("click", async () => {
  await window.mahjongOverlayApp.stopLaunch();
  await refreshStatus();
});

document.querySelector("#collect-start").addEventListener("click", async () => {
  await window.mahjongOverlayApp.startCollect();
  await refreshStatus();
});

document.querySelector("#collect-stop").addEventListener("click", async () => {
  await window.mahjongOverlayApp.stopCollect();
  await refreshStatus();
});

document.querySelector("#open-html").addEventListener("click", async () => {
  const result = await window.mahjongOverlayApp.openHtmlFolder();
  if (!result.ok) {
    appendLog(result.message || "html フォルダを開けませんでした");
  }
});

document.querySelectorAll("[data-open-overlay]").forEach((button) => {
  button.addEventListener("click", async () => {
    await window.mahjongOverlayApp.openOverlay(button.dataset.openOverlay);
  });
});

window.mahjongOverlayApp.onStatus((payload) => {
  updateStatus(payload);
});

refreshStatus().catch((error) => {
  htmlDir.textContent = `初期化に失敗しました: ${String(error)}`;
});
