const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  envCheck: () => ipcRenderer.invoke("env-check"),
  login: (args) => ipcRenderer.invoke("login", args),
  get: (args) => ipcRenderer.invoke("api-get", args),
  start: (args) => ipcRenderer.invoke("start", args),
  stop: (args) => ipcRenderer.invoke("stop", args),
  previewStart: (args) => ipcRenderer.invoke("preview-start", args),
  previewStop: () => ipcRenderer.invoke("preview-stop"),
  directStart: (args) => ipcRenderer.invoke("direct-start", args),
  directStop: () => ipcRenderer.invoke("direct-stop"),
  previewLog: () => ipcRenderer.invoke("preview-log"),
  previewOpenLog: () => ipcRenderer.invoke("preview-openlog"),
  onPreviewExit: (cb) => ipcRenderer.on("preview-exit", (_e, p) => cb(p)),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openLog: (sid) => ipcRenderer.invoke("open-log", sid),
  onWorkerExit: (cb) => ipcRenderer.on("worker-exit", (_e, p) => cb(p)),
  // Tự setup Python lần đầu (tạo venv + cài Imou) ngay trong app.
  setupPython: () => ipcRenderer.invoke("setup-python"),
  onSetupProgress: (cb) => ipcRenderer.on("setup-progress", (_e, m) => cb(m)),
});
