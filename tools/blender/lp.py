"""Low-poly model kit for the game's Blender scripts (tools/blender/*.py → models/*.glb).

Everything here works in GAME coordinates: metres, x = east, y = up, z = south (north = -z), yaw `ry` in radians
around +y with the same sense as three.js `rotation.y`. Blender is z-up, so vertices go through B() below; the glTF
exporter's +Y-up conversion maps Blender back to exactly these game axes.

Style: PS2-era low poly. Few segments (6-12 round), flat shading, one flat colour per face (no textures).
Colours are 0xRRGGBB ints written to the material as-is (the game renders without sRGB output, so the hex you pick
is the colour you see), material name 'c_rrggbb' (or a custom name for colour slots, see Part.add_material).

    import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import lp
    lp.reset()
    p = lp.Part()
    p.box(4, 3, 6, at=(0, 1.5, 0), col=0xd8c8a0)           # w (x), h (y), d (z), centred at `at`
    p.cyl(1, 1, 5, n=8, at=(0, 3, 0), col=0x4b6172)          # r_bottom, r_top, h; `at` = centre
    o = p.obj('thing', props={'lm': {...}})                  # one Blender object; props → glTF extras (JSON strings)
    lp.export('models/thing.glb', [o])
    lp.preview([o], '/tmp/thing.png')                        # Workbench render for a quick visual check (Read the PNG)

Run: /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/<script>.py
"""
import bpy, bmesh, json, math, os, glob
from mathutils import Vector, Matrix
from mathutils.geometry import tessellate_polygon

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORLD = os.path.join(ROOT, 'world')
MODELS = os.path.join(ROOT, 'models')


def B(x, y, z): return (x, -z, y)  # game → Blender


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.objects): [c.remove(i) for i in list(c)]


_mats = {}
def material(col, name=None):
    """Flat-colour material. col: 0xRRGGBB. name defaults to 'c_rrggbb'; give one to tag colour slots (people)."""
    name = name or 'c_%06x' % col
    m = _mats.get(name)
    if m and m.name in bpy.data.materials: return m
    m = bpy.data.materials.new(name)
    rgb = [((col >> s) & 255) / 255 for s in (16, 8, 0)]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    _mats[name] = m
    return m


def _xf(at, ry=0.0, rx=0.0, rz=0.0, s=(1, 1, 1)):
    """Local → game transform: scale, then rotate (rx about x, rz about z, then ry yaw), then translate."""
    def f(p):
        x, y, z = p[0] * s[0], p[1] * s[1], p[2] * s[2]
        if rx: c, n = math.cos(rx), math.sin(rx); y, z = y * c - z * n, y * n + z * c
        if rz: c, n = math.cos(rz), math.sin(rz); x, y = x * c - y * n, x * n + y * c
        if ry: c, n = math.cos(ry), math.sin(ry); x, z = x * c + z * n, -x * n + z * c
        return (x + at[0], y + at[1], z + at[2])
    return f


class Part:
    """Accumulates flat-shaded faces (game coords) with a colour per face; .obj() makes one Blender object."""

    def __init__(self):
        self.v = []; self.f = []; self.fm = []; self.mats = []; self._mi = {}

    def _m(self, col, name=None):
        k = name or col
        if k not in self._mi: self._mi[k] = len(self.mats); self.mats.append(material(col, name))
        return self._mi[k]

    def add_material(self, col, name):
        """Use a named material for the next faces: p.face(..., col=p.slot(0xffffff, 'skin'))."""
        return ('named', col, name)

    def _mid(self, col):
        if isinstance(col, tuple) and col[0] == 'named': return self._m(col[1], col[2])
        return self._m(col)

    def face(self, pts, col):
        """One polygon (game coords), counter-clockwise seen from the front side."""
        b = len(self.v); self.v += [B(*p) for p in pts]; self.f.append(list(range(b, b + len(pts)))); self.fm.append(self._mid(col))

    def box(self, w, h, d, at=(0, 0, 0), ry=0.0, rx=0.0, rz=0.0, col=0xcccccc, top=None, taper=1.0):
        """Axis box w×h×d centred at `at` (rotated). top: optional colour for the top face. taper scales the top face."""
        X = _xf(at, ry, rx, rz)
        hw, hh, hd = w / 2, h / 2, d / 2; tw, td = hw * taper, hd * taper
        P = [X(p) for p in [(-hw, -hh, -hd), (hw, -hh, -hd), (hw, -hh, hd), (-hw, -hh, hd),
                            (-tw, hh, -td), (tw, hh, -td), (tw, hh, td), (-tw, hh, td)]]
        for q, c in (((3, 2, 6, 7), col), ((1, 0, 4, 5), col), ((2, 1, 5, 6), col), ((0, 3, 7, 4), col),
                     ((4, 7, 6, 5), top if top is not None else col), ((0, 1, 2, 3), col)):
            self.face([P[i] for i in q], c)
        return self

    def cyl(self, r0, r1, h, n=8, at=(0, 0, 0), ry=0.0, rx=0.0, rz=0.0, col=0xcccccc, top=None, caps=True, a0=0.0):
        """Frustum along local y, centred at `at`. r1=0 → cone. n segments (keep 6-12)."""
        X = _xf(at, ry, rx, rz); hh = h / 2
        ring = lambda r, y: [X((r * math.cos(a0 + i * 2 * math.pi / n), y, -r * math.sin(a0 + i * 2 * math.pi / n))) for i in range(n)]
        lo, hi = ring(r0, -hh), ring(r1, hh)
        for i in range(n):
            j = (i + 1) % n
            if r1 > 1e-6: self.face([lo[i], lo[j], hi[j], hi[i]], col)
            else: self.face([lo[i], lo[j], hi[i]], col)
        if caps:
            if r1 > 1e-6: self.face(hi, top if top is not None else col)
            if r0 > 1e-6: self.face(lo[::-1], col)
        return self

    def sphere(self, r, n=8, rings=4, at=(0, 0, 0), col=0xcccccc, hemi=False, sy=1.0, ry=0.0):
        """Low-poly UV sphere (hemi=True: upper half only, open bottom → domes). sy squashes/stretches vertically."""
        X = _xf(at, ry); top = rings if hemi else rings * 2
        def pt(i, k):
            th = math.pi / 2 - k * (math.pi / 2 / rings); a = i * 2 * math.pi / n
            return X((r * math.cos(th) * math.cos(a), r * math.sin(th) * sy, -r * math.cos(th) * math.sin(a)))
        for k in range(top):
            for i in range(n):
                j = (i + 1) % n
                a, b, c, d = pt(i, k + 1), pt(j, k + 1), pt(j, k), pt(i, k)
                if k == 0: self.face([a, b, c], col)  # pole fan
                elif k == top - 1 and not hemi: self.face([a, c, d], col)  # bottom pole fan
                else: self.face([a, b, c, d], col)
        return self

    def lathe(self, prof, n=8, at=(0, 0, 0), col=0xcccccc, cols=None, ry=0.0):
        """Revolve a profile [(r, y), ...] (bottom → top) around local y. cols: optional colour per profile band."""
        X = _xf(at, ry)
        R = [[X((r * math.cos(i * 2 * math.pi / n), y, -r * math.sin(i * 2 * math.pi / n))) for i in range(n)] for r, y in prof]
        for k in range(len(prof) - 1):
            c = cols[k] if cols else col
            for i in range(n):
                j = (i + 1) % n
                if prof[k + 1][0] < 1e-6: self.face([R[k][i], R[k][j], R[k + 1][i]], c)
                elif prof[k][0] < 1e-6: self.face([R[k][i], R[k + 1][j], R[k + 1][i]], c)
                else: self.face([R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]], c)
        return self

    def prism(self, w, h, d, at=(0, 0, 0), ry=0.0, col=0xcccccc, ends=None):
        """Gable roof / pediment: triangle in the x-y plane (base w, height h, base at at.y), extruded d along z."""
        X = _xf(at, ry); hw, hd = w / 2, d / 2
        A, Bp, C = (-hw, 0, hd), (hw, 0, hd), (0, h, hd)
        A2, B2, C2 = (-hw, 0, -hd), (hw, 0, -hd), (0, h, -hd)
        e = ends if ends is not None else col
        self.face([X(A), X(Bp), X(C)], e); self.face([X(B2), X(A2), X(C2)], e)
        self.face([X(Bp), X(B2), X(C2), X(C)], col); self.face([X(A2), X(A), X(C), X(C2)], col)
        self.face([X(A2), X(B2), X(Bp), X(A)], col)
        return self

    def hip(self, w, h, d, at=(0, 0, 0), ry=0.0, col=0xcccccc, ridge=0.5):
        """Hip roof over w×d, apex height h; ridge = fraction of the long side kept as a ridge line (0 = pyramid)."""
        X = _xf(at, ry); hw, hd = w / 2, d / 2
        if w >= d: r0, r1 = (-hw * ridge, h, 0), (hw * ridge, h, 0)
        else: r0, r1 = (0, h, -hd * ridge), (0, h, hd * ridge)
        a, b, c, e = (-hw, 0, hd), (hw, 0, hd), (hw, 0, -hd), (-hw, 0, -hd)
        if w >= d:
            self.face([X(a), X(b), X(r1), X(r0)], col); self.face([X(c), X(e), X(r0), X(r1)], col)
            self.face([X(b), X(c), X(r1)], col); self.face([X(e), X(a), X(r0)], col)
        else:
            self.face([X(a), X(b), X(r1)], col); self.face([X(c), X(e), X(r0)], col)
            self.face([X(b), X(c), X(r0), X(r1)], col); self.face([X(e), X(a), X(r1), X(r0)], col)
        return self

    def extrude(self, ring, y0, y1, col=0xcccccc, top=None, bottom=False, inset=0.0):
        """Vertical prism on a footprint ring [(x, z), ...] (game coords) from y0 to y1, flat top (any concave ring).
        inset > 0 shrinks the ring towards its centroid by that many metres (crude, fine for convex-ish rings)."""
        r = list(ring)
        if len(r) > 2 and tuple(r[0]) == tuple(r[-1]): r = r[:-1]
        if _area(r) > 0: r = r[::-1]  # wall winding: outward normals
        if inset:
            cx = sum(p[0] for p in r) / len(r); cz = sum(p[1] for p in r) / len(r)
            r = [(cx + (p[0] - cx) * max(0, 1 - inset / max(1e-6, math.hypot(p[0] - cx, p[1] - cz))),
                  cz + (p[1] - cz) * max(0, 1 - inset / max(1e-6, math.hypot(p[0] - cx, p[1] - cz)))) for p in r]
        n = len(r)
        for i in range(n):
            a, b = r[i], r[(i + 1) % n]
            self.face([(a[0], y0, a[1]), (a[0], y1, a[1]), (b[0], y1, b[1]), (b[0], y0, b[1])], col)
        tris = tessellate_polygon([[Vector((p[0], p[1], 0)) for p in r]])
        for t in tris:
            q = [r[k] for k in t]
            if _area(q) < 0: q = q[::-1]
            self.face([(p[0], y1, p[1]) for p in q], top if top is not None else col)
            if bottom: self.face([(p[0], y0, p[1]) for p in q[::-1]], col)
        return self

    def quad(self, a, b, c, d, col):
        self.face([a, b, c, d], col); return self

    def merge(self, other):
        for k, fi in enumerate(other.f):
            m = other.mats[other.fm[k]]
            self.face([_unB(other.v[i]) for i in fi], ('named', _mat_hex(m), m.name))
        return self

    def obj(self, name, parent=None, props=None, origin=(0, 0, 0)):
        """Make the Blender object. origin (game coords) becomes the object's pivot/location; props → glTF extras."""
        me = bpy.data.meshes.new(name)
        o0 = B(*origin)
        me.from_pydata([(v[0] - o0[0], v[1] - o0[1], v[2] - o0[2]) for v in self.v], [], self.f)
        for m in self.mats: me.materials.append(m)
        for k, poly in enumerate(me.polygons): poly.material_index = self.fm[k]; poly.use_smooth = False
        me.update()
        ob = bpy.data.objects.new(name, me); ob.location = o0
        bpy.context.scene.collection.objects.link(ob)
        if parent is not None: ob.parent = parent; ob.location = Vector(o0) - parent.matrix_world.translation
        for k, v in (props or {}).items(): ob[k] = v if isinstance(v, (int, float, str)) else json.dumps(v, separators=(',', ':'))
        return ob


def _area(r):
    """Signed area in the x/z plane; > 0 = counter-clockwise seen from above (+y) with x east, z south."""
    return sum(r[i][1] * r[(i + 1) % len(r)][0] - r[(i + 1) % len(r)][1] * r[i][0] for i in range(len(r))) / 2


def _unB(v): return (v[0], v[2], -v[1])
def _mat_hex(m): c = m.diffuse_color; return (round(c[0] * 255) << 16) | (round(c[1] * 255) << 8) | round(c[2] * 255)


def empty(name, at=(0, 0, 0), parent=None, props=None):
    """Group node (glTF node without mesh) at game position `at`."""
    ob = bpy.data.objects.new(name, None); ob.location = B(*at)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None: ob.parent = parent; ob.location = Vector(B(*at)) - parent.matrix_world.translation
    for k, v in (props or {}).items(): ob[k] = v if isinstance(v, (int, float, str)) else json.dumps(v, separators=(',', ':'))
    return ob


def export(path, objs=None):
    """Write a .glb (no Draco, flat normals, extras on). objs=None → whole scene."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    if objs is not None:
        def sel(o):
            o.select_set(True)
            for c in o.children: sel(c)
        for o in objs: sel(o)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=objs is not None, export_extras=True,
                              export_yup=True, export_apply=True, export_normals=True, export_texcoords=False,
                              export_materials='EXPORT', export_animations=False, export_cameras=False, export_lights=False)
    print('wrote', path, os.path.getsize(path) // 1024, 'KB')


def preview(objs, path, yaw=35, pitch=25, size=900, ortho=False):
    """Workbench render of objs (flat material colours, outlines) for a quick look. yaw/pitch in degrees;
    yaw 0 looks at the model from the south (+z game) towards north."""
    sc = bpy.context.scene
    bpy.context.view_layer.update()  # fresh matrix_world for moved parents
    pts = []
    def walk(o):
        if o.type == 'MESH': pts.extend(o.matrix_world @ Vector(c) for c in o.bound_box)
        for c in o.children: walk(c)
    for o in objs: walk(o)
    if not pts: return
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2; rad = (hi - lo).length / 2 or 1
    cam_d = bpy.data.cameras.new('pv'); cam = bpy.data.objects.new('pv', cam_d); sc.collection.objects.link(cam)
    yw, pt = math.radians(yaw), math.radians(pitch)
    # game south (+z) = Blender -y
    d = Vector((math.sin(yw) * math.cos(pt), -math.cos(yw) * math.cos(pt), math.sin(pt)))
    if ortho: cam_d.type = 'ORTHO'; cam_d.ortho_scale = rad * 2.2
    else: cam_d.lens = 50
    cam.location = c + d * (rad * 3.2)
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam_d.clip_end = rad * 20
    sc.camera = cam
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'MATERIAL'; sh.show_object_outline = True
    sh.show_shadows = True
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.filepath = path; sc.render.image_settings.file_format = 'PNG'
    w = bpy.data.worlds.get('pv') or bpy.data.worlds.new('pv'); sc.world = w
    hidden = [o for o in sc.objects if o.type == 'MESH' and o not in _all(objs)]
    for o in hidden: o.hide_render = True
    bpy.ops.render.render(write_still=True)
    for o in hidden: o.hide_render = False
    bpy.data.objects.remove(cam)
    print('preview', path)


def _all(objs):
    out = []
    def walk(o): out.append(o); [walk(c) for c in o.children]
    for o in objs: walk(o)
    return out


# ---------------- world data (footprints) ----------------
_B = None
def buildings():
    """All pack buildings as dicts {ring: [(x, z)...] metres, holes, h, c: (cx, cz) vertex-mean centroid = what
    js/facades.js passes to landmarkSkipped(), key}."""
    global _B
    if _B is None:
        _B = []
        for f in sorted(glob.glob(os.path.join(WORLD, 'packs', '*.json'))):
            for key, t in json.load(open(f)).items():
                for b in t.get('b', []):
                    fl = b[4]; r = [(fl[k] * .1, fl[k + 1] * .1) for k in range(0, len(fl) - 1, 2)]
                    if len(r) < 3: continue
                    _B.append({'ring': r, 'holes': [[(h[k] * .1, h[k + 1] * .1) for k in range(0, len(h) - 1, 2)] for h in (b[5] or [])],
                               'h': float(b[0]), 'c': (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r)), 'key': key})
    return _B


def footprints_near(x, z, r):
    """Pack buildings whose centroid lies within r metres of (x, z), nearest first."""
    out = [b for b in buildings() if math.hypot(b['c'][0] - x, b['c'][1] - z) < r]
    return sorted(out, key=lambda b: math.hypot(b['c'][0] - x, b['c'][1] - z))


def footprint(x, z, r=25):
    """Nearest pack building to (x, z) (by centroid) or None."""
    f = footprints_near(x, z, r); return f[0] if f else None


def special():
    return json.load(open(os.path.join(WORLD, 'world.json'))).get('special', {})
