# Fenceline

A desktop app for planning hunts on your property: draw property lines, food plots and bedding areas, place stands, and study the ground with satellite, topo and lidar maps. All map data is free public data from the USGS.

## Run it

You need [Node.js](https://nodejs.org) installed. In this folder:

```bash
npm install
npm start
```

`npm start` builds the app and opens the Fenceline window. While making changes, use `npm run dev` instead. It reloads the window when files change.

## Installer for family PCs

```bash
npm run dist
```

This makes `release\Hunting-Hub-Setup-<version>.exe` (about 120 MB). Send that file (Google Drive, a USB stick...) and they run it. The app isn't code-signed (that costs money), so Windows shows "Windows protected your PC" the first time: click **More info**, then **Run anyway**. Each PC keeps its own data; send a map file to share yours.

To change the icon, replace `public/logo.svg` and run `npm run icon` before `npm run dist`. Bump `version` in `package.json` for each new installer you send.

## Website (free on GitHub Pages)

The website has a home page with the Windows download and the phone field page. Your maps, stands and hunts are never on it; it only hands out the app.

```bash
npm run build:site
```

That builds it into `site-dist`. To put it online, one time:

1. Make a free account at github.com, then a new **public** repository (this one is `hunting-app`) (free Pages needs public; the code holds no personal data).
2. Push this project to it: `git remote add origin https://github.com/<you>/hunting-app.git`, then `git push -u origin master:main`.
3. On GitHub: **Settings → Pages → Source: GitHub Actions**. The site appears at `https://<you>.github.io/hunting-app/` a minute or two later, and updates on every push to `main`.
4. Put the installer on it: `git tag v0.1.0`, then `git push origin v0.1.0`. GitHub builds the installer and attaches it to a release; the site's Download button always gets the newest one. Bump `version` in `package.json` before each new tag.

## Using it

- **Draw property** and **Draw area**: click each corner on the map, then press **Done** (or Enter). Backspace undoes the last corner and Esc cancels.
- **Add pin**: pick a type (stand, camera, scrape...), then click the map. Pins are locked so they can't move by accident: to move one, click it, press **Unlock to move** and drag it. It locks again when you click away.
- **Import KML/GPX**: brings in property lines and waypoints from Google Earth, onX, county GIS sites and other mapping apps. Waypoints with "stand" or "blind" in the name become stands.
- **Add map image**: lay a screenshot of a parcel map, plat or survey over the map, then trace your property line from it.
  1. Take a screenshot of the map (for example, Dent County's parcel viewer as a guest). Press Win+Shift+S, then save it as a PNG.
  2. Click **Add map image** and pick the file.
  3. Click a spot on the image (a road intersection, section corner or pond corner), then click the same spot on the map. Do this 2–4 times, with the spots spread out. With 3 or more points the panel shows how many feet off each one is.
  4. Save, then use **Draw property** to click along the lines in the image. Use **See-through** to fade the image in and out.
- **Map labels** (the layers button at the top right, or Settings): turn names on or off by kind, and for stands, pins and areas by type, so you can hide trail camera names but keep stands. Show all and Hide all do everything at once.
- **Edit line** (on a trail) opens one menu at the bottom of the map with all the tools. **Combine** turns several walks of one road into one line: it keeps the trail you're on, removes where a walk doubled back on itself, and folds in overlapping lines of the same type; turn-offs stay on it as branches, and Undo puts it all back. **Join**: click another line, then press Join, and the two become one line with this line's name, even if they meet at a T. **Split** cuts a trail in two where you click (click right at a T to unhook that branch), and **Delete part** removes the stretch between two spots you click. Set the color, pattern (solid, dashed or dotted), thickness (skinny, normal or thick) and black outline (on or off) for each type of trail in Settings, or for a single trail on its panel.
- **Action Board** (sidebar): ideas and work to do, moved from Idea to To do to Done. Finished cards go in a Done dropdown at the bottom. Add a **Schedule** to any area or section (a burn every 3 years in Feb–Mar, say) and a To do card appears 60 days ahead (change that in Settings); marking it done starts the next cycle, and upcoming work shows under **Coming up** in the Summary. Notes saved on the phone's Notes tab land here, and a stand idea with a GPS spot can become a real stand. Work logged on a food plot from the phone goes into that plot's log instead.
- **Draw section**: split a property into named units (e.g. "North Ridge"). Click a section to add plans:
  - **Burn plans:** safe wind directions plus wind and humidity limits. The plan lists the hours in the forecast that meet them.
  - **Timber plans:** the practice, contractor, and cost and income estimates.
  - **Habitat and other plans.**
  - Every plan has a status, target date, checklist and notes.
- **Download for offline** (on a property): saves the maps for the property plus about ¼ mile around it, after showing the size. Every map tile you look at is also saved on your PC, so it doesn't load again.
- **Settings** (gear next to the name): color, shape and size for each pin type, colors for area types, and the default property line color. A single stand, pin or property can also get its own color from its card.
- **Hunt Forecast** (top of the sidebar):
  - Pick a sit (now, or any morning or evening in the next few days) to see its low and high temperature, how the wind direction and speed change, gusts, and rain, with graphs.
  - Drag the slider (or press play) to watch the scent cones move through the sit.
  - Rates every stand against its **Good winds**: Good, Maybe (the wind is close, very light, or gusty) or Bad.
  - While it's open, good stands glow green on the map and the rest fade.
  - Each stand also gets a **scent cone**: the wedge downwind where deer could smell you. It's longer in a steady wind, and short and wide when the wind is light and swirly.
  - If a cone reaches a bedding area or sanctuary, the stand is rated Bad and its cone turns red.
  - The forecast is free from Open-Meteo and needs internet.
- **Compass** (bottom right): turns with the map. The blue arrow shows which way the wind is blowing, which is where your scent goes. Click the compass to face north again.
- **Layers** (top right):
  - Satellite, Topo or Lidar base map.
  - **Lidar shading** blends the lidar hillshade over satellite.
  - **Contours** come in 10, 5 or 2 ft intervals and show when zoomed in.
- Click anything on the map or in the sidebar to edit it. Stands have a **Good winds** picker.
- **Share** (sidebar): **Export whole map** saves everything as one file. **Share** on a property saves just that property with its stands, pins, areas, sections, plans, hunts and map images. Send the file however you like (email, text, USB stick); the other person opens it with **Import a map file**. Importing adds what's new and replaces only what's newer, so you can send updates back and forth.

Your data is saved automatically to `Documents\Hunting Hub\hub-data.json`. The previous version is kept next to it as `hub-data.json.bak`, and map images go in `Documents\Hunting Hub\images`.

## Map data

- Satellite: USGS Imagery Only (The National Map)
- Topo: USGS Topo (The National Map)
- Lidar: USGS 3DEP elevation (bare-earth lidar). Hillshade, slope and contours are generated by the USGS server.

The lidar server is sometimes slow or briefly unavailable. The app retries automatically, so a few tiles may fill in late.
