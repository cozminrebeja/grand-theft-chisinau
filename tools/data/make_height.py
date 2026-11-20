"""Bare-earth heightmap → world/height.json (+ world.json 'height').

Copernicus GLO-30 is a surface model: roofs and tree tops are in it. Old version removed them with a 7x7 grey
opening (~150x210 m), which also flattened every real ridge, valley edge and slope narrower than that.
Now: only cells under tall building footprints and parks (from world/packs) take that heavy estimate; everywhere else keeps the
DSM, a small 3x3 opening (~60x90 m) takes off street trees and leftover clutter, and a light blur smooths radar noise.

Usage: python3 tools/data/make_height.py <world dir> <dir with Copernicus_DSM_COG_10_N4{6,7}_00_E028_00_DEM.tif>
Tiles: https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N47_00_E028_00_DEM/Copernicus_DSM_COG_10_N47_00_E028_00_DEM.tif
Needs numpy scipy tifffile imagecodecs pillow. After it: apply_overrides.py → make_earthworks.py → make_city_lod.py.
"""
import sys, os, json, math, glob, base64
import numpy as np, tifffile
from scipy import ndimage
from PIL import Image, ImageDraw

WD, DD = sys.argv[1], sys.argv[2]
TALL = 9  # m; low houses only add a few metres at 30 m pixels and cover whole hillsides, so they stay in
W = json.load(open(f'{WD}/world.json'))
LAT0, LON0 = W['origin']; KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110574
dem = np.vstack([tifffile.imread(f'{DD}/Copernicus_DSM_COG_10_N{n}_00_E028_00_DEM.tif').astype(np.float32) for n in (47, 46)])
res = 1 / 3600.0  # rows: lat 48 -> 46, cols: lon 28 -> 29

X0, X1, Z0, Z1 = W['bounds']; M = 1500
lat_top = LAT0 - (Z0 - M) / KZ; lat_bot = LAT0 - (Z1 + M) / KZ; lon_l = LON0 + (X0 - M) / KX; lon_r = LON0 + (X1 + M) / KX
r0 = int((48 - lat_top) / res) - 10; r1 = int((48 - lat_bot) / res) + 10; c0 = int((lon_l - 28) / res) - 10; c1 = int((lon_r - 28) / res) + 10
sub = dem[r0:r1, c0:c1]

# building mask at DEM resolution (pixel centres: row r ↔ lat 48-(r+.5)res, as sampled below)
mask = Image.new('L', (sub.shape[1], sub.shape[0]), 0); dr = ImageDraw.Draw(mask)
def px(x, z): return ((LON0 + x / KX - 28) / res - 0.5 - c0, (48 - (LAT0 - z / KZ)) / res - 0.5 - r0)
nb = 0
for f in glob.glob(f'{WD}/packs/*.json'):
    for t in json.load(open(f)).values():
        for b in t['b']:
            ring = b[4]
            if len(ring) >= 6 and b[0] >= TALL:
                dr.polygon([px(ring[k] / 10, ring[k + 1] / 10) for k in range(0, len(ring) - 1, 2)], fill=1); nb += 1
        for a in t['a']:  # parks are mostly wooded here: 15-25 m of canopy reads as ground otherwise
            if a[0] == 'park' and len(a[1]) >= 6:
                dr.polygon([px(a[1][k] / 10, a[1][k + 1] / 10) for k in range(0, len(a[1]) - 1, 2)], fill=1)
bm = ndimage.binary_dilation(np.array(mask, bool), iterations=1)  # radar layover/shadow spills ~1 px past the walls

# under tall buildings and parks use the old heavy bare-earth estimate (7x7 opening + blur); everywhere else keep the DSM.
# Interpolating across the holes instead fails: whole hillsides of private houses get masked and go flat.
bg = ndimage.gaussian_filter(ndimage.grey_opening(sub, size=(7, 7)), 2.0)
g = np.where(bm, np.minimum(bg, sub), sub)
g = ndimage.grey_opening(g, size=(3, 3))  # ponytail: woods outside mapped parks/tiles keep their canopy; add OSM landuse=forest to the mask if it shows
g = ndimage.gaussian_filter(g, 1.0)

cell = 20.0; gx0 = X0 - M; gz0 = Z0 - M; nx = int((X1 - X0 + 2 * M) / cell) + 1; nz = int((Z1 - Z0 + 2 * M) / cell) + 1
X, Z = np.meshgrid(gx0 + np.arange(nx) * cell, gz0 + np.arange(nz) * cell)
rr = (48 - (LAT0 - Z / KZ)) / res - 0.5 - r0; cc = (LON0 + X / KX - 28) / res - 0.5 - c0
h = ndimage.map_coordinates(g, [rr, cc], order=1, mode='nearest')
base = W['height']['base'] if 'height' in W else float(ndimage.map_coordinates(g, [[(48 - LAT0) / res - 0.5 - r0], [(LON0 - 28) / res - 0.5 - c0]], order=1)[0])
# base is kept from the previous build so absolute heights in bridge/override specs keep their datum
rel = np.round((h - base) * 10).astype('<i2')
json.dump({'b64': base64.b64encode(rel.tobytes()).decode()}, open(f'{WD}/height.json', 'w'))
W['height'] = {'file': 'world/height.json', 'x0': gx0, 'z0': gz0, 'cell': cell, 'nx': nx, 'nz': nz, 'scale': 0.1, 'base': round(base, 1),
               'source': 'Copernicus GLO-30 DEM (© DLR/Airbus, ESA), tall buildings and parks masked'}
json.dump(W, open(f'{WD}/world.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print('buildings', nb, 'masked %.1f%%' % (100 * bm.mean()), 'grid', nx, nz, 'base', round(base, 1), 'range', rel.min() / 10, rel.max() / 10,
      'Arc', round(float(rel[int(-gz0 / cell), int(-gx0 / cell)]) / 10, 1))
