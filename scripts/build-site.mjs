// Builds the website (home page + phone field page) into site-dist, ready for
// GitHub Pages. The home page is built as home.html so it can't clash with the
// hub's index.html, then renamed so it opens at the site's address.
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';

import { build } from 'vite';

await build({ mode: 'site' });
await rename('site-dist/home.html', 'site-dist/index.html');

// The field page's script and style files get hashed names at build time; list
// them in the service worker so one visit saves everything for offline use.
const fieldHtml = await readFile('site-dist/field.html', 'utf8');
const assets = [...fieldHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => `./${m[1]}`);
// The Map tab loads on its own (it's big), with MapLibre's worker; save those
// too, so the map opens with no signal even if it was never opened online.
const mapFiles = (await readdir('site-dist/assets')).filter((f) => /^(MapTab|maplibre-gl-worker)-/.test(f)).map((f) => `./assets/${f}`);
if (mapFiles.length < 2) throw new Error('Map tab files not found in site-dist/assets');
assets.push(...mapFiles);
const sw = await readFile('site-dist/field-sw.js', 'utf8');
const list = "'./field.webmanifest'";
if (!sw.includes(list)) throw new Error('field-sw.js precache list not found');
await writeFile('site-dist/field-sw.js', sw.replace(list, [list, ...assets.map((a) => `'${a}'`)].join(', ')));

// Tells GitHub Pages to serve the files as they are.
await writeFile('site-dist/.nojekyll', '');
console.log(`Website built in site-dist (${assets.length} field page files cached for offline)`);
