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
- **Walk an area**: on the phone page's Pin tab, press **Walk around an area** and walk its edge. The card counts down the distance back to where you started; when you're back, stop to save. On the hub the walk arrives with the phone's other walks: press **Area** to make the shape you walked an area, then pick its type and name. Any walk can be made a trail or an area.
- **Add pin**: pick a type (stand, camera, scrape...), then click the map. Pins are locked so they can't move by accident: to move one, click it, press **Unlock to move** and drag it. It locks again when you click away.
- **Import KML/GPX**: brings in property lines and waypoints from Google Earth, onX, county GIS sites and other mapping apps. Waypoints with "stand" or "blind" in the name become stands.
- **Add map image**: lay a screenshot of a parcel map, plat or survey over the map, then trace your property line from it.
  1. Take a screenshot of the map (for example, Dent County's parcel viewer as a guest). Press Win+Shift+S, then save it as a PNG.
  2. Click **Add map image** and pick the file.
  3. Click a spot on the image (a road intersection, section corner or pond corner), then click the same spot on the map. Do this 2–4 times, with the spots spread out. With 3 or more points the panel shows how many feet off each one is.
  4. Save, then use **Draw property** to click along the lines in the image. Use **See-through** to fade the image in and out.
- **Map labels** (the layers button at the top right, or Settings): turn names on or off by kind, and for stands, pins and areas by type, so you can hide trail camera names but keep stands. Show all and Hide all do everything at once. Set them the way you like and press **Save these as my default**, then **My default** brings them back after Show all or Hide all.
- **Edit line** (on a trail) opens one menu at the bottom of the map with all the tools. **Combine** turns several walks of one road into one line: it keeps the trail you're on, removes where a walk doubled back on itself, and folds in overlapping lines of the same type; turn-offs stay on it as branches, and Undo puts it all back. **Join**: click another line, then press Join, and the two become one line with this line's name, even if they meet at a T. **Split** cuts a trail in two where you click (click right at a T to unhook that branch), and **Delete part** removes the stretch between two spots you click. Set the color, pattern (solid, dashed or dotted), thickness (skinny, normal or thick) and black outline (on or off) for each type of trail in Settings, or for a single trail on its panel.
- **Pins on the map** (Choose Map): turn whole pin types off, like trail cameras or rubs.
- **Make a poster** (sidebar, Share): lays out a printed map. Pick the paper (11×17 up to 36×48 inches, or any size), DPI (150 to 300) and JPG or PNG; the map (aerial photos, leaf-off winter or leaf-on summer, lidar or topo, with lidar shading and contours if you like); and what shows: each kind of thing and its labels on or off, and opened up, each single property, area, stand, trail or section and its label. Drag the paper to frame it and scroll to zoom, or press **Fit** on a property. Drag any label to move it (a stand label moved away gets a line back to the stand), double-click to put it back, or press its × to leave it off; **Label text**, **Pins**, **Property lines**, **Section lines**, **Area outlines** and **Trails** each have their own size. Pin types turn off as groups too. Add a title, north arrow and scale bar, and your own logo in any corner (a PNG with a see-through background looks best), then **Save poster image** for a print shop. Tiles come from the saved maps where they can; Missouri 6 inch photos only where a property’s maps are saved.
- **Soil tests**: on the phone, in the **Pin** tab under **Start a soil test**, tap one of your fields or **Just start a test** (pick the field on the hub later), then **Took core here** at each spot you take a core (it counts them; aim for 10 to 15) and **Done**. The cores go straight onto the hub's map ("Back Field core 1, 2, 3…" or "Soil test Nov 8 core 1…"). On the hub, the **Soil Tests** card opens a window listing tests **Waiting for results** and **Results in**. Pick one to (1) set its field, from your areas or with **Make a field from these spots**, which draws an outline around the cores (reshape it later with Edit shape), and (2) **Add the lab results**. A test with results shows what to buy, the cores drawn in the field, and the field's earlier tests; **Edit results**, **Show on map**. A field's own panel also has its soil test, and **Open in Soil Tests**. Results for a field with no cores marked go in with **+ Results for a field**. Type in the lab report: pH, buffer pH, P, K, Ca, Mg, organic matter, CEC and the per-acre lime and fertilizer recommendations (lime in tons, or pounds of ENM as Missouri’s lab writes it, with your lime’s ENM per ton). The plot shows the pH rated, and what to buy for its size: tons and 40-lb bags of lime, and pounds and 50-lb bags of the closest bagged blend (pick another from the list). Saving a new test can put that work on the Action Board and start a **Soil test** schedule every 3 years; each test also goes in the plot log, and partners get it with the plot.
- **Action Board** (sidebar): ideas and work to do, moved from Idea to To do to Done. Finished cards go in Done at the bottom. Click a list's heading (Ideas, To do or Done) to fold it open or shut, or use **Collapse all** / **Expand all**; the board remembers which are shut. Add a **Schedule** to any area or section (a burn every 3 years in Feb–Mar, say) and a To do card appears 60 days ahead (change that in Settings); marking it done starts the next cycle, and upcoming work shows under **Coming up** in the Summary. Notes saved on the phone's Notes tab land here (until the hub has one, it can be changed with **Edit** on the phone), and a stand idea with a GPS spot can become a real stand. Work logged on a food plot from the phone goes into that plot's log instead.
- **Draw section**: split a property into named units (e.g. "North Ridge"). Click a section to add plans:
  - **Burn plans:** safe wind directions plus wind and humidity limits. The plan lists the hours in the forecast that meet them.
  - **Timber plans:** the practice, contractor, and cost and income estimates.
  - **Habitat and other plans.**
  - Every plan has a status, target date, checklist and notes.
- **Saved maps** (Settings): the desktop app keeps every property's maps saved on your PC by itself, for the property plus ¼ or ½ mile around it: satellite, close-up photos, topo, lidar and 3D terrain, down to the closest zoom. It runs in the background a few seconds after the app opens and again when you add or reshape a property or switch the lidar style or contours, so the map near your properties loads from disk. Turn it off in Settings. **Download this one now** on a property does the same right away. Every map tile you look at is also saved on your PC, so it doesn't load again. For a property in Missouri it also saves the state's 6 inch aerial photos (leaf-off, 2023–24), about four times sharper than the normal close-ups; they show when you zoom in close on a downloaded property. To see the summer (leaf-on) photos instead, pick **Leaf-on (summer)** under Close-up photos in Choose Map.
- **Settings** (gear next to the name): color, shape and size for each pin type, colors for area types, the default property line color, and the border (solid, dashed or dotted, and its width) and shading of property and section outlines. A single stand, pin or property can also get its own color from its card.
- **Hunt Forecast** (top of the sidebar):
  - The next ten days show as small calendar pages (a row that scrolls sideways), each with an **AM** and **PM** sit to pick (or **Right now**). Each sit shows its **Deer activity** score (0–100), and each day its best one.
  - **Deer activity** follows the Fenceline outline (inspired by Dr. Grant Woods' public comments, not his formula): for now only internet weather and the rut date: where the rut is (around the peak date you set; Missouri is about Nov 15), the temperature against the same hours the last three days, dawn and dusk, and rain, weighted as in the outline. Trail camera visits and hunt logs are built in but switched off (`FORECAST_USES_LOCAL_DATA` in `src/lib/deerActivity.ts`). Moon and barometric pressure aren't used. It shows the top reasons up and down, a Medium or Low confidence (by how far out the forecast is), and says plainly when a part is left out for lack of data. It's an estimate, not the chance of seeing a deer.
  - Each stand gets a **Hunting Opportunity** score for the picked sit: the activity score plus its wind direction and scent, how steady the wind is, and the conditions for you.
  - Pick a sit to see its low and high temperature, how the wind direction and speed change, gusts, and rain, with graphs.
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
- **Schedules** (sidebar): everything coming up in one list, both repeating work on areas and sections and section plans with a date. Drag items or use the arrows to change the order (**Sort by date** puts it back), and edit or remove them right there. The order is kept on each PC; the changes themselves sync to partners.
- **Partners** (Settings, Camp sync): two desktops can share one map. Start a camp on one PC, then on the other join with its code and approve it from the first. Press **Share the map with partners** on each, and stands, pins (camera pins too), property lines, areas, sections, trails, plans, food plot logs and soil tests, hunts and the Action Board stay in step. Each PC still keeps its own full copy and only changes are sent, so it works offline and catches up later. If the same thing is changed on both PCs, the newest change wins. Trail camera photos and tags and map images stay on each PC. Hunters use the phone page with the same code: they see stands and deer reports, and can send notes to the Action Board. The quickest way in is the QR code under **Join the Camp** (sidebar) or in Settings: the phone's camera opens the phone page with the code filled in, so the hunter only types a name. On iPhone, a phone page added to the home screen keeps its own data apart from Safari, so join from inside it: the Camp tab has **Scan the camp QR code**, which uses the phone's camera there. **Save image** saves a Fenceline card with the camp name, the QR code and the 12-letter code in big letters, to text, email or print.
- **Share** (sidebar): **Export whole map** saves everything as one file. **Share** on a property saves just that property with its stands, pins, areas, sections, plans, hunts and map images. Send the file however you like (email, text, USB stick); the other person opens it with **Import a map file**. Importing adds what's new and replaces only what's newer, so you can send updates back and forth.

Your data is saved automatically to `Documents\Hunting Hub\hub-data.json`. The previous version is kept next to it as `hub-data.json.bak`, and map images go in `Documents\Hunting Hub\images`.

## Map data

- Satellite: USGS Imagery Only (The National Map), with NAIP aerial photos up close. On downloaded Missouri properties, Missouri's 6 inch statewide aerials from [MSDIS](https://msdis.missouri.edu).
- In 3D, the close-up photos fade in as you zoom and the distance fades into haze, so the switch between photo sources and the rougher far-off tiles don't jump out.
- Topo: USGS Topo (The National Map)
- Lidar: USGS 3DEP elevation (bare-earth lidar). Hillshade, slope and contours are generated by the USGS server.

The lidar server is sometimes slow or briefly unavailable. The app retries automatically, so a few tiles may fill in late.
