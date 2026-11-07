// Turns public/logo.svg into build/icon.png (256 px, the app and installer icon)
// and public/apple-touch-icon.png (180 px, the iPhone home screen icon).
// Run after changing the logo: npm run icon
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
// Drawn this many times bigger, then shrunk: a window drawn at exactly the icon's
// size could come out a pixel or two short, leaving a see-through strip on the
// right and bottom (an iPhone shows it as a thin light line around the icon).
// Kept small: Windows won't always make a hidden window as big as asked.
const OVERSAMPLE = 2;

async function render(svg, size, background) {
  const big = size * OVERSAMPLE;
  const win = new BrowserWindow({
    width: big,
    height: big,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  const html = `<html><body style="margin:0;overflow:hidden;background:transparent">
    <img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:100vw;height:100vh">
  </body></html>`;
  await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
  // Give the image a moment to paint.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const shot = await win.webContents.capturePage();
  win.destroy();
  // A window that came out the wrong shape would squash the icon.
  const got = shot.getSize();
  if (got.width !== got.height) throw new Error(`The icon was drawn ${got.width}x${got.height}, not square; try a smaller OVERSAMPLE.`);
  let image = shot.resize({ width: size, height: size, quality: 'best' });
  if (background) image = flatten(image, background);
  return image.toPNG();
}

// Lays the icon over a solid color, so no pixel is see-through (iPhone icons
// should be fully solid). The bitmap is BGRA with premultiplied alpha.
function flatten(image, hex) {
  const { width, height } = image.getSize();
  const bmp = Buffer.from(image.toBitmap());
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let i = 0; i < bmp.length; i += 4) {
    const rest = 255 - bmp[i + 3];
    bmp[i] += Math.round((b * rest) / 255);
    bmp[i + 1] += Math.round((g * rest) / 255);
    bmp[i + 2] += Math.round((r * rest) / 255);
    bmp[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(bmp, { width, height });
}

// Keep running between renders; it quits itself when done.
app.on('window-all-closed', () => undefined);

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'public', 'logo.svg'), 'utf8');
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), await render(svg, 256));
  // iPhone rounds the corners itself and shows see-through ones as a line or
  // black, so its icon gets square corners on a solid background: the tile's color.
  const square = svg.replace(/(<rect[^>]*?)\s+rx="[^"]*"/, '$1');
  const tile = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1] ?? '#1c130d';
  fs.writeFileSync(path.join(root, 'public', 'apple-touch-icon.png'), await render(square, 180, tile));
  console.log('Wrote build/icon.png and public/apple-touch-icon.png');
  app.quit();
});
