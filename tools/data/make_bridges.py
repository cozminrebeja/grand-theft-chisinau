"""Extract bridge and tunnel spans for Chișinău from the cached Overture segments and add them to world.json.
Input : /home/claude/gtc/citydata/raw/transportation_segment.parquet (road_flags is_bridge / is_tunnel with `between` fractions),
        world/world.json (origin, bounds, global roads `r` for widths).
Output: world.json keys `bridges` and `tunnels`: [[w, layer, flat dm, kind]] (kind 0 drivable,1 service,2 pedestrian,3 footway,4 rail).
Run   : python3 dev/data/make_bridges.py [world_dir]   (adds/overwrites only the two keys)"""
import sys, json, math, collections
import pyarrow.parquet as pq
import shapely
from shapely.geometry import LineString
from shapely.strtree import STRtree
import numpy as np

WD = sys.argv[1] if len(sys.argv) > 1 else 'world'
RAW = '/home/claude/gtc/citydata/raw'
W = json.load(open(WD + '/world.json'))
LAT0, LON0 = W['origin']
KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110574
X0, X1, Z0, Z1 = W['bounds']
DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'}
DEFW = {'trunk': 15, 'motorway': 16, 'primary': 14, 'secondary': 11, 'tertiary': 9, 'residential': 6.5, 'unclassified': 6.5,
        'living_street': 5.5, 'service': 4.2, 'track': 3.5, 'pedestrian': 6, 'footway': 2.2, 'path': 2, 'cycleway': 2, 'steps': 2.2, 'bridleway': 2}

def proj(coords):
    a = np.asarray(coords)
    return np.column_stack(((a[:, 0] - LON0) * KX, -(a[:, 1] - LAT0) * KZ))

# global roads index for widths (kinds 0-2)
glines, gw, gk = [], [], []
for r in W['r']:
    f = r[6]
    pts = [(f[i] / 10, f[i + 1] / 10) for i in range(0, len(f), 2)]
    if len(pts) >= 2:
        glines.append(LineString(pts)); gw.append(r[1]); gk.append(r[0])
tree = STRtree(glines)

def width_for(line, kind, cls):
    if kind <= 2:
        mid = line.interpolate(0.5, normalized=True)
        best, bd = None, 4.0
        for i in tree.query(mid.buffer(4.0)):
            d = glines[i].distance(mid)
            if d < bd and gk[i] == kind: bd, best = d, i
        if best is not None: return gw[best]
    if kind == 4: return 5.0
    return DEFW.get(cls, 4.0)

def cut(pts, a, b):
    """sub-polyline between length fractions a..b"""
    line = LineString(pts); L = line.length
    if L <= 0: return None
    s = shapely.ops.substring(line, a * L, b * L) if (a > 0 or b < 1) else line
    return s if isinstance(s, LineString) and s.length > 0 else None
import shapely.ops

seg = pq.read_table(f'{RAW}/transportation_segment.parquet', columns=['geometry', 'subtype', 'class', 'subclass', 'road_flags'])
pieces = {'is_bridge': [], 'is_tunnel': []}
cnt = collections.Counter()
for s in seg.to_pylist():
    flags = s['road_flags'] or []
    if not flags: continue
    vals = set(v for rf in flags for v in (rf.get('values') or []))
    if not (vals & {'is_bridge', 'is_tunnel'}) or 'is_under_construction' in vals: continue
    st, cls, sub = s['subtype'], s['class'], s['subclass']
    if st == 'rail':
        if cls not in ('standard_gauge', 'tram', 'narrow_gauge', 'light_rail', None, 'unknown'): pass
        kind = 4
    elif st == 'road':
        if sub in ('crosswalk', 'sidewalk'): continue
        if cls in DRIVE: kind = 0
        elif cls in ('service', 'track'): kind = 1
        elif cls == 'pedestrian': kind = 2
        elif cls in ('footway', 'path', 'cycleway', 'steps', 'bridleway'): kind = 3
        else: continue
    else: continue
    g = shapely.from_wkb(s['geometry'])
    if g.geom_type != 'LineString': continue
    pts = proj(g.coords)
    if pts[:, 0].max() < X0 or pts[:, 0].min() > X1 or pts[:, 1].max() < Z0 or pts[:, 1].min() > Z1: continue
    for rf in flags:
        for v in rf.get('values') or []:
            if v not in pieces: continue
            bt = rf.get('between') or [0.0, 1.0]
            sub_l = cut(pts, bt[0], bt[1])
            if sub_l is None: continue
            pieces[v].append((kind, cls, sub_l)); cnt[(v, kind)] += 1
print('raw pieces', dict(cnt))

def merge(lst):
    """chain pieces whose endpoints touch (<1 m) and have the same kind into continuous spans"""
    out = []
    by_kind = collections.defaultdict(list)
    for k, c, l in lst: by_kind[k].append([c, list(l.coords)])
    for k, items in by_kind.items():
        used = [False] * len(items)
        ends = collections.defaultdict(list)
        key = lambda p: (round(p[0]), round(p[1]))
        for i, (c, pts) in enumerate(items):
            for e in (pts[0], pts[-1]):
                for dx in (-1, 0, 1):
                    for dz in (-1, 0, 1): ends[(key(e)[0] + dx, key(e)[1] + dz)].append(i)
        def near(p, q): return math.hypot(p[0] - q[0], p[1] - q[1]) < 1.0
        for i in range(len(items)):
            if used[i]: continue
            used[i] = True; c, pts = items[i][0], list(items[i][1])
            grew = True
            while grew:
                grew = False
                for endi in (0, -1):
                    e = pts[endi]
                    for j in ends[key(e)]:
                        if used[j]: continue
                        q = items[j][1]
                        if near(q[0], e): add = q[1:]
                        elif near(q[-1], e): add = q[::-1][1:]
                        else: continue
                        # only continue roughly straight (avoid chaining across junctions at sharp angles)
                        d1 = (pts[-1][0] - pts[-2][0], pts[-1][1] - pts[-2][1]) if endi == -1 else (pts[0][0] - pts[1][0], pts[0][1] - pts[1][1])
                        d2 = (add[0][0] - e[0], add[0][1] - e[1]) if add else (0, 0)
                        l1, l2 = math.hypot(*d1), math.hypot(*d2)
                        if l1 > 0 and l2 > 0 and (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2) < 0.5: continue
                        used[j] = True
                        pts = pts + add if endi == -1 else add[::-1] + pts
                        grew = True; break
                    if grew: break
            out.append((k, c, LineString(pts)))
    return out

res = {}
for v, key in (('is_bridge', 'bridges'), ('is_tunnel', 'tunnels')):
    spans = merge(pieces[v])
    rows = []
    for k, c, l in spans:
        l = l.simplify(0.3)
        if l.length < (8 if k <= 2 else 5): continue      # tiny bogus spans
        if k == 3 and l.length < 6: continue
        w = width_for(l, k, c)
        rows.append([round(float(w), 1), 1 if v == 'is_bridge' else -1, [int(round(t * 10)) for p in l.coords for t in p], k])
    res[key] = rows
    print(key, len(rows), collections.Counter(r[3] for r in rows), 'total km', round(sum(LineString([(r[2][i] / 10, r[2][i + 1] / 10) for i in range(0, len(r[2]), 2)]).length for r in rows) / 1000, 2))
W['bridges'] = res['bridges']; W['tunnels'] = res['tunnels']
import os
json.dump(W, open(WD + '/world.json.tmp', 'w'), separators=(',', ':'), ensure_ascii=False); os.replace(WD + '/world.json.tmp', WD + '/world.json')
print('wrote', WD + '/world.json')
