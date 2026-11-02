// Finds animals (and people and vehicles) in trail camera photos with
// Microsoft's MegaDetector V6 (yolov9-c), run on this PC with ONNX Runtime.
// The model (about 100 MB) is downloaded once, on first use, from Microsoft's
// official record, and checked against its published fingerprint.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const path = require('node:path');
const { app, nativeImage, net } = require('electron');

const MODEL = {
  name: 'MegaDetector V6 (yolov9-c)',
  file: 'MDV6-yolov9-c.onnx',
  url: 'https://zenodo.org/records/15398270/files/MDV6-yolov9-c.onnx?download=1',
  md5: '3db7988385714066c1515dde6ab56e4c',
  bytes: 101437043,
};
const SIZE = 640;
const LABELS = ['animal', 'person', 'vehicle'];
// Boxes below this score are dropped before deciding.
const MIN_SCORE = 0.05;

function modelPath() {
  return path.join(app.getPath('userData'), 'models', MODEL.file);
}

async function status() {
  const info = await fs.stat(modelPath()).catch(() => null);
  return { name: MODEL.name, ready: !!info && info.size === MODEL.bytes, bytes: MODEL.bytes };
}

// Downloads the model, reporting progress, and keeps it only if the fingerprint matches.
async function download(onProgress) {
  const target = modelPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.download`;
  const response = await net.fetch(MODEL.url);
  if (!response.ok || !response.body) throw new Error(`The model download answered ${response.status}`);
  const hash = crypto.createHash('md5');
  const out = createWriteStream(temp);
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      onProgress(received, MODEL.bytes);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (hash.digest('hex') !== MODEL.md5) {
    await fs.rm(temp, { force: true });
    throw new Error("The downloaded model didn't match Microsoft's fingerprint, so it was thrown away. Try again.");
  }
  await fs.rename(temp, target);
  return status();
}

let sessionPromise = null;

// The model, loaded once. Uses the graphics chip through DirectML when it can, else the processor.
function session() {
  if (!sessionPromise) {
    const ort = require('onnxruntime-node');
    sessionPromise = ort.InferenceSession.create(modelPath(), { executionProviders: ['dml', 'cpu'] }).catch(() =>
      ort.InferenceSession.create(modelPath(), { executionProviders: ['cpu'] }),
    );
    sessionPromise.catch(() => (sessionPromise = null));
  }
  return sessionPromise;
}

// The photo shrunk to fit 640x640, centered on grey (how the model was trained),
// as the float RGB tensor the model takes.
function prepare(file) {
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error('Not a photo this can read');
  const { width, height } = image.getSize();
  const scale = SIZE / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const padX = Math.floor((SIZE - w) / 2);
  const padY = Math.floor((SIZE - h) / 2);
  const bgra = image.resize({ width: w, height: h, quality: 'good' }).toBitmap();
  const plane = SIZE * SIZE;
  const data = new Float32Array(3 * plane).fill(114 / 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const o = (y + padY) * SIZE + (x + padX);
      data[o] = bgra[i + 2] / 255;
      data[plane + o] = bgra[i + 1] / 255;
      data[2 * plane + o] = bgra[i] / 255;
    }
  }
  return { data, width, height, scale, padX, padY };
}

function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

// Finds what's in one photo: boxes as [x, y, width, height] in 0-1 of the photo, with scores.
async function detect(file) {
  const started = Date.now();
  const s = await session();
  const ort = require('onnxruntime-node');
  const p = prepare(file);
  const result = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', p.data, [1, 3, SIZE, SIZE]) });
  const out = result[s.outputNames[0]];
  // Rows: centre x, centre y, width, height (input pixels), then one score per label.
  const [, rows, anchors] = out.dims;
  const d = out.data;
  const found = [];
  for (let a = 0; a < anchors; a++) {
    let best = 0;
    let label = 0;
    for (let c = 4; c < rows; c++) {
      if (d[c * anchors + a] > best) [best, label] = [d[c * anchors + a], c - 4];
    }
    if (best < MIN_SCORE) continue;
    const cx = d[a];
    const cy = d[anchors + a];
    const bw = d[2 * anchors + a];
    const bh = d[3 * anchors + a];
    const x = (cx - bw / 2 - p.padX) / p.scale / p.width;
    const y = (cy - bh / 2 - p.padY) / p.scale / p.height;
    found.push({ label: LABELS[label] ?? 'animal', score: best, box: [x, y, bw / p.scale / p.width, bh / p.scale / p.height] });
  }
  // Keep the best of overlapping boxes.
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const f of found) {
    if (kept.length >= 20) break;
    if (!kept.some((k) => k.label === f.label && iou(k.box, f.box) > 0.45)) kept.push(f);
  }
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return {
    detections: kept.map((k) => ({
      label: k.label,
      score: Math.round(k.score * 1000) / 1000,
      box: [clamp(k.box[0]), clamp(k.box[1]), clamp(k.box[2]), clamp(k.box[3])].map((v) => Math.round(v * 10000) / 10000),
    })),
    ms: Date.now() - started,
    model: MODEL.name,
  };
}

module.exports = { status, download, detect, modelPath };
