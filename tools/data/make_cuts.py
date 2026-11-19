"""Grade separation where a road bridge crosses over another drivable road that stays on the ground.
The DEM is ground-filtered (and roads are draped), so such crossings came out at-grade. For each one we
  * sink the under-road into a cut (world.json `cuts`: [[hw_m, depth_m, centre_s_m, flat dm]]; depth tapers to 0 at both ends)
  * lift the deck with a hump (world.json `humps`: [[x_dm, z_dm, H_m, R_m]] applied to every span passing within R)
Run after make_bridges.py and make_rivers.py:  python3 tools/data/make_cuts.py [world_dir]"""
import sys, json, math
from shapely.geometry import LineString, Point
from shapely.ops import linemerge, substring
from shapely.strtree import STRtree
import numpy as np
WD = sys.argv[1] if len(sys.argv) > 1 else 'world'
W = json.load(open(WD + '/world.json'))
NAMES = W['names']
CLEAR = 7.2      # deck top over the under-road (game metres): 5.5 m vertical clearance (MD/SNiP norm for city streets) + ~1.7 m deck & girders
LC = 115.0       # cut half-length along the under-road (original metres) — keeps the ramp grade under ~9%
H = W['height']; A = np.array(__import__('base64').b64decode(json.load(open(WD + '/height.json'))['b64']) and np.frombuffer(__import__('base64').b64decode(json.load(open(WD + '/height.json'))['b64']), dtype='<i2')).reshape(H['nz'], H['nx'])
def gy(x, z):  # original metres -> game height (heightmap metres * WS=0.8)
    fx = (x - H['x0']) / H['cell']; fz = (z - H['z0']) / H['cell']; i = int(fx); j = int(fz); u = fx - i; v = fz - j
    a = A[j, i] * (1 - u) + A[j, i + 1] * u; b = A[j + 1, i] * (1 - u) + A[j + 1, i + 1] * u
    return (a * (1 - v) + b * v) * H['scale'] * 0.8
L = lambda f: LineString([(f[i] / 10, f[i + 1] / 10) for i in range(0, len(f), 2)])
spans = [(b, L(b[2])) for b in W['bridges']]
road_spans = [(b, l) for b, l in spans if b[3] <= 1 and l.length > 15]
allspan = STRtree([l for _, l in spans])
roads = [(r, L(r[6])) for r in W['r'] if r[0] <= 1 and len(r[6]) >= 4]
rtree = STRtree([l for _, l in roads])
def covered(p, line):  # is the road at p itself on a bridge span (parallel & overlapping)?
    for i in allspan.query(p.buffer(4)):
        sl = spans[i][1]
        if sl.distance(p) < 3 and abs(sl.project(p) - sl.length / 2) < sl.length / 2 - 1:
            # parallel test
            a = sl.interpolate(max(0, sl.project(p) - 2)); b = sl.interpolate(min(sl.length, sl.project(p) + 2))
            c = line.interpolate(max(0, line.project(p) - 2)); d = line.interpolate(min(line.length, line.project(p) + 2))
            u = np.array([b.x - a.x, b.y - a.y]); w = np.array([d.x - c.x, d.y - c.y])
            if abs(u @ w) / (np.linalg.norm(u) * np.linalg.norm(w) + 1e-9) > .8: return True
    return False
cuts, humps = [], []
for b, sl in road_spans:
    hits = []
    for i in rtree.query(sl):
        r, rl = roads[i]
        x = rl.intersection(sl)
        for p in (getattr(x, 'geoms', [x]) if not x.is_empty else []):
            if p.geom_type != 'Point': continue
            s = sl.project(p)
            if s < 4 or s > sl.length - 4: continue           # touches at the abutment = junction, not an underpass
            if covered(p, rl): continue
            hits.append((s, p, r, rl))
    if not hits: continue
    # cluster by road name (dual carriageways -> one cut)
    groups = {}
    for h in hits: groups.setdefault((h[2][3], h[2][0]), []).append(h)
    for (nm, kind), G in groups.items():
        s0 = sum(h[0] for h in G) / len(G); pc = sl.interpolate(s0)
        have = (gy(sl.coords[0][0], sl.coords[0][1]) * (1 - s0 / sl.length) + gy(sl.coords[-1][0], sl.coords[-1][1]) * s0 / sl.length) - gy(pc.x, pc.y)
        need = CLEAR - have
        if need <= .5: continue
        # hump on the deck: sin² rise from the nearer abutment, max grade ~9%  (slope_max = H·π/(2·s*), s* in game metres)
        sstar = min(s0, sl.length - s0) * .8
        Hh = max(0.0, min(3.2, need * .45, .09 * 2 * sstar / math.pi))
        D = min(6.0, need - Hh); Hh = need - D if need - D > Hh else Hh
        # centre line: merge same-name pieces near the crossing, take the piece through the first hit, offset to the cluster middle
        r0, rl0 = G[0][2], G[0][3]
        same = [roads[i][1] for i in rtree.query(pc.buffer(LC + 40)) if roads[i][0][3] == r0[3] and roads[i][0][0] == r0[0]]
        m = linemerge(same); parts = list(m.geoms) if hasattr(m, 'geoms') else [m]
        line = min(parts, key=lambda q: q.distance(G[0][1]))
        sc = line.project(G[0][1]); sub = substring(line, max(0, sc - LC), min(line.length, sc + LC))
        spread = max(h[0] for h in G) - min(h[0] for h in G)
        if spread > 3:
            # shift toward the other carriageway(s)
            far = max(G, key=lambda h: h[1].distance(G[0][1]))[1]
            q = sub.interpolate(sub.project(G[0][1])); a = sub.interpolate(max(0, sub.project(q) - 2)); c = sub.interpolate(min(sub.length, sub.project(q) + 2))
            t = np.array([c.x - a.x, c.y - a.y]); t /= np.linalg.norm(t) + 1e-9; n = np.array([-t[1], t[0]])
            side = np.sign((far.x - q.x) * n[0] + (far.y - q.y) * n[1])
            sub = sub.offset_curve(side * spread / 2 * .9) if hasattr(sub, 'offset_curve') else sub.parallel_offset(spread / 2 * .9, 'left' if side > 0 else 'right')
            if sub.geom_type != 'LineString': continue
        hw = max(h[2][1] for h in G) / 2 + spread / 2 + 4.0
        sub = sub.simplify(.8); scc = sub.project(pc)
        cuts.append([round(hw, 1), round(D, 2), round(scc, 1), [int(round(v * 10)) for xy in sub.coords for v in xy]])
        humps.append([int(round(pc.x * 10)), int(round(pc.y * 10)), round(Hh, 2), round(b[0] / 2 + 14, 1)])
        print(f'{NAMES[r0[3]] if isinstance(r0[3], int) and r0[3] < len(NAMES) else r0[3]!s:32} under span w{b[0]} at ({pc.x:.0f},{pc.y:.0f}) have {have:.1f} cut {D:.1f} hump {Hh:.1f} hw {hw:.1f}')
W['cuts'] = cuts; W['humps'] = humps
json.dump(W, open(WD + '/world.json', 'w'), separators=(',', ':'), ensure_ascii=False)
print(len(cuts), 'cuts')
