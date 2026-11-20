"""Whole-city low-detail layer, built headless in Blender from the game's own world data.
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/make_city_lod.py -- [world_dir]
Outputs <world>/city/: buildings.glb (Draco; every footprint extruded to its height, flat roofs, chunked 4 km;
TEXCOORD_0 = tile index (i+.5, j+.5) so the game can hide tiles that stream in full detail), ground.webp
(top-down render of roads, water, parks, plazas, parking; alpha 0 elsewhere) and city.json (ground texture bounds).
Re-run whenever world/ data changes. Colours are written linear-as-displayed (the game renders without sRGB output)."""
import bpy, json, glob, os, sys, base64, math, zlib, time
import numpy as np
from mathutils.geometry import tessellate_polygon
from mathutils import Vector

W = (sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])[:1] or ['world']
W = os.path.abspath(W[0]); OUT = os.path.join(W, 'city'); os.makedirs(OUT, exist_ok=True)
WJ = json.load(open(os.path.join(W, 'world.json'))); T = WJ['tile']
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrain import Terrain
_T = Terrain(W)  # DEM + earthworks (world/earth.json), same as js/mapcore.js groundY
def ground(x, z): return _T.ground(x, z)

def ring(flat):
    p = [(flat[k] * .1, flat[k + 1] * .1) for k in range(0, len(flat) - 1, 2)]
    if len(p) > 1 and p[0] == p[-1]: p.pop()
    # ponytail: drop near-collinear points (<0.4 m off the line); real Douglas-Peucker if vertex count ever matters
    out = list(p); changed = True
    while changed and len(out) > 3:
        changed = False
        for k in range(len(out)):
            a, b, c = out[k - 1], out[k], out[(k + 1) % len(out)]
            L = math.hypot(c[0] - a[0], c[1] - a[1])
            if L > 1e-6 and abs((c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0])) / L < .4: out.pop(k); changed = True; break
    return out

def lin(h): return [((h >> s) & 255) / 255 for s in (16, 8, 0)]
WALL = {0: [0xf3e3b8, 0xeed39a, 0xf0d9c9, 0xf4efe4, 0xdfe6cc, 0xe9c597, 0xe6d6c8, 0xf1d9ae, 0xe8d2cf, 0xd9d5c4],
        1: [0xe9e7e0, 0xdedad0, 0xefe7d6, 0xd8dde0, 0xf1e8cf, 0xe6ddd0, 0xd6d1c7], 2: [0xb7c7d4, 0xa9bccb, 0xc9d3da, 0xd2d2cc],
        3: [0xe4ddd0, 0xd9d3c6, 0xe8e2d4, 0xcfcac0], 4: [0xf2ead8, 0xe9dcc0]}
ROOF_FLAT = [0x8b8e90, 0x7d8184, 0x9a9c9a, 0x6f7275, 0x5d6063]
ROOF_TILE = [0x9a4b33, 0x8a3f2c, 0xa5583a, 0x6b5a4c, 0x7a4636, 0x4f6e58]
def hsh(s): return zlib.crc32(s.encode())

# ---------------- buildings ----------------
def landmark_skips():
    """Centroids of the footprints that models/landmarks.glb replaces (lm.skip extras), same test as js landmarkSkipped()."""
    import struct
    p = os.path.join(os.path.dirname(W), 'models', 'landmarks.glb')
    if not os.path.exists(p): return []
    b = open(p, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]
    return [s for nd in json.loads(b[20:20 + n]).get('nodes', []) for s in json.loads((nd.get('extras') or {}).get('lm', '{}')).get('skip', [])]
LM_SKIP = landmark_skips()
print('landmark skips', len(LM_SKIP))
CH = 2000  # chunk size (m): smaller culls better at street level, more draw calls from the air
chunks = {}
nb = 0
for f in sorted(glob.glob(os.path.join(W, 'packs', '*.json'))):
    for key, t in json.load(open(f)).items():
        ti, tj = map(int, key.split('_'))
        for n, b in enumerate(t.get('b', [])):
            h, minH, style = float(b[0]), float(b[1] or 0), int(b[2])
            fl = b[4]; n2 = len(fl) // 2
            if n2 and any(math.hypot(sum(fl[0::2][:n2]) * .1 / n2 - sx, sum(fl[1::2][:n2]) * .1 / n2 - sz) < 2.5 for sx, sz in LM_SKIP): continue  # landmark model
            outer = ring(b[4])
            if len(outer) < 3 or h <= 0: continue
            holes = [r for r in (ring(hh) for hh in (b[5] or [])) if len(r) >= 3]
            allp = outer + [p for r in holes for p in r]
            xs = np.array([p[0] for p in allp]); zs = np.array([p[1] for p in allp])
            cx, cz = xs.mean(), zs.mean()
            base = float(min(ground(xs, zs).min(), ground(cx, cz))) - .6
            y0, y1 = base + (minH if minH > 0 else 0), base + .6 + h
            s = hsh(key + ':' + str(n)); pal = WALL.get(style, WALL[0])
            wc = [c * .8 for c in lin(pal[s % len(pal)])]  # walls darker: detailed buildings read darker through their facade textures
            pitched = style in (0, 3) and h <= 10 and len(outer) <= 8  # private houses / low blocks: tiled roofs
            ex = b[6] if len(b) > 6 and b[6] else {}
            rc = lin(int(ex['rc'][1:], 16)) if ex.get('rc') else lin((ROOF_TILE if pitched else ROOF_FLAT)[(s >> 8) % (len(ROOF_TILE) if pitched else len(ROOF_FLAT))])  # rc: photo roof colour (make_roofs.py)
            C = chunks.setdefault((math.floor(cx / CH), math.floor(cz / CH)), {'v': [], 'f': [], 'c': [], 't': []})
            V, F, Cc, Tt = C['v'], C['f'], C['c'], C['t']
            uvt = (ti + .5, tj + .5)
            for r in [outer] + holes:  # walls: bottom ring + top ring
                k0 = len(V); m = len(r)
                for (x, z) in r: V.append((x, -z, y0)); Cc.append(wc)
                for (x, z) in r: V.append((x, -z, y1)); Cc.append(wc)
                for k in range(m):
                    a, bb = k, (k + 1) % m
                    F.append((k0 + a, k0 + bb, k0 + m + bb, k0 + m + a))
            k0 = len(V)  # roof: own vertices so it can carry the roof colour
            for (x, z) in allp: V.append((x, -z, y1)); Cc.append(rc)
            for tri in tessellate_polygon([[Vector((x, z, 0)) for (x, z) in r] for r in [outer] + holes]):
                F.append(tuple(k0 + q for q in tri))
            Tt.append((len(F), uvt))
            nb += 1
print('buildings', nb, 'chunks', len(chunks))

bpy.ops.wm.read_factory_settings(use_empty=True)
for (ci, cj), C in chunks.items():
    me = bpy.data.meshes.new(f'city_{ci}_{cj}'); me.from_pydata(C['v'], [], C['f']); me.validate(clean_customdata=False)
    ca = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.hstack([np.array(C['c'], dtype=np.float32), np.ones((len(C['c']), 1), np.float32)]).ravel())
    me.color_attributes.active_color = ca
    # per-corner tile id; faces were appended building by building, so walk the (face_end, tile) marks
    uv = me.uv_layers.new(name='UVMap'); fu = np.zeros((len(me.polygons), 2), np.float32); s = 0
    for e, (u, v) in C['t']: fu[s:e] = (u, 1 - v); s = e  # exporter flips v
    tot = np.array([p.loop_total for p in me.polygons]); uv.data.foreach_set('uv', np.repeat(fu, tot, axis=0).ravel())
    ob = bpy.data.objects.new(me.name, me); bpy.context.scene.collection.objects.link(ob)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'buildings.glb'), export_format='GLB', export_normals=False, export_materials='NONE',
                          export_vertex_color='ACTIVE', export_texcoords=True, export_draco_mesh_compression_enable=True,
                          export_draco_mesh_compression_level=7, export_draco_position_quantization=16, export_draco_texcoord_quantization=12,
                          export_draco_color_quantization=8)

# ---------------- ground texture: top-down Workbench render ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
X0, X1, Z0, Z1 = WJ['bounds']; S = max(X1 - X0, Z1 - Z0); RES = 4096
cxm, czm = (X0 + X1) / 2, (Z0 + Z1) / 2; GX0, GZ0 = cxm - S / 2, czm - S / 2
LAYERS = {('a', 'park'): (0, (.36, .50, .25)), ('a', 'parking'): (1, (.50, .50, .48)), ('a', 'plaza'): (2, (.66, .63, .57)),
          ('a', 'water'): (3, (.24, .40, .52)), ('r', 1): (4, (.55, .54, .51)), ('r', 2): (5, (.66, .63, .57)), ('r', 0): (6, (.38, .38, .39))}
geo = {k: ([], []) for k in LAYERS}
for f in sorted(glob.glob(os.path.join(W, 'packs', '*.json'))):
    for t in json.load(open(f)).values():
        for a in t.get('a', []):
            if ('a', a[0]) not in geo: continue
            V, F = geo[('a', a[0])]; rs = [r for r in [ring(a[1])] + [ring(h) for h in (a[2] or [])] if len(r) >= 3]
            if not rs or len(rs[0]) < 3: continue
            k0 = len(V); flat = [p for r in rs for p in r]
            for (x, z) in flat: V.append((x, -z, 0))
            for tri in tessellate_polygon([[Vector((x, z, 0)) for (x, z) in r] for r in rs]): F.append(tuple(k0 + q for q in tri))
        for r in t.get('r', []):
            if ('r', r[0]) not in geo: continue
            V, F = geo[('r', r[0])]; w = max(float(r[1]), 3.0) / 2; p = [(r[6][k] * .1, r[6][k + 1] * .1) for k in range(0, len(r[6]) - 1, 2)]
            for (ax, az), (bx, bz) in zip(p, p[1:]):
                dx, dz = bx - ax, bz - az; L = math.hypot(dx, dz)
                if L < 1e-3: continue
                ux, uz = dx / L * w, dz / L * w  # extend each end by w/2 so joints close
                ax, az, bx, bz = ax - ux, az - uz, bx + ux, bz + uz; nx, nz = -uz, ux; k0 = len(V)
                V += [(ax + nx, -(az + nz), 0), (bx + nx, -(bz + nz), 0), (bx - nx, -(bz - nz), 0), (ax - nx, -(az - nz), 0)]; F.append((k0, k0 + 1, k0 + 2, k0 + 3))
for k, (V, F) in geo.items():
    if not F: continue
    z, col = LAYERS[k]; me = bpy.data.meshes.new(str(k)); me.from_pydata(V, [], F)
    ob = bpy.data.objects.new(str(k), me); ob.location.z = z; ob.color = (*col, 1); sc.collection.objects.link(ob)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); cam.data.type = 'ORTHO'; cam.data.ortho_scale = S
cam.location = (cxm, -czm, 100); cam.data.clip_end = 1000; sc.collection.objects.link(cam); sc.camera = cam
sc.render.engine = 'BLENDER_WORKBENCH'; sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'OBJECT'
sc.display.render_aa = '8'; sc.render.film_transparent = True; sc.view_settings.view_transform = 'Raw'
sc.render.resolution_x = sc.render.resolution_y = RES; sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGBA'; sc.render.image_settings.quality = 82
sc.render.filepath = os.path.join(OUT, 'ground.webp'); bpy.ops.render.render(write_still=True)
json.dump({'ground': {'image': 'city/ground.webp', 'x0': GX0, 'z0': GZ0, 'size': S}, 'buildings': 'city/buildings.glb', 'chunk': CH, 'v': int(time.time())},
          open(os.path.join(OUT, 'city.json'), 'w'))
print('CITY_LOD_OK', {f: os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)})
