"""Builds models/landmarks.glb from landmarks_core.py (the 14 original landmarks) + landmarks_new.py (added ones).
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/landmarks.py
Each module exposes build() -> list of top-level objects, one per landmark, named by key, with prop 'lm' =
{x, z, fp:[ring...], h, skip:[[x,z]...]} (see lm_glbList in js/landmarks.js)."""
import sys, os, importlib, traceback
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp

lp.reset()
objs = []
for mod in ('landmarks_core', 'landmarks_new'):
    try: objs += importlib.import_module(mod).build()
    except ModuleNotFoundError as e: print('skip', mod, e)
    except Exception: print('FAILED', mod); traceback.print_exc()  # one broken module must not block the other
lp.export(os.path.join(lp.MODELS, 'landmarks.glb'), objs)
