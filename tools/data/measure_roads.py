"""Measure carriageway widths (kerb to kerb) on the 2020 aerial orthophoto → tools/data/overrides/zz_photo.json.

Every drivable road gets brightness cross-sections every 10 m (not near junctions); their median profile washes out
cars, markings and shadows. Kerbs are the strongest brightening step on each side of the dark carriageway (pavements
here are often asphalt too, but older and lighter). Kept only when each half of the road gives the same width (±2 m).
Roads with a manual satellite fix (other overrides files) are left alone. apply_overrides.py applies the output.
Usage: python3 tools/data/measure_roads.py <world dir> <ortho cache> [--check]   (--check: compare to manual fixes)
"""
import sys, os, json, glob, math, collections
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ortho import Ortho

WD, CACHE = sys.argv[1], sys.argv[2]; CHECK = '--check' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = f'{HERE}/overrides/zz_photo.json'
O = Ortho(WD, CACHE); W = json.load(open(f'{WD}/world.json')); NAMES = W['names']
STEP, DS, K, STEPMIN = .5, 10.0, 40, .02  # K: profile half-length in samples (20 m); STEPMIN: kerb brightening per m

manual = collections.defaultdict(list)
for f in glob.glob(f'{HERE}/overrides/*.json'):
    if f == OUT: continue
    for o in json.load(open(f)).get('roads', []):
        if o.get('x') is not None: manual[o['name']].append((o['x'], o['z'], o['w']))
        else: manual[o['name']].append(None)  # whole-road fix

roads = [r for r in W['r'] if r[0] == 0]
deg = collections.Counter(i for r in roads for i in r[5] if i >= 0)
junc = {i for i, n in deg.items() if n >= 2}


def stations(r):
    P = np.array(r[6], np.float64).reshape(-1, 2) / 10
    J = [P[k] for k, i in enumerate(r[5]) if i in junc]
    out = []
    for a, b in zip(P, P[1:]):
        L = np.hypot(*(b - a))
        if L < 1e-3: continue
        u = (b - a) / L
        for s in np.arange(DS / 2, L, DS):
            p = a + u * s
            if not any(np.hypot(*(p - q)) < r[1] / 2 + 15 for q in J): out.append((p, u))
    return out


def profile(p, u, w):
    """luminance across the road at p (index k <-> offset (k - K) * STEP), or None off the photo"""
    t = np.arange(-K, K + 1) * STEP; n = np.array([-u[1], u[0]])
    xy = p[None, :] + t[:, None] * n[None, :]
    c = O.rgb(xy[:, 0], xy[:, 1]).astype(np.float32) / 255
    return None if (c.max(1) == 0).any() else c.mean(1)


def width(prof, w):
    """kerbs = strongest brightening step on each side of the dark carriageway in the road's median profile"""
    m = np.median(prof, 0); m = np.convolve(m, [.25, .5, .25], 'same'); g = np.gradient(m) / STEP
    t = (np.arange(len(m)) - K) * STEP; lo = 1.5; hi = min(w / 2 + 8, K * STEP - 1)
    R = (t > lo) & (t < hi); L = (t < -lo) & (t > -hi)
    kr = np.argmax(np.where(R, g, -9)); kl = np.argmax(np.where(L, -g, -9))
    if g[kr] < STEPMIN or -g[kl] < STEPMIN: return None
    return t[kr] - t[kl]


res, S = [], collections.Counter()
for r in roads:
    name = NAMES[r[3]] if r[3] < len(NAMES) else ''
    P = np.array(r[6]).reshape(-1, 2) / 10
    mm = manual.get(name, [])
    if not CHECK and (None in mm or any(np.hypot(P[:, 0] - x, P[:, 1] - z).min() < 60 for x, z, _ in [m for m in mm if m])):
        S['manual'] += 1; continue
    st = stations(r)
    prof = [q for q in (profile(p, u, r[1]) for p, u in st) if q is not None]
    if len(prof) < 5: S['few'] += 1; continue
    prof = np.array(prof); h = len(prof) // 2
    ws = [width(prof, r[1]), width(prof[:h], r[1]), width(prof[h:], r[1])]  # whole road, and each half must agree
    if None in ws or max(ws) - min(ws) > 2: S['noisy'] += 1; continue
    w = round(ws[0] * 2) / 2; med = ws[0]
    if not CHECK and abs(w - r[1]) < .75: S['same'] += 1; continue
    # a point every ~50 m: apply_overrides matches tile pieces only within 40 m of a point
    L = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))]); pts = [P[int(np.argmin(abs(L - s)))] for s in np.arange(0, L[-1] + 1, 50)]
    for q in pts: res.append({'name': name, 'x': round(float(q[0]), 1), 'z': round(float(q[1]), 1), 'w': w, 'ow': r[2],
                              'from_w': r[1], 'reason': f'photo 2020: {len(prof)} sections, {med:.1f} m kerb to kerb'})
    S['measured'] += 1

if CHECK:  # compare against the manual satellite audit
    err = []
    for o in res:
        for x, z, w in [m for m in manual.get(o['name'], []) if m]:
            if math.hypot(x - o['x'], z - o['z']) < 60: err.append((o['w'] - w, o['name'], w, o['w'])); break
    e = np.array([q[0] for q in err])
    print(dict(S), 'vs manual: n', len(e), 'median err %.2f  |err| p50 %.2f p80 %.2f' % (np.median(e), np.median(abs(e)), np.percentile(abs(e), 80)))
    for q in sorted(err, key=lambda q: -abs(q[0]))[:12]: print('  %+.1f %s manual %.1f photo %.1f' % q)
else:
    json.dump({'roads': res}, open(OUT, 'w'), ensure_ascii=False, indent=0)
    print(dict(S), '->', OUT)
