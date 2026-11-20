"""The 14 original landmarks, PS2-era style: simple massing, smooth shading with hard real corners, and the small detail
(window rows with frames and sills, rustication, brick, string courses, cornice shadows, pilasters, weathering, darker
bases) PAINTED into one baked texture per landmark (lp.bake). Geometry only where it makes the silhouette: domes, drums,
towers, porticos and big columns, the arch, pediments, the concave Parliament front, the circus colonnade.

build() → one Blender object per landmark, named by its key, with prop 'lm' (see lm_glbList in js/landmarks.js):
  {x, z, fp:[ring...], h, hs:[h per ring] (optional), skip:[[x,z]...], base:ring (optional, default fp[0])}
Geometry is in game coordinates relative to (x, base, z); y = 0 is the lowest ground under the base ring, so walls and
plinths start below 0 (-1.5 m) to stay grounded on the downhill side.

Facades: every face gets two helper UV layers before baking, 'wall' = (metres along the wall, height) and 'wlen' = (wall
length, 0); cylinders built inside LP.cylmode() get metres around the circumference instead. facade() node trees paint
window grids in those metres, centred on each wall, so any footprint orientation works. The helper layers are removed
after the bake; the exported mesh keeps one UV set (the bake atlas).

Placement: arc / cathedral / belltower / statue from world.json `special` ([x, z, angle, size]); the others are fitted to
their OSM footprints (lp.footprint) and the State Circus to its drum + back wing rings. Fronts face the nearest named road.
Run through tools/blender/landmarks.py."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp
import bpy, bmesh
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

TAU = 2 * math.pi

# ---------------- palette (hex = colour on screen; slightly desaturated) ----------------
CREAM = 0xe4d9bd; WHITE = 0xeeeadf; IVORY = 0xe9e2d0; BEIGE = 0xcbc1ab; PAVE = 0xb9b1a2
DOME = 0x4f6270; ROOF = 0x6f6c66; GOLD = 0xc9a64e; BRONZE = 0x48553f; BRONZE2 = 0x37422f
GLASS = 0x2f3a44; DARK = 0x2a2623; DOOR = 0x46302a; BRICK = 0xa2513d; BRICK2 = 0x98473a
STONE = 0xcdc7ba; COPPER = 0x5f7568


# ---------------- part with per-landmark materials + facade UV tags ----------------
class LP(lp.Part):
    """lp.Part whose flat colours become per-landmark materials ('<key>_rrggbb': lp.bake rewires every material of the
    baked mesh to its texture, so materials must not be shared between landmarks) and which tags faces built inside
    cylmode() so their facade coordinates run around the circumference."""

    def __init__(s, key):
        super().__init__(); s.key = key; s.tag = []; s.mode = None; s._pm = {}

    def _m(s, col, name=None): return super()._m(col, name or '%s_%06x' % (s.key, col))

    def face(s, pts, col):
        super().face(pts, col); s.tag.append(s.mode)

    def cylmode(s, x, z, r):
        P = s
        class _C:
            def __enter__(c): P.mode = ('cyl', x, z, r)
            def __exit__(c, *a): P.mode = None
        return _C()

    def paint(s, name, col, kind='noise', col2=None, scale=1.0, grime=.35):
        k = '%s_%s' % (s.key, name)
        if k not in s._pm: s._pm[k] = lp.pmat(k, col, kind, col2, scale, grime)
        return s._pm[k]


# ---------------- node-graph helper for facade materials ----------------
class NG:
    def __init__(s, m): s.N = m.node_tree.nodes; s.L = m.node_tree.links

    def _in(s, sock, v):
        if isinstance(v, bpy.types.NodeSocket): s.L.new(v, sock)
        elif sock.type == 'RGBA' and isinstance(v, (int, float)): sock.default_value = (v, v, v, 1)
        else: sock.default_value = v

    def op(s, o, a, b=0.0, clamp=False):
        n = s.N.new('ShaderNodeMath'); n.operation = o; n.use_clamp = clamp
        s._in(n.inputs[0], a); s._in(n.inputs[1], b); return n.outputs[0]

    def add(s, a, b): return s.op('ADD', a, b)
    def sub(s, a, b): return s.op('SUBTRACT', a, b)
    def mul(s, a, b): return s.op('MULTIPLY', a, b)
    def div(s, a, b): return s.op('DIVIDE', a, b)
    def lt(s, a, b): return s.op('LESS_THAN', a, b)
    def gt(s, a, b): return s.op('GREATER_THAN', a, b)
    def abs(s, a): return s.op('ABSOLUTE', a)
    def fract(s, a): return s.op('FRACT', a)
    def floor(s, a): return s.op('FLOOR', a)
    def mx(s, a, b): return s.op('MAXIMUM', a, b)
    def sat(s, a): return s.op('MULTIPLY', a, 1.0, clamp=True)
    def between(s, v, a, b): return s.mul(s.gt(v, a), s.lt(v, b))

    def rgb(s, c):
        n = s.N.new('ShaderNodeRGB'); n.outputs[0].default_value = (*lp._hex(c), 1); return n.outputs[0]

    def mix(s, fac, a, b, blend='MIX'):
        n = s.N.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = blend
        pick = lambda socks, nm: next(x for x in socks if x.name == nm and x.enabled)
        s._in(pick(n.inputs, 'Factor'), fac); s._in(pick(n.inputs, 'A'), a); s._in(pick(n.inputs, 'B'), b)
        return pick(n.outputs, 'Result')

    def shade(s, c, k):
        """c × k (k: float or socket)."""
        return s.mix(1.0, c, k, 'MULTIPLY')

    def uv(s, name):
        n = s.N.new('ShaderNodeUVMap'); n.uv_map = name
        sp = s.N.new('ShaderNodeSeparateXYZ'); s.L.new(n.outputs['UV'], sp.inputs[0])
        return sp.outputs['X'], sp.outputs['Y']

    def vec(s, x, y, z=0.0):
        n = s.N.new('ShaderNodeCombineXYZ'); s._in(n.inputs[0], x); s._in(n.inputs[1], y); s._in(n.inputs[2], z); return n.outputs[0]

    def obj(s):
        n = s.N.new('ShaderNodeTexCoord'); return n.outputs['Object']

    def noise(s, vec, scale, detail=4.0):
        n = s.N.new('ShaderNodeTexNoise'); s._in(n.inputs['Vector'], vec); n.inputs['Scale'].default_value = scale
        n.inputs['Detail'].default_value = detail; return n.outputs['Fac']

    def ramp(s, fac, c0, c1, p0=.3, p1=.7):
        n = s.N.new('ShaderNodeValToRGB'); s._in(n.inputs['Fac'], fac); e = n.color_ramp.elements
        e[0].position, e[1].position = p0, p1
        e[0].color = (*c0, 1) if len(c0) == 3 else c0; e[1].color = (*c1, 1) if len(c1) == 3 else c1
        return n.outputs['Color']


def _mulc(c, k): return tuple(min(1, v * k) for v in lp._hex(c))


def facade(P, name, wall, rows=(), sp=3.0, ww=1.4, glass=0x34404b, frame=None, fw=.18, sill=True, pier=None, pw=.6,
           py=(-9, 999), rust=None, rustcol=None, brick=False, mortar=0xcfc6b6, bands=(), bandcol=None, top=None,
           grime=.45, mull=True, nscale=1.2):
    """Painted facade material for landmark part P. rows = [(y_bottom, height, 'rect'|'arch', width?, spacing?)]: window
    rows (heights are metres above the landmark base), one column per `sp` metres centred on each wall face. frame/sill:
    lighter surround; pier: pilaster/fin stripes between window columns (pw wide, between heights py); rust: rusticated
    ground floor below that height (rustcol); brick: wall is brick with `mortar`; bands: string courses at those heights;
    top: cornice height (dark shadow under it); grime: weathering streaks, blotches and darker base."""
    k = '%s_%s' % (P.key, name)
    if k in P._pm: return P._pm[k]
    m = bpy.data.materials.new(k); m.use_nodes = True; P._pm[k] = m
    g = NG(m); bsdf = next(n for n in g.N if n.type == 'BSDF_PRINCIPLED'); bsdf.inputs['Roughness'].default_value = 1
    U, Y = g.uv('wall'); Lw, _ = g.uv('wlen')
    W = lp._hex(wall)

    def grid(spc):
        n = g.floor(g.add(g.div(Lw, spc), .08))
        q = g.div(g.sub(U, g.mul(g.sub(Lw, g.mul(n, spc)), .5)), spc)
        cin = g.mul(g.gt(q, 0), g.lt(q, n))
        return cin, g.abs(g.mul(g.sub(g.fract(q), .5), spc)), q, n
    cin0, afu0, q0, n0 = grid(sp)
    # base surface
    if brick:
        t = g.N.new('ShaderNodeTexBrick'); g._in(t.inputs['Vector'], g.vec(U, Y))
        t.inputs['Color1'].default_value = (*W, 1); t.inputs['Color2'].default_value = (*_mulc(wall, .86), 1)
        t.inputs['Mortar'].default_value = (*lp._hex(mortar), 1); t.inputs['Scale'].default_value = 1.0
        t.inputs['Mortar Size'].default_value = .018; t.inputs['Brick Width'].default_value = .5; t.inputs['Row Height'].default_value = .16
        c = t.outputs['Color']
        c = g.shade(c, g.ramp(g.noise(g.obj(), 1.5), (.9, .9, .9), (1, 1, 1)))
    else:
        c = g.ramp(g.noise(g.obj(), nscale, 5), _mulc(wall, .9), W, .3, .72)
    if rust is not None:
        rm = g.lt(Y, rust)
        if rustcol is not None: c = g.mix(rm, c, g.ramp(g.noise(g.obj(), 1.5), _mulc(rustcol, .9), lp._hex(rustcol)))
        c = g.mix(g.mul(rm, g.lt(g.fract(g.div(Y, .6)), .1)), c, g.shade(c, .72))
    for yb in bands:
        bc = g.rgb(bandcol if bandcol is not None else WHITE)
        c = g.mix(g.between(Y, yb - .45, yb - .16), c, g.shade(c, .82))
        c = g.mix(g.lt(g.abs(g.sub(Y, yb)), .16), c, bc)
    if pier is not None:
        pm = g.mul(g.mul(g.gt(afu0, sp / 2 - pw / 2), g.between(Y, py[0], py[1])), g.between(q0, -.02, g.add(n0, .02)))
        c = g.mix(pm, c, g.ramp(g.noise(g.obj(), 1.5), _mulc(pier, .92), lp._hex(pier)))
    # windows
    G = F = S = T = 0.0
    for r in rows:
        yb, h, shape = r[0], r[1], r[2]; w = r[3] if len(r) > 3 else ww; spc = r[4] if len(r) > 4 else sp
        cin, afu, _, _ = (cin0, afu0, 0, 0) if spc == sp else grid(spc)
        fv = g.sub(Y, yb)
        def mask(e):  # window shape grown by e metres
            hw = w / 2 + e
            if shape == 'arch':
                hr = h - w / 2
                rect = g.mul(g.lt(afu, hw), g.between(fv, -e, hr))
                dy = g.sub(fv, hr); circ = g.mul(g.lt(g.add(g.mul(afu, afu), g.mul(dy, dy)), hw * hw), g.gt(fv, hr - .01))
                return g.mul(g.mx(rect, circ), cin)
            return g.mul(g.mul(g.lt(afu, hw), g.between(fv, -e, h + e)), cin)
        gm = mask(0); G = gm if G == 0.0 else g.mx(G, gm)
        T = g.mx(T, g.mul(gm, g.sat(g.div(fv, h)))) if T != 0.0 else g.mul(gm, g.sat(g.div(fv, h)))
        if frame is not None: fm = mask(fw); F = fm if F == 0.0 else g.mx(F, fm)
        if sill:
            sm = g.mul(g.mul(g.lt(afu, w / 2 + fw + .12), g.between(fv, -fw - .2, -fw + .02)), cin)
            S = sm if S == 0.0 else g.mx(S, sm)
    if rows:
        if S != 0.0: c = g.mix(S, c, g.rgb(frame if frame is not None else 0xb9b3a6))
        if F != 0.0: c = g.mix(F, c, g.rgb(frame))
        gc = g.mix(T, g.rgb(glass), g.rgb(_lighten(glass)))
        if mull: gc = g.mix(g.lt(afu0, .05), gc, g.rgb(frame if frame is not None else 0x8c8a84))   # mullion
        c = g.mix(G, c, gc)
    # weathering
    if top is not None: c = g.shade(c, g.sub(1.0, g.mul(.32, g.sat(g.div(g.sub(Y, top - 1.2), 1.2)))))
    if grime > 0:
        c = g.shade(c, g.add(1 - .32 * grime, g.mul(.32 * grime, g.sat(g.div(g.sub(Y, -1.0), 3.5)))))      # dirty base
        st = g.noise(g.vec(g.mul(U, 1.6), g.mul(Y, .07)), 1.0, 3)                                          # rain streaks
        c = g.shade(c, g.ramp(st, (1 - .3 * grime,) * 3, (1, 1, 1), .38, .62))
        c = g.shade(c, g.ramp(g.noise(g.obj(), .08, 2), (1 - .22 * grime,) * 3, (1, 1, 1), .4, .65))     # blotches
    g.L.new(c, bsdf.inputs['Base Color'])
    m.diffuse_color = (*W, 1)
    return m


def _lighten(c):
    r, g_, b = lp._hex(c); k = lambda v: min(255, int(v * 255 * 1.9 + 25))
    return (k(r) << 16) | (k(g_) << 8) | k(b)


# ---------------- geometry helpers ----------------
def newell(pts):
    nx = ny = nz = 0.0
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1])
    return (nx, ny, nz)


def qface(p, pts, col, n=None, toward=None, away=None):
    """Add polygon pts (game xyz), flipped if needed so its normal points along n / towards `toward` / away from `away`."""
    N = newell(pts); c = [sum(q[k] for q in pts) / len(pts) for k in range(3)]
    if n is None: n = [toward[k] - c[k] for k in range(3)] if toward is not None else [c[k] - away[k] for k in range(3)]
    if N[0] * n[0] + N[1] * n[1] + N[2] * n[2] < 0: pts = pts[::-1]
    p.face(list(pts), col)


def ring_open(r):
    r = [tuple(q) for q in r]
    return r[:-1] if len(r) > 2 and r[0] == r[-1] else r


def pip(x, z, r):
    ins = False; j = len(r) - 1
    for i in range(len(r)):
        a, b = r[i], r[j]
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1] + 1e-12) + a[0]: ins = not ins
        j = i
    return ins


def edges(r):
    """[(a, b, L, u, n)] with n the outward horizontal normal (x, z)."""
    r = ring_open(r); out = []
    for i in range(len(r)):
        a, b = r[i], r[(i + 1) % len(r)]; dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
        if L < 1e-6: continue
        out.append([a, b, L, (dx / L, dz / L), (dz / L, -dx / L)])
    lng = max(out, key=lambda e: e[2]); m = ((lng[0][0] + lng[1][0]) / 2, (lng[0][1] + lng[1][1]) / 2)
    if pip(m[0] + lng[4][0] * .05, m[1] + lng[4][1] * .05, r):
        for e in out: e[4] = (-e[4][0], -e[4][1])
    return out


def offset_ring(r, d):
    """Miter offset of a ring by d metres outward (negative = inward)."""
    E = edges(r); n = len(E); out = []
    for i in range(n):
        n1, n2 = E[i - 1][4], E[i][4]
        mx, mz = n1[0] + n2[0], n1[1] + n2[1]; l = math.hypot(mx, mz)
        if l < 1e-6: mx, mz, l = n2[0], n2[1], 1
        mx, mz = mx / l, mz / l; k = d / max(.35, mx * n2[0] + mz * n2[1])
        out.append((E[i][0][0] + mx * k, E[i][0][1] + mz * k))
    return out


def centroid(r): r = ring_open(r); return (sum(q[0] for q in r) / len(r), sum(q[1] for q in r) / len(r))


def extrude(p, ring, y0, y1, col, top=None, bottom=False, holes=()):
    """Prism on a footprint ring (+ courtyard holes), outward walls, flat top."""
    r = ring_open(ring)
    for a, b, L, u, n in edges(r):
        qface(p, [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], col, n=(n[0], 0, n[1]))
    hs = [ring_open(h) for h in holes]
    for h in hs:
        for a, b, L, u, n in edges(h):
            qface(p, [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], col, n=(-n[0], 0, -n[1]))
    allp = r + [q for h in hs for q in h]
    tris = tessellate_polygon([[Vector((q[0], q[1], 0)) for q in loop] for loop in [r] + hs])
    for t in tris:
        qface(p, [(allp[k][0], y1, allp[k][1]) for k in t], top if top is not None else col, n=(0, 1, 0))
        if bottom: qface(p, [(allp[k][0], y0, allp[k][1]) for k in t], col, n=(0, -1, 0))


def band(p, ring, y0, y1, col, out=.25):
    """Cornice: a strip `out` metres proud of the wall (outer face, top and underside only)."""
    r = [e[0] for e in edges(ring)]; o = offset_ring(r, out); n = len(r)
    for a, b, L, u, nn in edges(o):
        qface(p, [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], col, n=(nn[0], 0, nn[1]))
    for i in range(n):
        j = (i + 1) % n
        for y, d in ((y1, 1), (y0, -1)):
            qface(p, [(r[i][0], y, r[i][1]), (r[j][0], y, r[j][1]), (o[j][0], y, o[j][1]), (o[i][0], y, o[i][1])], col, n=(0, d, 0))


def simplify(ring, tol=.35):
    """Drop footprint vertices closer than tol to the line through their neighbours (OSM jitter, tiny notches)."""
    r = ring_open(ring); ch = True
    while ch and len(r) > 4:
        ch = False
        for i in range(len(r)):
            a, b, c = r[i - 1], r[i], r[(i + 1) % len(r)]
            dx, dz = c[0] - a[0], c[1] - a[1]; L = math.hypot(dx, dz) or 1e-9
            if abs((b[0] - a[0]) * dz - (b[1] - a[1]) * dx) / L < tol or math.hypot(b[0] - a[0], b[1] - a[1]) < tol:
                r.pop(i); ch = True; break
    return r


def win_shape(c, u, yb, yt, w, shape):
    """Window/door outline (world xyz) centred at c=(x,z) along unit u: rect / arch (round top) / point (gothic)."""
    P = lambda dx, y: (c[0] + u[0] * dx, y, c[1] + u[1] * dx)
    if shape == 'arch':
        ys = yt - w / 2
        return [P(-w / 2, yb), P(w / 2, yb)] + [P(w / 2 * math.cos(a), ys + w / 2 * math.sin(a)) for a in [k * math.pi / 4 for k in range(5)]]
    if shape == 'point':
        ys = yt - w * .6
        return [P(-w / 2, yb), P(w / 2, yb), P(w / 2, ys), P(0, yt), P(-w / 2, ys)]
    return [P(-w / 2, yb), P(w / 2, yb), P(w / 2, yt), P(-w / 2, yt)]


def window(p, c, u, n, yb, h, w, col, shape='rect', frame=None, fw=.25, out=.08):
    """Geometry opening (doors, belfry openings): a coplanar panel just proud of the wall."""
    if frame is not None:
        qface(p, win_shape((c[0] + n[0] * out * .5, c[1] + n[1] * out * .5), u, yb - fw, yb + h + fw, w + 2 * fw, shape), frame, n=(n[0], 0, n[1]))
    qface(p, win_shape((c[0] + n[0] * out, c[1] + n[1] * out), u, yb, yb + h, w, shape), col, n=(n[0], 0, n[1]))


def ring_merlons(p, ring, y, sp, w, h, d, col, minL=1.0):
    for a, b, L, u, n in edges(ring):
        if L < minL: continue
        k = max(1, int(L / sp))
        for i in range(k):
            t = (i + .5) * L / k
            p.box(w, h, d, at=(a[0] + u[0] * t - n[0] * d * .3, y + h / 2, a[1] + u[1] * t - n[1] * d * .3), ry=math.atan2(-u[1], u[0]), col=col)


class Fr:
    """Local frame at (x, z) turned by ang (three.js rotation.y sense): local +z → (sin ang, cos ang) in world x/z."""

    def __init__(s, p, x, z, ang=0.0): s.p, s.x, s.z, s.ang = p, x, z, ang; s.c, s.s = math.cos(ang), math.sin(ang)
    def P(s, lx, lz): return (s.x + lx * s.c + lz * s.s, s.z - lx * s.s + lz * s.c)
    def W(s, lx, y, lz): X, Z = s.P(lx, lz); return (X, y, Z)
    def D(s, lx, lz): return (lx * s.c + lz * s.s, -lx * s.s + lz * s.c)
    def sub(s, lx, lz, ry=0.0): X, Z = s.P(lx, lz); return Fr(s.p, X, Z, s.ang + ry)
    def ring(s, pts): return [s.P(*q) for q in pts]
    def rect(s, w, d, lx=0, lz=0): return s.ring([(lx - w / 2, lz - d / 2), (lx + w / 2, lz - d / 2), (lx + w / 2, lz + d / 2), (lx - w / 2, lz + d / 2)])
    def box(s, w, h, d, lx, y0, lz, col, ry=0.0, **kw): s.p.box(w, h, d, at=s.W(lx, y0 + h / 2, lz), ry=s.ang + ry, col=col, **kw)
    def cyl(s, r0, r1, h, lx, y0, lz, col, n=8, **kw): s.p.cyl(r0, r1, h, n=n, at=s.W(lx, y0 + h / 2, lz), ry=s.ang, col=col, **kw)
    def wcyl(s, r, h, lx, y0, lz, col, n=16, **kw):
        """Cylinder whose facade coordinates run around the circumference (painted drum windows)."""
        X, Z = s.P(lx, lz)
        with s.p.cylmode(X, Z, r): s.cyl(r, r, h, lx, y0, lz, col, n=n, **kw)
    def dome(s, r, lx, y0, lz, col, n=12, rings=4, sy=1.0): s.p.sphere(r, n=n, rings=rings, at=s.W(lx, y0, lz), col=col, hemi=True, sy=sy, ry=s.ang)
    def ball(s, r, lx, y, lz, col, n=6, rings=2): s.p.sphere(r, n=n, rings=rings, at=s.W(lx, y, lz), col=col, ry=s.ang)
    def prism(s, w, h, d, lx, y0, lz, col, ry=0.0, ends=None): s.p.prism(w, h, d, at=s.W(lx, y0, lz), ry=s.ang + ry, col=col, ends=ends)
    def hip(s, w, h, d, lx, y0, lz, col, ry=0.0, ridge=.5): s.p.hip(w, h, d, at=s.W(lx, y0, lz), ry=s.ang + ry, col=col, ridge=ridge)
    def lathe(s, prof, lx, y0, lz, col, n=8, cols=None): s.p.lathe(prof, n=n, at=s.W(lx, y0, lz), col=col, cols=cols, ry=s.ang)
    def face(s, pts, col, n=None):
        """pts: local (lx, y, lz); n: local normal (nx, ny, nz)."""
        P = [s.W(*q) for q in pts]
        if n is not None: d = s.D(n[0], n[2]); n = (d[0], n[1], d[1])
        qface(s.p, P, col, n=n)


def column(F, lx, lz, y0, h, r, col, cap=None, n=8):
    """Big column: n-gon shaft (smooth-shaded by the bake) + capital block."""
    cap = cap if cap is not None else col
    F.cyl(r * 1.05, r * .9, h - r * .8, lx, y0, lz, col, n=n, caps=False)
    F.box(r * 2.5, r * .8, r * 2.5, lx, y0 + h - r * .8, lz, cap)


def arch_span(F, span, y_s, y_t, thick, col, n=6, under=None):
    """Wall slab over an opening along local x (-span/2..span/2), thickness along local z, with a semicircular
    intrados springing at y_s; top at y_t. Faces: front, back, intrados, top."""
    R = span / 2; t = thick / 2
    A = [(-R * math.cos(k * math.pi / n), y_s + R * math.sin(k * math.pi / n)) for k in range(n + 1)]
    for i in range(n):
        (x0, y0), (x1, y1) = A[i], A[i + 1]
        F.face([(x0, y0, t), (x1, y1, t), (x1, y_t, t), (x0, y_t, t)], col, n=(0, 0, 1))
        F.face([(x0, y0, -t), (x1, y1, -t), (x1, y_t, -t), (x0, y_t, -t)], col, n=(0, 0, -1))
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        F.face([(x0, y0, t), (x1, y1, t), (x1, y1, -t), (x0, y0, -t)], under if under is not None else col, n=(-mx, y_s - my, 0))
    F.face([(-R, y_t, -t), (R, y_t, -t), (R, y_t, t), (-R, y_t, t)], col, n=(0, 1, 0))


def clock(F, lz, y, r, ry=0.0):
    """Clock face on a wall whose outward normal is local +z (after ry): light octagon, dark rim and hands."""
    G = F.sub(0, 0, ry)
    oc = lambda rr, dz: [(rr * math.cos(k * TAU / 8 + math.pi / 8), y + rr * math.sin(k * TAU / 8 + math.pi / 8), lz + dz) for k in range(8)]
    G.face(oc(r * 1.15, .05), DARK, n=(0, 0, 1)); G.face(oc(r, .1), 0xe9e4d6, n=(0, 0, 1))
    G.face([(-r * .06, y, lz + .14), (r * .06, y, lz + .14), (r * .06, y + r * .8, lz + .14), (-r * .06, y + r * .8, lz + .14)], DARK, n=(0, 0, 1))
    G.face([(0, y - r * .05, lz + .15), (r * .55, y - r * .05, lz + .15), (r * .55, y + r * .05, lz + .15), (0, y + r * .05, lz + .15)], DARK, n=(0, 0, 1))


def flag(F, lx, lz, y0, h=6.0, ry=0.0):
    """Moldovan flag on a pole (blue-yellow-red, with the arms)."""
    F.cyl(.08, .06, h, lx, y0, lz, 0xcfcfcf, n=4)
    G = F.sub(lx, lz, ry)
    for i, c in enumerate((0x1d4a9a, 0xe8c330, 0xb5232f)): G.box(.9, 1.8, .06, .5 + i * .9, y0 + h - 2.0, 0, c)


def steps(F, w, lz, n, y_top, depth=.5, rise=.25, col=PAVE):
    """Stair flight in front of local z = lz going outward (+z), top at y_top."""
    for i in range(n):
        F.box(w + i * .4, y_top - i * rise + 1.5, depth * (i + 1), 0, -1.5, lz + depth * (i + 1) / 2, col)


# ---------------- world data ----------------
_R = None
def roads():
    global _R
    if _R is None:
        w = json.load(open(os.path.join(lp.WORLD, 'world.json'))); N = w['names']
        _R = [(q[0], q[1], N[q[3]], [(q[6][i] * .1, q[6][i + 1] * .1) for i in range(0, len(q[6]) - 1, 2)]) for q in w['r']]
    return _R


def roads_near(x, z, r):
    return [q for q in roads() if any(abs(t[0] - x) < r and abs(t[1] - z) < r for t in q[3])]


def road_dist(x, z, flt=None, kinds=(0,), rs=None):
    bd = 1e9
    for kind, wd, name, P in (rs if rs is not None else roads()):
        if kind not in kinds or (flt and not flt(name, wd)): continue
        for a, b in zip(P, P[1:]):
            dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz or 1e-9
            t = max(0, min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2))
            d = math.hypot(a[0] + dx * t - x, a[1] + dz * t - z)
            if d < bd: bd = d
    return bd


def runs(ring, tol=4.0):
    """Edges merged into straight runs (consecutive edges within tol degrees) → [(a, b, L, u, n)]."""
    E = edges(ring); out = []
    for e in E:
        if out:
            a0, b0, L0, u0, n0 = out[-1]
            if abs(math.degrees(math.atan2(u0[0] * e[3][1] - u0[1] * e[3][0], u0[0] * e[3][0] + u0[1] * e[3][1]))) < tol:
                a, b = a0, e[1]; dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
                n = (dz / L, -dx / L) if n0[0] * dz / L - n0[1] * dx / L > 0 else (-dz / L, dx / L)
                out[-1] = [a, b, L, (dx / L, dz / L), n]; continue
        out.append(list(e))
    return out


def front(ring, minL, flt=None):
    """Straight run (≥ minL) whose midpoint is nearest a road (optionally filtered by name) → frame-ready dict."""
    best, bd = None, 1e9; c = centroid(ring); rs = roads_near(c[0], c[1], 400)
    for a, b, L, u, n in runs(ring):
        if L < minL: continue
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        d = road_dist(m[0] + n[0] * 3, m[1] + n[1] * 3, flt, rs=rs)
        if d < bd: bd, best = d, dict(a=a, b=b, L=L, u=u, n=n, m=m, d=d)
    return best


def front_frame(p, fe):
    """Frame on a front run: origin at its midpoint, local +z = outward normal, local x along the run."""
    return Fr(p, fe['m'][0], fe['m'][1], math.atan2(fe['n'][0], fe['n'][1]))


def depth_behind(ring, F):
    """How far the ring extends behind a front frame (max -lz)."""
    return max(-((q[0] - F.x) * F.s + (q[1] - F.z) * F.c) for q in ring_open(ring))


def r2(r): return [[round(q[0], 2), round(q[1], 2)] for q in ring_open(r)]


STF = lambda name, w: 'Ștefan cel Mare' in name


# ---------------- object, facade UVs, unwrap, bake ----------------
def wall_uv(p, o):
    """UV layers: 'UVMap' (bake atlas, active), 'wall' (metres along wall, height), 'wlen' (wall length)."""
    me = o.data
    l0 = me.uv_layers.new(name='UVMap'); lw = me.uv_layers.new(name='wall'); ll = me.uv_layers.new(name='wlen')
    me.uv_layers.active = l0; l0.active_render = True
    for k, poly in enumerate(me.polygons):
        P = [lp._unB(p.v[i]) for i in p.f[k]]; N = newell(P); ln = math.sqrt(N[0] ** 2 + N[1] ** 2 + N[2] ** 2) or 1
        tag = p.tag[k]; ys = [q[1] for q in P]
        if abs(N[1]) / ln < .5 and tag and tag[0] == 'cyl':
            _, cx, cz, r = tag; a0 = math.atan2(P[0][0] - cx, P[0][2] - cz) % TAU; us = []
            for q in P:
                a = math.atan2(q[0] - cx, q[2] - cz)
                while a - a0 > math.pi: a -= TAU
                while a - a0 < -math.pi: a += TAU
                us.append(a * r)
            L = TAU * r
        elif abs(N[1]) / ln < .5:
            hl = math.hypot(N[0], N[2]) or 1; t = (N[2] / hl, -N[0] / hl)
            us = [q[0] * t[0] + q[2] * t[1] for q in P]; u0 = min(us); us = [u - u0 for u in us]; L = max(us)
        else:
            us = [q[0] for q in P]; L = 0.0
        for j, li in enumerate(poly.loop_indices):
            lw.data[li].uv = (us[j], ys[j]); ll.data[li].uv = (L, 0)


def unwrap(o, flat=.3):
    """Smart-UV the atlas; big horizontal faces (roofs, plain plinths) get less texture space than the facades."""
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    bm = bmesh.new(); bm.from_mesh(o.data); uv = bm.loops.layers.uv['UVMap']
    for f in bm.faces:
        if abs(f.normal.z) > .75:
            c = sum((l[uv].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
            for l in f.loops: l[uv].uv = c + (l[uv].uv - c) * flat
    bm.to_mesh(o.data); bm.free()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    try: bpy.ops.uv.select_all(action='SELECT')
    except Exception: pass
    bpy.ops.uv.pack_islands(margin=0.003)
    bpy.ops.object.mode_set(mode='OBJECT')


def make(p, key, x, z, fp, h, skip=(), hs=None, base=None, size=512, ao=.6, ao_dist=2.0):
    lm = {'x': round(x, 2), 'z': round(z, 2), 'fp': [r2(r) for r in fp], 'h': h, 'skip': [[round(c[0], 2), round(c[1], 2)] for c in skip]}
    if hs: lm['hs'] = hs
    if base: lm['base'] = r2(base)
    o = p.obj(key, props={'lm': lm}, origin=(x, 0, z))
    wall_uv(p, o); unwrap(o)
    lp.bake([o], size=size, ao=ao, ao_dist=ao_dist, smooth_angle=50, unwrap=False)
    me = o.data
    for nm in ('wall', 'wlen'): me.uv_layers.remove(me.uv_layers[nm])
    # every material now shows the same baked image: keep one, so the glTF has one material/texture per landmark
    for poly in me.polygons: poly.material_index = 0
    while len(me.materials) > 1: me.materials.pop(index=len(me.materials) - 1)
    me.materials[0].name = key + '_mat'
    return o


# ================= special landmarks (world.json special) =================
def arc(S):
    x, z, ang, size = S['arc']; k = size / 10.2; p = LP('arc'); F = Fr(p, x, z, ang)
    A = facade(p, 'stone', 0xdfd4b9, bands=(6.0 * k - .2, 9.05 * k + .5), bandcol=0xebe5d5, top=9.05 * k, grime=.55, nscale=.8)
    AT = facade(p, 'attic', 0xdfd4b9, bands=(), top=12.7 * k, grime=.45)
    W = p.paint('trim', 0xe8e2d2, grime=.3); PL = p.paint('plinth', 0xbdb39b, 'stripes', 0xa59c87, .45, grime=.5)
    Sz, ws, pw = 10.2 * k, 5.2 * k, 2.5 * k; o = ws / 2 + pw / 2
    yS, yT = 6.0 * k, 9.05 * k
    for sx in (-1, 1):
        for sz in (-1, 1):
            F.box(pw + .7 * k, 1.5 + .8 * k, pw + .7 * k, sx * o, -1.5, sz * o, PL)
            F.box(pw, yT - .8 * k, pw, sx * o, .8 * k, sz * o, A)
    for i in range(4):
        G = F.sub(0, 0, i * math.pi / 2)
        arch_span(G.sub(0, o), ws, yS, yT, pw, A, n=6, under=p.paint('vault', 0xcfc4a8, grime=.5))
        G.box(.55 * k, .9 * k, pw + .2 * k, 0, yS + ws / 2 - .2 * k, o, W)                     # keystone
        for lat in (o - pw / 2 + .45 * k, o + pw / 2 - .45 * k):                                 # 2 engaged columns per pylon face
            for sd in (-1, 1): column(G, sd * lat, Sz / 2 + .12 * k, .8 * k, yT - .8 * k, .3 * k, W, n=6)
        clock(G, (Sz - .6 * k) / 2, 11.55 * k, .9 * k)
    F.box(ws, .45 * k, ws, 0, yS + ws / 2, 0, A)                                                  # vault over the crossing
    F.box(Sz + .5 * k, 1.0 * k, Sz + .5 * k, 0, yT, 0, A)                                         # entablature
    F.box(Sz + 1.2 * k, .38 * k, Sz + 1.2 * k, 0, yT + 1.0 * k, 0, W)                            # cornice
    F.box(Sz - .6 * k, 2.3 * k, Sz - .6 * k, 0, yT + 1.38 * k, 0, AT)                            # attic
    F.box(Sz - .2 * k, .3 * k, Sz - .2 * k, 0, yT + 3.68 * k, 0, W)
    F.box(Sz - 2.6 * k, .8 * k, Sz - 2.6 * k, 0, yT + 3.98 * k, 0, AT)
    F.box(Sz - 2.2 * k, .22 * k, Sz - 2.2 * k, 0, yT + 4.78 * k, 0, W)
    pyl = [F.rect(pw + .7 * k, pw + .7 * k, sx * o, sz * o) for sx in (-1, 1) for sz in (-1, 1)]
    return make(p, 'arc', x, z, pyl, round(yT + 5.0 * k, 1), base=F.rect(Sz * 1.35, Sz * 1.35), size=512, ao_dist=1.5)


def cathedral(S):
    x, z, ang, size = S['cathedral']; k = size / 31; p = LP('cathedral'); F = Fr(p, x, z, ang)
    a, e, H, dep = 6.5 * k, 14 * k, 13.5 * k, 4.6 * k
    WL = facade(p, 'wall', 0xe6dcc3, rows=[(3.4 * k, 5.6 * k, 'arch', 1.7 * k), (10.6 * k, 1.8 * k, 'rect', 1.4 * k)], sp=3.9 * k,
                frame=0xf0ebdf, fw=.28, pier=0xefeadc, pw=.8, rust=2.0 * k, rustcol=0xd8cfb8, top=H, grime=.45)
    BL = facade(p, 'block', 0xe6dcc3, top=H + 5.3 * k, grime=.35)
    R, yb = 5.6 * k, H + .7 * k; yd, hd = yb + 5.15 * k, 7 * k
    DR = facade(p, 'drum', 0xe6dcc3, rows=[(yd + 1.4 * k, 4.2 * k, 'arch', 1.3 * k)], sp=TAU * R / 8, frame=0xf0ebdf, fw=.2,
                pier=0xefeadc, pw=.6, top=yd + hd, grime=.3, mull=False)
    WT = p.paint('trim', 0xece7da, grime=.3); RF = p.paint('roof', 0x5e7280, grime=.5, scale=2)
    DM = p.paint('dome', 0x4c606e, 'stripes', 0x435562, .9, grime=.35); POD = p.paint('podium', 0xc4bba7, grime=.6)
    COL = p.paint('col', 0xf1ede2, grime=.25); TY = p.paint('tymp', 0xe2d8c2, grime=.3)
    cross = lambda a, e: F.ring([(-a, -e), (a, -e), (a, -a), (e, -a), (e, a), (a, a), (a, e), (-a, e), (-a, a), (-e, a), (-e, -a), (-a, -a)])
    extrude(p, cross(a + 1.4 * k, e + dep + 1.0 * k), -1.5, .9 * k, POD)
    C = cross(a, e)
    extrude(p, C, .9 * k, H, WL)
    band(p, C, H, H + .7 * k, WT, .45 * k)
    rh = 3.6 * k
    for i in range(4):
        G = F.sub(0, 0, i * math.pi / 2)
        window(p, G.P(0, e), G.D(1, 0), G.D(0, 1), .9 * k, 5.0 * k, 3.0 * k, DOOR, 'arch', WT, .3)
        for j in range(6): column(G, (-5 + j * 2) * k * 1.04, e + dep - .8 * k, .9 * k, H - 1.0 * k - .9 * k, .52 * k, COL, WT)
        G.box(2 * a + 1.0 * k, 1.7 * k, dep + .5 * k, 0, H - 1.0 * k, e + dep / 2 - .05 * k, WT)          # entablature
        zt = e + dep + .25 * k + .06
        G.face([(-a + .5 * k, H + 1.0 * k, zt), (a - .5 * k, H + 1.0 * k, zt), (0, H + .7 * k + rh - .6 * k, zt)], TY, n=(0, 0, 1))
        G.box(.14 * k, 1.4 * k, .14 * k, 0, H + .7 * k + rh, e + dep, GOLD); G.box(.7 * k, .12 * k, .12 * k, 0, H + .7 * k + rh + .9 * k, e + dep, GOLD)
        steps(G, 2 * a + 1.0 * k, e + dep + 1.0 * k, 3, .9 * k, col=POD)
    for ry in (0, math.pi / 2): F.prism(2 * a + .9 * k, rh, 2 * (e + dep) + .5 * k, 0, H + .7 * k, 0, RF, ry=ry, ends=WT)
    c = 7 * k
    F.box(2 * c, 4.6 * k, 2 * c, 0, yb, 0, BL, top=RF); F.box(2 * c + .8 * k, .55 * k, 2 * c + .8 * k, 0, yb + 4.6 * k, 0, WT)
    F.wcyl(R, hd, 0, yd, 0, DR, n=16, top=RF)
    F.cyl(R + .5 * k, R + .5 * k, .6 * k, 0, yd + hd, 0, WT, n=16)
    F.dome(R + .2 * k, 0, yd + hd + .6 * k, 0, DM, n=16, rings=5, sy=1.05)
    yt = yd + hd + .6 * k + (R + .2 * k) * 1.05 - .3 * k
    F.cyl(1.15 * k, 1.15 * k, 2.4 * k, 0, yt, 0, BL, n=8); F.cyl(1.4 * k, 1.4 * k, .3 * k, 0, yt + 2.4 * k, 0, WT, n=8)
    F.dome(1.35 * k, 0, yt + 2.7 * k, 0, DM, n=8, rings=3, sy=1.2)
    F.ball(.35 * k, 0, yt + 4.5 * k, 0, GOLD); F.box(.22 * k, 3 * k, .22 * k, 0, yt + 4.6 * k, 0, GOLD); F.box(1.4 * k, .2 * k, .2 * k, 0, yt + 6.6 * k, 0, GOLD)
    fp = [F.rect(2 * a + .8, 2 * (e + dep)), F.rect(2 * (e + dep), 2 * a + .8)]
    return make(p, 'cathedral', x, z, fp, 30, base=F.rect(size * 1.15, size * 1.15), size=1024, ao_dist=2.0)


def belltower(S):
    x, z, ang, size = S['belltower']; k = size / 12.2; p = LP('belltower'); F = Fr(p, x, z, ang)
    WT = p.paint('trim', 0xece7da, grime=.3); DM = p.paint('dome', 0x4c606e, 'stripes', 0x435562, .9, grime=.35)
    COL = p.paint('col', 0xf1ede2, grime=.25)
    F.box(13.4 * k, 2.3, 13.4 * k, 0, -1.5, 0, p.paint('plinth', 0xbdb39b, grime=.6)); y = .8
    for ti, (w, h) in enumerate([(12.2, 15.0), (10.2, 12.5), (8.8, 10.5), (7.4, 9.0)]):
        w *= k
        if ti == 0:
            rows = [(y, 6.0, 'arch', 3.4 * k), (y + 8.4, 4.4, 'arch', 2.0 * k)]; gl = DOOR
        else:
            rows = [(y + h * .14, h * .66, 'arch', w * .36)]; gl = 0x26221f
        T = facade(p, 't%d' % ti, 0xe8dfca, rows=rows, sp=w * .999, glass=gl, frame=0xf3efe6, fw=.35, pier=0xf1ede3, pw=1.6 * k,
                   top=y + h - .45, grime=.4, mull=False, rust=(y + 1.0 if ti == 0 else None), rustcol=0xcfc6b0)
        F.box(w, h, w, 0, y, 0, T, top=WT)
        if ti > 0:
            for i in range(4):
                G = F.sub(0, 0, i * math.pi / 2)
                for sd in (-1, 1): column(G, sd * w * .3, w / 2 + .3 * k, y, h - .5, .3 * k, COL, WT, n=6)
                G.box(w * .4, .9, .25, 0, y + h * .14, w / 2 + .12, WT)                         # balustrade in the opening
        F.box(w + 1.0 * k, .55, w + 1.0 * k, 0, y + h - .15, 0, WT)
        if ti > 0:
            for sx in (-1, 1):
                for sz in (-1, 1): F.cyl(.35 * k, .18 * k, .9, sx * (w / 2 + .1), y + h + .4, sz * (w / 2 + .1), WT, n=6)
        y += h + .4
    R = 2.8 * k
    LN = facade(p, 'lantern', 0xe8dfca, rows=[(y + .6, 2.6, 'arch', 1.1)], sp=TAU * R / 8, glass=0x26221f, frame=0xf3efe6, fw=.15,
                top=y + 4, grime=.3, mull=False)
    F.wcyl(R, 4, 0, y, 0, LN, n=8, a0=math.pi / 8)
    F.cyl(R + .4, R + .4, .4, 0, y + 4, 0, WT, n=8, a0=math.pi / 8)
    F.dome(R + .15, 0, y + 4.4, 0, DM, n=12, rings=4, sy=1.25)
    ys = y + 4.4 + (R + .15) * 1.25 - .2
    F.cyl(.7, .5, 1.4, 0, ys, 0, DM, n=6); F.ball(.42, 0, ys + 1.7, 0, GOLD); F.cyl(.25, .06, 3.2, 0, ys + 2.0, 0, GOLD, n=6)
    F.box(.16, 2.4, .16, 0, ys + 5.0, 0, GOLD); F.box(1.2, .14, .14, 0, ys + 6.4, 0, GOLD)
    return make(p, 'belltower', x, z, [F.rect(13.4 * k, 13.4 * k)], 60, size=512, ao_dist=1.5)


def statue(S):
    x, z, ang, size = S['statue']
    ang = 2.3535   # baked: faces the nearest bd. Ștefan cel Mare segment (as the old runtime nearestSeg did)
    p = LP('statue'); F = Fr(p, x, z, ang)
    GR = p.paint('granite', 0x6e5149, col2=0x58403a, scale=.4, grime=.3); GR2 = p.paint('granite2', 0x5f453e, scale=.4, grime=.4)
    BR = p.paint('bronze', 0x47543e, col2=0x5d7458, scale=.3, grime=.5); BR2 = p.paint('bronze2', 0x36412f, scale=.3, grime=.4)
    F.box(5.6, 1.9, 5.6, 0, -1.5, 0, p.paint('step', 0x9b958b, grime=.6))
    F.box(4.6, .9, 4.6, 0, .4, 0, GR2); F.box(3.6, .5, 3.6, 0, 1.3, 0, GR)
    F.box(3.0, 3.4, 3.0, 0, 1.8, 0, GR); F.box(3.4, .45, 3.4, 0, 5.2, 0, GR2); F.box(3.0, .3, 3.0, 0, 5.65, 0, GR)
    F.box(1.6, 1.1, .1, 0, 3.0, 1.52, BR2)                                                # bronze plaque
    y0 = 5.95
    F.box(.8, .25, .55, 0, y0, .05, BR)
    F.lathe([(.8, 0), (.62, 1.2), (.5, 2.3), (.48, 2.6), (.42, 3.25), (.15, 3.6)], 0, y0 + .2, 0, BR, n=8)   # robe + torso
    F.prism(1.3, .5, .55, 0, y0 + 2.95, -.05, BR2)                                         # mantle over shoulders
    F.box(1.15, .3, .55, 0, y0 + 3.2, 0, BR)
    F.ball(.28, 0, y0 + 3.85, .02, BR, n=8, rings=3)                                       # head
    F.box(.3, .3, .1, 0, y0 + 3.62, .22, BR2)                                              # beard
    F.cyl(.27, .3, .25, 0, y0 + 4.05, 0, 0x76683a, n=6)                                    # crown
    F.box(.25, .95, .25, -.62, y0 + 3.0, 0, BR, rz=-.25)                                    # right upper arm
    F.box(.22, .9, .22, -.78, y0 + 3.85, .05, BR)                                           # forearm raised
    F.box(.12, 2.2, .12, -.8, y0 + 4.2, .07, BR)                                            # the cross
    F.box(.8, .12, .12, -.8, y0 + 5.9, .07, BR); F.box(.5, .1, .1, -.8, y0 + 5.6, .07, BR)
    F.box(.24, 1.05, .24, .62, y0 + 2.4, .05, BR, rx=.15)                                   # left arm down
    F.box(.09, 1.7, .09, .55, y0 + .9, .3, BR2, rx=-.12); F.box(.42, .08, .08, .55, y0 + 2.45, .32, BR2)   # sword
    for i in range(8):
        t = i / 8 * TAU + math.pi / 8; F.cyl(.1, .08, .8, math.cos(t) * 3.6, 0, math.sin(t) * 3.6, 0x2e2e2e, n=4)
    return make(p, 'statue', x, z, [F.rect(4.6, 4.6)], 10, base=F.rect(6, 6), size=256, ao_dist=.6)


# ================= buildings on OSM footprints =================
def fp_of(x, z, tol=.35):
    b = lp.footprint(x, z, 4)
    if not b: raise RuntimeError('no footprint near %s,%s' % (x, z))
    b = dict(b); b['ring'] = simplify(b['ring'], tol)
    return b


def gov():
    b = fp_of(-105.2, 100.7); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('gov')
    H, FH = 27.0, 3.2
    rows = [(.5, 3.0, 'rect', 2.6)] + [(4.8 + FH * i, 2.0, 'rect', 1.75) for i in range(7)] + [(H + 1.9 + FH * i, 2.0, 'rect', 1.75) for i in range(3)]
    WL = facade(p, 'wall', 0xd6d0c3, rows=rows, sp=3.1, glass=0x2e3943, pier=0xe6e1d6, pw=.7, py=(4.2, 99), rust=4.2,
                rustcol=0xb5ae9f, top=H, grime=.5)
    RF = p.paint('roof', 0x6f6c66, grime=.3, scale=3); TR = p.paint('trim', 0xd4cec2, grime=.4)
    extrude(p, ring, -1.5, H, WL, top=RF)
    band(p, ring, H, H + .9, TR, .25)
    fe = front(ring, 60, STF); G = front_frame(p, fe)   # main facade: towards the Arc / bd. Ștefan cel Mare
    blk = G.rect(44, 17.6, 0, -8.8 + .01)
    extrude(p, blk, H + .9, H + 10.5, WL, top=RF)
    band(p, blk, H + 10.5, H + 11.3, TR, .3)
    G.box(7, 3.6, .3, 0, H + 6.2, .2, 0xa88f4c); G.box(5.6, 2.6, .35, 0, H + 6.7, .25, 0x355a3f)  # state emblem panel
    flag(G, 0, -8.8, H + 11.3, 7)
    PIL = p.paint('pillar', 0xe2ded4, grime=.35)
    for i in range(10): G.box(1.2, 10.4, 1.2, -20 + i * 40 / 9, -1.5, 4.2, PIL)                    # entrance pillars
    G.box(46, .9, 6.0, 0, 8.9, 2.6, TR); G.box(46.6, .25, 6.6, 0, 9.8, 2.6, 0xb9b2a4)
    steps(G, 48, 5.0, 4, .8, .7, .2)
    return make(p, 'gov', cx, cz, [ring], H + 11, skip=[b['c']], size=1024, ao_dist=2.5)


def parl():
    b = fp_of(-478.5, -262.6); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('parl')
    H = 27.5
    rows = [(.3, 3.6, 'rect', 2.4)] + [(5.2 + 3.3 * i, 2.5, 'rect', 2.2) for i in range(7)]
    WL = facade(p, 'wall', 0xe6e3da, rows=rows, sp=3.0, glass=0x2b3640, pier=0xf2f0ea, pw=.8, py=(4.4, 99), bands=[4.6 + 3.3 * i for i in range(7)],
                bandcol=0xe6e3db, grime=.4, sill=False)
    AT = facade(p, 'attic', 0xe6e3db, top=H + 2.4, grime=.35)
    RF = p.paint('roof', 0x7a7771, grime=.3, scale=3)
    extrude(p, ring, -1.5, H, WL, top=RF)
    extrude(p, offset_ring(ring, .3), H, H + 2.4, AT, top=RF, bottom=True)                       # attic
    band(p, ring, H + 2.4, H + 2.9, p.paint('trim', 0xd6d3cb, grime=.3), .5)
    fe = front(ring, 30, STF); G = front_frame(p, fe)
    flag(G, 0, -7, H + 2.9, 8)
    W = p.paint('canopy', 0xe8e6df, grime=.3)
    G.box(min(26, fe['L'] * .6), .7, 5, 0, 4.6, 2.2, W)                                          # entrance canopy
    for sd in (-1, 1):
        for j in range(3): G.box(.7, 6.1, .7, sd * (3 + j * 4), -1.5, 4.2, W)
    steps(G, min(26, fe['L'] * .6), 5.0, 4, 0, .7)
    return make(p, 'parl', cx, cz, [ring], H + 3, skip=[b['c']], size=1024, ao_dist=2.5)


def prim():
    b = fp_of(139.9, 230.7); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('prim')
    H = 15.0; WT = 0xe6dfd2
    rows = [(1.7, 2.4, 'arch', 1.3), (6.1, 2.9, 'arch', 1.3), (11.0, 2.6, 'arch', 1.3)]
    WL = facade(p, 'wall', BRICK, rows=rows, sp=3.3, brick=True, mortar=0xcdbfae, frame=WT, fw=.22, bands=(5.15, 10.15, H - .3),
                bandcol=WT, rust=1.0, rustcol=0xc8bfae, top=H, grime=.5)
    tw = 7.5
    TWm = facade(p, 'tower', BRICK, rows=[(1.7, 2.4, 'arch', 1.2, tw / 2), (6.1, 2.9, 'arch', 1.2, tw / 2), (11.0, 2.6, 'arch', 1.2, tw / 2),
                                          (16.0, 3.4, 'arch', 1.6, tw), (21.3, 3.4, 'arch', 1.6, tw)], sp=tw / 2, brick=True, mortar=0xcdbfae,
                 frame=WT, fw=.22, bands=(5.15, 10.15, 15.15, 20.65, 25.75), bandcol=WT, rust=1.0, rustcol=0xc8bfae, grime=.5)
    BF = facade(p, 'belfry', BRICK2, brick=True, mortar=0xcdbfae, top=32.2, grime=.45)
    RF = p.paint('roof', 0x5f4a40, grime=.3, scale=3); GR = p.paint('spire', 0x4a564f, 'stripes', 0x3f4a44, .6, grime=.4)
    MR = p.paint('merlon', BRICK2, grime=.5); TR = p.paint('trim', WT, grime=.35)
    extrude(p, ring, -1.5, H, WL, top=RF)
    ring_merlons(p, ring, H, 2.0, .8, .9, .45, MR)
    fe = front(ring, 15, STF); G = front_frame(p, fe)
    T = G.sub(0, -(tw / 2 - .8))
    T.box(tw, 28.5, tw, 0, -1.5, 0, TWm, top=RF)
    window(p, T.P(0, tw / 2), T.D(1, 0), T.D(0, 1), 0, 4.0, 2.6, DOOR, 'point', WT, .35)
    T.box(tw - .6, 5.2, tw - .6, 0, 27.0, 0, BF, top=RF)
    for i in range(4): clock(T, (tw - .6) / 2, 29.6, 1.55, i * math.pi / 2)
    T.box(tw + .5, .45, tw + .5, 0, 26.6, 0, TR); T.box(tw + .2, .45, tw + .2, 0, 32.2, 0, TR)
    ring_merlons(p, T.rect(tw, tw), 32.65, 1.25, .6, .8, .4, MR)
    for sx in (-1, 1):
        for sz in (-1, 1):
            T.cyl(.6, .6, 6.6, sx * tw / 2, 26.6, sz * tw / 2, MR, n=6)
            T.cyl(.8, 0, 2.4, sx * tw / 2, 33.2, sz * tw / 2, GR, n=6)
    T.hip(tw - .2, 9.0, tw - .2, 0, 32.65, 0, GR, ridge=0)
    T.ball(.3, 0, 41.8, 0, GOLD); flag(T, 0, 0, 41.6, 3.6)
    return make(p, 'prim', cx, cz, [ring, T.rect(tw, tw)], H + 1, hs=[H + 1, 42], skip=[b['c']], size=1024, ao_dist=1.5)


def opera():
    b = fp_of(-160.3, -358.3); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('opera')
    H = 21.0
    SL = facade(p, 'slats', 0x8f969b, pier=0xe9e9e4, pw=1.5, sp=2.6, top=H, grime=.35)
    AT = p.paint('attic', 0xe6e6e1, grime=.35); RF = p.paint('roof', 0x8f8c85, grime=.5, scale=3)
    extrude(p, ring, -1.5, H, SL, top=RF)
    extrude(p, offset_ring(ring, 1.2), H, H + 1.6, AT, top=RF, bottom=True)                       # overhanging attic
    fe = front(ring, 40, STF); G = front_frame(p, fe); L = fe['L']; D = depth_behind(ring, G)     # glass lobby towards the boulevard
    lw = L * .8
    LB = facade(p, 'lobby', 0x3d5466, pier=0xdfe3e4, pw=.3, sp=3.2, bands=(6.55,), bandcol=0xdfe3e4, grime=.15, nscale=.3)
    extrude(p, G.rect(lw, 7.5, 0, 3.75), -1.5, 13.5, LB, top=AT)
    COL = p.paint('col', 0xefefea, grime=.25)
    for i in range(14): G.cyl(.5, .5, 15.0, -lw / 2 + .8 + i * (lw - 1.6) / 13, -1.5, 9.4, COL, n=8, caps=False)
    G.box(L * .86, 1.1, 11.5, 0, 13.5, 4.9, AT)                                                    # canopy
    steps(G, lw + 4, 10.3, 4, 0, .8)
    extrude(p, G.rect(28, 22, 0, -D * .62), H, H + 10, SL, top=RF)                                 # stage tower
    return make(p, 'opera', cx, cz, [ring], H + 10, skip=[b['c']], size=1024, ao_dist=2.5)


def water():
    b = fp_of(-772.5, 596.4); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('water')
    WT = 0xe6dfd2
    WL = facade(p, 'wall', BRICK2, rows=[(1.2, 3.0, 'arch', 1.2), (7.2, 3.0, 'arch', 1.2), (12.8, 2.8, 'arch', 1.2)], sp=3.6, brick=True,
                mortar=0xcdbfae, frame=WT, fw=.25, bands=(6.0, 11.6), bandcol=WT, rust=.8, rustcol=0xb8ad9b, top=16.4, grime=.55)
    BR = facade(p, 'parapet', BRICK2, brick=True, mortar=0xcdbfae, grime=.5)
    RF = p.paint('roof', 0x5f463c, grime=.6); TR = p.paint('trim', WT, grime=.4)
    extrude(p, ring, -1.5, 17.0, WL, top=RF)
    band(p, ring, 16.4, 17.6, TR, .5)
    extrude(p, offset_ring(ring, .45), 17.6, 19.2, BR, top=RF, bottom=True)
    ring_merlons(p, offset_ring(ring, .45), 19.2, 1.3, .7, .8, .5, BR)
    F = Fr(p, cx, cz, 0)
    PV = facade(p, 'pavilion', 0xe8e1d3, rows=[(18.6, 2.2, 'arch', 1.2)], sp=TAU * 3.6 / 8, glass=0x2b2724, top=21.8, grime=.35, mull=False)
    F.wcyl(3.6, 4.2, 0, 17.6, 0, PV, n=8, a0=math.pi / 8)
    F.cyl(4.2, 4.2, .35, 0, 21.8, 0, TR, n=8, a0=math.pi / 8)
    F.cyl(4.6, 0, 4.0, 0, 22.15, 0, p.paint('cone', 0x55615a, 'stripes', 0x48544d, .5, grime=.4), n=8, a0=math.pi / 8)
    F.cyl(.06, .06, 2.5, 0, 26.0, 0, 0x333333, n=4); F.ball(.25, 0, 26.3, 0, GOLD)
    return make(p, 'water', cx, cz, [ring], 22, skip=[b['c']], size=512, ao_dist=1.0)


def emin():
    b = fp_of(250.9, 348.8); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('emin')
    H = 17.0; WT = 0xf0e9d8
    WL = facade(p, 'wall', 0xe0cfa9, rows=[(1.4, 2.3, 'arch', 1.5), (6.2, 3.4, 'rect', 1.5), (11.6, 3.0, 'rect', 1.5)], sp=3.6,
                frame=WT, fw=.25, rust=4.5, rustcol=0xd2bf96, bands=(4.7,), bandcol=WT, top=H, grime=.45)
    RF = p.paint('roof', 0x77736b, grime=.3, scale=3); TR = p.paint('trim', WT, grime=.35); PA = p.paint('parapet', 0xe0cfa9, grime=.4)
    extrude(p, ring, -1.5, H, WL, top=RF)
    band(p, ring, H, H + .8, TR, .55)
    extrude(p, offset_ring(ring, .15), H + .8, H + 1.6, PA, top=RF)
    fe = front(ring, 12, STF); G = front_frame(p, fe); w = min(19, fe['L'] * .85)
    COL = p.paint('col', 0xf3eee2, grime=.3)
    for i in range(6): column(G, -w / 2 + .9 + i * (w - 1.8) / 5, 3.4, .9, 11.6, .6, COL, TR)
    G.box(w + 1.2, 1.5, 4.6, 0, 12.5, 2.1, TR)
    G.prism(w + 1.6, 3.4, 5.0, 0, 14.0, 2.1, RF, ends=TR)
    G.face([(-w / 2 + .5, 14.4, 4.66), (w / 2 - .5, 14.4, 4.66), (0, 16.7, 4.66)], p.paint('tymp', 0xe6dbc2, grime=.3), n=(0, 0, 1))
    POD = p.paint('podium', 0xcfc6b2, grime=.5)
    G.box(w + 1.2, 2.4, 4.6, 0, -1.5, 2.1, POD)
    steps(G, w + 1.2, 4.4, 3, .9, .6, col=POD)
    return make(p, 'emin', cx, cz, [ring], H + 2, skip=[b['c']], size=512, ao_dist=1.5)


def art():
    b = fp_of(-195.3, 316.8); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('art')
    H = 14.0; WT = 0xf0e9d8; C = 0xe2cfab
    WL = facade(p, 'wall', C, rows=[(1.3, 2.2, 'rect', 1.5), (5.6, 3.6, 'arch', 1.5), (10.1, 2.6, 'rect', 1.4)], sp=3.6,
                frame=WT, fw=.26, rust=4.2, rustcol=0xd4bf98, bands=(4.4,), bandcol=WT, top=H, grime=.45)
    RF = p.paint('roof', 0x6c6963, grime=.3, scale=3); TR = p.paint('trim', WT, grime=.35); PA = p.paint('parapet', C, grime=.4)
    extrude(p, ring, -1.5, H, WL, top=RF)
    band(p, ring, H, H + .7, TR, .5)
    extrude(p, offset_ring(ring, .15), H + .7, H + 1.4, PA, top=RF)
    # corner rotunda with a copper dome at the Pușkin / 31 August corner
    v = min(ring, key=lambda q: math.hypot(q[0] + 132, q[1] - 352)); d = math.hypot(cx - v[0], cz - v[1])
    rx, rz = v[0] + (cx - v[0]) / d * 2.6, v[1] + (cz - v[1]) / d * 2.6; F = Fr(p, rx, rz, 0)
    RO = facade(p, 'rotunda', C, rows=[(1.3, 2.2, 'rect', 1.2), (5.6, 3.6, 'arch', 1.2), (H + .8, 1.6, 'arch', 1.1)], sp=TAU * 4 / 6,
                frame=WT, fw=.22, rust=4.2, rustcol=0xd4bf98, bands=(4.4, H + .35), bandcol=WT, top=H + 3.0, grime=.45)
    F.wcyl(4.0, H + 4.5, 0, -1.5, 0, RO, n=12)
    F.cyl(4.5, 4.5, .5, 0, H + 3.0, 0, TR, n=12)
    CU = p.paint('copper', COPPER, 'stripes', 0x52675b, .7, grime=.45)
    F.dome(4.15, 0, H + 3.5, 0, CU, n=12, rings=4, sy=1.3)
    F.cyl(.6, .4, 1.6, 0, H + 8.6, 0, CU, n=6); F.ball(.35, 0, H + 10.4, 0, GOLD)
    return make(p, 'art', cx, cz, [ring], H + 2, skip=[b['c']], size=1024, ao_dist=1.5)


def bnm():
    b = fp_of(422.5, -508.1); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('bnm')
    H = 30.0
    rows = [(.4, 4.0, 'rect', 3.0)] + [(5.6 + 3.05 * i, 2.5, 'rect', 1.7) for i in range(8)]
    WL = facade(p, 'wall', 0xd9d7d0, rows=rows, sp=3.4, glass=0x30414f, pier=0xeae9e4, pw=.6, py=(4.8, H - 1), bands=(4.8,),
                bandcol=0xcac8c0, top=H - 1, grime=.4, sill=False)
    CR = p.paint('crown', 0xeae9e4, grime=.3); RF = p.paint('roof', 0x77756f, grime=.3, scale=3)
    extrude(p, ring, -1.5, H, WL, top=RF)
    extrude(p, offset_ring(ring, .6), H - 1.0, H + 1.6, CR, top=RF, bottom=True)
    fe = front(ring, 20, lambda n, w: 'Grigore Vieru' in n); G = front_frame(p, fe)
    G.box(min(30, fe['L'] * .55), .8, 7, 0, 4.4, 3.5, CR)
    for sd in (-1, 1): G.box(.8, 5.9, .8, sd * min(14, fe['L'] * .26), -1.5, 6.4, CR)
    G.box(10, 2.2, .3, 0, H - 4.2, .7, 0x948452)                                                  # bank name plate
    steps(G, min(30, fe['L'] * .55), 7.0, 3, 0, .6)
    return make(p, 'bnm', cx, cz, [ring], H + 2, skip=[b['c']], size=1024, ao_dist=2.5)


def cath2():
    b = fp_of(-281.9, -491.3); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = LP('cath2')
    H = 12.0; C, WT = 0xe6d3a5, 0xf1ebdc
    WL = facade(p, 'wall', C, rows=[(3.0, 5.2, 'arch', 1.6)], sp=3.8, frame=WT, fw=.25, rust=1.0, rustcol=0xd2bf93, top=H, grime=.45,
                pier=0xeee6cf, pw=.6, mull=False)
    RF = p.paint('roof', 0x80553f, 'stripes', 0x704a37, .5, grime=.5); TR = p.paint('trim', WT, grime=.35)
    extrude(p, ring, -1.5, H, WL, top=p.paint('flat', 0x7a7064, grime=.6, scale=3))
    band(p, ring, H, H + .6, TR, .35)
    pts = ring; sxx = sum((q[0] - cx) ** 2 for q in pts); szz = sum((q[1] - cz) ** 2 for q in pts); sxz = sum((q[0] - cx) * (q[1] - cz) for q in pts)
    th = .5 * math.atan2(2 * sxz, sxx - szz); u = (math.cos(th), math.sin(th)); n = (-u[1], u[0])
    pr = lambda q: ((q[0] - cx) * u[0] + (q[1] - cz) * u[1], (q[0] - cx) * n[0] + (q[1] - cz) * n[1])
    PU = [pr(q) for q in pts]; u0, u1 = min(q[0] for q in PU), max(q[0] for q in PU)
    wid = lambda lo, hi: [q[1] for q in PU if lo <= q[0] <= hi]
    e0, e1 = wid(u0, u0 + 14), wid(u1 - 14, u1)
    mid = wid((u0 + u1) / 2 - 4, (u0 + u1) / 2 + 4); nw = max(mid) - min(mid); nc = (max(mid) + min(mid)) / 2
    rot_end = 0 if (max(e0) - min(e0)) > (max(e1) - min(e1)) else 1
    rr = ((max(e0) - min(e0)) if rot_end == 0 else (max(e1) - min(e1))) / 2
    ruc = u0 + rr if rot_end == 0 else u1 - rr; rnc = ((max(e0) + min(e0)) if rot_end == 0 else (max(e1) + min(e1))) / 2
    A = Fr(p, cx + n[0] * nc, cz + n[1] * nc, math.atan2(u[0], u[1]))                         # local z along the axis
    za, zb = (ruc + rr * .6, u1 - nw / 2) if rot_end == 0 else (u0 + nw / 2, ruc - rr * .6)
    A.prism(nw + .6, nw * .42, zb - za, 0, H + .6, (za + zb) / 2, RF, ends=p.paint('gable', C, grime=.4))
    A.box(.15, 1.2, .15, 0, H + .6 + nw * .42, zb if rot_end == 0 else za, GOLD)
    Rf = Fr(p, cx + u[0] * ruc + n[0] * rnc, cz + u[1] * ruc + n[1] * rnc, 0)
    rr *= .82; rd = rr * .82
    DRm = facade(p, 'drum', C, rows=[(H + 1.1, 1.4, 'arch', .9)], sp=TAU * rd / 6, frame=WT, fw=.15, top=H + 3.2, grime=.35, mull=False)
    Rf.wcyl(rd, 2.6, 0, H + .6, 0, DRm, n=12)
    Rf.cyl(rd + .35, rd + .35, .35, 0, H + 3.2, 0, TR, n=12)
    DM = p.paint('dome', 0x5b7365, 'stripes', 0x50675a, .6, grime=.4)
    Rf.dome(rr * .85, 0, H + 3.5, 0, DM, n=12, rings=4, sy=.8)
    yl = H + 3.5 + rr * .85 * .8 - .2
    Rf.cyl(.9, .9, 1.6, 0, yl, 0, TR, n=6); Rf.cyl(1.1, 0, 1.0, 0, yl + 1.6, 0, DM, n=6)
    Rf.box(.15, 2.0, .15, 0, yl + 2.4, 0, GOLD); Rf.box(.9, .14, .14, 0, yl + 3.7, 0, GOLD)
    return make(p, 'cath2', cx, cz, [ring], H + 3, skip=[b['c']], size=512, ao_dist=1.2)


# State Circus: drum fitted to the Overture/OSM ring + the back-of-house wing (footprint minus drum), decimetres
CIRC_C, CIRC_R = (1257.7, -1394.9), 28.3
CIRC_WING = [[11644, -14333, 11640, -14186, 12214, -14175, 12323, -14081, 12324, -14084, 12328, -14090, 12331, -14097, 12335, -14103, 12339, -14108, 12343, -14114, 12347, -14120, 12351, -14125, 12356, -14131, 12360, -14136, 12365, -14142, 12370, -14147, 12374, -14152, 12379, -14157, 12385, -14161, 12390, -14166, 12395, -14171, 12401, -14175, 12406, -14179, 12412, -14183, 12418, -14187, 12424, -14191, 12430, -14195, 12436, -14198, 12442, -14202, 12444, -14203, 12464, -14222, 12376, -14312, 12355, -14290, 12344, -14301, 12355, -14869, 12138, -14875, 12060, -14799, 12052, -14807, 12048, -14804, 12052, -14800, 11716, -14478, 11719, -14476, 11641, -14400, 11639, -14333],
             [11771, -14290, 11773, -14400, 11908, -14528, 11942, -14492, 12038, -14582, 12004, -14619, 12138, -14747, 12249, -14743, 12245, -14547, 12069, -14553, 11972, -14460, 11968, -14285]]


def circ():
    (cx, cz), R = CIRC_C, CIRC_R; p = LP('circ')
    dm = lambda f: [(f[i] * .1, f[i + 1] * .1) for i in range(0, len(f), 2)]
    wing, hole = simplify(dm(CIRC_WING[0]), .3), dm(CIRC_WING[1])
    best, bd = 0.0, 1e9                       # entrance faces the nearest wide road (bd. Renașterii Naționale)
    for kind, wd, name, P in roads():
        if kind != 0 or wd < 10: continue
        for q in P:
            d = math.hypot(q[0] - cx, q[1] - cz)
            if d < bd: bd, best = d, math.atan2(q[0] - cx, q[1] - cz)
    F = Fr(p, cx, cz, best)
    W = p.paint('white', 0xe9e6de, grime=.35); ST = p.paint('steps', 0xc4bdaf, 'stripes', 0xaaa395, .45, grime=.5)
    for r, y1 in ((R + 6.6, .25), (R + 5.8, .7), (R + 5.0, 1.4)): F.cyl(r, r, y1 + 3, 0, -3, 0, ST, n=32)
    GL1 = facade(p, 'glass1', 0x2c3a46, pier=0xc9ccce, pw=.25, sp=TAU * (R - 1.6) / 48, grime=.15, nscale=.3)
    GL2 = facade(p, 'glass2', 0x536d80, pier=0xdfe2e3, pw=.25, sp=TAU * (R - .6) / 72, bands=(11.3,), bandcol=0xdfe2e3, grime=.15, nscale=.3)
    F.wcyl(R - 1.6, 4.6, 0, 1.4, 0, GL1, n=24)
    F.wcyl(R - .6, 10.6, 0, 6.0, 0, GL2, n=24, caps=False)
    F.cyl(R - .3, R - .3, .5, 0, 5.9, 0, W, n=24)
    N = 24; bay = TAU / N; chord = 2 * (R + .2) * math.sin(bay / 2)
    for i in range(N):
        a = (i + .5) * bay; G = F.sub(math.sin(a) * (R + .2), math.cos(a) * (R + .2), a)
        G.box(1.2, 15.6, 1.8, 0, 1.4, 0, W)
        b2 = i * bay; Q = F.sub(math.sin(b2) * (R + .2) * math.cos(bay / 2), math.cos(b2) * (R + .2) * math.cos(bay / 2), b2)
        arch_span(Q, chord - 1.2, 13.4, 17.0, .9, W, n=4)
    FR = facade(p, 'frieze', 0xe9e6de, bands=(17.4, 19.8), bandcol=0xf3f1ec, top=20.2, grime=.35)
    F.wcyl(R + .75, 3.2, 0, 17.0, 0, FR, n=24)
    F.cyl(R + 1.05, R + 1.05, .45, 0, 20.2, 0, W, n=24)
    F.cyl(R - 2, R - 2, 1.6, 0, 20.6, 0, W, n=24)
    F.dome(R - 2, 0, 22.2, 0, p.paint('dome', 0xa1a8ad, 'stripes', 0x8f969b, 1.2, grime=.35), n=24, rings=4, sy=4.2 / (R - 2))
    F.cyl(3.0, 2.6, 1.6, 0, 25.9, 0, W, n=12); F.cyl(3.0, 0, 1.4, 0, 27.5, 0, 0x878f95, n=12)
    # entrance canopy on columns + the CIRC sign (block letters)
    F.box(26, .9, 9, 0, 5.95, R + 3.2, W)
    for i in range(6): F.cyl(.4, .4, 4.6, -11 + i * 4.4, 1.4, R + 7, W, n=8, caps=False)
    for st in range(3): F.box(28, 1.6 - st * .45 + 1.5, 4 - st, 0, -1.5, R + 7.5 + st, ST)
    zf = R + 1.2; F.box(9.6, 2.8, .3, 0, 17.2, zf, 0xf2f0ea); RD = 0xb92630; zl = zf + .2; s = .38
    def Lt(x0, cells):
        for cx0, cy0, w, h in cells: F.box(w * s, h * s, .2, x0 + (cx0 + w / 2) * s, 17.4 + cy0 * s, zl, RD)
    Lt(-3.03, [(0, 0, 1, 5), (1, 4, 2, 1), (1, 0, 2, 1)])                                  # C
    Lt(-1.39, [(1, 0, 1, 5)])                                                              # I
    Lt(.25, [(0, 0, 1, 5), (1, 4, 2, 1), (2, 3, 1, 1), (1, 2, 2, 1), (2, 0, 1, 2)])      # R
    Lt(1.89, [(0, 0, 1, 5), (1, 4, 2, 1), (1, 0, 2, 1)])                                   # C
    # back-of-house wing (with its service yard)
    WG = facade(p, 'wing', 0xd6d0c3, rows=[(1.2, 2.4, 'rect', 2.2), (5.0, 2.4, 'rect', 2.2), (8.6, 2.4, 'rect', 2.2)], sp=3.4, glass=0x34404b,
                bands=(4.4, 8.0), bandcol=0xc7c1b4, top=12, grime=.5)
    extrude(p, wing, -6, 12, WG, top=p.paint('roof', 0x84817b, grime=.3, scale=3), holes=[hole])
    band(p, wing, 12, 12.6, p.paint('trim', 0xd8d4ca, grime=.4), .2)
    drum = [(cx + math.sin(i / 32 * TAU) * R, cz + math.cos(i / 32 * TAU) * R) for i in range(32)]
    skip = lp.footprint(1242.3, -1408.4, 4)
    return make(p, 'circ', cx, cz, [drum, wing], 26, hs=[26, 13], skip=[skip['c']] if skip else [], size=1024, ao_dist=2.0)


def build():
    S = lp.special(); out = []
    for f in (arc, cathedral, belltower, statue):
        if f.__name__ in S: out.append(f(S))
    for f in (gov, parl, prim, opera, water, emin, art, bnm, cath2, circ): out.append(f())
    return out
