const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  envCheck: () => ipcRenderer.invoke("env-check"),
  login: (args) => ipcRenderer.invoke("login", args),
  get: (args) => ipcRenderer.invoke("api-get", args),
  start: (args) => ipcRenderer.invoke("start", args),
  stop: (args) => ipcRenderer.invoke("stop", args),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  openLog: (sid) => ipcRenderer.invoke("open-log", sid),
  onWorkerExit: (cb) => ipcRenderer.on("worker-exit", (_e, p) => cb(p)),
  // Tự setup Python lần đầu (tạo venv + cài Imou) ngay trong app.
  setupPython: () => ipcRenderer.invoke("setup-python"),
  onSetupProgress: (cb) => ipcRenderer.on("setup-progress", (_e, m) => cb(m)),
});
