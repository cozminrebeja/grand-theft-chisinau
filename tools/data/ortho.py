"""Local cache of Moldova's 2020 aerial orthophoto (AGCC / Geoportal INDS, 0.2 m source, fetched at 0.5 m).

Only used offline to derive data (roof colours, road widths); the photos themselves are never shipped with the game.
Terms: the 2016-2021 orthophoto WMS metadata says "no conditions to access and use"; credit AGCC / Geoportal INDS.
https://geoportalinds.gov.md/geonetwork/srv/api/records/aa3ca0f5-e430-4efd-83fc-f166db62bae1

Fetch:  python3 tools/data/ortho.py <world dir> <cache dir>     (~1 km cells, resumable, ~20 min for the city)
Use:    O = Ortho(world_dir, cache_dir); O.rgb(x, z) -> uint8 RGB at local metres (arrays ok), 0 where not cached
"""
import sys, os, json, math, subprocess
import concurrent.futures as cf
import numpy as np
from PIL import Image

CELL, PX = 1000.0, 2048  # 0.488 m/px
LAYER = 'orthophoto:2020_ortofoto_moldova_centru'
WMS = 'https://maps2.ingeocad.md/geoserver/orthophoto/wms?service=WMS&version=1.1.1&request=GetMap&layers=%s&styles=&srs=EPSG:4326&bbox=%s&width=%d&height=%d&format=image/jpeg'


class Ortho:
    def __init__(self, wd, cache):
        W = json.load(open(f'{wd}/world.json')); self.LAT0, self.LON0 = W['origin']
        self.KX = 111320 * math.cos(math.radians(self.LAT0)); self.KZ = 110574; self.cache = cache; self.mem = {}

    def path(self, i, j): return f'{self.cache}/c_{i}_{j}.jpg'

    def bbox(self, i, j):  # lon/lat box of cell (i,j); x east, z south
        x, z = i * CELL, j * CELL
        return '%.7f,%.7f,%.7f,%.7f' % (self.LON0 + x / self.KX, self.LAT0 - (z + CELL) / self.KZ, self.LON0 + (x + CELL) / self.KX, self.LAT0 - z / self.KZ)

    def img(self, i, j):  # ~12 MB per cell, keeps the last 40 (callers walk the city in cell order)
        k = (i, j)
        if k not in self.mem:
            if len(self.mem) >= 40: self.mem.pop(next(iter(self.mem)))
            p = self.path(i, j); self.mem[k] = np.asarray(Image.open(p).convert('RGB')) if os.path.exists(p) else None
        return self.mem[k]

    def rgb(self, x, z):
        x = np.asarray(x, np.float64); z = np.asarray(z, np.float64); out = np.zeros(x.shape + (3,), np.uint8)
        ci = np.floor(x / CELL).astype(int); cj = np.floor(z / CELL).astype(int)
        for (i, j) in set(zip(ci.ravel().tolist(), cj.ravel().tolist())):
            im = self.img(i, j)
            if im is None: continue
            m = (ci == i) & (cj == j)
            c = np.clip(((x[m] - i * CELL) / CELL * PX).astype(int), 0, PX - 1); r = np.clip(((z[m] - j * CELL) / CELL * PX).astype(int), 0, PX - 1)
            out[m] = im[r, c]
        return out


if __name__ == '__main__':
    wd, cache = sys.argv[1], sys.argv[2]; os.makedirs(cache, exist_ok=True); O = Ortho(wd, cache)
    W = json.load(open(f'{wd}/world.json')); T = W['tile']
    cells = set()
    for key in W['tiles']:  # every 1 km cell touching a streamed tile
        ti, tj = map(int, key.split('_'))
        for x in (ti * T, ti * T + T - 1):
            for z in (tj * T, tj * T + T - 1): cells.add((math.floor(x / CELL), math.floor(z / CELL)))
    todo = sorted(c for c in cells if not os.path.exists(O.path(*c)))
    print(len(cells), 'cells,', len(todo), 'to fetch', flush=True)

    def get(c):
        tmp = O.path(*c) + '.part'
        r = subprocess.run(['curl', '-sf', '-m', '300', '--retry', '3', '-o', tmp, WMS % (LAYER, O.bbox(*c), PX, PX)])
        if r.returncode == 0 and os.path.getsize(tmp) > 1000: os.replace(tmp, O.path(*c)); return True
        return False
    with cf.ThreadPoolExecutor(4) as ex:
        for n, (c, ok) in enumerate(zip(todo, ex.map(get, todo))):
            if not ok or n % 20 == 0: print(n, c, 'ok' if ok else 'FAILED', flush=True)
