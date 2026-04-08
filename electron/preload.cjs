const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("mahjongOverlayApp", {
  startLaunch: () => ipcRenderer.invoke("launch:start"),
  stopLaunch: () => ipcRenderer.invoke("launch:stop"),
  startCollect: () => ipcRenderer.invoke("collect:start"),
  stopCollect: () => ipcRenderer.invoke("collect:stop"),
  openHtmlFolder: () => ipcRenderer.invoke("folder:openHtml"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (settings) => ipcRenderer.invoke("settings:save", settings),
  connectObs: () => ipcRenderer.invoke("obs:connect"),
  disconnectObs: () => ipcRenderer.invoke("obs:disconnect"),
  playObsRiichi: () => ipcRenderer.invoke("obs:playRiichi"),
  listObsInputs: () => ipcRenderer.invoke("obs:listInputs"),
  resetHan: () => ipcRenderer.invoke("han:reset"),
  resetRecords: () => ipcRenderer.invoke("records:reset"),
  resetPoints: () => ipcRenderer.invoke("points:reset"),
  getStatus: () => ipcRenderer.invoke("app:getStatus"),
  onStatus: (callback) => {
    ipcRenderer.on("app:status", (_event, payload) => callback(payload));
  }
});
