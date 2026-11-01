// Starts the Vite dev server, then opens the Electron window pointed at it.
// Closing the window stops everything.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

const server = await createServer();
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite did not report a local URL');
console.log(`Hub UI at ${url}`);

const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

electron.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
