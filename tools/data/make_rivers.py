"""Bîc river centrelines (Overture base_water, class river) -> world.json `rivers`: [[w_m, flat dm]] in original metres.
Run: python3 tools/data/make_rivers.py [world_dir]"""
import sys, json, math
import pyarrow.parquet as pq, shapely
from shapely.ops import linemerge
WD = sys.argv[1] if len(sys.argv) > 1 else 'world'
W = json.load(open(WD + '/world.json'))
LAT0, LON0 = W['origin']; KX = 111320 * math.cos(math.radians(LAT0)); KZ = 110574
X0, X1, Z0, Z1 = W['bounds']
t = pq.read_table('/home/claude/gtc/citydata/raw/base_water.parquet', columns=['names', 'class', 'geometry']).to_pylist()
lines = []
for r in t:
    if r['class'] != 'river': continue
    g = shapely.from_wkb(r['geometry'])
    if g.geom_type != 'LineString': continue
    g = shapely.transform(g, lambda c: __import__('numpy').column_stack(((c[:, 0] - LON0) * KX, -(c[:, 1] - LAT0) * KZ)))
    lines.append(g)
m = linemerge(lines)
parts = list(m.geoms) if hasattr(m, 'geoms') else [m]
box = shapely.box(X0 - 200, Z0 - 200, X1 + 200, Z1 + 200)
out = []
for p in parts:
    p = p.intersection(box)
    for q in (p.geoms if hasattr(p, 'geoms') else [p]):
        if q.is_empty or q.length < 30: continue
        q = q.simplify(1.5)
        out.append([22, [int(round(v * 10)) for xy in q.coords for v in xy]])
        print('river part', round(q.length), 'm', len(q.coords), 'pts')
W['rivers'] = out
json.dump(W, open(WD + '/world.json', 'w'), separators=(',', ':'), ensure_ascii=False)
