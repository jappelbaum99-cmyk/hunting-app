Fenceline (formerly Hunting Hub): a Windows desktop app (Electron + React + Vite + MapLibre) for mapping hunting property. The phone field page (`field.html`, `src/field`) shares `src/types` and `src/lib`. The website (`home.html` + the field page) is published to GitHub Pages by `.github/workflows/pages.yml`; tagged releases build the installer (`release.yml`).

## Rules

- Everything must be free: no paid APIs, no services that need a card. Map data comes from public USGS services (basemap.nationalmap.gov, elevation.nationalmap.gov, and imagery.nationalmap.gov for close-up NAIP aerials past zoom 15).
- The USGS elevation (lidar) server often answers 502/504. All USGS tiles go through the `retry://` protocol in `src/map/layers.ts` (3D terrain uses `retry-dem://`, the same retries plus re-coding the float elevation TIFF in `src/map/terrain.ts`); keep it that way.
- Data lives in `Documents\Hunting Hub\hub-data.json`, written by `electron/main.cjs` (temp file + rename, previous copy kept as `.bak`). In a plain browser it falls back to localStorage, which is for development only.
- Records use UUID ids, `createdAt`/`updatedAt`, and soft deletes (`deletedAt`) so they can sync with the phone site later. Never hard-delete records.
- Map images (overlays) are files in `Documents\Hunting Hub\images`, written and read through the `hub:saveImage`/`hub:loadImage` IPC handlers, which only accept plain file names. In a plain browser they go to IndexedDB. Their placement is computed from control points in `src/lib/georef.ts`.
- Camp sync (phone hunts and GPS pins to the hub, stands to the phones) runs on Firebase's free Spark plan with anonymous sign-in: `src/lib/camp.ts`, config in `src/lib/firebaseConfig.ts`, access rules in `firestore.rules` (pasted into the Firebase console). Hunters, on the phone page, get hunts, pins, stands, walks and notes, plus food plot names (no shapes) on the camp document. They can send notes for the Action Board but don't see it.
- Partners are the hubs running a camp: the one that started it and any approved by a partner. They share the map, plans, logs and board in the camp's `shared` collection, which only partners can read (`src/lib/partnerSync.ts`, `src/data/usePartnerSync.ts`). Each record is packed as text, because Firestore can't hold nested arrays. Everything saves locally first and only changes move; the newest change to a record wins. Trail camera photos and tags and map images never go there; camera pins do. Keep the free limits in mind: don't add anything that reads or writes per photo.
- Updates: on startup the hub asks the GitHub releases API for the newest version (`hub:checkForUpdate` in `electron/main.cjs`) and shows a banner. Download and install run inside the hub through `electron-updater`, which reads `latest.yml` from the release (`release.yml` attaches it with the installer and blockmap) and verifies the download. The app is unsigned, so GitHub account access controls what the family installs. A dev window opens the browser instead.
- The renderer has no Node access. Add new desktop abilities as small IPC handlers in `electron/main.cjs` exposed through `electron/preload.cjs`.
- Map labels and pins are HTML markers (no glyph/font server needed). Update their classes with `classList`, never `className`, because maplibre adds its own positioning classes.
- The old name stays in places existing data and updates depend on: `productName` and `appId` in `package.json` (`productName` sets the userData folder holding the detector model and tile cache), the `Documents\Hunting Hub` and `Hunting Hub Photos` folders, file `kind` values, storage keys, the Firebase project and the installer file name. Don't rename these without a migration.
- Don't scrape the county GIS or onX.
- Offline map downloads stay property-sized.
- Don't default the photo library to OneDrive.
- Never bundle or commit the MegaDetector `.onnx` model (AGPL). Each PC downloads it once.
- In-app updates work through the GitHub download route (0.7.0 to 0.8.0 confirmed on a real PC).

## Working with the owner

- Ask before installing or downloading anything. The owner makes system, driver and registry changes themselves.
- Commit only when asked, with the email `291184756+jappelbaum99-cmyk@users.noreply.github.com`.

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
