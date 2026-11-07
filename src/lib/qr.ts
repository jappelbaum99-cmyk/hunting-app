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

// A card to save and share: the camp's name, the QR code, the code written out,
// and where to type it for a phone without a camera that reads QR codes.
export async function campQrCard(campName: string, code: string): Promise<Blob> {
  const modules = qrModules(campJoinUrl(code));
  const quiet = 4;
  const cell = 10;
  const qrSize = (modules.length + quiet * 2) * cell;
  const width = Math.max(qrSize + 80, 560);
  const height = qrSize + 330;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  await document.fonts?.ready;

  g.fillStyle = '#1c130d';
  g.fillRect(0, 0, width, height);
  g.textAlign = 'center';
  g.fillStyle = '#f08a24';
  g.font = '600 20px "Josefin Slab", Georgia, serif';
  g.fillText('FENCELINE CAMP', width / 2, 44);
  g.fillStyle = '#f7efe6';
  g.font = '700 32px system-ui, sans-serif';
  g.fillText(fitText(g, campName, width - 60), width / 2, 86);

  // Black on white with a quiet border: what phone cameras read best.
  const left = (width - qrSize) / 2;
  const top = 112;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(left, top, qrSize, qrSize, 16);
  g.fill();
  g.fillStyle = '#000000';
  modules.forEach((row, y) => row.forEach((dark, x) => dark && g.fillRect(left + (x + quiet) * cell, top + (y + quiet) * cell, cell, cell)));

  const below = top + qrSize;
  g.fillStyle = '#c9b8a6';
  g.font = '18px system-ui, sans-serif';
  g.fillText('Scan with the phone camera to join, or enter this code', width / 2, below + 44);
  g.fillStyle = '#f7efe6';
  g.font = '700 40px ui-monospace, Consolas, monospace';
  g.fillText(code, width / 2, below + 100);
  g.fillStyle = '#c9b8a6';
  g.font = '18px system-ui, sans-serif';
  g.fillText('on the Camp tab of the phone page:', width / 2, below + 146);
  g.font = '16px system-ui, sans-serif';
  g.fillText(fitText(g, FIELD_PAGE_URL.replace('https://', ''), width - 40), width / 2, below + 174);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), 'image/png'));
}

function fitText(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
