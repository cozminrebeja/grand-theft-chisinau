"""Inventory of every bridge in the Chișinău game area, from Overture base/infrastructure (OSM bridge ways with their tags,
OSM man_made=bridge outlines) + what each one crosses (Bîc/streams, roads, railways, or a valley).
Writes tools/data/bridges_chisinau.csv. With --add-rail also adds the railway bridges to world.json `bridges` (kind 4) —
off by default because the game does not draw railway tracks yet.
Run after make_bridges.py and make_rivers.py:  python3 tools/data/bridge_inventory.py [world_dir]"""
import sys, json, math, csv, os
import pyarrow.parquet as pq, shapely, numpy as np
from shapely.geometry import LineString
from shapely.strtree import STRtree
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]; ADD_RAIL = '--add-rail' in sys.argv
WD = ARGS[0] if ARGS else 'world'
RAW = '/home/claude/gtc/citydata/raw'
HERE = os.path.dirname(os.path.abspath(__file__))
W = json.load(open(WD + '/world.json'))
LAT0, LON0 = W['origin']; KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110574
X0, X1, Z0, Z1 = W['bounds']
P = lambda g: shapely.transform(g, lambda c: np.column_stack(((c[:, 0] - LON0) * KX, -(c[:, 1] - LAT0) * KZ)))
L = lambda f: LineString([(f[i] / 10, f[i + 1] / 10) for i in range(0, len(f), 2)])
inf = pq.read_table(f'{RAW}/base_infrastructure.parquet', columns=['geometry', 'names', 'subtype', 'class', 'source_tags', 'level']).to_pylist()
lines, areas = [], []
for r in inf:
    if r['subtype'] != 'bridge': continue
    g = P(shapely.from_wkb(r['geometry'])); b = g.bounds
    if b[2] < X0 or b[0] > X1 or b[3] < Z0 or b[1] > Z1: continue
    tags = dict(r['source_tags'] or [])
    rec = {'geom': g, 'name': (r['names'] or {}).get('primary') or tags.get('bridge:name') or '', 'tags': tags, 'level': r['level'] or 1, 'cls': r['class']}
    (areas if g.geom_type in ('Polygon', 'MultiPolygon') else lines).append(rec)
# what is underneath
water = [L(f) for _, f in W.get('rivers', [])]
wq = pq.read_table(f'{RAW}/base_water.parquet', columns=['geometry', 'class']).to_pylist()
for r in wq:
    if r['class'] in ('stream', 'canal', 'drain', 'river', 'ditch'):
        g = shapely.from_wkb(r['geometry'])
        if g.geom_type == 'LineString': water.append(P(g))
wt = STRtree(water)
roads = [L(r[6]) for r in W['r'] if r[0] <= 1 and len(r[6]) >= 4]; rt = STRtree(roads)
rails = []
for s in pq.read_table(f'{RAW}/transportation_segment.parquet', columns=['geometry', 'subtype']).to_pylist():
    if s['subtype'] == 'rail': rails.append(P(shapely.from_wkb(s['geometry'])))
railt = STRtree(rails)
spans = STRtree([L(b[2]) for b in W['bridges']])
KIND = lambda t: 4 if 'railway' in t else 0 if t.get('highway') in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link') else 1 if t.get('highway') in ('service', 'track') else 2 if t.get('highway') == 'pedestrian' else 3
rows, added = [], 0
for rec in lines:
    g = rec['geom']; t = rec['tags']; k = KIND(t)
    crosses = []
    if any(water[i].crosses(g) or water[i].distance(g) < 2 for i in wt.query(g.buffer(2))): crosses.append('water')
    mid = g.interpolate(.5, normalized=True)
    if any(roads[i].crosses(g) for i in rt.query(g) if roads[i].distance(mid) < g.length / 2): crosses.append('road')
    if k != 4 and any(rails[i].crosses(g) for i in railt.query(g)): crosses.append('rail')
    if not crosses: crosses.append('valley/other')
    # deck height rule (game metres above what is underneath): clearance + structure depth
    rule = 'over rail 6.5+1.6' if 'rail' in crosses else 'over road 5.5+1.6' if 'road' in crosses else 'over water ~4.5 above water' if 'water' in crosses else 'follow terrain'
    rows.append({'name': rec['name'], 'type': t.get('railway') or t.get('highway') or t.get('man_made', ''), 'bridge': t.get('bridge', ''), 'structure': t.get('bridge:structure', ''), 'layer': rec['level'], 'length_m': round(g.length, 1),
                 'lat': round(LAT0 - mid.y / KZ, 6), 'lon': round(LON0 + mid.x / KX, 6), 'crosses': '+'.join(crosses), 'deck_rule': rule, 'ref': t.get('ref', ''), 'lanes': t.get('lanes', '')})
    # railway bridges were missing from the game (rail_flags not in the cached extract): add them
    if ADD_RAIL and k == 4 and g.geom_type == 'LineString' and g.length > 8 and not any(L(W['bridges'][i][2]).distance(mid) < 3 for i in spans.query(mid.buffer(3))):
        W['bridges'].append([5.0, int(rec['level'] or 1), [int(round(v * 10)) for xy in g.coords for v in xy], 4]); added += 1
for a in areas:
    c = a['geom'].centroid
    rows.append({'name': a['name'], 'type': 'outline (man_made=bridge)', 'bridge': a['tags'].get('bridge', ''), 'structure': a['tags'].get('bridge:structure', ''), 'layer': a['level'], 'length_m': round(a['geom'].length / 2, 1),
                 'lat': round(LAT0 - c.y / KZ, 6), 'lon': round(LON0 + c.x / KX, 6), 'crosses': '', 'deck_rule': '', 'ref': '', 'lanes': ''})
rows.sort(key=lambda r: (r['type'].startswith('outline'), -r['length_m']))
with open(os.path.join(HERE, 'bridges_chisinau.csv'), 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
if added: json.dump(W, open(WD + '/world.json', 'w'), separators=(',', ':'), ensure_ascii=False)
import collections
print(len(lines), 'bridge ways,', len(areas), 'bridge outlines;', added, 'railway bridges added to world.json')
print(collections.Counter(r['crosses'] for r in rows if r['crosses']))
