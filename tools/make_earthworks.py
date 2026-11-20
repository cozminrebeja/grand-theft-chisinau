"""Bridges & earthworks from the per-area audit specs (tools/data/bridges/*.json, schema in each file's sites[]).
  python3 tools/make_earthworks.py [world_dir] [spec_dir]
Writes:
  world/earth.json  2 m height-correction raster: final ground height (dm, Arc = 0) wherever an embankment / ramp / raised road
                    fills above the DEM or a cutting / river channel cuts below it; js/mapcore.js groundY() and tools/terrain.py read it.
  world.json        bridge_spec {bridge idx: {deck, structure, under}} drives deck profiles + piers in js/bridges.js;
                    bridges missing from Overture are appended (spec.added); walls[] = retaining walls to render.
Idempotent: re-running replaces everything it wrote. Re-run tools/make_city_lod.py afterwards."""
import json, glob, os, sys, base64, math, collections, gzip, re
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from terrain import Terrain, NO

W = sys.argv[1] if len(sys.argv) > 1 else 'world'
SPECS = sorted(glob.glob(os.path.join(sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'bridges'), '*.json')))
C, BS = 2.0, 64
WJ = json.load(open(f'{W}/world.json'))
T = Terrain(W, with_earth=False)
S = collections.Counter()

fill, cut, setv = {}, {}, {}  # (ci,cj) -> metres; setv = raise-or-lower to the line (raised roads)

def raster(line, top_w, side, slope, mode):
    """Rasterise one earthwork: inside top_w/2 the surface is the line height; outside, a slope (H:V) runs back to natural
    ground, or nothing for walls (the wall is rendered). Fills keep max, cuts keep min; combined with the DEM later."""
    half = max(top_w, 1.0) / 2; slope = max(slope or 1.5, .3)
    reach = half + (0 if side == 'wall' else 25 * slope)  # 25 m max height difference handled
    P = np.array(line, float)
    for si, (a, b) in enumerate(zip(P, P[1:])):
        x0, x1 = min(a[0], b[0]) - reach, max(a[0], b[0]) + reach; z0, z1 = min(a[1], b[1]) - reach, max(a[1], b[1]) + reach
        I, J = np.meshgrid(np.arange(math.floor(x0 / C), math.ceil(x1 / C) + 1), np.arange(math.floor(z0 / C), math.ceil(z1 / C) + 1))
        X, Z = I * C, J * C
        dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz or 1e-9
        t0 = ((X - a[0]) * dx + (Z - a[1]) * dz) / l2; t = np.clip(t0, 0, 1)
        d = np.hypot(X - (a[0] + dx * t), Z - (a[1] + dz * t)); y = a[2] + (b[2] - a[2]) * t
        if side == 'wall': tgt = np.where(d <= half, y, np.nan)
        elif mode == 'set': tgt = np.where(d <= half, y, np.nan)  # slopes of a set line come from the fill/cut passes below
        else: tgt = np.where(d <= half, y, (y - (d - half) / slope) if mode == 'fill' else (y + (d - half) / slope))
        tgt = np.where(d <= reach, tgt, np.nan)
        if mode != 'cut':  # fills end square at the line ends: an embankment ending at a bridge deck must not round-cap
            # back under the span and bury what passes beneath (Luncii under Podul Circului)
            if si == 0: tgt = np.where(t0 < 0, np.nan, tgt)
            if si == len(P) - 2: tgt = np.where(t0 > 1, np.nan, tgt)
        dem = T.dem(X, Z)
        keep = ~np.isnan(tgt) & ((tgt > dem + .05) if mode == 'fill' else (tgt < dem - .05) if mode == 'cut' else True)
        D = {'fill': fill, 'cut': cut, 'set': setv}[mode]
        for ci, cj, v in zip(I[keep], J[keep], tgt[keep]):
            k = (int(ci), int(cj)); o = D.get(k)
            D[k] = v if o is None else (min(o, v) if mode == 'cut' else max(o, v))

bridge_spec, walls, added, rivers, channels = {}, [], [], [], []
RAIL = re.compile(r'rail|track|cfm|siding|railway|tram', re.I)
FOOT = re.compile(r'sidewalk|footway|footbridge|pedestrian|stair', re.I)
WATER = re.compile(r'b[îi]c|river|stream|i[șs]nov|bostancea|durle|brook|creek|water|canal', re.I)
base_bridges = [b for b in WJ.get('bridges', []) if not (len(b) > 4 and isinstance(b[4], dict) and b[4].get('added'))]
names = WJ['names']; nid = {n: i for i, n in enumerate(names)}
for f in SPECS:
    for site in json.load(open(f)).get('sites', []):
        for br in site.get('bridges', []):
            spec = {k: br[k] for k in ('deck', 'structure', 'under') if br.get(k)}
            if not spec.get('deck'): S['bridge-no-deck'] += 1; continue
            idx = [i for i in br.get('data_idx') or [] if 0 <= i < len(base_bridges)]
            if not idx and br.get('polyline'):  # missing in Overture → add a span (no rail: the game draws no railways)
                road = br.get('road') or ''
                if RAIL.search(road): S['bridge-rail-skipped'] += 1; continue
                st = br.get('structure') or {}; foot = bool(FOOT.search(road)); w = float(br.get('width') or st.get('road_w') or (2.5 if foot else 7))
                flat = [int(round(v * 10)) for p in br['polyline'] for v in p[:2]]
                added.append([w, 1, flat, 3 if foot else 0, {'added': True, 'site': site.get('id', '')}]); idx = [len(base_bridges) + len(added) - 1]; S['bridge-added'] += 1
            for i in idx: bridge_spec[str(i)] = spec
            S['bridge-spec'] += len(idx)
        for ew in site.get('earthworks', []):
            line = [p for p in ew.get('line') or [] if len(p) >= 3]
            if len(line) < 2: S['earthwork-bad'] += 1; continue
            typ = ew.get('type', 'embankment'); is_cut = typ in ('cutting', 'channel')
            if typ == 'channel' and ew.get('bed_below_water') is not None:  # Bîc-centre gave the WATER line; bed is below it
                wl = line; line = [[p[0], p[1], p[2] - float(ew['bed_below_water'])] for p in line]
            elif typ == 'channel': wl = [[p[0], p[1], p[2] + float(ew.get('water_depth') or .4)] for p in line]
            if typ == 'channel':
                txt = ' '.join(str(ew.get(k) or '') for k in ('name', 'road', 'lining', 'evidence', 'note')) + ' ' + str(site.get('name') or '') + ' ' + str(site.get('id') or '')
                wet = bool(WATER.search(txt)); r1 = lambda P: [[round(p[0], 1), round(p[1], 1), round(p[2], 2)] for p in P]
                channels.append({'line': r1(line), 'w': float(ew.get('top_w') or 6), 'slope': float(ew.get('slope') or 1.5), 'lined': bool(ew.get('lined')) and wet,  # spec flag: the audit saw a concrete / canalised channel
                                 'water': wet, 'wd': round(float(np.mean([a[2] - b[2] for a, b in zip(wl, line)])), 2), 'id': site.get('id', '')})
                if wet: rivers.append({'line': r1(wl), 'half': float(ew.get('top_w') or 6) / 2 + float(ew.get('slope') or 1.5) * 3})
            args = (line, float(ew.get('top_w') or 8), ew.get('side', 'slope'), float(ew.get('slope') or 1.5))
            if typ == 'raised_road': raster(*args, 'set'); raster(*args, 'fill'); raster(*args, 'cut')  # meet the line from above and below
            else: raster(*args, 'cut' if is_cut else 'fill')
            if ew.get('side') == 'wall': walls.append({'line': line, 'half': float(ew.get('top_w') or 8) / 2, 'cut': is_cut}); S['wall'] += 1
            S['earthwork-' + typ] += 1

# combine with the DEM: fill raises, cut lowers (a cut wins where both apply, e.g. an underpass under a ramp's footprint)
cells = {}
for k, v in fill.items(): cells[k] = v
for k, v in cut.items(): cells[k] = min(cells.get(k, v), v) if k in fill else v
for k, v in setv.items(): cells[k] = v  # a raised road's carriageway is exactly its line
blocks = collections.defaultdict(lambda: np.full((BS, BS), NO, '<i2'))
for (ci, cj), v in cells.items(): blocks[(ci // BS, cj // BS)][cj % BS, ci % BS] = int(round(v * 10))
with gzip.open(f'{W}/earth.json.gz', 'wt', compresslevel=9) as fo:  # gzip: the sparse raster is mostly sentinels
    json.dump({'cell': C, 'bs': BS, 'blocks': {f'{bi}_{bj}': base64.b64encode(a.tobytes()).decode() for (bi, bj), a in blocks.items()}}, fo, separators=(',', ':'))
if os.path.exists(f'{W}/earth.json'): os.remove(f'{W}/earth.json')
WJ['bridges'] = base_bridges + added; WJ['bridge_spec'] = bridge_spec; WJ['walls'] = walls; WJ['rivers'] = rivers; WJ['channels'] = channels
for k in ('cuts', 'humps'): WJ.pop(k, None)  # superseded generic underpass data (audited specs replace it)
json.dump(WJ, open(f'{W}/world.json', 'w'), separators=(',', ':'), ensure_ascii=False)
S['cells'] = len(cells); S['blocks'] = len(blocks)
S['rivers'] = len(rivers); S['channels'] = len(channels); S['lined'] = sum(c['lined'] for c in channels)
print(dict(S), 'earth.json.gz', os.path.getsize(f'{W}/earth.json.gz'))
