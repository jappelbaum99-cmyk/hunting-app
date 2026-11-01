// Builds the website (home page + phone field page) into site-dist, ready for
// GitHub Pages. The home page is built as home.html so it can't clash with the
// hub's index.html, then renamed so it opens at the site's address.
import { readFile, rename, writeFile } from 'node:fs/promises';

import { build } from 'vite';

await build({ mode: 'site' });
await rename('site-dist/home.html', 'site-dist/index.html');

// The field page's script and style files get hashed names at build time; list
// them in the service worker so one visit saves everything for offline use.
const fieldHtml = await readFile('site-dist/field.html', 'utf8');
const assets = [...fieldHtml.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)].map((m) => `./${m[1]}`);
const sw = await readFile('site-dist/field-sw.js', 'utf8');
const list = "'./field.webmanifest'";
if (!sw.includes(list)) throw new Error('field-sw.js precache list not found');
await writeFile('site-dist/field-sw.js', sw.replace(list, [list, ...assets.map((a) => `'${a}'`)].join(', ')));

// Tells GitHub Pages to serve the files as they are.
await writeFile('site-dist/.nojekyll', '');
console.log(`Website built in site-dist (${assets.length} field page files cached for offline)`);
