// Turns public/logo.svg into build/icon.png (256 px, the app and installer icon)
// and public/apple-touch-icon.png (180 px, the iPhone home screen icon).
// Run after changing the logo: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}" style="display:block">
  </body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  // Give the image a moment to paint.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const image = (await win.webContents.capturePage()).resize({ width: size, height: size });
  win.destroy();
  return image.toPNG();
}

// Keep running between renders; it quits itself when done.
app.on('window-all-closed', () => undefined);

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'public', 'logo.svg'), 'utf8');
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), await render(svg, 256));
  // iPhone rounds the corners itself and shows transparent ones as black,
  // so its icon gets square corners.
  const square = svg.replace(/(<rect[^>]*?)\s+rx="[^"]*"/, '$1');
  fs.writeFileSync(path.join(root, 'public', 'apple-touch-icon.png'), await render(square, 180));
  console.log('Wrote build/icon.png and public/apple-touch-icon.png');
  app.quit();
});
