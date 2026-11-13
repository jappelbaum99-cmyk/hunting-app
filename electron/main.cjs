// Electron main process: opens the hub window and owns the data file on disk.
const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { autoUpdater } = require('electron-updater');
const detector = require('./detector.cjs');

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

// A dated copy kept before the map starts syncing with another hub. Returns its path.
async function backupData() {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const copy = path.join(dataDir(), `hub-data.before-sharing-${stamp}.json`);
  await fs.copyFile(dataFile(), copy);
  return copy;
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
// The USGS servers, and Missouri's MSDIS photos (only fetched by a property download).
const TILE_HOSTS = new Set(['basemap.nationalmap.gov', 'elevation.nationalmap.gov', 'imagery.nationalmap.gov', 'stateimagery.msdis.missouri.edu']);

function tileDir() {
  return path.join(app.getPath('userData'), 'tile-cache');
}

function tilePath(url) {
  const hash = crypto.createHash('sha1').update(url).digest('hex');
  return path.join(tileDir(), hash.slice(0, 2), `${hash}.tile`);
}

// Returns the tile's bytes from disk, or fetches and saves it. Only tile URLs
// from TILE_HOSTS are allowed. Fails (so the page can retry) on any bad response.
// With saveOnly, makes sure the tile is on disk and returns no bytes (the
// background property download only needs it saved).
// Fetches the map no longer needs (it panned or zoomed away), by request id, so a
// busy USGS server doesn't tie up connections for tiles nobody will see.
const tileFetches = new Map();
const cancelledTiles = new Set();

function cancelTile(_event, requestId) {
  const fetching = tileFetches.get(requestId);
  if (fetching) return fetching.abort();
  // Cancelled before its fetch started (it was still checking the disk).
  cancelledTiles.add(requestId);
  setTimeout(() => cancelledTiles.delete(requestId), 60_000);
}

async function getTile(_event, url, { cacheOnly = false, saveOnly = false, requestId = null } = {}) {
  if (typeof url !== 'string' || !TILE_HOSTS.has(new URL(url).hostname)) throw new Error(`Not a map tile URL: ${url}`);
  const file = tilePath(url);
  if (saveOnly) {
    const have = await fs.access(file).then(
      () => true,
      () => false,
    );
    if (have) return { bytes: null, cached: true };
  }
  try {
    return { bytes: await fs.readFile(file), cached: true };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (cacheOnly) return null;
  if (requestId && cancelledTiles.delete(requestId)) throw new Error('Tile no longer needed');
  // The USGS servers can hang on a busy day. Give up after 30 seconds so the map's
  // loading slot frees up for saved tiles; the map tries the tile again later.
  const cancel = new AbortController();
  if (requestId) tileFetches.set(requestId, cancel);
  let bytes;
  try {
    const response = await net.fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(30_000), cancel.signal]) });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.startsWith('image/')) throw new Error(`USGS answered ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  } finally {
    if (requestId) tileFetches.delete(requestId);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Write then rename, so a half-written tile is never read back.
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, file).catch(() => fs.rm(temp, { force: true }));
  return { bytes: saveOnly ? null : bytes, cached: false };
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

// Trail camera photos. The UI may only read folders the person picked in a
// folder dialog, and only write inside the photo library they chose.
const sourceRoots = new Set();
let libraryRoot = null;
const PHOTO_FILE = /\.(jpe?g)$/i;

// The full path for a relative path inside a root, refusing anything that
// would land outside it.
function inside(root, rel) {
  if (!root || typeof rel !== 'string') throw new Error('No folder for that file');
  const full = path.resolve(root, rel);
  const base = path.resolve(root);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Not inside the folder: ' + rel);
  return full;
}

function requireSource(dir) {
  const resolved = path.resolve(String(dir));
  if (!sourceRoots.has(resolved)) throw new Error('That folder was not picked in this session');
  return resolved;
}

function defaultPhotoLibrary() {
  // In the user's own folder, not Documents or Pictures (often synced to OneDrive).
  return path.join(os.homedir(), 'Hunting Hub Photos');
}

async function pickFolder(event, purpose) {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: purpose === 'library' ? 'Where should trail camera photos be kept?' : 'Folder of trail camera photos (e.g. the SD card)',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: purpose === 'library' ? defaultPhotoLibrary() : undefined,
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const dir = path.resolve(result.filePaths[0]);
  if (purpose === 'library') libraryRoot = dir;
  else sourceRoots.add(dir);
  return dir;
}

async function setPhotoLibrary(_event, dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new Error('The photo library must be a full folder path');
  const resolved = path.resolve(dir);
  await fs.mkdir(resolved, { recursive: true });
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error('That is not a folder');
  libraryRoot = resolved;
  return resolved;
}

// Every photo in a picked folder and its subfolders (cards keep them in DCIM\100MEDIA and so on).
async function listPhotos(_event, dir) {
  const root = requireSource(dir);
  const found = [];
  const walk = async (folder, depth) => {
    if (depth > 6) return;
    for (const entry of await fs.readdir(folder, { withFileTypes: true }).catch(() => [])) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (PHOTO_FILE.test(entry.name)) {
        const info = await fs.stat(full);
        found.push({ rel: path.relative(root, full), size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  };
  await walk(root, 0);
  return found.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }));
}

async function readSourcePhoto(_event, dir, rel) {
  return fs.readFile(inside(requireSource(dir), rel));
}

async function libraryPhotoExists(_event, rel) {
  return fs.access(inside(libraryRoot, rel)).then(
    () => true,
    () => false,
  );
}

// Never overwrites: returns false if a file is already there.
async function writeLibraryPhoto(_event, rel, bytes) {
  const file = inside(libraryRoot, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(file, Buffer.from(bytes), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

function previewPath(rel) {
  return inside(path.join(libraryRoot, '.previews'), rel + '.jpg');
}

async function moveLibraryPhoto(_event, from, to) {
  const source = inside(libraryRoot, from);
  const target = inside(libraryRoot, to);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const taken = await fs.access(target).then(
    () => true,
    () => false,
  );
  if (taken) throw new Error('Already a file at ' + to);
  await fs.rename(source, target);
  // The cached preview is made again from the new spot when needed.
  await fs.rm(previewPath(from), { force: true });
}

// Serves library photos to the hub as hubphoto://photo/<path>, and small
// previews (made once, then kept in the library's .previews folder) as
// hubphoto://preview/<path>.
async function servePhoto(request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  try {
    const file = inside(libraryRoot, rel);
    if (url.host !== 'preview') return net.fetch(pathToFileURL(file).toString());
    const preview = previewPath(rel);
    try {
      return new Response(await fs.readFile(preview), { headers: { 'content-type': 'image/jpeg' } });
    } catch {
      const image = nativeImage.createFromPath(file);
      if (image.isEmpty()) return new Response('Not a photo', { status: 404 });
      const small = image.resize({ width: 360, quality: 'good' }).toJPEG(78);
      await fs.mkdir(path.dirname(preview), { recursive: true });
      await fs.writeFile(preview, small);
      return new Response(small, { headers: { 'content-type': 'image/jpeg' } });
    }
  } catch (error) {
    return new Response(String((error && error.message) || error), { status: 404 });
  }
}

// Updates: asks GitHub (free, no account) whether a newer installer was published.
// The hub then downloads and installs it itself with electron-updater, which reads
// latest.yml from the same release and checks the download against its fingerprint.
const RELEASES = 'https://github.com/jappelbaum99-cmyk/hunting-app/releases';
const LATEST_RELEASE_API = 'https://api.github.com/repos/jappelbaum99-cmyk/hunting-app/releases/latest';

function versionParts(version) {
  return String(version).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}

function isNewer(latest, current) {
  const a = versionParts(latest);
  const b = versionParts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

async function checkForUpdate() {
  const current = app.getVersion();
  const response = await net.fetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Hunting-Hub/${current}` },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = await response.json();
  const latest = String(release.tag_name ?? '').replace(/^v/, '');
  return {
    current,
    latest,
    available: latest !== '' && isNewer(latest, current),
    publishedAt: release.published_at ?? null,
    notes: typeof release.body === 'string' ? release.body.slice(0, 2000) : '',
  };
}

function sendUpdateStatus(status) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('hub:updateStatus', status);
}

function downloadInBrowser() {
  return shell.openExternal(`${RELEASES}/latest/download/Hunting-Hub-Setup.exe`);
}

async function downloadUpdate() {
  // A dev window has no installed copy to replace.
  if (!app.isPackaged) return downloadInBrowser();
  sendUpdateStatus({ state: 'downloading', percent: 0 });
  try {
    await autoUpdater.checkForUpdates();
    await autoUpdater.downloadUpdate();
  } catch (err) {
    console.error('Update download failed', err);
    sendUpdateStatus({ state: 'error' });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Fenceline',
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

protocol.registerSchemesAsPrivileged([{ scheme: 'hubphoto', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

app.whenReady().then(() => {
  protocol.handle('hubphoto', servePhoto);
  ipcMain.handle('hub:loadData', loadData);
  ipcMain.handle('hub:saveData', saveData);
  ipcMain.handle('hub:backupData', backupData);
  ipcMain.handle('hub:dataPath', () => dataFile());
  ipcMain.handle('hub:saveImage', saveImage);
  ipcMain.handle('hub:loadImage', loadImage);
  ipcMain.handle('hub:getTile', getTile);
  ipcMain.handle('hub:cancelTile', cancelTile);
  ipcMain.handle('hub:tileCacheInfo', tileCacheInfo);
  ipcMain.handle('hub:clearTileCache', clearTileCache);
  ipcMain.handle('hub:showDataFolder', () => shell.openPath(dataDir()));
  ipcMain.handle('hub:pickFolder', pickFolder);
  ipcMain.handle('hub:defaultPhotoLibrary', () => defaultPhotoLibrary());
  ipcMain.handle('hub:setPhotoLibrary', setPhotoLibrary);
  ipcMain.handle('hub:listPhotos', listPhotos);
  ipcMain.handle('hub:readSourcePhoto', readSourcePhoto);
  ipcMain.handle('hub:libraryPhotoExists', libraryPhotoExists);
  ipcMain.handle('hub:writeLibraryPhoto', writeLibraryPhoto);
  ipcMain.handle('hub:moveLibraryPhoto', moveLibraryPhoto);
  ipcMain.handle('hub:detectorStatus', () => detector.status());
  ipcMain.handle('hub:downloadDetector', (event) =>
    detector.download((received, total) => {
      if (!event.sender.isDestroyed()) event.sender.send('hub:detectorProgress', received, total);
    }),
  );
  ipcMain.handle('hub:detectPhoto', (_event, rel) => detector.detect(inside(libraryRoot, rel)));
  ipcMain.handle('hub:checkForUpdate', checkForUpdate);
  autoUpdater.autoDownload = false;
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', () => sendUpdateStatus({ state: 'ready' }));
  ipcMain.handle('hub:downloadUpdate', downloadUpdate);
  ipcMain.handle('hub:downloadUpdateInBrowser', downloadInBrowser);
  // Installs without the setup screens, then reopens the hub.
  ipcMain.handle('hub:installUpdate', () => autoUpdater.quitAndInstall(true, true));
  ipcMain.handle('hub:openReleaseNotes', () => shell.openExternal(`${RELEASES}/latest`));
  ipcMain.handle('hub:openLibraryFolder', (_event, rel) => shell.openPath(rel ? inside(libraryRoot, rel) : libraryRoot));
  createWindow();
});

app.on('window-all-closed', () => app.quit());
