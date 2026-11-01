// Electron main process: opens the hub window and owns the data file on disk.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

function dataDir() {
  return path.join(app.getPath('documents'), 'Hunting Hub');
}

function dataFile() {
  return path.join(dataDir(), 'hub-data.json');
}

async function loadData() {
  try {
    return await fs.readFile(dataFile(), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Writes to a temp file first so a crash mid-save never corrupts the data,
// and keeps the previous version as a .bak.
async function saveData(_event, json) {
  if (typeof json !== 'string') throw new Error('saveData expects a JSON string');
  JSON.parse(json);
  await fs.mkdir(dataDir(), { recursive: true });
  const file = dataFile();
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, json, 'utf8');
  await fs.copyFile(file, `${file}.bak`).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await fs.rename(temp, file);
}

// Map images (e.g. county parcel screenshots) live next to the data file.
const IMAGE_NAME = /^[\w-]+\.(png|jpe?g|webp)$/i;

function imagePath(name) {
  // Only plain file names, so the UI can never read or write outside the folder.
  if (typeof name !== 'string' || !IMAGE_NAME.test(name)) throw new Error(`Bad image name: ${name}`);
  return path.join(dataDir(), 'images', name);
}

async function saveImage(_event, name, bytes) {
  const file = imagePath(name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(bytes));
}

async function loadImage(_event, name) {
  return fs.readFile(imagePath(name));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Hunting Hub',
    backgroundColor: '#141814',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Links (e.g. map attribution) open in the normal browser, not inside the hub.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  ipcMain.handle('hub:loadData', loadData);
  ipcMain.handle('hub:saveData', saveData);
  ipcMain.handle('hub:dataPath', () => dataFile());
  ipcMain.handle('hub:saveImage', saveImage);
  ipcMain.handle('hub:loadImage', loadImage);
  ipcMain.handle('hub:showDataFolder', () => shell.openPath(dataDir()));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
