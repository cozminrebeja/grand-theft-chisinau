"""Apply the satellite/OSM accuracy audit (tools/data/overrides/<sector>.json) to the generated world data in place.
  python3 tools/apply_overrides.py [world_dir]
1. Citywide rules for the pipeline's fallbacks (build_city.py only read OSM lanes/width/levels inside the centre extract).
2. Explicit per-point fixes measured on satellite by sector (they win over rules).
Idempotent: every rule matches only the pipeline's original fallback values, and explicit road points carry from_w/match_w
or set an absolute width. Re-run tools/make_city_lod.py afterwards so the Blender city layer matches."""
import json, glob, os, sys, math, random, re, collections

W = sys.argv[1] if len(sys.argv) > 1 else 'world'
OV = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'overrides', '*.json')))
WJ = json.load(open(f'{W}/world.json')); NAMES = WJ['names']; NID = {n: i for i, n in enumerate(NAMES)}
PACKS = {f: json.load(open(f)) for f in sorted(glob.glob(f'{W}/packs/*.json'))}
S = collections.Counter()

def pts(flat): return [(flat[k] * .1, flat[k + 1] * .1) for k in range(0, len(flat) - 1, 2)]
def area(p): return abs(sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p)))) / 2
def min_rect(p):  # (short side, long side) of the minimum-area bounding rectangle over edge directions
    best = None
    for i in range(len(p)):
        dx, dz = p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]; L = math.hypot(dx, dz)
        if L < .5: continue
        ux, uz = dx / L, dz / L
        a = [x * ux + z * uz for x, z in p]; b = [-x * uz + z * ux for x, z in p]
        r = sorted((max(a) - min(a), max(b) - min(b)))
        if best is None or r[0] * r[1] < best[0] * best[1]: best = r
    return best or (0, 0)
def pip(p, x, z):
    c = False
    for i in range(len(p)):
        (ax, az), (bx, bz) = p[i - 1], p[i]
        if (az > z) != (bz > z) and x < ax + (z - az) * (bx - ax) / (bz - az): c = not c
    return c

GLASS_KEEP = {'Crown Plaza', 'Infinity Tower', 'Royal Tower', 'MallDova Centre'}
F_OLD = (1.2, .6)

# ---------------- 1. rules ----------------
def rule_building(b, key, n):
    e = b[6] if len(b) > 6 and b[6] else {}
    fl, name, h0 = e.get('floors'), e.get('name', ''), b[0]
    ring = pts(b[4]); A = area(ring); rnd = random.Random(f'{key}:{n}')
    if name == 'Rezervor subteran':  # covered reservoirs are grass mounds (Ciocana)
        b[0], b[2] = 1.5, 3; S['reservoir'] += 1; return
    if fl and any(abs(h0 - (fl * 3.2 + o)) < .15 for o in F_OLD):
        # floors→height: typical panel blocks 5/9/16 storeys ≈ 15/27/46 m (Buiucani/Ciocana/Botanica agree within ~1 m)
        b[0] = round(fl * 2.85 + 1.0, 1); S['floors'] += 1
    elif not fl:
        if 120 <= A < 400 and h0 in (10, 13) and b[2] == 0:  # private houses at 3–4 storeys (all sectors)
            b[0] = rnd.choice([5, 6.5, 7]); S['house'] += 1
        elif A >= 400 and h0 in (19, 28, 31, 48):
            short, long_ = min_rect(ring)
            # ponytail: shape heuristic, the data has no building class. Long thin slabs (≤18 m deep, ≥2.5:1) are panel blocks
            # and keep their height; halls, schools and historic blocks drop to 2–4 storeys. Upgrade: carry OSM class from build_city.py.
            if short <= 18 and long_ >= 2.5 * short:
                if h0 == 48: b[0] = 27.0; S['slab48'] += 1  # untagged 16-storey guess (Centru: 2 of 3 wrong) → 9 storeys
            else:
                b[0] = rnd.choice([9, 11, 13]) if h0 != 19 or A >= 1500 else rnd.choice([9, 11]); S['bighall'] += 1
                if b[2] == 1: b[2] = 0 if b[0] > 10 else 3
    if b[2] == 2 and name not in GLASS_KEEP:  # 50% random glass on towers; nearly all are residential (Botanica, Buiucani)
        b[2] = 1; S['glass'] += 1
    if h0 > 60 and A < 400: b[2] = 3; S['chimney'] += 1  # CET chimneys were glass/panel prisms
    if b[2] == 1 and b[0] < 9: b[2] = 0

def rule_road(r):
    if r[0] != 0: return
    if r[2] == 0 and r[1] < 5: r[1] = 6.5; S['road2way<5'] += 1  # OSM lanes=1 on two-way streets → 3.9 m
    elif r[2] != 0 and r[1] < 4.5: r[1] = 4.9; S['road1way<4.5'] += 1

for r in WJ['r']: rule_road(r)
for P in PACKS.values():
    for key, t in P.items():
        for n, b in enumerate(t.get('b', [])): rule_building(b, key, n)
        for r in t.get('r', []): rule_road(r)

# ---------------- 2. explicit per-point fixes ----------------
roads, blds, whole = [], [], []
for f in OV:
    O = json.load(open(f))
    for o in O.get('roads', []):
        if o['name'] not in NID: S['road-name-missing'] += 1; continue
        mw = o.get('match_w') or ([o['from_w']] if 'from_w' in o else None)
        if o.get('x') is None:  # whole named road; ow null = keep each piece's direction, only its oneway carriageways
            whole.append((NID[o['name']], float(o['w']), o.get('ow'), mw)); continue
        roads.append((NID[o['name']], o['x'], o['z'], float(o['w']), int(o['ow']), mw))
    blds += O.get('buildings', [])
RB = collections.defaultdict(list)
for o in roads: RB[o[0]].append(o)

def road_target(r, majority):
    """Nearest matching override point within 40 m of the road's vertices. Tile pieces take the overall nearest;
    global roads (one width per whole way) take the target most of their matched vertices agree on."""
    cand = [o for o in RB.get(r[3], []) if o[5] is None or any(abs(r[1] - m) < .05 for m in o[5])]
    if not cand: return None
    votes = collections.Counter(); best = (1600, None)
    for x, z in pts(r[6]):
        d, o = min(((x - o[1]) ** 2 + (z - o[2]) ** 2, o) for o in cand)
        if d < 1600: votes[(o[3], o[4])] += 1; best = min(best, (d, (o[3], o[4])))
    if not votes: return None
    return votes.most_common(1)[0][0] if majority else best[1]

def whole_road(r):
    for n, w, ow, mw in whole:
        if r[3] == n and r[0] == 0 and (ow is not None or r[2] != 0) and (mw is None or any(abs(r[1] - m) < .05 for m in mw)):
            if (r[1], r[2]) != (w, r[2] if ow is None else ow): r[1] = w; r[2] = r[2] if ow is None else ow; S['road-whole'] += 1
            return True
for r in WJ['r']:
    if whole_road(r): continue
    t = road_target(r, True)
    if t and (r[1], r[2]) != t: r[1], r[2] = t; S['road-global'] += 1
for P in PACKS.values():
    for t in P.values():
        for r in t.get('r', []):
            if r[0] > 2 or whole_road(r): continue
            g = road_target(r, False)
            if g and (r[1], r[2]) != g: r[1], r[2] = g; S['road-piece'] += 1

# buildings: footprint containing the point, else nearest centroid within 20 m
idx = []
for P in PACKS.values():
    for t in P.values():
        for b in t.get('b', []):
            p = pts(b[4]); idx.append((sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p), p, b))
for o in blds:
    near = [c for c in idx if abs(c[0] - o['x']) < 150 and abs(c[1] - o['z']) < 150]
    hit = next((c for c in near if pip(c[2], o['x'], o['z'])), None) or min(near, key=lambda c: (c[0] - o['x']) ** 2 + (c[1] - o['z']) ** 2, default=None)
    if not hit or (not pip(hit[2], o['x'], o['z']) and math.hypot(hit[0] - o['x'], hit[1] - o['z']) > 20): S['bld-miss'] += 1; continue
    b = hit[3]; b[0] = float(o['h'])
    if 'style' in o: b[2] = int(o['style'])
    elif b[2] == 1 and b[0] < 9: b[2] = 0
    elif b[0] >= 22 and b[2] in (0, 3): b[2] = 1  # same as the pipeline: ≥22 m reads as a panel block
    S['bld-explicit'] += 1

# ---------------- 3. buildings standing in the road ----------------
# Drop footprints that sit >30% on a drivable/service carriageway, and low ones (≤8 m) a street centreline runs ≥4 m into
# (Overture/OSM misalignment: kiosks, sheds, houses on the asphalt). Runs after the width fixes; deleting is idempotent.
C = 20; SEG = collections.defaultdict(list); CL = collections.defaultdict(list)
for P in PACKS.values():
    for t in P.values():
        for r in t.get('r', []):
            if r[0] > 1: continue
            p = pts(r[6]); w = r[1]
            for a, b in zip(p, p[1:]):
                for i in range(math.floor((min(a[0], b[0]) - w) / C), math.floor((max(a[0], b[0]) + w) / C) + 1):
                    for j in range(math.floor((min(a[1], b[1]) - w) / C), math.floor((max(a[1], b[1]) + w) / C) + 1):
                        SEG[(i, j)].append((a, b, w))
                if r[0] == 0:
                    n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1])))
                    for k in range(n):
                        x, z = a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n; CL[(math.floor(x / C), math.floor(z / C))].append((x, z))
def on_road(x, z):
    for a, b, w in SEG.get((math.floor(x / C), math.floor(z / C)), ()):
        dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz or 1e-9; u = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
        if math.hypot(a[0] + dx * u - x, a[1] + dz * u - z) < w / 2 - .5: return True
    return False
def in_road(b):
    p = pts(b[4])
    if len(p) < 3: return False
    xs, zs = [q[0] for q in p], [q[1] for q in p]; x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    if b[0] <= 8 and sum(pip(p, x, z) for i in range(math.floor(x0 / C), math.floor(x1 / C) + 1)
                         for j in range(math.floor(z0 / C), math.floor(z1 / C) + 1) for x, z in CL.get((i, j), ())) >= 4: return True
    st = max(.8, math.sqrt((x1 - x0) * (z1 - z0)) / 14); n = on = 0; x = x0 + st / 2
    while x < x1:
        z = z0 + st / 2
        while z < z1:
            if pip(p, x, z): n += 1; on += on_road(x, z)
            z += st
        x += st
    return n > 0 and on / n > .3
for P in PACKS.values():
    for t in P.values():
        if 'b' in t:
            keep = [b for b in t['b'] if not in_road(b)]; S['bld-in-road'] += len(t['b']) - len(keep); t['b'] = keep

dump = lambda o, f: open(f, 'w').write(json.dumps(o, separators=(',', ':'), ensure_ascii=False))
dump(WJ, f'{W}/world.json')
for f, P in PACKS.items(): dump(P, f)
print(dict(S))
