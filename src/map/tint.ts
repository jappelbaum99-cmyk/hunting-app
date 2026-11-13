// Recoloring black-line tiles (USGS contours) to any color. Each pixel keeps
// how dark and solid its line was, as see-through-ness, and takes the new
// color, so lines stay smooth at their edges and the background disappears.

// '#8b5a2b' -> [139, 90, 43].
function rgbOf(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function tintPixels(data: Uint8ClampedArray, hex: string): void {
  const [r, g, b] = rgbOf(hex);
  for (let i = 0; i < data.length; i += 4) {
    const lightness = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
    // A dark, solid pixel is line; white or see-through is background.
    const line = (data[i + 3] / 255) * (1 - lightness);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = Math.round(line * 255);
  }
}

// An image drawn in the new color.
export function tintedCanvas(image: ImageBitmap, hex: string): OffscreenCanvas {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  tintPixels(pixels.data, hex);
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

// A tile's PNG bytes, recolored.
export async function tintPng(bytes: ArrayBuffer, hex: string): Promise<ArrayBuffer> {
  const image = await createImageBitmap(new Blob([bytes]));
  const canvas = tintedCanvas(image, hex);
  image.close();
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
