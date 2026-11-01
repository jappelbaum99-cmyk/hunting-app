Hunting Hub: a Windows desktop app (Electron + React + Vite + MapLibre) for mapping hunting property. A small phone website for offline GPS pins comes later and will share `src/types` and `src/lib`.

## Rules

- Everything must be free: no paid APIs, no services that need a card. Map data comes from public USGS services (basemap.nationalmap.gov and elevation.nationalmap.gov).
- The USGS elevation (lidar) server often answers 502/504. All USGS tiles go through the `retry://` protocol in `src/map/layers.ts`; keep it that way.
- Data lives in `Documents\Hunting Hub\hub-data.json`, written by `electron/main.cjs` (temp file + rename, previous copy kept as `.bak`). In a plain browser it falls back to localStorage, which is for development only.
- Records use UUID ids, `createdAt`/`updatedAt`, and soft deletes (`deletedAt`) so they can sync with the phone site later. Never hard-delete records.
- Map images (overlays) are files in `Documents\Hunting Hub\images`, written and read through the `hub:saveImage`/`hub:loadImage` IPC handlers, which only accept plain file names. In a plain browser they go to IndexedDB. Their placement is computed from control points in `src/lib/georef.ts`.
- The renderer has no Node access. Add new desktop abilities as small IPC handlers in `electron/main.cjs` exposed through `electron/preload.cjs`.
- Map labels and pins are HTML markers (no glyph/font server needed). Update their classes with `classList`, never `className`, because maplibre adds its own positioning classes.

## Commands

```bash
npm run dev        # desktop window with live reload
npm run dev:web    # same UI in a normal browser at http://localhost:5173
npm start          # production build, then open it in Electron
npm run typecheck  # tsc --noEmit
```

Run the typecheck before declaring a task done.
