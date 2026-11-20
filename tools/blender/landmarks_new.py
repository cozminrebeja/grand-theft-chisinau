"""Added Chișinău landmarks for models/landmarks.glb (built by tools/blender/landmarks.py), PS2-era textured look.

build() returns one top-level object per landmark, named by its key, with prop 'lm' = {x, z, fp, h, skip[, clear]}
(see lm_glbList in js/landmarks.js). Geometry is in game metres relative to (x, base, z), base = lowest ground under
fp[0]. Footprints come from the game's own building data (lp.footprint), so the models sit on the real OSM rings.

Look: simple massing, smooth shading with hard corners, and the small detail (windows, floor lines, joints, stripes,
lettering, seat rows, grime) painted procedurally and baked with AO into one texture per landmark (lp.bake).

Keys: cosmos, atrium, atriumtower, grandhall, national, romanita, gates, gates2, palatul, gara, piata, piata2, hotelchisinau, ciuflea,
mazarache, pantelimon, eternitate, tvtower, zimbru.

A few parts that sit away from fp[0] on sloping ground carry a fixed height step measured in the game's terrain
(hotelchisinau's south-west wing, zimbru's pitch level); they are commented where used.
"""
import math, random, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp
import bpy

PI = math.pi

# ------------------------------------------------------------------ geometry helpers
def _cen(r): return (sum(p[0] for p in r) / len(r), sum(p[1] for p in r) / len(r))


def _sarea(r): return sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r))) / 2


def _inside(p, r):
    c = False
    for i in range(len(r)):
        a, b = r[i], r[i - 1]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]: c = not c
    return c


def mar(r):
    """Minimum-area rectangle of a ring: (cx, cz, angle of the long-or-first axis u, L along u, W across)."""
    best = None
    for i in range(len(r)):
        a, b = r[i], r[(i + 1) % len(r)]
        ang = math.atan2(b[1] - a[1], b[0] - a[0]); c, s = math.cos(ang), math.sin(ang)
        u = [p[0] * c + p[1] * s for p in r]; v = [-p[0] * s + p[1] * c for p in r]
        A = (max(u) - min(u)) * (max(v) - min(v))
        if best is None or A < best[0]:
            um, vm = (max(u) + min(u)) / 2, (max(v) + min(v)) / 2
            best = (A, um * c - vm * s, um * s + vm * c, ang, max(u) - min(u), max(v) - min(v))
    _, cx, cz, a, L, W = best
    if W > L: a += PI / 2; L, W = W, L
    return cx, cz, a, L, W


def simplify(r, tol=1.0):
    """Drop ring vertices closer than tol to the line through their neighbours (repeat until stable)."""
    r = list(r)
    changed = True
    while changed and len(r) > 4:
        changed = False
        for i in range(len(r)):
            a, p, b = r[i - 1], r[i], r[(i + 1) % len(r)]
            dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz) or 1e-9
            if abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / L < tol or math.hypot(p[0] - a[0], p[1] - a[1]) < tol:
                del r[i]; changed = True; break
    return r


def offset(r, d):
    """Miter offset of a simple ring; d > 0 grows it outward, d < 0 shrinks it."""
    def raw(sg):
        n = len(r); out = []
        for i in range(n):
            p0, p1, p2 = r[i - 1], r[i], r[(i + 1) % n]
            def nrm(a, b):
                dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz) or 1e-9
                return (dz / L * sg, -dx / L * sg)
            n1, n2 = nrm(p0, p1), nrm(p1, p2)
            k = max(1 + n1[0] * n2[0] + n1[1] * n2[1], 0.3)
            out.append((p1[0] + (n1[0] + n2[0]) / k * d, p1[1] + (n1[1] + n2[1]) / k * d))
        return out
    o = raw(1)
    if (abs(_sarea(o)) > abs(_sarea(r))) != (d > 0): o = raw(-1)
    return o


def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _unit(a): L = math.sqrt(_dot(a, a)) or 1e-9; return (a[0] / L, a[1] / L, a[2] / L)


def _newell(f):
    n = [0, 0, 0]
    for i in range(len(f)):
        a, b = f[i], f[(i + 1) % len(f)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return n


def oface(P, pts, col, toward):
    """Face whose front points along the vector `toward`."""
    if _dot(_newell(pts), toward) < 0: pts = pts[::-1]
    P.face(pts, col)


def solid(P, faces, col, cen=None):
    """Faces of a convex-ish solid, each turned to face away from its centre."""
    if cen is None:
        allp = [p for f in faces for p in f]; cen = tuple(sum(p[k] for p in allp) / len(allp) for k in range(3))
    for f in faces:
        c = tuple(sum(p[k] for p in f) / len(f) for k in range(3))
        oface(P, f, col if not isinstance(col, dict) else col.get(id(f), col['_']), _sub(c, cen))


def hexa(P, lo, hi, col, caps=True):
    """Solid between two matching quads (lo = bottom, hi = top), 3D points."""
    f = [[lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i]] for i in range(4)]
    if caps: f += [list(lo), list(hi)]
    solid(P, f, col)


def beam(P, a, b, t, col, caps=False):
    d = _unit(_sub(b, a)); up = (0, 1, 0) if abs(d[1]) < 0.95 else (1, 0, 0)
    s1 = _unit(_cross(d, up)); s2 = _unit(_cross(d, s1)); h = t / 2
    q = [(s1[0] * i + s2[0] * j, s1[1] * i + s2[1] * j, s1[2] * i + s2[2] * j) for i, j in ((-h, -h), (h, -h), (h, h), (-h, h))]
    hexa(P, [(a[0] + o[0], a[1] + o[1], a[2] + o[2]) for o in q], [(b[0] + o[0], b[1] + o[1], b[2] + o[2]) for o in q], col, caps)


def ring_walls(P, r, y0, y1, col):
    """Walls of a footprint ring between y0 and y1 (no caps), facing outward."""
    c = _cen(r)
    for i in range(len(r)):
        a, b = r[i], r[(i + 1) % len(r)]
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); dx, dz = b[0] - a[0], b[1] - a[1]
        n = (dz, 0, -dx)
        if _inside((m[0] + n[0] * 0.01, m[1] + n[2] * 0.01), r): n = (-n[0], 0, -n[2])
        oface(P, [(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], col, n)


def ring_windows(P, r, ys, wh, ww, step, col, out=0.08, margin=1.4, minlen=None):
    """Window quads along every long-enough edge of a ring, rows at heights ys."""
    for i in range(len(r)):
        a, b = r[i], r[(i + 1) % len(r)]
        dx, dz = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dz)
        if L < (minlen or ww + 2 * margin): continue
        ux, uz = dx / L, dz / L; nx, nz = uz, -ux
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        if _inside((m[0] + nx * 0.3, m[1] + nz * 0.3), r): nx, nz = -nx, -nz
        k = max(1, int((L - 2 * margin) // step)); t0 = (L - (k - 1) * step) / 2
        for j in range(k):
            t = t0 + j * step
            c0 = (a[0] + ux * (t - ww / 2) + nx * out, a[1] + uz * (t - ww / 2) + nz * out)
            c1 = (a[0] + ux * (t + ww / 2) + nx * out, a[1] + uz * (t + ww / 2) + nz * out)
            for y in ys:
                oface(P, [(c0[0], y, c0[1]), (c1[0], y, c1[1]), (c1[0], y + wh, c1[1]), (c0[0], y + wh, c0[1])], col, (nx, 0, nz))


class F:
    """Oriented frame on the ground: u along angle a (radians, atan2 in x/z), v = u turned +90° (towards +z for a=0)."""

    def __init__(s, cx, cz, a=0.0):
        s.cx, s.cz, s.a = cx, cz, a; s.c, s.s = math.cos(a), math.sin(a)

    def p(s, u, v): return (s.cx + u * s.c - v * s.s, s.cz + u * s.s + v * s.c)

    def P3(s, u, y, v): x, z = s.p(u, v); return (x, y, z)

    def dir(s, u, v): return (u * s.c - v * s.s, 0, u * s.s + v * s.c)

    def box(s, P, u, v, y0, w, h, d, col, top=None, taper=1.0, ry=0.0):
        """w along u, d along v, from y0 up."""
        x, z = s.p(u, v); P.box(w, h, d, at=(x, y0 + h / 2, z), ry=-s.a + ry, col=col, top=top, taper=taper)

    def cyl(s, P, u, v, y0, r0, r1, h, n=8, col=0xcccccc, top=None, caps=True, a0=0.0):
        x, z = s.p(u, v); P.cyl(r0, r1, h, n=n, at=(x, y0 + h / 2, z), col=col, top=top, caps=caps, a0=a0, ry=-s.a)

    def disc(s, P, u, v, y, r, t, col, n=10, axis='v'):
        """Vertical disc (clock face, arch head) facing along v (or u)."""
        x, z = s.p(u, v); P.cyl(r, r, t, n=n, at=(x, y, z), rx=PI / 2, ry=-s.a + (PI / 2 if axis == 'u' else 0), col=col)

    def gable(s, P, u, v, y0, w, h, d, along, col, ends=None):
        """Gable roof: ridge along 'u' or 'v' (length d), span w, apex h above y0."""
        x, z = s.p(u, v); P.prism(w, h, d, at=(x, y0, z), ry=-s.a + (PI / 2 if along == 'u' else 0), col=col, ends=ends)

    def hip(s, P, u, v, y0, w, h, d, col, ridge=0.5):
        x, z = s.p(u, v); P.hip(w, h, d, at=(x, y0, z), ry=-s.a, col=col, ridge=ridge)

    def quad(s, P, u0, u1, v, y0, y1, col, side=1, out=0.06):
        """Flat quad on the plane v (facade detail), facing +v (side=1) or -v."""
        vv = v + side * out
        oface(P, [s.P3(u0, y0, vv), s.P3(u1, y0, vv), s.P3(u1, y1, vv), s.P3(u0, y1, vv)], col, s.dir(0, side))

    def quad_u(s, P, v0, v1, u, y0, y1, col, side=1, out=0.06):
        """Flat quad on the plane u, facing +u (side=1) or -u."""
        uu = u + side * out
        oface(P, [s.P3(uu, y0, v0), s.P3(uu, y0, v1), s.P3(uu, y1, v1), s.P3(uu, y1, v0)], col, s.dir(side, 0))

    def vault(s, P, u0, u1, v0, v1, y0, rise, col, end=None, segs=6):
        """Barrel roof along u over [u0,u1]×[v0,v1], springing at y0 (parabolic arch), with end walls."""
        vm, vh = (v0 + v1) / 2, (v1 - v0) / 2
        arc = [(vm - vh + 2 * vh * i / segs, y0 + rise * (1 - ((2 * i / segs) - 1) ** 2)) for i in range(segs + 1)]
        for i in range(segs):
            (va, ya), (vb, yb) = arc[i], arc[i + 1]
            mid = (va + vb) / 2 - vm
            oface(P, [s.P3(u0, ya, va), s.P3(u1, ya, va), s.P3(u1, yb, vb), s.P3(u0, yb, vb)], col, s.dir(0, mid * 0.2) if abs(mid) > 1e-6 else (0, 1, 0))
            for uu, sd in ((u0, -1), (u1, 1)):
                oface(P, [s.P3(uu, y0, vm), s.P3(uu, ya, va), s.P3(uu, yb, vb)], end if end is not None else col, s.dir(sd, 0))

    def vault_v(s, P, u0, u1, v0, v1, y0, rise, col, end=None, segs=6):
        """Barrel roof along v."""
        g = F(s.cx, s.cz, s.a + PI / 2)
        # in g: u' = v, v' = -u
        g.vault(P, v0, v1, -u1, -u0, y0, rise, col, end, segs)


def vbay(P, f, u, vf, side, y0, y1, hw, depth, col):
    """V-shaped (triangular) bay window on the facade plane v=vf, pointing out to side, from y0 to y1."""
    A, Bv, C = (u - hw, vf), (u, vf + side * depth), (u + hw, vf)
    for p, q in ((A, Bv), (Bv, C)):
        mid = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        oface(P, [f.P3(p[0], y0, p[1]), f.P3(q[0], y0, q[1]), f.P3(q[0], y1, q[1]), f.P3(p[0], y1, p[1])], col,
              f.dir(mid[0] - u, mid[1] - (vf - side)))
    oface(P, [f.P3(*_uyv(A, y1)), f.P3(*_uyv(Bv, y1)), f.P3(*_uyv(C, y1))], col, (0, 1, 0))
    oface(P, [f.P3(*_uyv(A, y0)), f.P3(*_uyv(Bv, y0)), f.P3(*_uyv(C, y0))], col, (0, -1, 0))


def _uyv(p, y): return (p[0], y, p[1])


def onion(P, x, y0, z, r, col, gold=0xe2b23a, n=8, ry=0.0, cross=True):
    """Onion dome (Moldovan/Russian style) with a gold cross; returns the top height."""
    prof = [(0.62 * r, 0), (1.0 * r, 0.42 * r), (1.08 * r, 0.75 * r), (0.86 * r, 1.12 * r), (0.42 * r, 1.48 * r), (0.12 * r, 1.74 * r), (0, 1.95 * r)]
    P.lathe(prof, n=n, at=(x, y0, z), col=col)
    top = y0 + 1.95 * r
    if cross:
        P.cyl(0.16 * r, 0.05, 0.35 * r, n=6, at=(x, top + 0.12 * r, z), col=gold)
        P.box(0.18, 2.2, 0.18, at=(x, top + 1.25, z), ry=ry, col=gold)
        P.box(1.2, 0.18, 0.18, at=(x, top + 1.65, z), ry=ry, col=gold)
        P.box(0.8, 0.16, 0.16, at=(x, top + 0.9, z), ry=ry, rz=0.35, col=gold)
    return top


# ------------------------------------------------------------------ block letters (signage)
FONT = {
    'A': ['###', '#.#', '###', '#.#', '#.#'], 'B': ['##.', '#.#', '###', '#.#', '###'], 'C': ['###', '#..', '#..', '#..', '###'],
    'E': ['###', '#..', '###', '#..', '###'], 'H': ['#.#', '#.#', '###', '#.#', '#.#'], 'I': ['#', '#', '#', '#', '#'],
    'L': ['#..', '#..', '#..', '#..', '###'], 'M': ['#...#', '##.##', '#.#.#', '#...#', '#...#'], 'N': ['#..#', '##.#', '#.##', '#..#', '#..#'],
    'O': ['###', '#.#', '#.#', '#.#', '###'], 'P': ['###', '#.#', '###', '#..', '#..'], 'R': ['###', '#.#', '##.', '#.#', '#.#'],
    'S': ['###', '#..', '###', '..#', '###'], 'T': ['###', '.#.', '.#.', '.#.', '.#.'], 'U': ['#.#', '#.#', '#.#', '#.#', '###'],
    'Z': ['###', '..#', '.#.', '#..', '###'], 'G': ['###', '#..', '#.#', '#.#', '###'], 'D': ['##.', '#.#', '#.#', '#.#', '##.'],
    '-': ['...', '...', '###', '...', '...'],
}


def _rects(g):
    """Greedy rectangle cover of a glyph: (col, row, w, h), row 0 = top."""
    H, W = len(g), len(g[0]); used = [[False] * W for _ in range(H)]; out = []
    for j in range(H):
        for i in range(W):
            if g[j][i] != '#' or used[j][i]: continue
            w = 1
            while i + w < W and g[j][i + w] == '#' and not used[j][i + w]: w += 1
            h = 1
            while j + h < H and all(g[j + h][i + k] == '#' and not used[j + h][i + k] for k in range(w)): h += 1
            for jj in range(j, j + h):
                for ii in range(i, i + w): used[jj][ii] = True
            out.append((i, j, w, h))
    return out


# ------------------------------------------------------------------ painted materials (PS2 look)
# Each landmark is one object with a few procedural "paint" materials; finish() gives every face a facade texture space
# (UV layer 'fac': u = metres along the wall, v = height in metres; flat faces get x / z+5000), lp.bake() bakes the paint ×
# AO into one atlas per landmark, then 'fac' is dropped. Windows, floor lines, joints, stripes, seat rows, weathering and
# base darkening are node math on 'fac'; lettering and one-off facades are numpy-painted images mapped onto quads.
MATPX = {}    # material → window pitch along u: each wall face centres its window grid
FRAMES = {}   # material → f(local game point) → (u, v): explicit texture frame (the pitch markings)
IMGS = {}     # material → its Mapping node, fitted to the faces' 'fac' bounds (images on quads)


def _mul(col, k): return (min(255, int(((col >> 16) & 255) * k)) << 16) | (min(255, int(((col >> 8) & 255) * k)) << 8) | min(255, int((col & 255) * k))


def _hex(col): return [((col >> s) & 255) / 255 for s in (16, 8, 0)]


class NB:
    """Tiny node-tree builder: math on the 'fac' coordinates → Base Color."""

    def __init__(s, name):
        m = bpy.data.materials.new(name); m.use_nodes = True; s.mat = m
        nt = m.node_tree; s.N, s.L = nt.nodes, nt.links
        s.bsdf = next(n for n in s.N if n.type == 'BSDF_PRINCIPLED'); s.bsdf.inputs['Roughness'].default_value = 1.0
        uv = s.N.new('ShaderNodeUVMap'); uv.uv_map = 'fac'; s.uvs = uv.outputs[0]
        sp = s.N.new('ShaderNodeSeparateXYZ'); s.L.new(uv.outputs[0], sp.inputs[0]); s.u, s.v = sp.outputs[0], sp.outputs[1]
        s.obj = s.N.new('ShaderNodeTexCoord').outputs['Object']

    def _in(s, sock, x):
        if isinstance(x, bpy.types.NodeSocket): s.L.new(x, sock)
        elif sock.type == 'RGBA': sock.default_value = (x, x, x, 1) if isinstance(x, float) else (*_hex(x), 1)
        else: sock.default_value = x

    def m(s, op, a, b=0.0, c=0.0):
        n = s.N.new('ShaderNodeMath'); n.operation = op
        s._in(n.inputs[0], a); s._in(n.inputs[1], b); s._in(n.inputs[2], c)
        return n.outputs[0]

    def rgb(s, col): n = s.N.new('ShaderNodeRGB'); n.outputs[0].default_value = (*_hex(col), 1); return n.outputs[0]

    def mix(s, fac, a, b, blend='MIX'):
        n = s.N.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = blend; n.clamp_factor = True
        s._in(next(i for i in n.inputs if i.name == 'Factor' and i.type == 'VALUE'), fac)
        s._in(next(i for i in n.inputs if i.name == 'A' and i.type == 'RGBA'), a)
        s._in(next(i for i in n.inputs if i.name == 'B' and i.type == 'RGBA'), b)
        return next(o for o in n.outputs if o.type == 'RGBA')

    def shade(s, c, k): return s.mix(1.0, c, k, 'MULTIPLY')

    def vec(s, x, y, z=0.0):
        n = s.N.new('ShaderNodeCombineXYZ'); s._in(n.inputs[0], x); s._in(n.inputs[1], y); s._in(n.inputs[2], z); return n.outputs[0]

    def noise(s, vec, scale, detail=3.0):
        n = s.N.new('ShaderNodeTexNoise'); s._in(n.inputs['Vector'], vec)
        n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; return n.outputs['Fac']

    def white(s, vec):
        n = s.N.new('ShaderNodeTexWhiteNoise'); n.noise_dimensions = '3D'; s._in(n.inputs['Vector'], vec); return n.outputs['Value']

    def ramp(s, x, a, b, lo=0.0, hi=1.0):
        n = s.N.new('ShaderNodeMapRange'); s._in(n.inputs['Value'], x)
        n.inputs['From Min'].default_value = a; n.inputs['From Max'].default_value = b
        n.inputs['To Min'].default_value = lo; n.inputs['To Max'].default_value = hi
        return n.outputs['Result']

    def lt(s, a, b): return s.m('LESS_THAN', a, b)
    def gt(s, a, b): return s.m('GREATER_THAN', a, b)
    def mul(s, a, b): return s.m('MULTIPLY', a, b)
    def between(s, x, a, b): return s.mul(s.gt(x, a), s.lt(x, b))
    def fr(s, x, p, o=0.0): return s.m('FRACT', s.m('DIVIDE', s.m('SUBTRACT', x, o), p))

    def lines(s, x, p, w):
        """1 on thin lines of width w every p (metres) along x."""
        return s.lt(s.fr(x, p), w / p)

    def out(s, c):
        s.L.new(c, s.bsdf.inputs['Base Color']); return s.mat


def paint(name, wall, mott=0.10, streak=0.25, base=0.35, wins=(), stripes=None, bands=(), socle=None, rust=None, joints=None,
          ribs=None, rows=None, scales=None, graffiti=False, glass=0x2c3742, glass2=0x56687a, frame=None):
    """Procedural facade paint. wall = base colour. wins = [dict(px, pw, fl, sill, wh, y0, y1, arch, frame, glass, glass2,
    board=(col, share))]: window grids (px pitch along the wall, fl floor height, sill/wh in metres within the floor,
    y0..y1 height band). stripes=(period, col2, share[, y0, y1]) horizontal bands; bands=[(y0, y1, col)]; socle=(h, col)
    stone base; rust=(y0, y1, col, period) rusticated band; joints=(pu, pv, width, strength) panel joints / tile grid;
    ribs=(pu, width, strength) lines along v only; rows=(period, col2, every) stadium seat rows; scales=edge colour (dome
    scales / roof tiles); streak = vertical weathering streaks; base = darkening towards the ground."""
    s = NB(name)
    n = s.noise(s.obj, 0.35)
    def mot(col): return s.mix(s.ramp(n, .3, .7), s.rgb(_mul(col, 1 - mott)), s.rgb(col))
    c = mot(wall)
    if stripes:
        m = s.lt(s.fr(s.v, stripes[0]), stripes[2])
        if len(stripes) > 3: m = s.mul(m, s.between(s.v, stripes[3], stripes[4]))
        c = s.mix(m, c, mot(stripes[1]))
    for y0, y1, c2 in bands: c = s.mix(s.between(s.v, y0, y1), c, mot(c2))
    if rust:
        y0, y1, c2, p = rust; m = s.between(s.v, y0, y1)
        r = s.shade(mot(c2), s.m('SUBTRACT', 1.0, s.mul(s.lines(s.m('SUBTRACT', s.v, y0), p, 0.07), 0.45)))
        c = s.mix(m, c, r)
    if socle:
        h, c2 = socle; k = s.m('FLOOR', s.m('DIVIDE', s.v, 0.6))
        j = s.m('MAXIMUM', s.lines(s.v, 0.6, 0.05), s.lines(s.m('ADD', s.u, s.mul(k, 0.6)), 1.2, 0.05))
        st = s.shade(mot(c2), s.m('SUBTRACT', 1.0, s.mul(j, 0.4)))
        c = s.mix(s.lt(s.v, h), c, st)
    if scales is not None:
        br = s.N.new('ShaderNodeTexBrick'); s._in(br.inputs['Vector'], s.vec(s.u, s.v)); br.offset = 0.5
        br.inputs['Scale'].default_value = 1.0; br.inputs['Brick Width'].default_value = 0.5; br.inputs['Row Height'].default_value = 0.32
        br.inputs['Mortar Size'].default_value = 0.035; br.inputs['Mortar Smooth'].default_value = 0.6
        br.inputs['Color1'].default_value = (*_hex(wall), 1); br.inputs['Color2'].default_value = (*_hex(_mul(wall, .86)), 1)
        br.inputs['Mortar'].default_value = (*_hex(scales), 1)
        c = s.mix(0.85, c, br.outputs['Color'])
    if rows:
        p, c2, ev = rows; k = s.m('FLOOR', s.m('DIVIDE', s.v, p))
        c = s.mix(s.lt(s.m('FRACT', s.m('DIVIDE', k, ev)), 0.5 / ev), c, mot(c2))
        c = s.shade(c, s.m('SUBTRACT', 1.0, s.mul(s.lt(s.fr(s.v, p), 0.25), 0.4)))
    if joints:
        pu, pv, w, k = joints
        j = s.m('MAXIMUM', s.lines(s.u, pu, w), s.lines(s.v, pv, w))
        c = s.shade(c, s.m('SUBTRACT', 1.0, s.mul(j, k)))
    if ribs:
        pu, w, k = ribs; c = s.shade(c, s.m('SUBTRACT', 1.0, s.mul(s.lines(s.u, pu, w), k)))
    if graffiti:
        cr = s.N.new('ShaderNodeValToRGB'); cr.color_ramp.interpolation = 'CONSTANT'
        E = cr.color_ramp.elements; E[0].position = 0; E[0].color = (*_hex(0xc8508a), 1); E[1].position = .33; E[1].color = (*_hex(0x3fa6bd), 1)
        e = E.new(.66); e.color = (*_hex(0xd4b440), 1)
        s.L.new(s.white(s.vec(s.m('FLOOR', s.m('DIVIDE', s.u, 3.0)), 0.0)), cr.inputs['Fac'])
        m = s.mul(s.between(s.v, 0.3, 2.3), s.gt(s.noise(s.obj, 0.9, 2.0), 0.56))
        c = s.mix(m, c, cr.outputs['Color'])
    for W in wins: c = _windows(s, c, W, glass, glass2, frame)
    if streak:
        st = s.ramp(s.noise(s.vec(s.mul(s.u, 0.6), s.mul(s.v, 0.045)), 1.0, 2.0), .48, .78)
        c = s.shade(c, s.m('SUBTRACT', 1.0, s.mul(st, streak)))
    if base: c = s.shade(c, s.ramp(s.v, 0.0, 2.6, 1 - base, 1.0))
    if wins: MATPX[s.mat.name] = wins[0]['px']
    return s.out(c)


def _windows(s, c, W, glass, glass2, frame):
    px = W['px']; pw = W.get('pw', px * .5); fl = W.get('fl', 3.0); sill = W.get('sill', .9); wh = W.get('wh', 1.6)
    y0 = W.get('y0', 0.0); y1 = W.get('y1', 1e4); arch = W.get('arch', False); fw = W.get('fw', .15)
    U = s.fr(s.u, px); V = s.mul(s.fr(s.v, fl, y0), fl)
    du = s.m('ABSOLUTE', s.mul(s.m('SUBTRACT', U, 0.5), px))
    band = s.between(s.v, y0, y1)
    def mask(e):
        hw = pw / 2 + e; top = sill + wh + e
        if arch:
            rect = s.mul(s.lt(du, hw), s.between(V, sill - e, top - hw))
            dy = s.m('SUBTRACT', V, top - hw)
            circ = s.mul(s.lt(s.m('ADD', s.mul(du, du), s.mul(dy, dy)), hw * hw), s.gt(dy, 0.0))
            return s.mul(s.m('MAXIMUM', rect, circ), band)
        return s.mul(s.mul(s.lt(du, hw), s.between(V, sill - e, top)), band)
    fc = W.get('frame', frame)
    if fc is not None: c = s.mix(mask(fw), c, s.rgb(fc))
    r = s.white(s.vec(s.m('FLOOR', s.m('DIVIDE', s.u, px)), s.m('FLOOR', s.m('DIVIDE', s.m('SUBTRACT', s.v, y0), fl)), 0.37))
    g = s.mix(r, s.rgb(W.get('glass', glass)), s.rgb(W.get('glass2', glass2)))
    g = s.shade(g, s.ramp(V, sill, sill + wh, 0.82, 1.15))                     # sky reflection towards the top
    if W.get('mullion'):
        g = s.shade(g, s.m('SUBTRACT', 1.0, s.mul(s.lines(s.m('ADD', du, W['mullion'] / 2), W['mullion'], 0.09), 0.55)))
    b = W.get('board')
    if b: g = s.mix(s.gt(r, 1 - b[1]), g, s.rgb(b[0]))
    return s.mix(mask(0.0), c, g)


def plain(name, col, mott=0.12, streak=0.0, base=0.0, **kw): return paint(name, col, mott=mott, streak=streak, base=base, **kw)


class Canvas:
    """numpy painting in metres (x right, y up from the bottom), for lettering and one-off facades."""

    def __init__(s, wm, hm, bg, ppm=10):
        s.k = ppm; s.wm, s.hm = wm, hm; s.W, s.H = max(4, int(round(wm * ppm))), max(4, int(round(hm * ppm)))
        s.a = np.empty((s.H, s.W, 3), np.float32); s.a[:] = _hex(bg)
        yy, xx = np.mgrid[0:s.H, 0:s.W]; s.X = (xx + .5) / s.k; s.Y = s.hm - (yy + .5) / s.k

    def rect(s, x0, y0, x1, y1, col): s.a[(s.X >= x0) & (s.X < x1) & (s.Y >= y0) & (s.Y < y1)] = _hex(col)

    def disc(s, cx, cy, r, col, ymin=-1e9): s.a[((s.X - cx) ** 2 + (s.Y - cy) ** 2 < r * r) & (s.Y >= ymin)] = _hex(col)

    def ring(s, cx, cy, r0, r1, col):
        d = (s.X - cx) ** 2 + (s.Y - cy) ** 2; s.a[(d < r1 * r1) & (d >= r0 * r0)] = _hex(col)

    def arch(s, cx, y0, w, h, col): s.rect(cx - w / 2, y0, cx + w / 2, y0 + h - w / 2, col); s.disc(cx, y0 + h - w / 2, w / 2, col, ymin=y0 + h - w / 2)

    def text(s, txt, cx, y0, cell, col):
        ws = [len(FONT[c][0]) if c in FONT else 2 for c in txt]; Wd = sum(ws) + len(txt) - 1; x = cx - Wd * cell / 2
        for ch, w in zip(txt, ws):
            if ch in FONT:
                for i, j, wi, hj in _rects(FONT[ch]): s.rect(x + i * cell, y0 + (5 - j - hj) * cell, x + (i + wi) * cell, y0 + (5 - j) * cell, col)
            x += (w + 1) * cell

    def grain(s, k=0.06, seed=1): s.a *= 1 - k * np.random.RandomState(seed).rand(s.H, s.W, 1).astype(np.float32)

    def image(s, name):
        img = bpy.data.images.new(name, s.W, s.H, alpha=False); img.colorspace_settings.name = 'Non-Color'
        px = np.ones((s.H, s.W, 4), np.float32); px[..., :3] = s.a[::-1]; img.pixels.foreach_set(px.ravel()); img.update(); img.pack()
        return img


def text_cells(txt): return sum(len(FONT[c][0]) if c in FONT else 2 for c in txt) + len(txt) - 1


def img_mat(name, cv):
    s = NB(name)
    mp = s.N.new('ShaderNodeMapping'); mp.vector_type = 'POINT'; s.L.new(s.uvs, mp.inputs['Vector'])
    t = s.N.new('ShaderNodeTexImage'); t.image = cv.image(name + '_src'); t.extension = 'EXTEND'; s.L.new(mp.outputs[0], t.inputs['Vector'])
    IMGS[s.mat.name] = mp
    return s.out(t.outputs['Color'])


def sign(P, f, name, txt, fg, bg, uc, v, y0, h, sides=(1,), back=None, depth=0.3, pad=0.8):
    """Lettered board: text painted on quads facing +v / -v (sides), optional backing box of colour `back`."""
    cells = text_cells(txt); wc, hc = cells + 2 * pad, 5 + 2 * pad
    cv = Canvas(wc, hc, bg, ppm=8); cv.text(txt, wc / 2, pad, 1.0, fg); cv.grain(0.05)
    m = img_mat(name, cv); w = h * wc / hc
    if back is not None: f.box(P, uc, v, y0, w + 0.2, h + 0.2, depth, back)
    for sd in sides: f.quad(P, uc - w / 2 * sd, uc + w / 2 * sd, v, y0 + 0.1 * (back is not None), y0 + h + 0.1 * (back is not None), m, side=sd, out=depth / 2 + 0.03 if back is not None else 0.04)
    return w


def fac_uv(o):
    """UVMap (for the bake) + 'fac' facade coordinates per face; fits image materials to their faces."""
    me = o.data
    for l in list(me.uv_layers): me.uv_layers.remove(l)
    a = me.uv_layers.new(name='UVMap'); fu = me.uv_layers.new(name='fac')
    me.uv_layers.active = a; a.active_render = True
    V = me.vertices; bounds = {}
    for p in me.polygons:
        mt = me.materials[p.material_index]; nm = mt.name if mt else ''
        n = p.normal; nx, ny, nz = n.x, n.z, -n.y
        pts = [(V[i].co.x, V[i].co.z, -V[i].co.y) for i in p.vertices]
        fr = FRAMES.get(nm)
        if fr: uv = [fr(q) for q in pts]
        elif abs(ny) > 0.97: uv = [(q[0], q[2] + 5000.0) for q in pts]
        else:
            h = math.hypot(nx, nz); tx, tz = nz / h, -nx / h
            us = [q[0] * tx + q[2] * tz for q in pts]; u0 = min(us); wd = max(us) - u0
            px = MATPX.get(nm); off = (wd % px) / 2 if px else 0.0
            uv = [(uu - u0 - off, q[1]) for uu, q in zip(us, pts)]
        for li, t in zip(p.loop_indices, uv): fu.data[li].uv = t
        if nm in IMGS:
            b = bounds.setdefault(nm, [1e9, 1e9, -1e9, -1e9])
            for t in uv: b[0] = min(b[0], t[0]); b[1] = min(b[1], t[1]); b[2] = max(b[2], t[0]); b[3] = max(b[3], t[1])
    for nm, b in bounds.items():
        mp = IMGS[nm]; W = max(1e-3, b[2] - b[0]); H = max(1e-3, b[3] - b[1])
        mp.inputs['Scale'].default_value = (1 / W, 1 / H, 1); mp.inputs['Location'].default_value = (-b[0] / W, -b[1] / H, 0)


# ------------------------------------------------------------------ lookup / output helpers
def bld(x, z, r=10):
    b = lp.footprint(x, z, r)
    if b is None: raise RuntimeError('no building footprint near (%.1f, %.1f)' % (x, z))
    return b


def _rr(r): return [[round(p[0], 1), round(p[1], 1)] for p in r]


def finish(key, P, x, z, fp, h, skip, clear=(), tex=512, ao=0.7):
    lm = {'x': round(x, 2), 'z': round(z, 2), 'fp': [_rr(r) for r in fp], 'h': h, 'skip': [[round(c[0], 2), round(c[1], 2)] for c in skip]}
    if clear: lm['clear'] = [_rr(r) for r in clear]  # tree-free, walkable areas
    o = P.obj(key, props={'lm': lm}, origin=(x, 0, z))
    fac_uv(o)
    lp.bake([o], size=tex, name=key + '_tex', ao=ao)
    fu = o.data.uv_layers.get('fac')
    if fu: o.data.uv_layers.remove(fu)
    me = o.data                                   # every material now shows the same baked image: keep one
    for poly in me.polygons: poly.material_index = 0
    while len(me.materials) > 1: me.materials.pop(index=len(me.materials) - 1)
    me.materials[0].name = key
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print('landmark %-14s tris %5d  tex %4d  at (%.1f, %.1f)' % (key, tris, tex, x, z))
    return o


def square(cx, cz, hw, a=0.0):
    f = F(cx, cz, a); return [f.p(-hw, -hw), f.p(hw, -hw), f.p(hw, hw), f.p(-hw, hw)]


def circle(cx, cz, r, n=12): return [(cx + r * math.cos(i * 2 * PI / n), cz + r * math.sin(i * 2 * PI / n)) for i in range(n)]


GOLD = 0xd6aa48



# ================================================================== landmarks
def cosmos():
    """Hotel Cosmos (1974-83): 19-floor slab on Piața Negruzzi, long faces covered in angular glazed 'cabin' bay windows,
    blank white panel end walls, red COSMOS letters on the roof."""
    b = bld(1562.0, 1137.1); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    H0, FL, N = 6.0, 2.75, 18; H = H0 + N * FL
    roof = plain('cos_roof', 0x6f7174, joints=(4.0, 4.0, .06, .25))
    lobby = paint('cos_lobby', 0x59626a, base=.35, streak=.1, frame=0xa9adb0,
                  wins=[dict(px=3.0, pw=2.6, fl=6.0, sill=0.35, wh=4.2, y0=0.0, y1=6.0, glass=0x26313b, glass2=0x445566, mullion=1.3)])
    endw = paint('cos_end', 0xd9d6cc, streak=.35, base=.1, joints=(3.0, FL, .05, .22))
    bay = paint('cos_bay', 0xdedbd2, streak=.3, base=0, frame=0xc9c6be,
                wins=[dict(px=2.0, pw=1.55, fl=FL, sill=0.62, wh=1.68, y0=H0, y1=H, glass=0x2f3b49, glass2=0x5a6e83)])
    f.box(P, 0, 0, -2.5, L - 1.5, H0 + 2.5, W - 3.0, lobby, top=roof)
    f.box(P, 0, 0, H0 - 0.9, L + 0.4, 0.9, W + 0.4, endw, top=roof)                    # canopy band
    f.box(P, 0, 0, H0, L - 2, N * FL, W - 3.6, bay, top=roof)
    for su in (-1, 1): f.box(P, su * (L / 2 - 1.6), 0, H0, 3.2, N * FL + 1.0, W - 0.8, endw, top=roof)
    n = int((L - 7) // 3.3)
    for sv in (-1, 1):
        for i in range(n): vbay(P, f, -(n - 1) * 3.3 / 2 + i * 3.3, sv * (W / 2 - 1.8), sv, H0, H, 1.45, 1.4, bay)
    f.box(P, 0, 0, H, L - 1.0, 1.0, W - 1.2, endw, top=roof)
    f.box(P, L * 0.37, 0, H + 1, 8, 3.5, 7, endw, top=roof)                            # machine room
    y = H + 1.0
    for su in (-1, 1): f.box(P, su * 9, 0, y, 0.5, 6.5, 0.5, 0x5d6064)
    sign(P, f, 'cos_sign', 'COSMOS', 0xf0402f, 0x2c2e31, 0, 0, y + 1.0, 5.4, sides=(1, -1), back=0x2c2e31, depth=0.3)
    return finish('cosmos', P, cx, cz, [r], H + 2, [b['c']], tex=512)


def _reach(r, cx, cz, th):
    """Farthest crossing of the ray from (cx, cz) at angle th with ring r (to put a flat sign on a curved wall)."""
    dx, dz = math.cos(th), math.sin(th); best = 0.0
    for i in range(len(r)):
        (ax, az), (bx, bz) = r[i], r[(i + 1) % len(r)]; ex, ez = bx - ax, bz - az
        den = dx * ez - dz * ex
        if abs(den) < 1e-9: continue
        t = ((ax - cx) * ez - (az - cz) * ex) / den; s = ((ax - cx) * dz - (az - cz) * dx) / den
        if t > 0 and 0 <= s <= 1: best = max(best, t)
    return best


def _wall_sign(P, key, txt, fg, bg, r, cx, cz, th, y0, h):
    """Sign on the outer wall of ring r in the direction th (radians, x/z) from (cx, cz), facing outward."""
    f = F(cx, cz, th - PI / 2); sign(P, f, key, txt, fg, bg, 0, _reach(r, cx, cz, th) + 0.2, y0, h, sides=(1,), back=bg, depth=0.3)


def _edge_sign(P, key, txt, fg, bg, r, th, y0, h):
    """Sign centred on the ring edge that best faces direction th (length-weighted), flat on that wall."""
    best = None
    for i in range(len(r)):
        a, b = r[i], r[(i + 1) % len(r)]; L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 1e-6: continue
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); nx, nz = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
        if _inside((m[0] + nx * 0.3, m[1] + nz * 0.3), r): nx, nz = -nx, -nz
        sc = L * (nx * math.cos(th) + nz * math.sin(th))
        if best is None or sc > best[0]: best = (sc, m, math.atan2(nz, nx), L)
    _, m, nth, L = best
    h = min(h, 0.85 * L * 6.6 / (text_cells(txt) + 1.6))                            # fit the board on the wall
    sign(P, F(m[0], m[1], nth - PI / 2), key, txt, fg, bg, 0, 0.2, y0, h, sides=(1,), back=bg, depth=0.3)


def atrium():
    """Atrium (Str. Albișoara): round white shopping podium by the Negruzzi roundabout, glass shopfronts, a ribbon of
    windows under the roof and the green 'pixel' tiles on its curved front, ATRIUM / HI-TECH signs, a white umbrella
    roof over the atrium. The tower is atriumtower()."""
    b = bld(1767.0, 1077.0); r = b['ring']; cx, cz = _cen(r); P = lp.Part(); H = 18.0
    wall = paint('atr_wall', 0xeeeeea, streak=.15, base=.3, frame=0xd9dcdc,
                 wins=[dict(px=3.0, pw=2.8, fl=40, sill=0.3, wh=4.2, y0=0, y1=5, glass=0x2b3640, glass2=0x4f6273, mullion=1.0),
                       dict(px=2.0, pw=1.85, fl=40, sill=13.4, wh=2.5, y0=0, y1=16, glass=0x33414e, glass2=0x7e93a6),
                       dict(px=1.5, pw=0.45, fl=2.2, sill=0.2, wh=1.8, y0=6.0, y1=12.6, glass=0x2f8a5b, glass2=0x8cc8a0,
                            board=(0xeeeeea, .6))])
    roof = plain('atr_roof', 0x8e8a88, joints=(4, 4, .05, .2))
    P.extrude(r, -2.5, H, col=wall, top=roof)
    P.extrude(r, H, H + 1.0, col=0xe4e4e0, inset=1.0)                                  # parapet
    f = F(1768.0, 1095.0)
    f.cyl(P, 0, 0, H, 12, 12, 3.0, n=12, col=0xd8dadb, top=roof)                         # atrium drum
    f.cyl(P, 0, 0, H + 3.0, 8, 0.6, 3.5, n=8, col=0xf4f4f2)                             # white umbrella
    _wall_sign(P, 'atr_sign', 'ATRIUM', 0x2e9a4c, 0xf3f3f0, r, cx, cz, math.radians(70), 8.0, 3.2)
    _wall_sign(P, 'atr_hitech', 'HI-TECH', 0xffffff, 0xd2232a, r, cx, cz, math.radians(165), 8.5, 2.6)
    return finish('atrium', P, cx, cz, [r], H + 1, [b['c']], tex=1024)


def atriumtower():
    """Atrium tower: white shaft with dark vertical glass ribbons between two blank white pylons that rise past a set-back
    glass crown, with slot windows at the top; stands on the low annex north of the round mall (the data has 1 floor)."""
    b = bld(1740.0, 1005.0); r = b['ring']; cx, cz = _cen(r); P = lp.Part()
    f = F(1748.0, 1012.0, math.radians(40)); L, W, PW = 44.0, 20.0, 12.0; H0, H1, HC, HP = 15.0, 70.0, 84.0, 94.0
    roof = plain('atw_roof', 0x8a8886, joints=(4, 4, .05, .2))
    pod = paint('atw_pod', 0xecece8, streak=.2, base=.3, frame=0xd9dcdc,
                wins=[dict(px=3.0, pw=2.8, fl=40, sill=0.3, wh=4.2, y0=0, y1=5, glass=0x2b3640, glass2=0x4f6273, mullion=1.0),
                      dict(px=2.0, pw=1.85, fl=4.5, sill=0.8, wh=2.6, y0=5.5, y1=14, glass=0x33414e, glass2=0x7e93a6)])
    shaft = paint('atw_shaft', 0xf0f0ec, streak=.2, base=0, frame=0xdadcdc,
                  wins=[dict(px=1.7, pw=0.95, fl=H1 - H0, sill=0.0, wh=H1 - H0 - 0.6, y0=H0, y1=H1, glass=0x262c33, glass2=0x4b545e)])
    pylon = paint('atw_pylon', 0xf2f2ef, streak=.25, base=0, joints=(3.0, 3.0, .03, .12),
                  wins=[dict(px=2.6, pw=1.1, fl=HP + 1, sill=HP - 13, wh=9.0, y0=0, y1=HP, glass=0x2a2f36, glass2=0x3c444c)])
    crown = paint('atw_crown', 0xcfd6dc, streak=0, base=0, frame=0xd5dade,
                  wins=[dict(px=2.2, pw=2.05, fl=3.4, sill=0.2, wh=3.1, y0=H1, y1=HC, glass=0x4d7394, glass2=0x9ab9d2)])
    P.extrude(r, -2.5, H0, col=pod, top=roof)
    f.box(P, 0, 0, H0, L - 2 * PW, H1 - H0, W - 3, shaft, top=roof)
    f.box(P, 0, 0, H1, L - 2 * PW + 0.4, 2.2, W - 2.4, 0x2a2d31, top=roof)              # dark belt under the crown
    f.box(P, 0, 0, H1 + 2.2, L - 2 * PW, HC - H1 - 2.2, W - 6, crown, top=roof)         # set-back glass crown
    for su in (-1, 1): f.box(P, su * (L - PW) / 2, 0, H0 - 1, PW, HP - H0 + 1, W, pylon, top=roof)
    for sv in (-1, 1): sign(P, f, 'atw_sign' + str(sv), 'ATRIUM', 0x2e9a4c, 0xf3f3f0, 0, sv * (W / 2 - 1.5), H0 + 1.0, 2.6, sides=(sv,), back=0xf3f3f0, depth=0.3)
    return finish('atriumtower', P, cx, cz, [r], HP, [b['c']], tex=1024)


def grandhall():
    """Grand Hall (Piața Negruzzi, beside Hotel Cosmos): three-floor mall, glass shopfronts under a deep navy-blue
    cladding band with white GRAND HALL lettering."""
    b = bld(1626.0, 1077.0); r = b['ring']; cx, cz = _cen(r); P = lp.Part(); H = 14.0
    wall = paint('gh_wall', 0xe6e6e2, streak=.2, base=.3, frame=0xc9ccd0, bands=[(5.2, H + 1, 0x24345e)],
                 joints=(2.4, 1.6, .03, .15),
                 wins=[dict(px=3.2, pw=3.0, fl=40, sill=0.3, wh=4.3, y0=0, y1=5, glass=0x2b3640, glass2=0x4f6273, mullion=1.05)])
    roof = plain('gh_roof', 0x7d7c7a, joints=(4, 4, .05, .2))
    P.extrude(r, -2.5, H, col=wall, top=roof)
    for th in (0.0, PI / 2): _edge_sign(P, 'gh_sign%d' % round(th * 10), 'GRAND HALL', 0xffffff, 0x24345e, r, th, 7.6, 3.4)
    return finish('grandhall', P, cx, cz, [r], H, [b['c']], tex=512)


def build():
    out = []
    for fn in BUILD: out.append(fn())
    return out




def national():
    """Ruins of Hotel Național (1978): abandoned 16-floor concrete slab on Ștefan cel Mare, bare floor slabs over empty
    black window voids, a few boarded bays, stained end walls, graffiti on the podium, broken roof."""
    b = bld(1234, 1102); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    TL, TW, H0, FL, N = L - 4, W - 9, 7.0, 3.0, 14; H = H0 + N * FL
    roof = plain('nat_roof', 0x55534e, mott=.25, joints=(5, 5, .06, .2))
    pod = paint('nat_pod', 0x8a867d, streak=.6, base=.5, graffiti=True,
                wins=[dict(px=4.4, pw=3.4, fl=3.4, sill=0.8, wh=2.4, y0=0.0, y1=7.2, glass=0x18181a, glass2=0x2a2927, board=(0x6d695f, .3))])
    tw = paint('nat_tw', 0x9a968b, streak=.65, base=0, mott=.16,
               wins=[dict(px=3.1, pw=2.5, fl=FL, sill=0.62, wh=2.38, y0=H0, y1=H - 0.3, glass=0x121214, glass2=0x262626, board=(0x77736a, .12))])
    endw = paint('nat_end', 0x8d897f, streak=.75, base=0, mott=.18, joints=(3.0, 3.0, .05, .3))
    rust = plain('nat_rust', 0x5e4636, mott=.3)
    P.extrude(r, -2.5, 7, col=pod, top=roof)
    f.box(P, 0, 0, H0, TL - 1.0, N * FL, TW - 1.0, tw, top=roof)
    for su in (-1, 1): f.box(P, su * (TL / 2 - 1.3), 0, H0, 2.6, N * FL - (2.2 if su > 0 else 0) + 0.6, TW - 0.6, endw, top=roof)
    f.box(P, -TL * 0.12, 0, H, TL * 0.72, 0.5, TW, endw, top=roof)                  # last slab, partly gone
    f.box(P, -TL * 0.25, 0, H + 0.5, 8, 3.2, 6, endw, top=roof)                       # broken roof structure
    rnd = random.Random('national')
    for k in range(6): f.box(P, -TL * 0.25 + 5 + k * 1.7, rnd.uniform(-3, 3), H + 0.5, 0.25, rnd.uniform(1, 3), 0.25, rust)
    return finish('national', P, cx, cz, [r], H, [b['c']], tex=512)


def romanita():
    """Romanița (1986): 22-floor cylindrical tower, white ribs and floor lines over dark glazing, crowned by a ring of
    tall pointed pylons."""
    b = bld(365.8, 3756.5); r = b['ring']
    xs, zs = [p[0] for p in r], [p[1] for p in r]; cx, cz = (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2
    R = (max(xs) - min(xs) + max(zs) - min(zs)) / 4
    P = lp.Part(); N, FL, H0 = 22, 3.0, 4.0; H = H0 + N * FL; n = 16
    fw = 2 * (R - 0.6) * math.sin(PI / n)
    roof = plain('rom_roof', 0x6c6f73, joints=(3, 3, .05, .2))
    fac = paint('rom_fac', 0xe6e3db, streak=.3, base=0, frame=0xf2f0ea,
                wins=[dict(px=fw, pw=fw * 0.64, fl=FL, sill=0.75, wh=1.75, y0=H0, y1=H, glass=0x2f3b49, glass2=0x5b6e82)])
    lob = paint('rom_lob', 0x6a7178, base=.3, streak=0, frame=0xb5b8bb,
                wins=[dict(px=fw, pw=fw * 0.85, fl=5, sill=0.3, wh=3.4, y0=0, y1=4, glass=0x27313b, glass2=0x46576a, mullion=1.2)])
    con = paint('rom_con', 0xe2dfd7, streak=.35, base=0, mott=.12)
    P.cyl(R - 1.4, R - 1.4, H0 + 2.5, n=n, at=(cx, (H0 - 2.5) / 2, cz), col=lob, top=roof)
    P.cyl(R + 2.4, R + 2.4, 0.5, n=n, at=(cx, H0 - 0.55, cz), col=con, top=roof)        # entrance canopy ring
    P.cyl(R - 0.6, R - 0.6, N * FL, n=n, at=(cx, H0 + N * FL / 2, cz), col=fac, top=roof)
    P.cyl(R - 0.3, R - 0.3, 0.9, n=n, at=(cx, H + 0.45, cz), col=con, top=roof)        # parapet
    P.cyl(5.5, 5.5, 5, n=12, at=(cx, H + 3.4, cz), col=con, top=roof)                 # core / machine room
    for i in range(12):                                                                # the crown
        t = i * 2 * PI / 12; x, z = cx + (R - 1.6) * math.cos(t), cz - (R - 1.6) * math.sin(t)
        P.box(1.3, 9, 1.3, at=(x, H + 0.9 + 4.5, z), ry=PI / 2 + t, col=con)
        P.cyl(0.92, 0, 3.2, n=4, at=(x, H + 0.9 + 9 + 1.6, z), col=con, a0=PI / 4)
    for rr in (R - 1.0, R - 2.2):
        P.cyl(rr, rr, 1.2, n=n, at=(cx, H + 7.2, cz), col=con, caps=False)
    return finish('romanita', P, cx, cz, [r], H + 8, [b['c']], tex=512)


def gate_tower(key, bx, bz, floors):
    """Porțile Orașului: one of the twin 1980s towers flanking Bd. Dacia at the airport entrance. White panel slab
    with dark ribbon windows, terracotta loggia stripes, a set-back two-floor crown."""
    b = bld(bx, bz); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    H0, FL = 4.0, 2.85; N = floors - 1; H = H0 + N * FL; k = key + '_'
    roof = plain(k + 'roof', 0x6d6f72, joints=(4, 4, .05, .2))
    fac = paint(k + 'fac', 0xe2ded3, streak=.3, base=0, joints=(5.6, FL, .05, .18),
                wins=[dict(px=2.8, pw=2.45, fl=FL, sill=0.95, wh=1.5, y0=H0, y1=H, glass=0x2e3945, glass2=0x56677a)])
    endw = paint(k + 'end', 0xdedad0, streak=.35, base=0, joints=(3.0, FL, .05, .2),
                 wins=[dict(px=4.0, pw=1.0, fl=FL, sill=1.0, wh=1.2, y0=H0, y1=H, glass=0x2e3945, glass2=0x4c5d6f)])
    log = paint(k + 'log', 0x9b5843, streak=.25, base=0, mott=.14,
                wins=[dict(px=5.2, pw=4.3, fl=FL, sill=1.05, wh=1.55, y0=H0, y1=H, glass=0x2a2420, glass2=0x3c342e)])
    shop = paint(k + 'shop', 0x5a5f66, base=.3, streak=0, frame=0xb0b3b6,
                 wins=[dict(px=3.6, pw=3.0, fl=5, sill=0.3, wh=3.0, y0=0, y1=4, glass=0x27313b, glass2=0x4a5b6d)])
    crown = paint(k + 'crown', 0xd9d5cb, streak=.25, base=0,
                  wins=[dict(px=3.0, pw=2.7, fl=2.7, sill=0.6, wh=1.6, y0=H, y1=H + 5.4, glass=0x2b3540, glass2=0x485a6b)])
    f.box(P, 0, 0, -2.5, L - 2.4, H0 + 2.5, W - 2.6, shop, top=roof)
    f.box(P, 0, 0, H0, L - 0.4, N * FL, W, fac, top=roof)
    for su in (-1, 1):
        f.box(P, su * (L / 2 - 1.1), 0, -2.5, 2.2, H + 3.2, W + 0.3, endw, top=roof)
        f.box(P, su * (L / 2 - 6.5), 0, H0, 5.2, N * FL, W + 1.4, log, top=roof)
    f.box(P, 0, 0, H, L - 7, 5.4, W - 3.0, crown, top=roof)
    f.box(P, 0, 0, H + 5.4, L - 4.0, 0.9, W - 0.8, endw, top=roof)
    return finish(key, P, cx, cz, [r], H + 6, [b['c']], tex=512)


def palatul():
    """Palatul Republicii (1984): low modernist hall wrapped in a colonnade of slender red-granite piers holding a
    heavy white cornice, gilded glazing behind, red granite plinth."""
    b = bld(-571.7, 68.8); r0 = b['ring']; r = simplify(r0, 1.6)
    P = lp.Part(); PL, HC = 1.8, 12.6
    gran = paint('pal_gran', 0x86453a, mott=.16, streak=.12, base=.3, joints=(1.6, 1.2, .03, .25))
    pier = paint('pal_pier', 0x8a473b, mott=.14, streak=.15, base=.25)
    pave = plain('pal_pave', 0x9d958a, joints=(1.5, 1.5, .04, .3))
    glass = paint('pal_glass', 0xb08c46, mott=.12, streak=.1, base=.2, joints=(1.6, 2.4, .07, .45))
    cor = paint('pal_cor', 0xdcd7cc, streak=.4, base=0, joints=(3.0, 20.0, .05, .2))
    roof = plain('pal_roof', 0x8f8b84, joints=(6, 6, .05, .2))
    P.extrude(r, -2.5, PL, col=gran, top=pave)
    P.extrude(offset(r, -3.2), PL, PL + HC, col=glass, top=roof)
    for i in range(len(r)):
        a, c = r[i], r[(i + 1) % len(r)]; L = math.hypot(c[0] - a[0], c[1] - a[1])
        if L < 3: continue
        n = max(1, round(L / 4.6)); ang = math.atan2(c[1] - a[1], c[0] - a[0])
        for k in range(n):
            t = (k + 0.5) / n; x, z = a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t
            P.box(1.0, HC, 0.8, at=(x, PL + HC / 2, z), ry=-ang, col=pier)
    P.extrude(offset(r, 0.9), PL + HC, PL + HC + 2.0, col=cor, top=roof)
    f = F(-599.0, 31.5, math.radians(44.2))
    f.box(P, 0, 0, PL + HC + 2.0, 40, 4.5, 28, cor, top=roof)
    return finish('palatul', P, b['c'][0], b['c'][1], [r0], PL + HC + 6, [b['c']], tex=512)


def _gara_front():
    """Painted central facade of the station (30 × 15.5 m): arched window, pilasters, side windows, CHISINAU."""
    CR, WH, DK, GL, GD = 0xe0cd99, 0xf0ece0, 0x2a323b, 0x46576a, 0xc9a040
    cv = Canvas(30, 15.5, CR, ppm=12)
    cv.rect(0, 0, 30, 2.6, 0xcdb985)
    for y in np.arange(0.55, 2.6, 0.55): cv.rect(0, y, 30, y + 0.06, 0xa8976b)
    for x in (2.3, 8.0, 22.0, 27.7): cv.rect(x - 0.7, 0, x + 0.7, 15.0, WH)
    cv.arch(15, 0.2, 8.4, 13.2, WH); cv.arch(15, 0.5, 7.6, 12.6, DK)
    for x in (13.1, 15.0, 16.9): cv.rect(x - 0.08, 0.5, x + 0.08, 13.1, WH)
    for y in (4.2, 8.2): cv.rect(11.2, y - 0.08, 18.8, y + 0.08, WH)
    cv.ring(15, 13.1 - 3.8, 3.7, 3.85, WH)
    for x in (5.15, 24.85):
        for y0 in (1.2, 7.6):
            cv.arch(x, y0, 2.6, 4.8, WH); cv.arch(x, y0 + 0.2, 2.1, 4.3, GL)
    cv.rect(0, 14.9, 30, 15.5, WH)
    cv.rect(9.6, 13.25, 20.4, 14.85, 0xd6c28e); cv.text('CHISINAU', 15, 13.35, 0.28, 0x8a6a22)
    cv.grain(0.07, 3)
    return cv


def _clock():
    cv = Canvas(4, 4, 0xe0cd99, ppm=24)
    cv.disc(2, 2, 1.9, 0xf2eee4); cv.ring(2, 2, 1.75, 1.9, 0x3a3328)
    for k in range(12):
        t = k * PI / 6; cv.disc(2 + 1.55 * math.cos(t), 2 + 1.55 * math.sin(t), 0.1, 0x2a2620)
    cv.rect(1.94, 2.0, 2.06, 3.3, 0x2a2620); cv.rect(2.0, 1.94, 2.9, 2.06, 0x2a2620)
    return cv


def gara():
    """Chișinău railway station: long cream building with white cornices along the tracks, a projecting central hall
    with a tall arched window and CHIȘINĂU letters, the clock tower with a green cupola and gilded spire."""
    b = bld(2067.5, 1314.6); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    CR, WH = 0xe0cd99, 0xf0ece0
    # +v = south-west = the station square
    roof = plain('gar_roof', 0x7f776c, joints=(0.9, 40, .08, .25))
    wall = paint('gar_wall', CR, streak=.25, base=.35, frame=WH, rust=(-3, 1.0, 0xcdb985, 0.5),
                 wins=[dict(px=3.6, pw=1.7, fl=4.1, sill=1.0, wh=2.7, y0=0.0, y1=8.2, arch=True, glass=0x2b343e, glass2=0x4a5866)])
    tall = paint('gar_tall', CR, streak=.25, base=.35, frame=WH, rust=(-3, 1.0, 0xcdb985, 0.5),
                 wins=[dict(px=4.0, pw=2.0, fl=13, sill=1.2, wh=8.0, y0=0.0, y1=11.0, arch=True, glass=0x2b343e, glass2=0x4a5866, mullion=1.0)])
    cor = paint('gar_cor', WH, streak=.3, base=0, mott=.06)
    tow = paint('gar_tow', CR, streak=.3, base=0, frame=WH,
                wins=[dict(px=9.0, pw=2.2, fl=20, sill=1.4, wh=3.4, y0=18, y1=23, arch=True, glass=0x2b343e, glass2=0x404d5a),
                      dict(px=3.6, pw=1.6, fl=10, sill=1.0, wh=2.6, y0=30.2, y1=34.4, arch=True, glass=0x2b343e, glass2=0x404d5a)])
    green = paint('gar_cup', 0x4f8a70, mott=.15, streak=.15, base=0, ribs=(1.2, .08, .3))
    gold = plain('gar_gold', 0xcfa448, mott=.15)
    front = img_mat('gar_front', _gara_front()); clock = img_mat('gar_clock', _clock())
    P.extrude(r, -2.5, 8.5, col=wall, top=roof)
    P.extrude(offset(r, 0.35), 8.5, 9.3, col=cor, top=roof)
    for su in (-1, 1):                                                                 # end pavilions
        f.box(P, su * (L / 2 - 12), 0, -2.5, 15, 14.3, W - 2, tall, top=roof)
        f.box(P, su * (L / 2 - 12), 0, 11.8, 15.6, 0.9, W - 1.4, cor, top=roof)
        f.hip(P, su * (L / 2 - 12), 0, 12.7, 14, 3.0, W - 3, roof, ridge=0.3)
    D = W / 2 + 2.0
    f.box(P, 0, 0, -2.5, 30, 18.0, 2 * D, wall, top=roof)                            # central hall
    for sv in (-1, 1): f.quad(P, -15, 15, sv * D, 0.0, 15.5, front, side=sv, out=0.03)
    f.box(P, 0, 0, 15.5, 31, 1.2, 2 * D + 1, cor, top=roof)
    f.box(P, 0, 0, 16.7, 22, 1.4, 2 * D - 2, cor, top=roof)
    T = 9.0
    f.box(P, 0, 0, 18, T, 12, T, tow, top=roof)                                         # clock tower
    f.box(P, 0, 0, 29.3, T + 1, 0.9, T + 1, cor, top=roof)
    for sd in (-1, 1):
        f.quad(P, -2, 2, sd * T / 2, 23.6, 27.6, clock, side=sd, out=0.04)
        f.quad_u(P, -2, 2, sd * T / 2, 23.6, 27.6, clock, side=sd, out=0.04)
    f.cyl(P, 0, 0, 30.2, 3.4, 3.4, 4.2, n=8, col=tow, a0=PI / 8)                       # lantern
    f.cyl(P, 0, 0, 34.4, 3.9, 3.9, 0.6, n=8, col=cor, a0=PI / 8)
    x, z = f.p(0, 0)
    P.lathe([(3.7, 0), (3.6, 1.2), (3.0, 2.4), (1.8, 3.3), (1.0, 3.7)], n=12, at=(x, 35.0, z), col=green)   # cupola
    P.cyl(1.0, 0.0, 13.0, n=8, at=(x, 38.7 + 6.5, z), col=gold)                        # spire
    P.sphere(0.6, n=8, rings=3, at=(x, 44.6, z), col=gold)
    return finish('gara', P, cx, cz, [r], 12, [b['c']], tex=1024)


def _market_roofs(name):
    return paint(name, 0x8799a4, mott=.12, streak=.3, base=0, joints=(0.42, 1e4, .07, .25))


def piata():
    """Piața Centrală: the long main market pavilion (cream walls, glazed band, metal barrel roofs) with the market's
    name over the entrance on Str. Mitropolit Varlaam."""
    b = bld(873.9, 614.4); r = b['ring']; P = lp.Part()
    wall = paint('pia_wall', 0xd6cbb0, streak=.35, base=.45, frame=0xe9e5da,
                 wins=[dict(px=5.6, pw=4.6, fl=40, sill=3.2, wh=2.9, y0=0, y1=7, glass=0x4a5d70, glass2=0x6c8194, mullion=1.15),
                       dict(px=11.2, pw=3.0, fl=40, sill=0.0, wh=2.6, y0=0, y1=3, glass=0x34393e, glass2=0x45494d)])
    roof = _market_roofs('pia_roof'); flat = plain('pia_flat', 0x737f86, joints=(3, 3, .05, .2))
    ent = paint('pia_ent', 0xe8e4d9, streak=.3, base=.35, frame=0xf4f1ea,
                wins=[dict(px=15, pw=9.0, fl=40, sill=0.0, wh=5.5, y0=0, y1=6, glass=0x33393f, glass2=0x3d4349),
                      dict(px=15, pw=11.0, fl=40, sill=6.5, wh=3.0, y0=0, y1=10, glass=0x4a5d70, glass2=0x6c8194, mullion=1.4)])
    P.extrude(r, -2.5, 7.0, col=wall, top=flat)
    f = F(868.1, 581.0, math.atan2(72.4, 75.2))                                        # u: along the long strip, v: towards SW
    f.vault(P, 0.5, 103.5, 0.6, 17.4, 7.0, 4.8, roof, end=wall)
    f.vault_v(P, 3.0, 24.8, 17.4, 57.2, 7.0, 5.4, roof, end=wall)
    f.box(P, 52, -1.2, -2.5, 15, 13.5, 4.6, ent, top=flat)                             # entrance (Str. Mitropolit Varlaam, -v)
    for su in (-1, 1): f.box(P, 52 + su * 11.5, -2.4, 7.0, 0.35, 4.0, 0.35, 0x666b70)
    sign(P, f, 'pia_sign', 'PIATA CENTRALA', 0xc8302a, 0xeeebe3, 52, -2.6, 11.0, 2.9, sides=(-1,), back=0xe2ded4, depth=0.25)
    cx, cz = _cen(r)
    return finish('piata', P, cx, cz, [r], 12, [b['c']], tex=512)


def piata2():
    """Piața Centrală: the second (fruit) pavilion south of the main hall, same metal barrel roof."""
    b = bld(788.0, 538.0); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    wall = paint('pi2_wall', 0xd6cbb0, streak=.35, base=.45, frame=0xe9e5da,
                 wins=[dict(px=5.4, pw=4.2, fl=40, sill=2.8, wh=2.9, y0=0, y1=6.5, glass=0x4a5d70, glass2=0x6c8194, mullion=1.05),
                       dict(px=12.0, pw=3.0, fl=40, sill=0.0, wh=2.6, y0=0, y1=3, glass=0x34393e, glass2=0x45494d)])
    roof = _market_roofs('pi2_roof'); flat = plain('pi2_flat', 0x737f86)
    P.extrude(r, -2.5, 6.5, col=wall, top=flat)
    f.vault(P, -L / 2 + 0.3, L / 2 - 0.3, -W / 2 + 0.3, W / 2 - 0.3, 6.5, 5.0, roof, end=wall)
    return finish('piata2', P, cx, cz, [r], 11, [b['c']], tex=256)


def hotelchisinau():
    """Hotel Chișinău (1950s Stalinist): L-shaped five-floor block on Bd. Negruzzi, cream walls over a rusticated
    ground floor, white cornices, a columned corner portico with an attic, grey-green hip roofs."""
    b = bld(1271.9, 1266.1); r = b['ring']; P = lp.Part()
    CR, RU, WH = 0xe0cd9f, 0xc6ac7f, 0xf0ece0
    roof = paint('hch_roof', 0x66756d, mott=.12, streak=.2, base=0, joints=(0.8, 1e4, .07, .3))
    cor = paint('hch_cor', WH, streak=.3, base=0, mott=.06)
    _wm = {}
    def wallmat(y):
        if y in _wm: return _wm[y]
        _wm[y] = paint('hch_wall%d' % round(y * 10), CR, streak=.25, base=.35, frame=WH, rust=(y - 3, y + 4.6, RU, 0.55),
                     bands=[(y + 7.3, y + 7.5, WH), (y + 12.55, y + 12.75, WH)],
                     wins=[dict(px=3.4, pw=1.5, fl=40, sill=0.8, wh=2.9, y0=y, y1=y + 4.6, arch=True, glass=0x2b343e, glass2=0x485665),
                           dict(px=3.4, pw=1.35, fl=2.6, sill=0.55, wh=1.75, y0=y + 5.2, y1=y + 15.6, glass=0x2b343e, glass2=0x56687a)])
        return _wm[y]
    # terrain: the ring's low corner is the east end; the SW wing climbs ~4 m (measured in game), so it steps up
    def wing(f, L, W, y0):
        wm = wallmat(y0)
        f.box(P, 0, 0, y0 - 2.5, L, 2.5 + 15.8, W, wm, top=roof)
        f.box(P, 0, 0, y0 + 15.8, L + 0.6, 0.9, W + 0.6, cor, top=roof)
        f.hip(P, 0, 0, y0 + 16.7, L, 3.2, W, roof, ridge=max(0.2, 1 - W / L))
    wing(F(1296.5, 1257.0, 0.02), 53, 12.5, 0.0)                                       # east wing
    a = math.atan2(1307.6 - 1270.0, 1230.0 - 1266.2)
    g = F(1248.1, 1288.8, a)
    wing(F(*g.p(-13, 0), a), 26.5, 15.8, 1.6)                                          # SW wing, near half
    wing(F(*g.p(13, 0), a), 26.5, 15.8, 3.2)                                           # SW wing, far half (uphill)
    c = F(1271.4, 1262.0, math.radians(156.5))                                          # corner block, +v = outward (north)
    wm = wallmat(0.0)
    c.box(P, 0, 0, -2.5, 18, 2.5 + 18.7, 18, wm, top=roof)
    c.box(P, 0, 0, 16.2, 19.2, 1.0, 19.2, cor, top=roof)
    c.box(P, 0, 0, 17.2, 13, 4.2, 13, cor, top=roof)                                    # attic
    c.box(P, 0, 0, 21.4, 13.6, 0.7, 13.6, cor, top=roof)
    c.hip(P, 0, 0, 22.1, 12, 3.0, 12, roof, ridge=0.0)
    c.box(P, 0, 9.6, 4.6, 14, 0.8, 3.2, cor, top=roof)                                  # portico
    for k in range(6): c.cyl(P, -6 + k * 2.4, 10.4, 5.4, 0.55, 0.5, 10.4, n=10, col=cor)
    c.box(P, 0, 9.9, 15.8, 14.6, 1.0, 2.4, cor, top=roof)
    sign(P, c, 'hch_sign', 'HOTEL CHISINAU', 0xb08a34, WH, 0, 6.5, 18.3, 1.9, sides=(1,), pad=0.6)
    return finish('hotelchisinau', P, b['c'][0], b['c'][1], [r], 19, [b['c']], tex=512)



def ciuflea():
    """Ciuflea monastery church of St Theodore Tiron (1858): white cross-shaped church with sky-blue onion domes and
    gold crosses: big central dome, four corner domes, west bell tower over the entrance, east apse."""
    b = bld(1101.2, 1324.8); r = b['ring']; cx, cz, a, L, W = mar(r)
    f = F(cx, cz, a + PI / 2)                                                          # +v = west (entrance), -v = east (altar)
    if f.dir(0, 1)[0] > 0: f = F(cx, cz, a - PI / 2)
    P = lp.Part(); Lu, Wv = W, L; vt = -1.5
    WH, BS = 0xece8de, 0xd2cab6
    wall = paint('ciu_wall', WH, streak=.2, base=.35, frame=0xd8d2c2, socle=(1.4, BS), bands=[(9.9, 10.5, 0xdcd6c8)],
                 wins=[dict(px=3.8, pw=1.25, fl=40, sill=3.4, wh=4.0, y0=0, y1=9.5, arch=True, glass=0x33465c, glass2=0x4d6580)])
    tow = paint('ciu_tow', WH, streak=.2, base=.35, frame=0xd8d2c2, socle=(1.4, BS), bands=[(15.5, 16.1, 0xdcd6c8)],
                wins=[dict(px=7.4, pw=1.4, fl=40, sill=6.0, wh=3.4, y0=0, y1=12, arch=True, glass=0x33465c, glass2=0x4d6580),
                      dict(px=5.8, pw=1.9, fl=40, sill=16.9, wh=4.2, y0=0, y1=22, arch=True, glass=0x22262b, glass2=0x2c3036)])
    drum = paint('ciu_drum', WH, streak=.15, base=0, frame=0xd8d2c2,
                 wins=[dict(px=2 * 4.3 * math.sin(PI / 10), pw=0.9, fl=40, sill=12.4, wh=3.4, y0=10, y1=18, arch=True, glass=0x33465c, glass2=0x4d6580)])
    dome = paint('ciu_dome', 0x3664a8, mott=.1, streak=.1, base=0, scales=0x234a80)
    roof = paint('ciu_roof', 0x4a73ad, mott=.1, streak=.2, base=0, joints=(0.7, 1e4, .07, .3))
    gold = plain('ciu_gold', GOLD, mott=.15)
    f.box(P, 0, 0, -2.5, 10.5, 13.0, Wv - 2.0, wall, top=roof)                         # nave
    f.box(P, 0, vt, -2.5, Lu - 0.4, 13.0, 9.0, wall, top=roof)                          # transept
    f.gable(P, 0, 0, 10.5, 11.2, 3.0, Wv - 1.6, 'v', roof, ends=wall)
    f.gable(P, 0, vt, 10.5, 9.6, 3.0, Lu + 0.2, 'u', roof, ends=wall)
    f.cyl(P, 0, vt, 10.5, 4.3, 4.3, 7.5, n=10, col=drum, top=roof)                     # central drum
    x, z = f.p(0, vt); onion(P, x, 18.0, z, 4.6, dome, gold, n=12, ry=-f.a)
    for su in (-1, 1):
        for sv in (-1, 1):
            x, z = f.p(su * 4.0, vt + sv * 4.2)
            P.cyl(1.4, 1.4, 4.0, n=10, at=(x, 13.0, z), col=drum)
            onion(P, x, 15.0, z, 1.7, dome, gold, n=10, ry=-f.a)
    vb = Wv / 2 - 3.6                                                                  # bell tower (west)
    f.box(P, 0, vb, -2.5, 7.4, 2.5 + 16.1, 7.4, tow, top=roof)
    f.box(P, 0, vb, 16.1, 5.8, 6.0, 5.8, tow, top=roof)
    f.cyl(P, 0, vb, 22.1, 2.3, 2.3, 2.4, n=10, col=drum, top=roof)
    x, z = f.p(0, vb); onion(P, x, 24.5, z, 2.6, dome, gold, n=10, ry=-f.a)
    va = -(Wv / 2 - 4.2)                                                               # apse (east)
    f.cyl(P, 0, va, -2.5, 4.6, 4.6, 12.0, n=10, col=wall)
    f.cyl(P, 0, va, 9.5, 5.0, 0.4, 2.6, n=10, col=roof)
    return finish('ciuflea', P, cx, cz, [r], 12, [b['c']], tex=256)


def mazarache():
    """Măzărache church (1752), the oldest in the city: small whitewashed stone church with green roofs, a squat bell
    tower with a tented roof at the west end, a little dome over the nave, a rounded east apse."""
    b = bld(1246.6, -691.8); r = b['ring']; P = lp.Part()
    WH, ST = 0xe9e3d3, 0xb3a78d
    wall = paint('maz_wall', WH, streak=.3, base=.35, mott=.14, socle=(1.6, ST), frame=0xd5ccb6,
                 wins=[dict(px=4.6, pw=0.9, fl=40, sill=3.0, wh=2.4, y0=0, y1=7, arch=True, glass=0x2e3640, glass2=0x46525e)])
    tow = paint('maz_tow', WH, streak=.3, base=.35, mott=.14, socle=(1.6, ST), bands=[(12.0, 12.6, ST), (16.8, 17.3, ST)],
                wins=[dict(px=6.4, pw=1.8, fl=40, sill=13.3, wh=3.0, y0=0, y1=17, arch=True, glass=0x24272b, glass2=0x2e3135),
                      dict(px=7.8, pw=1.0, fl=40, sill=5.5, wh=1.8, y0=0, y1=10, arch=True, glass=0x2e3640, glass2=0x46525e)])
    roof = paint('maz_roof', 0x5a8a69, mott=.12, streak=.2, base=0, joints=(0.6, 1e4, .07, .3))
    gold = plain('maz_gold', GOLD, mott=.15)
    f = F(1244.2, -691.4, math.atan2(-0.5, 8.0))                                      # u = east
    f.box(P, -10.2, -0.3, -2.5, 7.8, 2.5 + 15.0, 8.2, tow, top=roof)                  # bell tower
    f.box(P, -10.2, -0.3, 12.6, 6.4, 4.2, 6.4, tow, top=roof)
    f.box(P, -10.2, -0.3, 16.8, 7.0, 0.5, 7.0, tow, top=roof)
    f.cyl(P, -10.2, -0.3, 17.3, 4.6, 0.3, 5.6, n=4, col=roof, a0=PI / 4)               # tented roof
    x, z = f.p(-10.2, -0.3); onion(P, x, 22.6, z, 0.75, roof, gold, n=8, ry=-f.a)
    f.box(P, -3.6, 0.0, -2.5, 5.2, 2.5 + 7.0, 15.4, wall, top=roof)                   # side chapels / transept
    f.box(P, 4.0, -0.3, -2.5, 10.2, 2.5 + 7.4, 10.8, wall, top=roof)                  # nave
    f.cyl(P, 9.6, -0.3, -2.5, 4.4, 4.4, 2.5 + 6.6, n=10, col=wall, a0=PI / 10)         # apse
    f.cyl(P, 9.6, -0.3, 4.1, 4.8, 0.6, 2.6, n=10, col=roof, a0=PI / 10)
    f.gable(P, 4.0, -0.3, 7.4, 11.4, 3.3, 11.0, 'u', roof, ends=wall)
    f.gable(P, -3.6, 0.0, 7.0, 6.2, 2.6, 16.2, 'v', roof, ends=wall)
    f.cyl(P, 4.0, -0.3, 9.6, 1.7, 1.7, 2.6, n=10, col=wall, top=roof)                  # nave dome
    x, z = f.p(4.0, -0.3); onion(P, x, 12.2, z, 1.9, roof, gold, n=10, ry=-f.a)
    return finish('mazarache', P, b['c'][0], b['c'][1], [r], 9, [b['c']], tex=256)


def pantelimon():
    """St Pantelimon, the 'Greek church' (1891, Bernardazzi): neo-Byzantine, walls striped in red brick and cream
    stone, a tall drum with a grey-blue dome and four corner turrets with small domes."""
    b = bld(12.9, 451.5); r = b['ring']; P = lp.Part()
    RB, CS = 0xa0472f, 0xe4d8bd
    xs, zs = [p[0] for p in r], [p[1] for p in r]; f = F((max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2, 0.0)
    H = 10.4
    wall = paint('pan_wall', CS, streak=.2, base=.3, mott=.1, stripes=(1.4, RB, 0.5, -3, H - 0.3), bands=[(H - 0.3, H + 1, CS)], frame=CS,
                 wins=[dict(px=3.6, pw=1.3, fl=40, sill=3.2, wh=3.8, y0=0, y1=H - 1, arch=True, glass=0x2b333d, glass2=0x45525f)])
    drum = paint('pan_drum', CS, streak=.15, base=0, mott=.1, stripes=(1.4, RB, 0.5, 0, 50), frame=CS,
                 wins=[dict(px=2 * 4.2 * math.sin(PI / 12), pw=0.85, fl=40, sill=H + 3.4, wh=2.8, y0=H, y1=H + 7, arch=True, glass=0x2b333d, glass2=0x45525f)])
    dome = paint('pan_dome', 0x5b6c7e, mott=.12, streak=.15, base=0, ribs=(1.1, .08, .35))
    roof = paint('pan_roof', 0x6a6f75, mott=.1, streak=.2, base=0, joints=(0.7, 1e4, .07, .3))
    gold = plain('pan_gold', GOLD, mott=.15)
    P.extrude(r, -2.4, H + 0.6, col=wall, top=roof)
    f.gable(P, 0, 0, H + 0.6, 9.5, 3.4, 22.0, 'u', roof, ends=wall)
    f.gable(P, 0, 0, H + 0.6, 9.5, 3.4, 15.2, 'v', roof, ends=wall)
    yd = H + 2.6
    P.cyl(4.2, 4.2, 6.0 + 2.6, n=12, at=(f.cx, H + (6.0 + 2.6) / 2, f.cz), col=drum)
    P.cyl(4.6, 4.6, 0.5, n=12, at=(f.cx, yd + 6.25, f.cz), col=drum, top=roof)
    P.sphere(4.4, n=12, rings=4, hemi=True, sy=1.15, at=(f.cx, yd + 6.5, f.cz), col=dome)
    P.box(0.22, 2.4, 0.22, at=(f.cx, yd + 6.5 + 5.06 + 1.2, f.cz), col=gold)
    P.box(1.3, 0.22, 0.22, at=(f.cx, yd + 6.5 + 5.06 + 1.7, f.cz), col=gold)
    for su in (-1, 1):
        for sv in (-1, 1):
            x, z = f.p(su * 7.6, sv * 4.6)
            P.cyl(1.35, 1.35, 3.3, n=10, at=(x, H + 0.6 + 1.65, z), col=drum)
            P.sphere(1.45, n=10, rings=3, hemi=True, sy=1.2, at=(x, H + 3.9, z), col=dome)
            P.box(0.14, 1.0, 0.14, at=(x, H + 3.9 + 1.74 + 0.5, z), col=gold)
    return finish('pantelimon', P, b['c'][0], b['c'][1], [r], 11, [b['c']], tex=256)


def eternitate():
    """Eternitate memorial (1975): five rifle-shaped red-granite pylons leaning together over the eternal flame,
    on a round stepped granite platform, a five-pointed star around the flame."""
    b = bld(18.2, 1720.3); cx, cz = 19.6, 1721.0; P = lp.Part()
    gr = paint('ete_gran', 0x8c4a3c, mott=.14, streak=.2, base=.3, joints=(1.4, 2.4, .03, .22))
    grd = paint('ete_grand', 0x6f362b, mott=.14, streak=.2, base=.3, joints=(1.4, 2.4, .03, .22))
    plat = paint('ete_plat', 0x9a948a, mott=.12, streak=0, base=.3, joints=(1.2, 1.2, .03, .3))
    star = plain('ete_star', 0x6a2b23, mott=.1)
    P.cyl(13.5, 13.5, 2.5, n=24, at=(cx, -1.0, cz), col=plat)                           # steps
    P.cyl(11.8, 11.8, 0.35, n=24, at=(cx, 0.43, cz), col=plat)
    st = []
    for k in range(10):
        t = -PI / 2 + k * PI / 5; rr = 4.4 if k % 2 == 0 else 1.8
        st.append((cx + rr * math.cos(t), cz + rr * math.sin(t)))
    P.extrude(st, 0.6, 1.0, col=star)
    P.cyl(0.9, 0.0, 2.0, n=6, at=(cx, 2.0, cz), col=0xff8a1e)
    P.cyl(0.5, 0.0, 1.4, n=5, at=(cx, 1.7, cz), col=0xffd24a, a0=0.4)
    fps = []; Hc = 24.5
    for k in range(5):
        t = PI / 2 + k * 2 * PI / 5
        g = F(cx, cz, t)
        def Q(rad, half, thick, y):
            return [g.P3(rad - thick / 2, y, -half), g.P3(rad + thick / 2, y, -half), g.P3(rad + thick / 2, y, half), g.P3(rad - thick / 2, y, half)]
        lo, mid = Q(9.6, 1.9, 1.5, -2.5), Q(2.2, 0.85, 0.8, Hc)
        cen = g.P3(5.5, Hc * 0.4, 0)
        for i in range(4):
            oface(P, [lo[i], lo[(i + 1) % 4], mid[(i + 1) % 4], mid[i]], grd if i == 1 else gr,
                  _sub(tuple((lo[i][j] + mid[(i + 1) % 4][j]) / 2 for j in range(3)), cen))
        apex = g.P3(0.7, Hc + 5.5, 0)
        for i in range(4): oface(P, [mid[i], mid[(i + 1) % 4], apex], gr, _sub(tuple((mid[i][j] + mid[(i + 1) % 4][j]) / 2 for j in range(3)), g.P3(1.8, Hc + 1, 0)))
        fps.append([g.p(rad + dt, s * h) for rad, dt, s, h in ((9.6, -0.9, -1, 2.0), (9.6, 0.9, -1, 2.0), (9.6, 0.9, 1, 2.0), (9.6, -0.9, 1, 2.0))])
    return finish('eternitate', P, cx, cz, fps, 24, [b['c']], tex=256)


def tvtower():
    """Chișinău TV tower (196 m): square steel lattice tapering in red/white sections, two platforms, red/white mast."""
    cx, cz = -1759.0, 2667.0; P = lp.Part()
    RD, WH = plain('tv_red', 0xb8352c, mott=.15), plain('tv_white', 0xe6e5df, mott=.1)
    GR = plain('tv_grey', 0x6a6d72, mott=.15, joints=(1.0, 1.0, .06, .3))
    lev = [-4, 0, 22, 42, 60, 77, 93, 108, 122, 136, 150]
    hw = lambda y: 11.0 - (11.0 - 2.4) * max(0, y) / 150.0
    def corners(y): h = hw(y); return [(cx - h, y, cz - h), (cx + h, y, cz - h), (cx + h, y, cz + h), (cx - h, y, cz + h)]
    for k in range(len(lev) - 1):
        y0, y1 = lev[k], lev[k + 1]; col = RD if k % 2 == 1 else WH
        c0, c1 = corners(y0), corners(y1); t = 0.9 - 0.45 * y1 / 150
        for i in range(4):
            beam(P, c0[i], c1[i], t, col)
            if y0 >= 0:
                beam(P, c1[i], c1[(i + 1) % 4], t * 0.6, col)
                j = (i + 1) % 4
                if k % 2: beam(P, c0[i], c1[j], t * 0.45, col)
                else: beam(P, c0[j], c1[i], t * 0.45, col)
    for y, s in ((60, 1.25), (122, 1.6)):                                              # platforms
        h = hw(y) * s
        P.box(2 * h, 1.2, 2 * h, at=(cx, y + 0.6, cz), col=GR)
        P.box(2 * h + 0.2, 1.0, 2 * h + 0.2, at=(cx, y + 1.7, cz), col=RD if y == 122 else WH, top=GR)
    P.box(6.2, 3.5, 6.2, at=(cx, 151.75, cz), col=WH, top=GR)
    for k in range(6):
        y0 = 153.5 + k * 7.0
        P.cyl(1.0 - k * 0.1, 0.9 - k * 0.1, 7.0, n=8, at=(cx, y0 + 3.5, cz), col=RD if k % 2 == 0 else WH)
    P.cyl(0.25, 0.1, 3.0, n=4, at=(cx, 196.5, cz), col=RD)
    fps = [square(c[0], c[2], 1.2) for c in corners(0)]
    return finish('tvtower', P, cx, cz, fps, 30, [], tex=256, ao=0.5)


def _pitch(Lp=105, Wp=68):
    """Pitch markings painted in the pitch frame (112 × 78 m, centre origin)."""
    cv = Canvas(112, 78, 0x4c8f3a, ppm=4)
    for k in range(12):
        if k % 2: cv.rect(56 - Lp / 2 + k * Lp / 12, 0, 56 - Lp / 2 + (k + 1) * Lp / 12, 78, 0x58a044)
    LN, w = 0xe9ece4, 0.18
    x0, x1, y0, y1 = 56 - Lp / 2, 56 + Lp / 2, 39 - Wp / 2, 39 + Wp / 2
    for (a, b2, c, d) in ((x0, y0 - w, x1, y0 + w), (x0, y1 - w, x1, y1 + w), (x0 - w, y0, x0 + w, y1), (x1 - w, y0, x1 + w, y1), (56 - w, y0, 56 + w, y1)):
        cv.rect(a, b2, c, d, LN)
    cv.ring(56, 39, 9.15 - w, 9.15 + w, LN); cv.disc(56, 39, 0.35, LN)
    for sg, xe in ((1, x0), (-1, x1)):
        for depth, half in ((16.5, 20.16), (5.5, 9.16)):
            xi = xe + sg * depth
            cv.rect(min(xe, xi), 39 - half - w, max(xe, xi), 39 - half + w, LN); cv.rect(min(xe, xi), 39 + half - w, max(xe, xi), 39 + half + w, LN)
            cv.rect(xi - w, 39 - half, xi + w, 39 + half, LN)
        cv.disc(xe + sg * 11, 39, 0.3, LN)
    cv.grain(0.08, 5)
    return cv


def zimbru():
    """Zimbru stadium (2006): stands on three sides on a concrete podium, yellow seats with green rows, the main
    south stand with VIP glazing under a cantilever roof, four corner floodlight masts, the pitch."""
    U = bld(2700.7, 4884.6); S = bld(2683.0, 4955.0, r=15); P = lp.Part()
    YL, GN = 0xe2b923, 0x23753a
    # the bowl is level, the hillside is not: lowest ground under the stands is ~2.6 m below the pitch (measured)
    PY = 2.6
    seat = paint('zim_seat', YL, mott=.08, streak=.1, base=0, rows=(0.42, GN, 4), ribs=(9.0, 1.1, .35))
    con = paint('zim_con', 0xb0b3b5, streak=.35, base=.4, mott=.12, bands=[(PY + 9.6, PY + 11.4, GN)],
                wins=[dict(px=6.0, pw=3.2, fl=40, sill=PY + 2.5, wh=2.5, y0=0, y1=PY + 6, glass=0x2e3740, glass2=0x3d4954)])
    vip = paint('zim_vip', 0xb0b3b5, streak=.3, base=.4, mott=.12, bands=[(PY + 13.0, PY + 14.4, GN)],
                wins=[dict(px=4.0, pw=3.7, fl=40, sill=PY + 8.5, wh=4.0, y0=0, y1=PY + 13, glass=0x2b3846, glass2=0x4f6378, mullion=1.0),
                      dict(px=6.0, pw=3.2, fl=40, sill=PY + 0.4, wh=3.0, y0=0, y1=PY + 4, glass=0x2e3740, glass2=0x3d4954)])
    rf = paint('zim_roof', 0xdcdcd8, mott=.06, streak=.15, base=0, joints=(6.0, 1e4, .1, .25))
    steel = plain('zim_steel', 0x8c9095, mott=.1)
    lamp = paint('zim_lamp', 0x7c8086, streak=0, base=0, mott=.05,
                 wins=[dict(px=1.05, pw=0.85, fl=1.05, sill=0.1, wh=0.85, y0=PY + 40.8, y1=PY + 44.9, glass=0xfff0b8, glass2=0xfffbe6)])

    def stand(i0, i1, o0, o1, yin, yout):
        """Seating slope from the inner (pitch) edge up to the outer edge, with front wall, back wall and ends."""
        cen = ((i0[0] + i1[0] + o0[0] + o1[0]) / 4, (i0[1] + i1[1] + o0[1] + o1[1]) / 4)
        out = ((o0[0] + o1[0]) / 2 - (i0[0] + i1[0]) / 2, 0, (o0[1] + o1[1]) / 2 - (i0[1] + i1[1]) / 2)
        yb = -1.5; ad = (i1[0] - i0[0], 0, i1[1] - i0[1])
        oface(P, [(i0[0], yb, i0[1]), (i1[0], yb, i1[1]), (i1[0], yin, i1[1]), (i0[0], yin, i0[1])], con, (-out[0], 0, -out[2]))
        oface(P, [(i0[0], yin, i0[1]), (i1[0], yin, i1[1]), (o1[0], yout, o1[1]), (o0[0], yout, o0[1])], seat, (-out[0], 1, -out[2]))
        oface(P, [(o0[0], yb, o0[1]), (o1[0], yb, o1[1]), (o1[0], yout + 1.2, o1[1]), (o0[0], yout + 1.2, o0[1])], con, out)
        oface(P, [(o0[0], yout, o0[1]), (o1[0], yout, o1[1]), (o1[0], yout + 1.2, o1[1]), (o0[0], yout + 1.2, o0[1])], con, (-out[0], 0, -out[2]))
        for p0, p1, sd in ((i0, o0, -1), (i1, o1, 1)):
            oface(P, [(p0[0], yb, p0[1]), (p1[0], yb, p1[1]), (p1[0], yout + 1.2, p1[1]), (p0[0], yin, p0[1])], con, (sd * ad[0], 0, sd * ad[2]))

    yi, yo = PY + 1.2, PY + 11.0
    stand((2642.8, 4862.3), (2629.1, 4937.2), (2625.0, 4853.7), (2610.3, 4933.8), yi, yo)       # west
    stand((2642.8, 4862.3), (2754.5, 4882.5), (2647.0, 4843.2), (2755.2, 4862.6), yi, yo)       # north
    stand((2754.5, 4882.5), (2741.0, 4957.1), (2774.2, 4880.5), (2759.7, 4960.7), yi, yo)       # east
    P.extrude([(2625.0, 4853.7), (2637.7, 4844.0), (2647.0, 4843.2), (2642.8, 4862.3)], -1.5, yo + 1.2, col=con)
    P.extrude([(2755.2, 4862.6), (2763.3, 4866.7), (2768.9, 4873.8), (2774.2, 4880.5), (2754.5, 4882.5)], -1.5, yo + 1.2, col=con)
    # main (south) stand: the building strip from the data + seats in front + cantilever roof
    s = S['ring']; d = (2737.7 - 2630.3, 4961.3 - 4941.7); Ls = math.hypot(*d); ud = (d[0] / Ls, d[1] / Ls); nn = (ud[1], -ud[0])
    A, Bp = (2630.3, 4941.7), (2737.7, 4961.3)
    stand((A[0] + nn[0] * 5, A[1] + nn[1] * 5), (Bp[0] + nn[0] * 5, Bp[1] + nn[1] * 5), A, Bp, yi, PY + 7.0)
    P.extrude(s, -1.5, PY + 17.0, col=vip, top=rf)
    fs = F((A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2, math.atan2(d[1], d[0]))           # u along the stand, -v = towards the pitch
    rl, rd = Ls - 6, 17.0
    hexa(P, [fs.P3(-rl / 2, PY + 18.6, 3.0), fs.P3(rl / 2, PY + 18.6, 3.0), fs.P3(rl / 2, PY + 20.4, -rd), fs.P3(-rl / 2, PY + 20.4, -rd)],
         [fs.P3(-rl / 2, PY + 19.4, 3.0), fs.P3(rl / 2, PY + 19.4, 3.0), fs.P3(rl / 2, PY + 21.0, -rd), fs.P3(-rl / 2, PY + 21.0, -rd)], rf)
    for k in range(6):
        u = -rl / 2 + 4 + k * (rl - 8) / 5
        beam(P, fs.P3(u, PY + 17.0, 1.5), fs.P3(u, PY + 21.6, -rd + 1.0), 0.7, steel)
        beam(P, fs.P3(u, PY + 21.6, -rd + 1.0), fs.P3(u, PY + 21.6, 2.5), 0.6, steel)
    # pitch: one box, markings painted in its own frame
    fp_ = F(2692.0, 4910.0, math.atan2(d[1], d[0]))
    grass = img_mat('zim_pitch', _pitch())
    FRAMES[grass.name] = lambda q, f=fp_: ((q[0]) * f.c + (q[2]) * f.s, -(q[0]) * f.s + (q[2]) * f.c)   # local coords (origin = pitch centre)
    fp_.box(P, 0, 0, -1.5, 112, PY + 1.55, 78, con, top=grass)
    for sg in (-1, 1):                                                                 # goals
        x, z = fp_.p(sg * 53.5, 0)
        P.box(0.3, 2.44, 7.3, at=(x, PY + 0.05 + 1.22, z), ry=-fp_.a, col=0xeeeeea)
    for mx, mz in ((2619.0, 4843.0), (2772.0, 4864.0), (2765.0, 4971.0), (2606.0, 4945.0)):   # floodlight masts
        P.cyl(0.9, 0.55, PY + 43.5, n=8, at=(mx, (PY + 42.0) / 2 - 0.75, mz), col=steel)
        ang = math.atan2(4910.0 - mz, 2692.0 - mx); fl = F(mx, mz, ang)
        fl.box(P, 0.6, 0, PY + 40.5, 1.2, 4.6, 7.0, lamp)
    # the pitch is a 'clear' area: walkable, but vegetation plants no trees on the grass
    pitch = [fp_.p(-56, -39), fp_.p(56, -39), fp_.p(56, 39), fp_.p(-56, 39)]
    return finish('zimbru', P, 2692.0, 4910.0, [U['ring'], s], 14, [U['c'], S['c']], clear=[pitch], tex=1024)


BUILD = [cosmos, atrium, atriumtower, grandhall, national, romanita, lambda: gate_tower('gates', 2825.4, 5325.6, 16), lambda: gate_tower('gates2', 2912.7, 5205.5, 17),
         palatul, gara, piata, piata2, hotelchisinau, ciuflea, mazarache, pantelimon, eternitate, tvtower, zimbru]
BUILD[6].key = 'gates'; BUILD[7].key = 'gates2'
