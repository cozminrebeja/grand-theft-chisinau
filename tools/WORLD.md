# Whole-city Chișinău — streaming world spec (v1)

Goal: the entire city of Chișinău (all sectors: Centru, Botanica, Buiucani, Ciocana, Râșcani + Durlești/Codru edges as data allows),
streamed in 500 m tiles around the player. Read ARCHITECTURE.md too (team rules, prefixes, testing). Desktop-only target.

## Coordinates (unchanged — everything already built depends on them)
Local metres, origin = Arcul de Triumf = `world.json.origin` [LAT0, LON0] = the value in the current data.json (do not change):
`x = (lon-LON0)*111320*cos(LAT0°)`, `z = -(lat-LAT0)*110574` (x east, z south). Stored as integers in **decimetres**.
Tile index: `i = floor(x/500)`, `j = floor(z/500)`, key `"i_j"`, file `world/tiles/i_j.json`.

## world/world.json (loaded once at start; keep ≤ ~15 MB)
- `version`, `origin`, `bounds` [X0,X1,Z0,Z1] (m), `tile` (500), `attribution` (string shown in-game)
- `tiles`: {"i_j": [nBuildings, nRoadPieces, bytes]} — only tiles that exist
- `r`: GLOBAL road network for traffic graph / nearestSeg / names / minimap: `[kind, w, ow, nameIdx, tw, ids, flat]`
  kind 0 drivable, 1 service, 2 pedestrian (no footways here); w width m; ow 0/1/-1 oneway; tw 1 = trolleybus wires;
  `ids`: per point, a graph node id (int, shared by all roads meeting at a junction) or -1; required for kind 0–2; flat = [x,z,…] dm
- `names` [string], `pois` [[name,x,z]] (m), `stops` [[x_dm,z_dm,name]] trolleybus stops,
  `special` {arc,cathedral,belltower,statue: [x,z,angle,size]} (keep current values), `districts` [[name, flat ring dm]],
  optional `map` {image:'world/map.png', mpp, x0, z0} pre-rendered overview map (x0,z0 = world metres of the image's top-left).

## world/tiles/i_j.json (≤ ~1.5 MB each; features clipped/assigned to the tile)
- `b`: buildings `[h, minH, style(0 classic,1 panel,2 glass,3 plain,4 church), colour, ring, holes, extra?]` (ring/holes flat dm; extra = optional object e.g. {roof:'gabled', floors:9, name})
  assigned by centroid (not clipped).
- `r`: render pieces `[kind(0..3 incl. 3 footway), w, ow, nameIdx, tw, null, flat]` — roads split at tile edges.
- `a`: areas `[kind('park'|'water'|'plaza'|'parking'), ring, holes]` clipped to the tile square.
- `trees`, `cross`: flat [x,z,…] dm points (trees = individually mapped trees; crossings = zebra points).

## Module per-tile builder API (world.js calls them; if a module lacks them, world.js falls back to its legacy global builder)
Called once at start, in order: `buildStreetsGlobal()` (roads/rgrid/segs from D.r — nearestSeg must work city-wide), `landmarksPreBuild()`.
Per tile `t` = {key,i,j,x0,z0,x1,z1,data,group(THREE.Group already in scene),polys}, in this order:
`buildBuildingsTile(t)` → `buildStreetsTile(t)` → `buildVegetationTile(t)` → `buildTransitTile(t)`.
- Put ALL per-tile meshes under `t.group`. Collision: `addPoly(rings, h, t)` (third arg registers it for removal).
- On unload world.js removes `t.group`, disposes every geometry under it, calls `removePolys(t.polys)`, then optional
  `<module>UnloadTile(t)` hooks (`buildingsUnloadTile`, `streetsUnloadTile`, `vegetationUnloadTile`, `transitUnloadTile`).
  Materials/textures must be shared module globals (never per tile) — world.js does NOT dispose materials.
- Deterministic: seed any randomness from the tile key so a re-loaded tile looks identical.
- Speed: a dense central tile should build in ≲ 40 ms per module (world.js time-slices tiles across frames). Neighbour tiles may not be loaded.
- Per-frame work (LOD etc.) iterates `WORLD.tiles` (Map key→t, t.state==='ready').
Globals from world.js: `WORLD` {tiles, T}, `worldUpdate(dt,px,pz)` (called each frame by game.js).

## Ownership for this phase
DATA → dev/data/* scripts + world/ output. ENGINE → js/world.js, js/game.js, js/traffic.js, js/mapcore.js, js/core.js, index.html, test.html.
BUILDINGS → js/facades.js. STREETS → js/streets.js. VEGETATION → js/vegetation.js. Others unchanged.
Until DATA delivers, everyone tests on the centre-only dataset produced by `python3 dev/make_center_tiles.py` (already in world/).
