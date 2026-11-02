Hunting Hub: a Windows desktop app (Electron + React + Vite + MapLibre) for mapping hunting property. The phone field page (`field.html`, `src/field`) shares `src/types` and `src/lib`. The website (`home.html` + the field page) is published to GitHub Pages by `.github/workflows/pages.yml`; tagged releases build the installer (`release.yml`).

## Rules

- Everything must be free: no paid APIs, no services that need a card. Map data comes from public USGS services (basemap.nationalmap.gov and elevation.nationalmap.gov).
- The USGS elevation (lidar) server often answers 502/504. All USGS tiles go through the `retry://` protocol in `src/map/layers.ts`; keep it that way.
- Data lives in `Documents\Hunting Hub\hub-data.json`, written by `electron/main.cjs` (temp file + rename, previous copy kept as `.bak`). In a plain browser it falls back to localStorage, which is for development only.
- Records use UUID ids, `createdAt`/`updatedAt`, and soft deletes (`deletedAt`) so they can sync with the phone site later. Never hard-delete records.
- Map images (overlays) are files in `Documents\Hunting Hub\images`, written and read through the `hub:saveImage`/`hub:loadImage` IPC handlers, which only accept plain file names. In a plain browser they go to IndexedDB. Their placement is computed from control points in `src/lib/georef.ts`.
- Camp sync (phone hunts and GPS pins to the hub, stands to the phones) runs on Firebase's free Spark plan with anonymous sign-in: `src/lib/camp.ts`, config in `src/lib/firebaseConfig.ts`, access rules in `firestore.rules` (pasted into the Firebase console). Only hunts, pins and stands go there; maps are shared by file.
- The renderer has no Node access. Add new desktop abilities as small IPC handlers in `electron/main.cjs` exposed through `electron/preload.cjs`.
- Map labels and pins are HTML markers (no glyph/font server needed). Update their classes with `classList`, never `className`, because maplibre adds its own positioning classes.

## Commands

```bash
npm run dev        # desktop window with live reload
npm run dev:web    # same UI in a normal browser at http://localhost:5173
npm start          # production build, then open it in Electron
npm run typecheck  # tsc --noEmit
npm run dist       # Windows installer in release/
npm run build:site # website (home page + phone page) in site-dist/
npm run icon       # remake the app and iPhone icons from public/logo.svg
```

Run the typecheck before declaring a task done.
