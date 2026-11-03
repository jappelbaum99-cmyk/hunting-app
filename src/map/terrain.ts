// 3D terrain from the USGS 3DEP lidar elevation server. MapLibre wants
// elevation as "terrarium" color-coded PNG tiles, which USGS doesn't make, so
// tiles are fetched as plain float TIFFs (meters) and re-coded here.

// Uncompressed float32 GeoTIFF (stripped or tiled), as the USGS server sends
// with compression=None, read into a width x height grid of meters.
export function readElevationTiff(buffer: ArrayBuffer): { width: number; height: number; meters: Float32Array } {
  const view = new DataView(buffer);
  const little = view.getUint16(0) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  const ifd = u32(4);
  const tags = new Map<number, number[]>();
  for (let i = 0; i < u16(ifd); i++) {
    const entry = ifd + 2 + i * 12;
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const size = type === 3 ? 2 : 4;
    const at = count * size > 4 ? u32(entry + 8) : entry + 8;
    const values: number[] = [];
    for (let n = 0; n < count; n++) values.push(type === 3 ? u16(at + n * 2) : u32(at + n * 4));
    tags.set(u16(entry), values);
  }
  const width = tags.get(256)![0];
  const height = tags.get(257)![0];
  if ((tags.get(259)?.[0] ?? 1) !== 1 || tags.get(258)?.[0] !== 32) throw new Error('Unexpected elevation tile format');
  const meters = new Float32Array(width * height);
  const read = (offset: number, i: number) => view.getFloat32(offset + i * 4, little);
  if (tags.has(324)) {
    // Tiled: blocks of tileW x tileH, left to right, top to bottom.
    const tileW = tags.get(322)![0];
    const tileH = tags.get(323)![0];
    const across = Math.ceil(width / tileW);
    tags.get(324)!.forEach((offset, t) => {
      const x0 = (t % across) * tileW;
      const y0 = Math.floor(t / across) * tileH;
      for (let y = 0; y < tileH && y0 + y < height; y++) {
        for (let x = 0; x < tileW && x0 + x < width; x++) meters[(y0 + y) * width + x0 + x] = read(offset, y * tileW + x);
      }
    });
  } else {
    const rowsPerStrip = tags.get(278)?.[0] ?? height;
    tags.get(273)!.forEach((offset, s) => {
      for (let i = 0; i < rowsPerStrip * width && s * rowsPerStrip * width + i < meters.length; i++) meters[s * rowsPerStrip * width + i] = read(offset, i);
    });
  }
  return { width, height, meters };
}

// Terrarium coding: meters = R * 256 + G + B / 256 - 32768. Gaps (no data) become 0 m.
export async function toTerrariumPng(tile: { width: number; height: number; meters: Float32Array }): Promise<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(tile.width * tile.height * 4);
  for (let i = 0; i < tile.meters.length; i++) {
    const m = tile.meters[i];
    const v = (Number.isFinite(m) && m > -1000 && m < 10000 ? m : 0) + 32768;
    rgba[i * 4] = Math.floor(v / 256);
    rgba[i * 4 + 1] = Math.floor(v) % 256;
    rgba[i * 4 + 2] = Math.floor((v - Math.floor(v)) * 256);
    rgba[i * 4 + 3] = 255;
  }
  const canvas = new OffscreenCanvas(tile.width, tile.height);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, tile.width, tile.height), 0, 0);
  return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
