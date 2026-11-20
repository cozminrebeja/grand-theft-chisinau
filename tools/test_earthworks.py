"""Check for tools/make_earthworks.py + tools/terrain.py: python3 tools/test_earthworks.py (uses a temp copy of world/)."""
import json, os, shutil, subprocess, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from terrain import Terrain

tmp = tempfile.mkdtemp(); w = os.path.join(tmp, 'world'); os.makedirs(w)
for f in ('world.json', 'height.json'): shutil.copy(os.path.join(HERE, '..', 'world', f), w)
specdir = os.path.join(tmp, 'specs'); os.makedirs(specdir); spec = os.path.join(specdir, 'test.json')
json.dump({'sites': [{'id': 't', 'bridges': [{'data_idx': [0], 'deck': [[0, 0, 9], [50, 0, 9]]}],
                      'earthworks': [{'type': 'embankment', 'line': [[0, -100, -1.2], [0, -20, 8]], 'top_w': 12, 'side': 'slope', 'slope': 1.5},
                                     {'type': 'channel', 'line': [[-50, 40, -5], [50, 40, -5]], 'top_w': 10, 'side': 'wall'}]}]}, open(spec, 'w'))
if True:
    subprocess.run([sys.executable, os.path.join(HERE, 'make_earthworks.py'), w, specdir], check=True, capture_output=True)
T = Terrain(w)
assert abs(T.ground(0, -21) - 7.9) < .2                      # embankment top follows the line
assert 3 < T.ground(13, -21) < 4                             # 1.5:1 side slope: 7 m out of the 6 m half-width → ~4.6 m lower
assert abs(T.ground(30, -21) - float(T.dem(30, -21))) < 1e-6  # outside the slope reach: natural ground
assert abs(T.ground(0, 40) + 5) < .01 and abs(T.ground(0, 43) + 5) < .01   # walled channel bottom across its width
assert T.ground(0, 50) == float(T.dem(0, 50))                # wall: no slope beyond the edge
assert json.load(open(os.path.join(w, 'world.json')))['bridge_spec']['0']['deck'][0] == [0, 0, 9]
shutil.rmtree(tmp); print('earthworks ok')
