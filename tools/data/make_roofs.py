"""Real roof colours from the 2020 aerial orthophoto → building extra 'rc' ('#rrggbb') in world/packs.

js/facades.js and tools/make_city_lod.py already use ex.rc; without it they pick a random palette colour.
Per building: pixels inside the footprint shrunk by ~1 m (more for tall blocks, whose roofs lean in the photo),
minus the darkest 35% (shadowed roof slopes) and brightest 5% (glints), median of the rest, then a mild grade
so the set matches the game's roof palette brightness. Idempotent. Run after apply_overrides.py, before make_city_lod.py.
Usage: python3 tools/data/make_roofs.py <world dir> <ortho cache>   (cache: tools/data/ortho.py)
"""
import sys, os, json, glob, math, collections
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ortho import Ortho, CELL

WD, CACHE = sys.argv[1], sys.argv[2]
O = Ortho(WD, CACHE); RES = .5
PALETTE_LUM = .50  # mean luminance of js/facades.js FAC_ROOFS (raw display values)
SAT = 1.4  # aerial haze and the median wash out tile reds; the palette is more saturated
S = collections.Counter()

PACKS = {f: json.load(open(f)) for f in sorted(glob.glob(f'{WD}/packs/*.json'))}
blds = []
for P in PACKS.values():
    for t in P.values():
        for b in t['b']:
            r = b[4]; xs = np.array(r[0::2]) / 10; zs = np.array(r[1::2]) / 10
            if len(xs) >= 3: blds.append((math.floor(xs.mean() / CELL), math.floor(zs.mean() / CELL), xs, zs, b))
blds.sort(key=lambda q: (q[1], q[0]))  # cell order keeps the image cache warm


def roof_rgb(xs, zs, h):
    x0, z0 = xs.min(), zs.min(); w = int((xs.max() - x0) / RES) + 3; hh = int((zs.max() - z0) / RES) + 3
    if w * hh > 4e6: return None, 'huge'
    im = Image.new('L', (w, hh), 0); ImageDraw.Draw(im).polygon([((x - x0) / RES + 1, (z - z0) / RES + 1) for x, z in zip(xs, zs)], fill=1)
    m = np.array(im, bool); short = 2 * ndimage.distance_transform_edt(m).max() * RES  # ~ narrowest width (m)
    shrink = min(max(1.0, .06 * h), .3 * short)
    m = ndimage.binary_erosion(m, iterations=max(1, int(shrink / RES)))
    if m.sum() < 16: return None, 'small'
    jj, ii = np.nonzero(m)
    px = O.rgb(x0 + (ii - 1) * RES, z0 + (jj - 1) * RES).astype(np.float32) / 255
    px = px[px.max(1) > 0]  # outside the cached photo
    if len(px) < 16: return None, 'nophoto'
    lum = (px * np.float32([.2126, .7152, .0722])).sum(1)
    lo, hi = np.percentile(lum, [35, 95]); keep = px[(lum >= lo) & (lum <= hi)]
    return (np.median(keep if len(keep) >= 8 else px, 0)), 'ok'


raw = []
for ci, cj, xs, zs, b in blds:
    c, why = roof_rgb(xs, zs, float(b[0])); S[why] += 1
    if c is not None: raw.append((b, c))
C = np.array([c for _, c in raw]); L = (C * [.2126, .7152, .0722]).sum(1)
g = PALETTE_LUM / np.median(L)  # photo is sunlit and bright; match the palette the textures were tuned for
for (b, _), c in zip(raw, C):
    c = c * g; l = (c * [.2126, .7152, .0722]).sum(); c = np.clip(l + (c - l) * SAT, 0, 1); hexc = '#%02x%02x%02x' % tuple(int(v * 255 + .5) for v in c)
    if len(b) < 7: b.append({})
    elif not b[6]: b[6] = {}
    b[6]['rc'] = hexc
dump = lambda o, f: open(f, 'w').write(json.dumps(o, separators=(',', ':'), ensure_ascii=False))
for f, P in PACKS.items(): dump(P, f)
W = json.load(open(f'{WD}/world.json'))
if 'AGCC' not in W['attribution']:
    W['attribution'] += ' · Roof colours: ortofoto 2020 © AGCC / Geoportal INDS'; dump(W, f'{WD}/world.json')
print(dict(S), 'gain %.2f' % g, 'median rgb', np.round(np.median(C * g, 0), 2))
