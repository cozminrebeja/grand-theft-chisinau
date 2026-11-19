# Real terrain (relief) — spec

Heightmap: `world/height.bin` (Int16 decimetres, row-major nz×nx, 20 m cells, ground-filtered Copernicus GLO-30), meta in `world.json.height`.
API (js/mapcore.js, loaded before tiles are built — `await initHeight()` runs right after initMap):
- `groundY(x,z)` → terrain height (m) relative to the Arc de Triumf ground (Arc = 0). Range ≈ −61…+156 m. Bilinear, cheap (call freely).
- `groundNormal(x,z)` → [nx,ny,nz]; `groundRange(ring)` → [minY,maxY] under a footprint.
Real Chișinău: Bîc river valley NW→SE through the centre; Buiucani / Botanica / Râșcani hills; slopes up to ~10–15 %.

Rules:
- Everything that stood on y=0 now stands on groundY at its own x,z. Sidewalks are still +0.17 m above the road surface at that spot.
- Flat things must DRAPE: subdivide long ground polylines/quads so no edge is longer than ~6–8 m before sampling groundY (a 20 m DEM cell + bilinear).
- Water surfaces stay flat at the lowest ground height along their shore (lakes are level!).
- Buildings: walls start at the lowest ground under the footprint (so no building floats); the floor/roof height is measured from that base.
- Collision stays 2D (addPoly). `P.h` stays a height ABOVE the building base; anything comparing absolute y against buildings must add the base — store it as `P.y0` (BUILDINGS sets it when calling addPoly; P.y0 defaults to 0).
- Keep the zero-page-error rule and the perf budget. Data lives in /home/claude/gtc/app/world (gitignored): in your worktree run `ln -s /home/claude/gtc/app/world world` before testing.

## Bridges & tunnels (js/bridges.js, BRIDGES agent)
- `surfaceY(x,z,refY)` → deck height on a bridge span (when refY is near/above the deck), else groundY. Vehicles, player, pedestrians, skid marks, mission markers etc. MUST use surfaceY instead of groundY.
- `onBridge(x,z)` → bridge info or null. STREETS: road vertices on a bridge span take the deck height (surfaceY) instead of being draped; terrain stays in the valley underneath; BRIDGES renders the deck structure (girders, piers, railings) and abutments.
- Data: world.json gets `bridges` [[w, layer, flat dm]] and `tunnels` [[w, layer, flat dm]] from Overture road_flags is_bridge / is_tunnel.
