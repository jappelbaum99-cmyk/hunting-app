// Exposes a small, fixed API to the hub UI. The UI never gets direct Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  loadData: () => ipcRenderer.invoke('hub:loadData'),
  saveData: (json) => ipcRenderer.invoke('hub:saveData', json),
  dataPath: () => ipcRenderer.invoke('hub:dataPath'),
  saveImage: (name, bytes) => ipcRenderer.invoke('hub:saveImage', name, bytes),
  loadImage: (name) => ipcRenderer.invoke('hub:loadImage', name),
  showDataFolder: () => ipcRenderer.invoke('hub:showDataFolder'),
});
