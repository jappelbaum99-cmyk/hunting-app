import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative paths so the built files load from disk inside Electron.
  base: './',
  resolve: {
    alias: { '@': page('./src') },
  },
  build: {
    // Two pages: the desktop hub, and the phone field page.
    rolldownOptions: {
      input: { main: page('./index.html'), field: page('./field.html') },
    },
  },
  server: { port: 5173 },
});
