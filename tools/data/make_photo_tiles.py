"""Aerial photo per streamed tile → world/photo/<i>_<j>.webp (1024 px, 0.49 m) and world/photo/lo/<i>_<j>.webp (256 px).

js/photo.js drapes them on each tile's ground, parks, plazas and parking (near tiles: hi, far tiles: lo).
Source: Moldova 2020 orthophoto (AGCC / Geoportal INDS), cached by tools/data/ortho.py. A 500 m tile is an exact
quarter of a 1 km cache cell, so this is a crop, no resampling. Tiles without photo coverage are skipped.
Usage: python3 tools/data/make_photo_tiles.py <world dir> <ortho cache>
"""
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ortho import Ortho, PX

WD, CACHE = sys.argv[1], sys.argv[2]
O = Ortho(WD, CACHE); W = json.load(open(f'{WD}/world.json')); T = int(W['tile']); H = PX // 2
os.makedirs(f'{WD}/photo/lo', exist_ok=True)
n = skip = 0; size = 0
for key in sorted(W['tiles']):
    i, j = map(int, key.split('_')); im = O.img(i // 2, j // 2)
    if im is None: skip += 1; continue
    c = im[(j % 2) * H:(j % 2) * H + H, (i % 2) * H:(i % 2) * H + H]  # row 0 = north (z0), col 0 = west (x0)
    if (c.max(2) < 8).mean() > .5 or (c.min(2) > 247).mean() > .5: skip += 1; continue  # nodata
    p = Image.fromarray(c)
    p.save(f'{WD}/photo/{key}.webp', quality=72, method=6)
    p.resize((256, 256), Image.LANCZOS).save(f'{WD}/photo/lo/{key}.webp', quality=80, method=6)
    n += 1; size += os.path.getsize(f'{WD}/photo/{key}.webp') + os.path.getsize(f'{WD}/photo/lo/{key}.webp')
print(n, 'tiles,', skip, 'skipped,', round(size / 1e6, 1), 'MB')
