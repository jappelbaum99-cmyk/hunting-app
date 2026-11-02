// Exposes a small, fixed API to the hub UI. The UI never gets direct Node access.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  loadData: () => ipcRenderer.invoke('hub:loadData'),
  saveData: (json) => ipcRenderer.invoke('hub:saveData', json),
  dataPath: () => ipcRenderer.invoke('hub:dataPath'),
  saveImage: (name, bytes) => ipcRenderer.invoke('hub:saveImage', name, bytes),
  loadImage: (name) => ipcRenderer.invoke('hub:loadImage', name),
  getTile: (url, options) => ipcRenderer.invoke('hub:getTile', url, options),
  tileCacheInfo: () => ipcRenderer.invoke('hub:tileCacheInfo'),
  clearTileCache: () => ipcRenderer.invoke('hub:clearTileCache'),
  showDataFolder: () => ipcRenderer.invoke('hub:showDataFolder'),
  pickFolder: (purpose) => ipcRenderer.invoke('hub:pickFolder', purpose),
  defaultPhotoLibrary: () => ipcRenderer.invoke('hub:defaultPhotoLibrary'),
  setPhotoLibrary: (dir) => ipcRenderer.invoke('hub:setPhotoLibrary', dir),
  listPhotos: (dir) => ipcRenderer.invoke('hub:listPhotos', dir),
  readSourcePhoto: (dir, rel) => ipcRenderer.invoke('hub:readSourcePhoto', dir, rel),
  libraryPhotoExists: (rel) => ipcRenderer.invoke('hub:libraryPhotoExists', rel),
  writeLibraryPhoto: (rel, bytes) => ipcRenderer.invoke('hub:writeLibraryPhoto', rel, bytes),
  moveLibraryPhoto: (from, to) => ipcRenderer.invoke('hub:moveLibraryPhoto', from, to),
  openLibraryFolder: (rel) => ipcRenderer.invoke('hub:openLibraryFolder', rel),
  detectorStatus: () => ipcRenderer.invoke('hub:detectorStatus'),
  downloadDetector: () => ipcRenderer.invoke('hub:downloadDetector'),
  onDetectorProgress: (callback) => {
    const listener = (_event, received, total) => callback(received, total);
    ipcRenderer.on('hub:detectorProgress', listener);
    return () => ipcRenderer.removeListener('hub:detectorProgress', listener);
  },
  detectPhoto: (rel) => ipcRenderer.invoke('hub:detectPhoto', rel),
});
