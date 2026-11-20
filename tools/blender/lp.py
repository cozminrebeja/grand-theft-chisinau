"""Low-poly model kit for the game's Blender scripts (tools/blender/*.py → models/*.glb).

Everything here works in GAME coordinates: metres, x = east, y = up, z = south (north = -z), yaw `ry` in radians
around +y with the same sense as three.js `rotation.y`. Blender is z-up, so vertices go through B() below; the glTF
exporter's +Y-up conversion maps Blender back to exactly these game axes.

Style: PS2-era (early-2000s console) low poly: simple silhouettes, SMOOTH shading, and all small detail painted into one
small texture per model (128-512 px) with baked darkening in creases (AO), grime, folds, seams, panel lines, windows.
Pipeline: build geometry with lp primitives using flat colours (material()) and/or procedural "paint" materials (pmat(),
or your own node trees), then lp.bake([objs], size) → welds + smooth-shades, UV-unwraps, bakes colour × AO into one image
and switches the materials to that texture (material names are kept: people encode colour slots in them). Then export().
Colours are 0xRRGGBB ints written as-is (the game renders without sRGB output and loads textures as linear, so the hex
you pick is the colour you see; baked images are stored Non-Color for the same reason). Material name 'c_rrggbb' or custom.

    import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); import lp
    lp.reset()
    p = lp.Part()
    p.box(4, 3, 6, at=(0, 1.5, 0), col=0xd8c8a0)           # w (x), h (y), d (z), centred at `at`
    p.box(4, 1, 6, at=(0, 3.5, 0), col=lp.pmat('plaster', 0xd8c8a0, 'noise', grime=.5))  # col may be a material
    p.cyl(1, 1, 5, n=8, at=(0, 3, 0), col=0x4b6172)          # r_bottom, r_top, h; `at` = centre
    o = p.obj('thing', props={'lm': {...}})                  # one Blender object; props → glTF extras (JSON strings)
    lp.bake([o], size=256)                                   # PS2 texture: colour × AO, smooth shading, UVs
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
    m = _mats.get(name) or bpy.data.materials.get(name)  # reuse pmat()/custom materials by name
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
        if isinstance(col, bpy.types.Material):  # pmat() or any custom material: col=wall_mat
            if col.name not in self._mi: self._mi[col.name] = len(self.mats); self.mats.append(col)
            return self._mi[col.name]
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
                              export_yup=True, export_apply=True, export_normals=True, export_texcoords=True,
                              export_image_format='AUTO',
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
    sh = sc.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_object_outline = False  # TEXTURE: baked image, else material colour
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


# ---------------- PS2 look: procedural paint, smooth shading, baked textures ----------------
def _hex(col): return [((col >> k) & 255) / 255 for k in (16, 8, 0)]


def pmat(name, col, kind='noise', col2=None, scale=1.0, grime=0.25, rough=1.0):
    """Procedural "painted" material, baked into the texture by bake(). col/col2 0xRRGGBB, scale = pattern size in metres.
    kind: 'noise' (mottled plaster/paint/fabric), 'brick' (col2 = mortar), 'stripes' (horizontal bands of col2, e.g. floor
    lines, siding), 'planks', 'flat'. grime 0-1 darkens with large-scale blotches + streaks (weathering). Build your own
    node trees for anything else (windows, faces, signs): bake() reads whatever ends up in Base Color."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED'); bsdf.inputs['Roughness'].default_value = rough
    tc = N.new('ShaderNodeTexCoord'); mp = N.new('ShaderNodeMapping'); L.new(tc.outputs['Object'], mp.inputs['Vector'])
    mp.inputs['Scale'].default_value = (1 / scale, 1 / scale, 1 / scale)
    c1 = (*_hex(col), 1); c2 = (*_hex(col2 if col2 is not None else col), 1)
    if kind == 'brick':
        t = N.new('ShaderNodeTexBrick'); L.new(mp.outputs['Vector'], t.inputs['Vector'])
        t.inputs['Color1'].default_value = c1; t.inputs['Color2'].default_value = tuple(v * .85 for v in c1[:3]) + (1,)
        t.inputs['Mortar'].default_value = c2; t.inputs['Scale'].default_value = 4; t.inputs['Mortar Size'].default_value = .015
        out = t.outputs['Color']
    elif kind in ('stripes', 'planks'):
        t = N.new('ShaderNodeTexWave'); t.bands_direction = 'Z'; L.new(mp.outputs['Vector'], t.inputs['Vector'])
        t.inputs['Scale'].default_value = 1.0; t.inputs['Distortion'].default_value = 0 if kind == 'stripes' else 1.5
        r = N.new('ShaderNodeValToRGB'); L.new(t.outputs['Fac'], r.inputs['Fac'])
        r.color_ramp.elements[0].color = c2; r.color_ramp.elements[1].color = c1
        r.color_ramp.elements[0].position = .08 if kind == 'stripes' else .4; r.color_ramp.elements[1].position = .12 if kind == 'stripes' else .6
        out = r.outputs['Color']
    elif kind == 'flat':
        rgb = N.new('ShaderNodeRGB'); rgb.outputs[0].default_value = c1; out = rgb.outputs[0]
    else:
        t = N.new('ShaderNodeTexNoise'); L.new(mp.outputs['Vector'], t.inputs['Vector'])
        t.inputs['Scale'].default_value = 6; t.inputs['Detail'].default_value = 6
        r = N.new('ShaderNodeValToRGB'); L.new(t.outputs['Fac'], r.inputs['Fac'])
        r.color_ramp.elements[0].color = tuple(v * .86 for v in c1[:3]) + (1,); r.color_ramp.elements[1].color = c1
        r.color_ramp.elements[0].position = .35; r.color_ramp.elements[1].position = .65
        if col2 is not None:  # second colour as sparse blotches
            e = r.color_ramp.elements.new(.9); e.color = c2
        out = r.outputs['Color']
    if grime > 0:
        g = N.new('ShaderNodeTexNoise'); L.new(tc.outputs['Object'], g.inputs['Vector']); g.inputs['Scale'].default_value = .35 / scale
        g.inputs['Detail'].default_value = 3
        gr = N.new('ShaderNodeValToRGB'); L.new(g.outputs['Fac'], gr.inputs['Fac'])
        gr.color_ramp.elements[0].color = (1 - .45 * grime,) * 3 + (1,); gr.color_ramp.elements[0].position = .45
        gr.color_ramp.elements[1].color = (1, 1, 1, 1); gr.color_ramp.elements[1].position = .62
        mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1
        L.new(out, mx.inputs['A']); L.new(gr.outputs['Color'], mx.inputs['B']); out = mx.outputs['Result']
    L.new(out, bsdf.inputs['Base Color'])
    m.diffuse_color = c1
    return m


def smooth(o, angle=40):
    """Weld coincident vertices (Part writes a face soup) and smooth-shade, keeping edges sharper than `angle` degrees."""
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(o.data); bm.free()
    o.data.shade_smooth(); o.data.set_sharp_from_angle(angle=math.radians(angle))
    return o


def _meshes(objs):
    out = []
    def walk(o):
        if o.type == 'MESH' and o not in out: out.append(o)
        for c in o.children: walk(c)
    for o in objs: walk(o)
    return out


def bake(objs, size=256, name=None, ao=0.75, ao_dist=None, smooth_angle=40, margin=3, samples=24, unwrap=True, jpeg=True):
    """Bake the PS2 texture for objs (and their mesh children) into ONE size×size image shared by all of them:
    weld + smooth (smooth_angle=None to skip), smart-UV-unwrap together (unwrap=False keeps your UVs), bake Base Color and
    ambient occlusion, multiply (ao = strength 0-1, ao_dist = AO reach in metres, default ~5% of the group size), store the
    result as a packed JPEG/PNG image and rewire every material on these meshes to that texture (names kept, base colour
    white). Returns the image. Bake each model or each shared-atlas group separately."""
    import numpy as np
    ms = _meshes(objs)
    if not ms: return None
    sc = bpy.context.scene
    name = name or ms[0].name + '_tex'
    if smooth_angle is not None:
        for o in ms: smooth(o, smooth_angle)
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    if unwrap:
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
        bpy.ops.uv.pack_islands(margin=0.004)
        bpy.ops.object.mode_set(mode='OBJECT')
    img = bpy.data.images.new(name, size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'  # raw values = the hex colours (game loads textures as linear)
    mats = []
    for o in ms:
        for m in o.data.materials:
            if m and m not in mats: mats.append(m)
    for m in mats:
        m.use_nodes = True
        n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img; n.name = '_bake'; m.node_tree.nodes.active = n
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = samples
    sc.render.bake.margin = margin
    if not sc.world: sc.world = bpy.data.worlds.new('w')
    if ao_dist is None:
        pts = [o.matrix_world @ Vector(c) for o in ms for c in o.bound_box]
        ext = max(max(p[i] for p in pts) - min(p[i] for p in pts) for i in range(3))
        ao_dist = max(.15, ext * .05)
    sc.world.light_settings.distance = ao_dist
    def run(kind, **kw):
        bpy.ops.object.bake(type=kind, use_clear=True, margin=margin, **kw)
        a = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(a); return a.reshape(size, size, 4)
    col = run('DIFFUSE', pass_filter={'COLOR'})
    if ao > 0:
        occ = run('AO')
        col[..., :3] *= (1 - ao * (1 - occ[..., :3]))
    col[..., 3] = 1
    img.pixels.foreach_set(col.ravel())
    import tempfile
    img.file_format = 'JPEG' if jpeg else 'PNG'
    img.filepath_raw = os.path.join(tempfile.gettempdir(), name + ('.jpg' if jpeg else '.png'))
    img.save(); img.pack()
    for m in mats:  # rewire: Image → Base Color, nothing else (glTF: baseColorTexture, factor 1)
        nt = m.node_tree; N = nt.nodes
        for n in list(N):
            if n.name != '_bake': N.remove(n)
        tex = N['_bake']; bsdf = N.new('ShaderNodeBsdfPrincipled'); out = N.new('ShaderNodeOutputMaterial')
        bsdf.inputs['Roughness'].default_value = 1.0
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color']); nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
        m.diffuse_color = (1, 1, 1, 1)
    sc.render.engine = 'BLENDER_WORKBENCH'
    print('baked', name, size, 'px,', len(ms), 'meshes,', len(mats), 'materials, ao_dist %.2f' % ao_dist)
    return img
