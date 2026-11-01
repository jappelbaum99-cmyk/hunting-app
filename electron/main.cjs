// Electron main process: opens the hub window and owns the data file on disk.
const { app, BrowserWindow, ipcMain, net, shell } = require('electron');
const crypto = require('node:crypto');
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

// Map tiles are kept on disk so panning around (or reopening the app) doesn't
// fetch them again, and so a downloaded property works with no internet.
// They live in the app's local folder, not Documents: Documents is synced to
// OneDrive here, and tiles add up.
const TILE_HOSTS = new Set(['basemap.nationalmap.gov', 'elevation.nationalmap.gov']);

function tileDir() {
  return path.join(app.getPath('userData'), 'tile-cache');
}

function tilePath(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex');
  return path.join(tileDir(), hash.slice(0, 2), `${hash}.tile`);
}

// Returns the tile's bytes from disk, or fetches and saves it. Only USGS
// tile URLs are allowed. Fails (so the page can retry) on any bad response.
async function getTile(_event, url, { cacheOnly = false } = {}) {
  if (typeof url !== 'string' || !TILE_HOSTS.has(new URL(url).hostname)) throw new Error(`Not a map tile URL: ${url}`);
  const file = tilePath(url);
  try {
    return { bytes: await fs.readFile(file), cached: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cacheOnly) return null;
  const response = await net.fetch(url);
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.startsWith('image/')) throw new Error(`USGS answered ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write then rename, so a half-written tile is never read back.
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, file).catch(() => fs.rm(temp, { force: true }));
  return { bytes, cached: false };
}

async function tileCacheInfo() {
  let count = 0;
  let bytes = 0;
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.tile')) {
        count += 1;
        bytes += (await fs.stat(full)).size;
      }
    }
  };
  await walk(tileDir());
  return { count, bytes };
}

async function clearTileCache() {
  await fs.rm(tileDir(), { recursive: true, force: true });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Hunting Hub',
    backgroundColor: '#1c130d',
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
  ipcMain.handle('hub:getTile', getTile);
  ipcMain.handle('hub:tileCacheInfo', tileCacheInfo);
  ipcMain.handle('hub:clearTileCache', clearTileCache);
  ipcMain.handle('hub:showDataFolder', () => shell.openPath(dataDir()));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
