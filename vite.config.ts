import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Relative paths so the built files load from disk inside Electron.
  base: './',
  resolve: {
    alias: { '@': page('./src') },
  },
  build: {
    // The website (npm run build:site): a home page, renamed to index.html
    // after the build, and the phone field page.
    // The desktop app: the hub, plus the field page for trying it out.
    outDir: mode === 'site' ? 'site-dist' : 'dist',
    rolldownOptions: {
      input: (mode === 'site'
        ? { home: page('./home.html'), field: page('./field.html') }
        : { main: page('./index.html'), field: page('./field.html') }) as Record<string, string>,
    },
  },
  server: { port: 5173 },
}));
