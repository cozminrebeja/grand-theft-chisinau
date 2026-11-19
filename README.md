# Grand Theft Chișinău

An open-world browser game set in the real city of Chișinău, Moldova — the whole city (all five sectors), streamed in 500 m tiles,
with real streets, buildings, trolleybus wires and stops, real terrain relief and bridges. Built with three.js (r128), no build step.

Play: https://fun.rebeja.co

## Run locally
Any static server works (the game fetches JSON files, so `file://` won't):
```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy (GitHub Pages)
1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/ (root)`.
3. The `CNAME` file sets the custom domain to `fun.rebeja.co`. At your DNS provider add a **CNAME** record:
   `fun` → `<your-github-username>.github.io`. Then enable "Enforce HTTPS" in Pages settings once the certificate is issued.

## Controls
Mouse — look · WASD — walk / drive · Shift — run · Space — handbrake · E — enter / exit vehicle · H — horn · C — camera ·
Tab — map · M — sound · R — music on/off · Q — car radio (tap: next station, hold: radio wheel; Moldovan + Romanian + Russian stations) · Esc — pause menu. Graphics quality: title screen or pause menu (Medie / Înaltă / Ultra).

## Layout
- `index.html` — page, HUD, menus; loads `js/*.js` in order (classic scripts sharing one global scope).
- `js/` — `core` utils · `env` lighting/sky/post · `mapcore` helpers, collision, terrain height · `bridges` · `facades` buildings ·
  `streets` ground/roads/furniture · `traffic` road graph · `world` tile streaming · `vegetation` · `landmarks` · `vehicles` ·
  `people` · `fx` · `game` gameplay/HUD/main loop.
- `assets/env/` — three.js r128 post-processing example scripts (MIT).
- `world/` — generated city data: `world.json` (roads, POIs, stops, districts, bridges…), `packs/` (tile data), `height.json`
  (terrain), `map.png`, `far.json`.
- `tools/` — the data pipeline scripts used to generate `world/` (Overture Maps + OSM + Copernicus DEM) and notes
  (ARCHITECTURE.md, WORLD.md, TERRAIN.md). They were written for the original build environment; paths may need adjusting.

## Data & credits
- Map data © OpenStreetMap contributors (ODbL) and Overture Maps Foundation — https://www.openstreetmap.org/copyright
- Terrain: Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS
  by the European Union and ESA; all rights reserved.
- three.js © three.js authors (MIT). Fonts: Google Fonts (Anton, Pirata One, Inter — OFL).
