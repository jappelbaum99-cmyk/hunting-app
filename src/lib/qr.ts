// QR codes for joining a camp: the hub shows one, a phone's camera opens the
// phone page with the camp code already filled in (see campJoinUrl in lib/site.ts).
import qrcode from 'qrcode-generator';

import { campJoinUrl, FIELD_PAGE_URL } from '@/lib/site';

// Which squares are dark, row by row. Medium error correction: still scans
// when printed small, smudged or photographed at an angle.
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, row) => Array.from({ length: n }, (_, col) => qr.isDark(row, col)));
}

// Dark squares as one SVG path, in module units.
export function qrPath(modules: boolean[][]): string {
  let d = '';
  modules.forEach((row, y) => row.forEach((dark, x) => dark && (d += `M${x} ${y}h1v1h-1z`)));
  return d;
}

// A card to save and share, in Fenceline colors: the wordmark, the camp's name,
// the QR code, and the 12-letter code in a band at the bottom for anyone who'd
// rather type it.
const DARK = '#1c130d';
const ORANGE = '#f08a24';
const CREAM = '#f7efe6';
const MUTED = '#c9b8a6';

export async function campQrCard(campName: string, code: string): Promise<Blob> {
  const modules = qrModules(campJoinUrl(code));
  const quiet = 4;
  const cell = 11;
  const qrSize = (modules.length + quiet * 2) * cell;
  const width = 760;
  const wordmarkH = 210;
  const qrTop = 60 + wordmarkH + 120;
  const bandTop = qrTop + qrSize + 44;
  const height = bandTop + 150 + 96;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const [wordmark] = await Promise.all([loadImage(`${import.meta.env.BASE_URL}wordmark.png`), document.fonts?.ready]);
  const mid = width / 2;

  // Background with faint contour lines, like a topo map.
  const glow = g.createRadialGradient(mid, 0, 40, mid, 0, height);
  glow.addColorStop(0, '#3a2414');
  glow.addColorStop(0.6, DARK);
  g.fillStyle = glow;
  g.fillRect(0, 0, width, height);
  g.strokeStyle = 'rgba(240, 138, 36, 0.09)';
  g.lineWidth = 2;
  for (let i = 0; i < 14; i++) {
    const y0 = 40 + i * (height / 13);
    g.beginPath();
    for (let x = 0; x <= width; x += 8) {
      const y = y0 + Math.sin(x / 90 + i * 0.9) * 18 + Math.sin(x / 37 + i) * 6;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  // Double orange frame.
  g.strokeStyle = ORANGE;
  g.lineWidth = 5;
  g.strokeRect(18, 18, width - 36, height - 36);
  g.lineWidth = 1.5;
  g.strokeRect(30, 30, width - 60, height - 60);

  g.textAlign = 'center';
  if (wordmark) {
    const w = (wordmark.naturalWidth / wordmark.naturalHeight) * wordmarkH;
    g.drawImage(wordmark, mid - w / 2, 56, w, wordmarkH);
  } else {
    g.fillStyle = CREAM;
    g.font = '600 64px "Josefin Slab", Georgia, serif';
    g.fillText('FENCELINE', mid, 56 + wordmarkH / 2);
  }

  g.fillStyle = ORANGE;
  g.font = '700 20px system-ui, sans-serif';
  g.letterSpacing = '6px';
  g.fillText('JOIN THE CAMP', mid, 60 + wordmarkH + 42);
  g.letterSpacing = '0px';
  g.fillStyle = CREAM;
  g.font = '700 42px system-ui, sans-serif';
  g.fillText(fitText(g, campName, width - 120), mid, 60 + wordmarkH + 92);

  // The QR code black on white (what phone cameras read best), in an orange ring.
  const left = mid - qrSize / 2;
  g.fillStyle = ORANGE;
  g.beginPath();
  g.roundRect(left - 8, qrTop - 8, qrSize + 16, qrSize + 16, 24);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(left, qrTop, qrSize, qrSize, 18);
  g.fill();
  g.fillStyle = '#000000';
  modules.forEach((row, y) => row.forEach((dark, x) => dark && g.fillRect(left + (x + quiet) * cell, qrTop + (y + quiet) * cell, cell, cell)));

  // The code in an orange band.
  g.fillStyle = ORANGE;
  g.fillRect(30, bandTop, width - 60, 150);
  g.fillStyle = DARK;
  g.font = '700 18px system-ui, sans-serif';
  g.letterSpacing = '5px';
  g.fillText('CAMP CODE', mid, bandTop + 40);
  g.font = '800 62px ui-monospace, Consolas, monospace';
  g.letterSpacing = '3px';
  g.fillText(code, mid, bandTop + 112);
  g.letterSpacing = '0px';

  g.fillStyle = MUTED;
  g.font = '19px system-ui, sans-serif';
  g.fillText('Scan with the phone camera, or type the code on the Camp tab of', mid, bandTop + 190, width - 90);
  g.fillStyle = CREAM;
  g.font = '600 19px system-ui, sans-serif';
  g.fillText(fitText(g, FIELD_PAGE_URL.replace('https://', ''), width - 90), mid, bandTop + 220);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), 'image/png'));
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fitText(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
