"""Sentinel-2 true colour → world/city/sat.jpg, projected onto the same square as city/ground.webp (make_city_lod.py).

The distant terrain shader (js/world.js) lays it under the drawn roads/water/parks, so the far ground shows real fields,
woods and built-up land instead of flat procedural green. 10 m pixels: only meant for the distant layer.
Source: one cloud-free Copernicus Sentinel-2 L2A pass (two MGRS tiles), read straight from the AWS open-data COGs.
With an ortho cache (tools/data/ortho.py), the 2020 aerial photo is laid over it at 4.4 m wherever it exists (the whole
streamed city), Sentinel colour-matched to it and feathered over ~500 m at the edge.
Usage: python3 tools/data/make_sentinel.py <world dir> [ortho cache]   (needs numpy scipy rasterio pyproj pillow)
"""
import sys, json, math
import numpy as np, rasterio
from rasterio.windows import from_bounds
from pyproj import Transformer
from scipy import ndimage
from PIL import Image

SCENES = ['S2B_35TPN_20250814_0_L2A', 'S2B_35TPM_20250814_0_L2A']  # 14 Aug 2025, 0% cloud, full coverage
URL = 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/35/T/{sq}/2025/8/{id}/TCI.tif'
RES = 4096
SAT, TARGET = 1.25, .46  # tuning knobs: saturation, mean luminance

W = json.load(open(f'{sys.argv[1]}/world.json'))
LAT0, LON0 = W['origin']; KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110574
X0, X1, Z0, Z1 = W['bounds']; S = max(X1 - X0, Z1 - Z0); GX0, GZ0 = (X0 + X1) / 2 - S / 2, (Z0 + Z1) / 2 - S / 2  # = make_city_lod.py

px = (np.arange(RES) + .5) * S / RES
X, Z = np.meshgrid(GX0 + px, GZ0 + px)  # row 0 = north (z0), like the ortho render
E, N = Transformer.from_crs('EPSG:4326', 'EPSG:32635', always_xy=True).transform(LON0 + X / KX, LAT0 - Z / KZ)
out = np.zeros((RES, RES, 3), np.float32); have = np.zeros((RES, RES), bool)
for sid in SCENES:
    with rasterio.open(URL.format(sq=sid[7:9], id=sid)) as src:
        win = from_bounds(E.min() - 50, N.min() - 50, E.max() + 50, N.max() + 50, src.transform).intersection(
            rasterio.windows.Window(0, 0, src.width, src.height))
        a = src.read(window=win).astype(np.float32); T = src.window_transform(win)
    c = (E - T.c) / T.a - .5; r = (N - T.f) / T.e - .5
    rgb = np.dstack([ndimage.map_coordinates(a[k], [r, c], order=1, cval=0) for k in range(3)])
    ok = ~have & (rgb.min(2) > 0)
    out[ok] = rgb[ok]; have |= ok
    print(sid, 'filled %.1f%%' % (100 * have.mean()))
assert have.mean() > .999, 'scene gap'
# grade to the game's palette (raw display values, like the procedural greens 0x6f8a4a/0x56723c): TCI is hazy and darker
c = out / 255; lum = (c * np.float32([.2126, .7152, .0722])).sum(2)
c = lum[..., None] + (c - lum[..., None]) * SAT  # saturation
c *= TARGET / lum.mean()  # mean brightness of the procedural terrain
c = np.where(c > .8, .8 + .2 * np.tanh((c - .8) / .2), c)  # soft knee: roofs and bare soil don't clip
if len(sys.argv) > 2:  # aerial photo over Sentinel
    import os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); from ortho import Ortho, CELL
    O = Ortho(sys.argv[1], sys.argv[2]); cells = [tuple(map(int, f[2:-4].split('_'))) for f in os.listdir(sys.argv[2]) if f.startswith('c_') and f.endswith('.jpg')]
    q = 250; i0 = min(i for i, j in cells); j0 = min(j for i, j in cells); i1 = max(i for i, j in cells); j1 = max(j for i, j in cells)
    M = np.zeros(((j1 - j0 + 1) * q, (i1 - i0 + 1) * q, 3), np.float32); V = np.zeros(M.shape[:2], np.float32)
    for i, j in cells:  # 1 km cell -> 250 px (4 m), area-averaged
        M[(j - j0) * q:(j - j0 + 1) * q, (i - i0) * q:(i - i0 + 1) * q] = np.asarray(Image.fromarray(O.img(i, j)).resize((q, q), Image.LANCZOS), np.float32) / 255
        V[(j - j0) * q:(j - j0 + 1) * q, (i - i0) * q:(i - i0 + 1) * q] = 1; O.mem.clear()
    r = (Z - j0 * CELL) / CELL * q - .5; cc = (X - i0 * CELL) / CELL * q - .5
    o = np.dstack([ndimage.map_coordinates(M[..., k], [r, cc], order=1, cval=0) for k in range(3)])
    v = ndimage.map_coordinates(V, [r, cc], order=0, cval=0) > .5
    g = np.sqrt(o[v].mean(0) / c[v].mean(0)); c = np.clip(c * g, 0, 1)  # half-way to the April photo's colour balance (August is greener)
    w = ndimage.gaussian_filter(np.clip(ndimage.distance_transform_edt(v) / (500 / (S / RES)), 0, 1), 40)[..., None]
    c = w * o + (1 - w) * c; print('photo over %.0f%% of the square, sentinel gain' % (100 * v.mean()), np.round(g, 2))
Image.fromarray((np.clip(c, 0, 1) * 255 + .5).astype(np.uint8)).save(f'{sys.argv[1]}/city/sat.jpg', quality=88)
if 'Sentinel' not in W['attribution']:  # licence: credit modified Copernicus Sentinel data
    W['attribution'] += ' · Imagery: contains modified Copernicus Sentinel data 2025'
    json.dump(W, open(f'{sys.argv[1]}/world.json', 'w'), separators=(',', ':'), ensure_ascii=False)
C = json.load(open(f'{sys.argv[1]}/city/city.json')); C['v'] += 1; json.dump(C, open(f'{sys.argv[1]}/city/city.json', 'w'))  # cache-bust sat.jpg
