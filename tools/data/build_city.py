"""Build the whole-city Chișinău dataset in WORLD.md format.
Inputs : /home/claude/gtc/citydata/raw/*.parquet (dev/data/ov_extract.py), raw/osm_rel/*.osm (dev/data/fetch_trolley.py),
         /home/claude/gtc/osm.pkl (centre OSM extract: exact widths/lanes/trolley tags), the centre world/ (trees, crossings, special, pois).
Output : /home/claude/gtc/citydata/world/{world.json,tiles/i_j.json,map.png}
Run    : python3 dev/data/build_city.py   (from the worktree root)"""
import os, sys, json, math, random, glob, pickle, collections, time, hashlib, re
import xml.etree.ElementTree as ET
import pyarrow.parquet as pq
import shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, box
from shapely.ops import unary_union

T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.1f}s]', *a, flush=True)
RAW = '/home/claude/gtc/citydata/raw'
OUT = '/home/claude/gtc/citydata/world'
HERE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # worktree root
OLD = json.load(open(os.path.join(HERE, 'world/world.json')))
LAT0, LON0 = OLD['origin']
KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110574
TS = 500.0
SC = 0.1
def proj_xy(x, y):  # lon/lat arrays -> metres
    return (x - LON0) * KX, -(y - LAT0) * KZ
def P(geom): return shapely.transform(geom, lambda c: __import__('numpy').column_stack(proj_xy(c[:, 0], c[:, 1])))
q = lambda v: int(round(v * 10))
def flat(pts): return [v for p in pts for v in (q(p[0]), q(p[1]))]
def tij(x, z): return (math.floor(x / TS), math.floor(z / TS))
def num(s):
    try: return float(str(s).replace('m', '').replace(',', '.').strip().split(';')[0])
    except Exception: return None
def osm_ids(sources, prefix):
    out = []
    for s in sources or []:
        rid = s.get('record_id') or ''
        if s.get('dataset') == 'OpenStreetMap' and rid.startswith(prefix):
            m = re.match(prefix + r'(\d+)', rid)
            if m: out.append(int(m.group(1)))
    return out

# ---------------- city polygon (union of the five sectors) ----------------
div = pq.read_table(f'{RAW}/divisions_division_area.parquet', columns=['names', 'subtype', 'geometry']).to_pylist()
SECT = {'sectorul Botanica': 'Botanica', 'sectorul Buiucani': 'Buiucani', 'sectorul Centru': 'Centru', 'sectorul Ciocana': 'Ciocana', 'sectorul Rîșcani': 'Râșcani', 'sectorul Râșcani': 'Râșcani'}
sectors = []
for d in div:
    n = (d['names'] or {}).get('primary') or ''
    if n in SECT: sectors.append((SECT[n], P(shapely.from_wkb(d['geometry']))))
assert len(sectors) == 5, [s[0] for s in sectors]
CITY = unary_union([g for _, g in sectors]).buffer(150)
shapely.prepare(CITY)
X0, Z0, X1, Z1 = CITY.bounds
log('city bounds m', [round(v) for v in (X0, X1, Z0, Z1)], 'area km2', round(CITY.area / 1e6, 1))
TILES = {}
for i in range(math.floor(X0 / TS), math.floor(X1 / TS) + 1):
    for j in range(math.floor(Z0 / TS), math.floor(Z1 / TS) + 1):
        if CITY.intersects(box(i * TS, j * TS, (i + 1) * TS, (j + 1) * TS)):
            TILES[(i, j)] = {'b': [], 'r': [], 'a': [], 'trees': [], 'cross': []}
log('tiles', len(TILES))
def tile_of(x, z):
    k = tij(x, z); return TILES.get(k)

# ---------------- centre OSM extract (exact tags as before) ----------------
nodes, ways, rels = pickle.load(open('/home/claude/gtc/osm.pkl', 'rb'))
log('osm.pkl', len(ways), 'ways')

# ---------------- names table ----------------
names = []; nameIdx = {}
def nid_(s):
    s = s or ''
    if s not in nameIdx: nameIdx[s] = len(names); names.append(s)
    return nameIdx[s]
nid_('')

# ---------------- buildings (logic mirrors /home/claude/gtc/build_data.py) ----------------
SPECIAL_SKIP = {20340431, 25764333, 549387560, 11730885}
def ringpts(coords):
    pts = list(coords)[:-1] if len(coords) > 1 and tuple(coords[0]) == tuple(coords[-1]) else list(coords)
    out = []
    for p in pts:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.3: out.append((p[0], p[1]))
    return out
def area(pts): return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
bt_tab = pq.read_table(f'{RAW}/buildings_building.parquet', columns=['id', 'geometry', 'height', 'min_height', 'num_floors', 'class', 'subtype', 'roof_shape', 'facade_color', 'names', 'sources', 'is_underground'])
nb = 0; nskip = 0
for r in bt_tab.to_pylist():
    if r['is_underground']: continue
    ids_w = osm_ids(r['sources'], 'w'); ids_r = osm_ids(r['sources'], 'r')
    oid = (ids_w or ids_r or [int(hashlib.md5(r['id'].encode()).hexdigest()[:12], 16)])[0]
    if oid in SPECIAL_SKIP: nskip += 1; continue
    g = P(shapely.from_wkb(r['geometry']))
    parts = list(g.geoms) if isinstance(g, MultiPolygon) else [g] if isinstance(g, Polygon) else []
    for poly in parts:
        pts = ringpts(poly.exterior.coords)
        if len(pts) < 3: continue
        fl = flat(pts); cx = sum(fl[0::2]) / len(pts) / 10; cz = sum(fl[1::2]) / len(pts) / 10
        T = tile_of(cx, cz)
        if T is None or not CITY.contains(shapely.Point(cx, cz)): continue
        A = abs(area(pts))
        if A < 8: continue
        h = r['height']; lv = r['num_floors']; mh = r['min_height'] or 0
        rnd = random.Random(oid)
        bt = r['class'] or 'yes'
        if h is None:
            if lv: h = lv * 3.2 + (1.2 if lv < 6 else 0.6)
            elif bt in ('garage', 'garages', 'shed', 'kiosk', 'roof', 'service', 'hut', 'toilets', 'carport', 'container', 'greenhouse', 'farm_auxiliary', 'shelter'): h = 3
            elif bt in ('house', 'detached', 'semidetached_house'): h = rnd.choice([4, 5, 6.5, 7])
            elif bt == 'apartments': h = rnd.choice([15, 16.5, 28, 28, 31, 48]) if A > 500 else rnd.choice([7, 10, 13, 15])
            elif bt in ('church', 'cathedral', 'chapel'): h = 12
            else:
                if A < 120: h = rnd.choice([3.5, 4, 6])
                elif A < 400: h = rnd.choice([6.5, 7.5, 10, 13])
                elif A < 1500: h = rnd.choice([10, 13, 16, 19, 28])
                else: h = rnd.choice([13, 16, 19, 28, 31])
        if bt == 'roof': mh = max(mh, h - 0.6) if h > 3 else 2.6
        if h - mh < 0.5: continue
        col = r['facade_color'] or ''
        style = 0
        if bt in ('church', 'cathedral', 'chapel') or r['subtype'] == 'religious': style = 4
        elif h >= 40: style = 2 if rnd.random() < .5 else 1
        elif h >= 22: style = 1
        elif h <= 4.2: style = 3
        hol = []
        for hr in poly.interiors:
            hp = ringpts(hr.coords)
            if len(hp) >= 3: hol.append(flat(hp))
        rec = [round(h, 1), round(mh, 1), style, col, fl, hol]
        extra = {}
        if r['roof_shape']: extra['roof'] = r['roof_shape']
        if lv: extra['floors'] = int(lv)
        nm = (r['names'] or {}).get('primary')
        if nm: extra['name'] = nm
        if extra: rec.append(extra)
        T['b'].append(rec); nb += 1
log('buildings', nb, 'special skipped', nskip)
del bt_tab

# ---------------- trolleybus relations (wired ways + stops) ----------------
WIRED = set(); stop_nodes = {}
for f in glob.glob(f'{RAW}/osm_rel/*.osm'):
    root = ET.parse(f).getroot()
    nd = {int(e.get('id')): e for e in root if e.tag == 'node'}
    for rel in (e for e in root if e.tag == 'relation'):
        rt = {t.get('k'): t.get('v') for t in rel.findall('tag')}
        if rt.get('route') != 'trolleybus': continue
        for m in rel.findall('member'):
            role = m.get('role') or ''
            if m.get('type') == 'way' and not role.startswith('platform'): WIRED.add(int(m.get('ref')))
            if m.get('type') == 'node' and (role.startswith('platform') or role.startswith('stop')):
                e = nd.get(int(m.get('ref')))
                if e is None: continue
                tags = {t.get('k'): t.get('v') for t in e.findall('tag')}
                stop_nodes[int(m.get('ref'))] = (float(e.get('lat')), float(e.get('lon')), tags.get('name') or 'Stație', role.startswith('platform'))
for w, (nd_, t) in ways.items():
    if t.get('trolley_wire') in ('yes', 'forward', 'backward', 'both'): WIRED.add(w)
log('wired osm ways', len(WIRED), 'stop nodes', len(stop_nodes))

# ---------------- roads ----------------
DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street'}
DEFW = {'trunk': 15, 'motorway': 16, 'primary': 14, 'secondary': 11, 'tertiary': 9, 'residential': 6.5, 'unclassified': 6.5, 'living_street': 5.5, 'service': 4.2, 'track': 3.5, 'pedestrian': 6, 'footway': 2.2, 'path': 2, 'cycleway': 2, 'steps': 2.2, 'bridleway': 2}
conn_id = {}
def cid(c):
    if c not in conn_id: conn_id[c] = len(conn_id)
    return conn_id[c]
seg = pq.read_table(f'{RAW}/transportation_segment.parquet', columns=['id', 'geometry', 'subtype', 'class', 'subclass', 'names', 'road_flags', 'access_restrictions', 'connectors', 'sources', 'width_rules'])
glob_roads = []      # [kind,w,ow,nameIdx,tw,ids,pts]  (kinds 0-2)
render = []          # [kind,w,ow,nameIdx,tw,pts]
crosspts = []
cnt = collections.Counter()
for s in seg.to_pylist():
    if s['subtype'] != 'road': continue
    cls = s['class']; sub = s['subclass']
    flags = set(v for rf in (s['road_flags'] or []) for v in (rf.get('values') or []))
    if 'is_under_construction' in flags: continue
    g = P(shapely.from_wkb(s['geometry']))
    if not isinstance(g, LineString) or g.length < 0.5: continue
    if not CITY.intersects(g): continue
    if sub == 'crosswalk':
        m = g.interpolate(0.5, normalized=True); crosspts.append((m.x, m.y)); continue
    if sub == 'sidewalk': continue
    if cls in DRIVE: kind = 0
    elif cls in ('service', 'track'): kind = 1
    elif cls == 'pedestrian': kind = 2
    elif cls in ('footway', 'path', 'cycleway', 'steps', 'bridleway'): kind = 3
    else: continue
    wids = osm_ids(s['sources'], 'w')
    t = None
    for w in wids:
        if w in ways: t = ways[w][1]; break
    # oneway
    ow = 0
    for a in s['access_restrictions'] or []:
        wh = a.get('when') or {}
        if a.get('access_type') == 'denied' and wh.get('heading') and not wh.get('mode') and not wh.get('using') and not wh.get('vehicle') and not a.get('between'):
            ow = 1 if wh['heading'] == 'backward' else -1
    lanes = None; w = None
    if t is not None:  # exact centre tags, identical to the old pipeline
        o = t.get('oneway'); ow = 1 if o in ('yes', '1', 'true') else -1 if o == '-1' else 0
        if t.get('junction') == 'roundabout': ow = ow or 1
        lanes = num(t.get('lanes'))
        tw_ = num(t.get('width')); w = tw_ if tw_ and 2 < tw_ < 40 else None
    else:
        for wr in s['width_rules'] or []:
            if wr.get('value') and 2 < wr['value'] < 40 and not wr.get('between'): w = wr['value']
    is_link = sub == 'link' or 'is_link' in flags
    base = cls
    if not w:
        if lanes and kind == 0: w = lanes * 3.3 + 0.6
        else: w = DEFW.get(base, 4) * (0.75 if ow and kind == 0 and not lanes else 1)
        if is_link: w = min(w, 7)
        if kind == 1 and sub in ('driveway', 'parking_aisle'): w = min(w, 3.6)
    tw = 1 if (kind == 0 and any(x in WIRED for x in wids)) else 0
    nm = nid_((s['names'] or {}).get('primary') or '')
    pts = [(c[0], c[1]) for c in g.coords]
    if kind <= 2:
        # insert connector points; ids per point
        cum = [0.0]
        for a, b in zip(pts, pts[1:]): cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        L = cum[-1]; ids = [-1] * len(pts)
        ins = []
        for c in s['connectors'] or []:
            sd = c['at'] * L
            k = min(range(len(cum)), key=lambda i: abs(cum[i] - sd))
            if abs(cum[k] - sd) < 0.75: ids[k] = cid(c['connector_id'])
            else: ins.append((sd, cid(c['connector_id'])))
        for sd, c in sorted(ins, reverse=True):
            k = next(i for i in range(1, len(cum)) if cum[i] >= sd)
            a, b = pts[k - 1], pts[k]; f = (sd - cum[k - 1]) / max(1e-9, cum[k] - cum[k - 1])
            pts.insert(k, (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)); ids.insert(k, c); cum.insert(k, sd)
        glob_roads.append([kind, round(w, 1), ow, nm, tw, ids, pts])
    render.append([kind, round(w, 1), ow, nm, tw, pts])
    cnt[kind] += 1
log('roads by kind', dict(cnt), 'connectors', len(conn_id), 'crosswalks', len(crosspts))
del seg
# remap node ids to compact ints, keep only ids that are junctions or endpoints (like the old pipeline)
use = collections.Counter(i for r in glob_roads for i in r[5] if i >= 0)
remap = {}
for r in glob_roads:
    ids = r[5]
    for k, i in enumerate(ids):
        if i < 0: continue
        if use[i] > 1 or k == 0 or k == len(ids) - 1:
            if i not in remap: remap[i] = len(remap)
            ids[k] = remap[i]
        else: ids[k] = -1
# simplify global roads between id points (keeps junctions exact)
def simp_keep(pts, ids, tol):
    outp = [pts[0]]; outi = [ids[0]]; start = 0
    for k in range(1, len(pts)):
        if ids[k] >= 0 or k == len(pts) - 1:
            sub = LineString(pts[start:k + 1]).simplify(tol) if k - start > 1 else LineString(pts[start:k + 1])
            sc = list(sub.coords)[1:]
            for c in sc[:-1]: outp.append(c); outi.append(-1)
            outp.append(pts[k]); outi.append(ids[k]); start = k
    return outp, outi
R_GLOBAL = []
for kind, w, ow, nm, tw, ids, pts in glob_roads:
    p2, i2 = simp_keep(pts, ids, 0.25)  # streets renders kinds 0-2 from this list: keep near-full detail
    R_GLOBAL.append([kind, w, ow, nm, tw, i2, flat(p2)])
log('global roads', len(R_GLOBAL), 'graph nodes', len(remap))
# render pieces per tile (densify long segments, split by segment midpoint)
def densify(pts, step=40.0):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); n = int(L // step)
        for k in range(1, n + 1):
            f = k / (n + 1); out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
        out.append(b)
    return out
npieces = 0
for kind, w, ow, nm, tw, pts in render:
    pts = list(LineString(pts).simplify(0.25).coords) if len(pts) > 2 else pts
    pts = densify(pts)
    cur = None; piece = []
    def flush():
        global npieces
        if piece and cur in TILES: TILES[cur]['r'].append([kind, w, ow, nm, tw, None, flat(piece)]); npieces += 1
    for a, b in zip(pts, pts[1:]):
        tk = tij((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if tk != cur:
            flush(); cur = tk; piece = [a]
        piece.append(b)
    flush()
log('render pieces', npieces)

# ---------------- areas ----------------
def areaKind(t):
    if t.get('natural') == 'water' or t.get('water') or t.get('landuse') in ('reservoir', 'basin'): return 'water'
    if t.get('leisure') in ('park', 'garden', 'playground', 'pitch', 'nature_reserve') or t.get('landuse') in ('grass', 'forest', 'recreation_ground', 'village_green', 'cemetery', 'meadow') or t.get('natural') in ('wood', 'scrub', 'grassland'): return 'park'
    if t.get('place') == 'square' or (t.get('highway') == 'pedestrian') or t.get('amenity') in ('marketplace',) or t.get('area:highway') == 'pedestrian': return 'plaza'
    if t.get('amenity') == 'parking': return 'parking'
    return None
areas = []
for fname, extra in (('base_land_use', None), ('base_water', 'water'), ('base_infrastructure', None)):
    tb = pq.read_table(f'{RAW}/{fname}.parquet', columns=['geometry', 'source_tags', 'subtype', 'class'])
    for r in tb.to_pylist():
        st = dict(r['source_tags'] or [])
        k = areaKind(st)
        if fname == 'base_water' and not k and r['subtype'] in ('lake', 'pond', 'reservoir', 'water', 'river') and r['class'] not in ('wastewater',): k = 'water'
        if fname == 'base_infrastructure':
            k = 'parking' if (r['class'] == 'parking' and r['subtype'] == 'transit') else None
        if not k: continue
        g = shapely.from_wkb(r['geometry'])
        if g.geom_type not in ('Polygon', 'MultiPolygon'): continue
        g = P(g)
        if not g.is_valid: g = g.buffer(0)
        if g.is_empty or not CITY.intersects(g): continue
        areas.append((k, g))
log('areas', collections.Counter(k for k, _ in areas))
ORDER = {'park': 0, 'parking': 1, 'plaza': 2, 'water': 3}
na = 0
for k, g in areas:
    x0, z0, x1, z1 = g.bounds
    for i in range(math.floor(x0 / TS), math.floor(x1 / TS) + 1):
        for j in range(math.floor(z0 / TS), math.floor(z1 / TS) + 1):
            T = TILES.get((i, j))
            if T is None: continue
            c = g.intersection(box(i * TS, j * TS, (i + 1) * TS, (j + 1) * TS))
            if c.is_empty: continue
            c = c.simplify(0.3)
            for p in (c.geoms if hasattr(c, 'geoms') else [c]):
                if p.geom_type != 'Polygon' or p.area < 4: continue
                o = ringpts(p.exterior.coords)
                if len(o) < 3: continue
                T['a'].append([k, flat(o), [flat(ringpts(h.coords)) for h in p.interiors if len(ringpts(h.coords)) >= 3]]); na += 1
for T in TILES.values(): T['a'].sort(key=lambda a: ORDER[a[0]])
log('area pieces', na)

# ---------------- trees + crossings (centre OSM from the old dataset, + Overture crossings city-wide) ----------------
old_trees = []; old_cross = []
for f in glob.glob(os.path.join(HERE, 'world/tiles/*.json')):
    d = json.load(open(f)); old_trees += d.get('trees', []); old_cross += d.get('cross', [])
for k in range(0, len(old_trees), 2):
    T = tile_of(old_trees[k] * SC, old_trees[k + 1] * SC)
    if T is not None: T['trees'] += [old_trees[k], old_trees[k + 1]]
infra = pq.read_table(f'{RAW}/base_infrastructure.parquet', columns=['geometry', 'class'])
for r in infra.to_pylist():
    if r['class'] == 'crossing':
        g = shapely.from_wkb(r['geometry'])
        if g.geom_type == 'Point':
            x, z = proj_xy(g.x, g.y); crosspts.append((x, z))
seen = set(); nc = 0
for k in range(0, len(old_cross), 2): seen.add((round(old_cross[k] * SC / 3), round(old_cross[k + 1] * SC / 3)))
for k in range(0, len(old_cross), 2):
    T = tile_of(old_cross[k] * SC, old_cross[k + 1] * SC)
    if T is not None: T['cross'] += [old_cross[k], old_cross[k + 1]]; nc += 1
for x, z in crosspts:
    key = (round(x / 3), round(z / 3))
    if key in seen: continue
    seen.add(key); T = tile_of(x, z)
    if T is not None and CITY.contains(shapely.Point(x, z)): T['cross'] += [q(x), q(z)]; nc += 1
log('trees', len(old_trees) // 2, 'crossings', nc)

# ---------------- stops ----------------
stops = []
for nid, (la, lo, name, plat) in stop_nodes.items():
    x, z = proj_xy(lo, la)
    if not CITY.contains(shapely.Point(x, z)): continue
    if any(abs(s[0] - x) < 10 and abs(s[1] - z) < 10 for s in stops): continue
    stops.append((x, z, name, plat))
# prefer platforms: drop stop_positions that have a platform within 30 m
st2 = [s for s in stops if s[3] or not any(o[3] and math.hypot(o[0] - s[0], o[1] - s[1]) < 30 for o in stops)]
STOPS = [[q(x), q(z), n] for x, z, n, _ in st2]
log('stops', len(STOPS))

# ---------------- POIs ----------------
pois = [list(p) for p in OLD['pois']]
CATS = {'hospital', 'college_university', 'hotel', 'park', 'shopping', 'historic_site', 'christian_place_of_worship', 'museum', 'theatre', 'music_venue', 'travel_and_transportation',
        'library', 'stadium', 'zoo', 'market', 'shopping_mall', 'performing_arts_venue', 'arena', 'sport_or_fitness_facility', 'government_office', 'high_school', 'monument'}
pl = pq.read_table(f'{RAW}/places_place.parquet', columns=['geometry', 'basic_category', 'confidence', 'names']).to_pylist()
pl.sort(key=lambda r: -(r['confidence'] or 0))
for r in pl:
    if r['basic_category'] not in CATS or (r['confidence'] or 0) < 0.75: continue
    nm = (r['names'] or {}).get('primary') or ''
    if len(nm) < 4 or len(nm) > 48: continue
    g = shapely.from_wkb(r['geometry']); x, z = proj_xy(g.x, g.y)
    if not CITY.contains(shapely.Point(x, z)): continue
    if any(math.hypot(p[1] - x, p[2] - z) < 300 for p in pois): continue
    pois.append([nm, round(x, 1), round(z, 1)])
    if len(pois) >= 240: break
log('pois', len(pois))

# ---------------- districts ----------------
districts = []
for n, g in sectors:
    poly = max(g.geoms, key=lambda p: p.area) if hasattr(g, 'geoms') else g
    districts.append([n, flat(ringpts(poly.simplify(15).exterior.coords))])

# ---------------- write tiles ----------------
os.makedirs(f'{OUT}/tiles', exist_ok=True)
for f in glob.glob(f'{OUT}/tiles/*.json'): os.remove(f)
index = {}; sizes = []
for (i, j), T in TILES.items():
    if not (T['b'] or T['r'] or T['a']): continue
    s = json.dumps(T, separators=(',', ':'), ensure_ascii=False)
    open(f'{OUT}/tiles/{i}_{j}.json', 'w').write(s)
    index[f'{i}_{j}'] = [len(T['b']), len(T['r']), len(s.encode())]; sizes.append(len(s.encode()))
log('tiles written', len(index), 'total MB', round(sum(sizes) / 1e6, 1), 'max KB', max(sizes) // 1024)

# ---------------- overview map ----------------
from PIL import Image, ImageDraw
MPP = 4.0
MX0, MZ0 = math.floor(X0), math.floor(Z0)
Wd, Hd = int((X1 - X0) / MPP) + 1, int((Z1 - Z0) / MPP) + 1
img = Image.new('RGB', (Wd, Hd), '#4f5944'); dr = ImageDraw.Draw(img)
M = lambda p: ((p[0] - MX0) / MPP, (p[1] - MZ0) / MPP)
cityring = [M(c) for c in (max(CITY.geoms, key=lambda p: p.area) if hasattr(CITY, 'geoms') else CITY).exterior.coords]
dr.polygon(cityring, fill='#5d6650')
AC = {'park': '#4b7a37', 'water': '#3f86b0', 'plaza': '#a49d8f', 'parking': '#55565a'}
for k, g in sorted(areas, key=lambda a: ORDER[a[0]]):
    for p in (g.geoms if hasattr(g, 'geoms') else [g]):
        if p.geom_type != 'Polygon': continue
        dr.polygon([M(c) for c in p.exterior.coords], fill=AC[k])
        for h in p.interiors: dr.polygon([M(c) for c in h.coords], fill='#5d6650')
for kind, w, ow, nm, tw, pts in sorted(render, key=lambda r: -r[0]):
    if kind == 3: col, wd = '#8f8a7e', 1
    elif kind == 0: col, wd = '#e9e6dc', max(1, round(w * 1.25 / MPP))
    elif kind == 1: col, wd = '#b9b5ac', 1
    else: col, wd = '#c9c3b5', max(1, round(w / MPP))
    dr.line([M(p) for p in pts], fill=col, width=wd)
for kind, w, ow, nm, tw, pts in render:
    if tw: dr.line([M(p) for p in pts], fill='#4f86e6', width=1)
for T in TILES.values():
    for b in T['b']:
        r = b[4]; dr.polygon([((r[k] * SC - MX0) / MPP, (r[k + 1] * SC - MZ0) / MPP) for k in range(0, len(r), 2)], fill='#7a7770')
img.save(f'{OUT}/map.png', optimize=True)
log('map', Wd, 'x', Hd, round(os.path.getsize(f'{OUT}/map.png') / 1e6, 1), 'MB')

# ---------------- world.json ----------------
W = dict(version=1, origin=[LAT0, LON0], bounds=[round(X0), round(X1), round(Z0), round(Z1)], tile=TS, tiles=index,
         r=R_GLOBAL, names=names, pois=pois, stops=STOPS, special=OLD['special'], districts=districts,
         attribution='© OpenStreetMap contributors, Overture Maps Foundation',
         map={'image': 'world/map.png', 'mpp': MPP, 'x0': MX0, 'z0': MZ0})
s = json.dumps(W, separators=(',', ':'), ensure_ascii=False)
open(f'{OUT}/world.json', 'w').write(s)
log('world.json MB', round(len(s.encode()) / 1e6, 2))
