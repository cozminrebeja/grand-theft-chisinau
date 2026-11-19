# Grand Theft Chișinău — architecture & team rules

Browser game, three.js **r128** (global `THREE`, classic scripts — no ES modules, no bundler).
`index.html` (CDN three) and `test.html` (local `vendor/three.min.js`) load these classic scripts **in order**:

| file | owner | what |
|---|---|---|
| js/core.js | integrator | utils (clamp, angDiff, lerpAng, seeded R/rr/pick, mr/mpick), `$`, `isTouch`, `progress`, `Bk` merged-geometry builder, `M()` matrix helper, `BOX`, `CYL`, `VC`/`VC2` vertex-colour materials |
| js/env.js | **ENV** | renderer, scene, fog, camera, lights, sky; `envUpdate(dt)`, `envRender(dt)`; optional `envPostBuild()` hook |
| js/mapcore.js | integrator | `ctex`, `glassGrad`, `blobMat`, map data `D` + `initMap`, `dec`, `SC`, chunked buckets `bk(name,x,z,mat,uv)`, `ftri`, `polyFill`, `sArea`, `pip`, collision grid (`addPoly`, `pushOut`, `solidAt`, `polys`), `SB`, `part`, `addRect`, `lm`, `LANDMARK_SKIP` |
| js/facades.js | **BUILDINGS** | `TEX`, `TILE`, `STYLE_NAMES`, `buildBuildings()` |
| js/streets.js | **STREETS** | `roads`, `stops`, `segs`, `rgrid`, `nearestSeg()`, `buildStreets()`, `buildTransit()` (wires, poles, stops) |
| js/traffic.js | integrator | road graph `edges`/`adj`/`nodePos`, lane agents, A* |
| js/vegetation.js | **VEGETATION** | `buildVegetation()` |
| js/landmarks.js | **LANDMARKS** | `buildLandmarks()` (+ may push to `LANDMARK_SKIP` at load time) |
| js/vehicles.js | **VEHICLES** | models, instanced pools, trolleybus, `SPEC`, `vehicles`, `makeVehicle`, `removeVehicle`, `renderVehicles(dt)` |
| js/people.js | **PEOPLE** | person geometry, instanced pedestrians, `peds`, `makePersonGroup`, `spawnPedAgent`, `SHIRTS/PANTS/SKIN`, `renderPed(p,dt)`, `renderPedsCommit()`, `animatePlayer(group,phase,speed,dt)` |
| js/fx.js (new, optional) | **FX** | `fxInit()`, `fxUpdate(dt)`, `fxEvent(name,data)` |
| js/game.js | integrator | gameplay, AI, input, HUD, minimap, main loop (`main()`) |

Build order at runtime (game.js `main()`): initMap → buildBuildings → buildStreets → buildGraph → buildVegetation → buildLandmarks → buildTransit → merge static buckets → `envPostBuild()` → `fxInit()` → spawn vehicles/peds → loop.
`window.gtcPlayer` = live player state {mode,x,z,h,car,speed}. Global `vehicles`, `peds`, `camera`, `scene` are readable by any module.
Per frame: AI → peds → player → `fxUpdate(dt)` → camera → `envUpdate(dt)` → `renderVehicles(dt)` → `envRender(dt)`.

World: metres, **x = east, z = south (north = −z)**, y up. Origin = Arc de Triumf. Real OSM data (data.json, ODbL — keep the attribution).
Vehicles face +z in model space; `v.h` heading → rotation.y. `v.speed` m/s, `v.steer` −1..1, `v.mode` ai|parked|player|chase.

## Hard rules for module agents
1. **Edit only the file(s) you own.** If you truly need a change elsewhere, don't make it — describe it in your final report.
2. **All scripts share ONE global lexical scope.** Every new top-level identifier you add MUST start with your prefix:
   env_, fac_, st_, veg_, lm_, veh_, ppl_, fx_. Re-declaring an existing global name is a SyntaxError that kills the whole game.
3. Keep existing public names/signatures working (listed above) — other modules call them.
4. Assets: procedural (canvas/geometry) preferred. Remote URLs at runtime are blocked by CSP except cdnjs.cloudflare.com,
   cdn.jsdelivr.net/npm/, unpkg.com (scripts only — e.g. `three@0.128.0/examples/js/...`). If you vendor binary assets,
   they must be CC0/public-domain, live under `assets/<yourarea>/`, total ≤ 3 MB per module, loaded by relative URL.
5. **Performance budget (target: recent iPhone/Android in Safari/Chrome, 60 fps):** whole frame ≤ ~1.2M triangles and ≤ ~250 draw calls
   in typical street view. Rough per-module shares: buildings 350k tris/40 calls, streets 150k/30, vegetation 200k/10,
   landmarks 80k/10, vehicles 200k/40, people 60k/10, env+fx 30 calls. Use merging (Bk/bk chunks) and InstancedMesh.
   Use `isTouch` to lower quality on phones (fewer shadows/particles, smaller textures). Load time must stay < ~6 s.
6. Test: `python3 dev/shot.py --port <your unique port> --out /tmp/<you>` (desktop) and add `--mobile`.
   It prints page errors and `renderer.info` per scene and saves screenshots (title, foot, drive, cars, street, trolley, aerial, peds).
   `__dbg.camOverride=[x,y,z,tx,ty,tz]` freezes the camera for custom shots. Zero PAGEERRORs required.
7. Commit your work in your worktree (`git add -A && git commit`), small focused commits.
