const launchStatus = document.querySelector("#launch-status");

if (!window.mahjongOverlayApp) {
  throw new Error("mahjongOverlayApp is not available");
}

function setStatusText(element, running) {
  element.textContent = running ? "動作中" : "停止中";
  element.style.color = running ? "#3dd598" : "#ebf2ff";
}

async function refreshStatus() {
  const status = await window.mahjongOverlayApp.getStatus();
  setStatusText(launchStatus, status.launchRunning);
}

document.querySelector("#launch-start").addEventListener("click", async () => {
  await window.mahjongOverlayApp.startLaunch();
  await refreshStatus();
});

document.querySelector("#launch-stop").addEventListener("click", async () => {
  await window.mahjongOverlayApp.stopLaunch();
  await refreshStatus();
});

window.mahjongOverlayApp.onStatus((payload) => {
  setStatusText(launchStatus, payload.launchRunning);
});

refreshStatus();
