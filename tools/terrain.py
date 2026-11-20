"""Terrain height as the game sees it: Copernicus DEM (world/height.json) + man-made earthworks (world/earth.json).
Shared by tools/make_earthworks.py, tools/make_city_lod.py (Blender) so every consumer matches js/mapcore.js groundY()."""
import json, os, base64, gzip
import numpy as np

NO = -32768  # earth.json sentinel: cell not affected


class Terrain:
    def __init__(self, W, with_earth=True):
        WJ = json.load(open(os.path.join(W, 'world.json'))); m = WJ['height']; self.m = m
        self.H = np.frombuffer(base64.b64decode(json.load(open(os.path.join(W, os.path.basename(m['file']))))['b64']), dtype='<i2') \
            .reshape(m['nz'], m['nx']).astype(np.float32)
        self.E = None
        p = os.path.join(W, 'earth.json.gz')
        if with_earth and os.path.exists(p):
            E = json.load(gzip.open(p, 'rt')); self.C, self.BS = E['cell'], E['bs']
            self.E = {tuple(map(int, k.split('_'))): np.frombuffer(base64.b64decode(v), dtype='<i2').reshape(self.BS, self.BS) for k, v in E['blocks'].items()}

    def dem(self, x, z):  # same bilinear sampling as js/mapcore.js
        m = self.m
        fx = np.clip((np.asarray(x, np.float64) - m['x0']) / m['cell'], 0, m['nx'] - 1.001); fz = np.clip((np.asarray(z, np.float64) - m['z0']) / m['cell'], 0, m['nz'] - 1.001)
        i = fx.astype(int); j = fz.astype(int); u = fx - i; v = fz - j; H = self.H
        return ((H[j, i] * (1 - u) + H[j, i + 1] * u) * (1 - v) + (H[j + 1, i] * (1 - u) + H[j + 1, i + 1] * u) * v) * m['scale']

    def cell(self, ci, cj):  # earth.json value (m) at integer cell, or None
        B = self.E.get((ci // self.BS, cj // self.BS))
        if B is None: return None
        v = B[cj % self.BS, ci % self.BS]
        return None if v == NO else v * .1

    def ground(self, x, z):
        """Scalar or array. Corners without an earthwork value fall back to the DEM at the point (earthworks taper into it)."""
        d = self.dem(x, z)
        if not self.E: return d
        xs, zs, ds = np.atleast_1d(x).astype(float), np.atleast_1d(z).astype(float), np.atleast_1d(d).astype(float)
        out = ds.copy()
        for n in range(len(xs)):
            fx, fz = xs[n] / self.C, zs[n] / self.C; i, j = int(np.floor(fx)), int(np.floor(fz)); u, v = fx - i, fz - j
            c = [self.cell(i, j), self.cell(i + 1, j), self.cell(i, j + 1), self.cell(i + 1, j + 1)]
            if all(q is None for q in c): continue
            c = [ds[n] if q is None else q for q in c]
            out[n] = (c[0] * (1 - u) + c[1] * u) * (1 - v) + (c[2] * (1 - u) + c[3] * u) * v
        return out if np.ndim(x) else float(out[0])
