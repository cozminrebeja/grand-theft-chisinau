"""Added Chișinău landmarks (PS2-era low poly) for models/landmarks.glb; built by tools/blender/landmarks.py.

build() returns one top-level object per landmark, named by its key, with prop 'lm' = {x, z, fp, h, skip}
(see lm_glbList in js/landmarks.js). Geometry is in game metres relative to (x, base, z), base = lowest ground under
fp[0]. Footprints come from the game's own building data (lp.footprint), so the models sit on the real OSM rings.

Keys: cosmos, national, romanita, gates, gates2, palatul, gara, piata, piata2, hotelchisinau, ciuflea,
mazarache, pantelimon, eternitate, tvtower, zimbru.

A few parts that sit away from fp[0] on sloping ground carry a fixed height step measured in the game's terrain
(hotelchisinau's south-west wing, zimbru's pitch level); they are commented where used.
"""
import math, random, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp

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
    'Z': ['###', '..#', '.#.', '#..', '###'],
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


def text(P, f, s, uc, v, y0, cell, col, side=1, depth=0.3):
    """Block letters centred at u=uc on the plane v, bottom at y0, readable from the +v side (side=1) or -v."""
    ws = [len(FONT[c][0]) if c in FONT else 2 for c in s]; W = sum(ws) + len(s) - 1; x = -W / 2
    for c, w in zip(s, ws):
        if c in FONT:
            for i, j, wi, hj in _rects(FONT[c]):
                uu = (x + i + wi / 2) * cell
                f.box(P, uc + side * uu, v, y0 + (5 - j - hj) * cell, wi * cell, hj * cell, depth, col)
        x += w + 1
    return W * cell


# ------------------------------------------------------------------ lookup / output helpers
def bld(x, z, r=10):
    b = lp.footprint(x, z, r)
    if b is None: raise RuntimeError('no building footprint near (%.1f, %.1f)' % (x, z))
    return b


def _rr(r): return [[round(p[0], 1), round(p[1], 1)] for p in r]


def finish(key, P, x, z, fp, h, skip, clear=()):
    lm = {'x': round(x, 2), 'z': round(z, 2), 'fp': [_rr(r) for r in fp], 'h': h, 'skip': [[round(c[0], 2), round(c[1], 2)] for c in skip]}
    if clear: lm['clear'] = [_rr(r) for r in clear]  # tree-free, walkable areas
    o = P.obj(key, props={'lm': lm}, origin=(x, 0, z))
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    print('landmark %-14s tris %5d  at (%.1f, %.1f)' % (key, tris, x, z))
    return o


def square(cx, cz, hw, a=0.0):
    f = F(cx, cz, a); return [f.p(-hw, -hw), f.p(hw, -hw), f.p(hw, hw), f.p(-hw, hw)]


def circle(cx, cz, r, n=12): return [(cx + r * math.cos(i * 2 * PI / n), cz + r * math.sin(i * 2 * PI / n)) for i in range(n)]


# ================================================================== landmarks
def cosmos():
    """Hotel Cosmos (1974-83): 19-floor slab on Piața Negruzzi, long faces covered in angular 'cabin' bay windows,
    blank white end walls, red neon COSMOS letters on the roof."""
    b = bld(1562.0, 1137.1); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    WH, GL, BD, GR = 0xedebe5, 0x3e4c5e, 0xd5d2ca, 0x8b8e92
    H0, FL, N = 6.0, 2.75, 18; H = H0 + N * FL
    f.box(P, 0, 0, -2.5, L - 1.5, H0 + 2.5, W - 3.0, 0x56616c)                       # lobby glass
    f.box(P, 0, 0, H0 - 0.9, L + 0.4, 0.9, W + 0.4, WH)                               # canopy band
    f.box(P, 0, 0, H0, L - 2, N * FL, W - 3.6, GL)                                     # glass core
    for su in (-1, 1): f.box(P, su * (L / 2 - 1.6), 0, H0, 3.2, N * FL + 1.0, W - 0.8, WH)  # blank end walls
    n = int((L - 7) // 3.3)
    for sv in (-1, 1):                                                                 # stacks of angular glazed bays
        for i in range(n): vbay(P, f, -(n - 1) * 3.3 / 2 + i * 3.3, sv * (W / 2 - 1.8), sv, H0, H, 1.45, 1.4, 0x55697e)
    for k in range(1, N + 1): f.box(P, 0, 0, H0 + k * FL - 0.45, L - 3.0, 0.45, W - 0.5, WH)  # white floor lines over the bays
    f.box(P, 0, 0, H, L - 1.0, 1.0, W - 1.2, WH, top=GR)                               # parapet / roof
    f.box(P, L * 0.22, 0, H + 1, 9, 3.5, 7, 0xcfcac0, top=GR)                          # machine room
    y = H + 1.0
    for su in (-1, 1): f.box(P, su * 9, 0, y, 0.5, 6.5, 0.5, GR)
    f.box(P, 0, 0, y + 1.0, 24, 0.35, 0.35, GR)
    f.box(P, 0, 0, y + 1.2, 23.5, 5.2, 0.18, 0x34373c)                                # sign board
    text(P, f, 'COSMOS', 0, 0.25, y + 1.4, 0.95, 0xe02a2a, side=1, depth=0.3)
    text(P, f, 'COSMOS', 0, -0.25, y + 1.4, 0.95, 0xe02a2a, side=-1, depth=0.3)
    return finish('cosmos', P, cx, cz, [r], H + 2, [b['c']])


def national():
    """Ruins of Hotel Național (1978): abandoned 16-floor concrete slab on Ștefan cel Mare, bare floor slabs over empty
    black window voids, stained end walls, a few boarded bays, broken roof."""
    b = bld(1234, 1102); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    CON, DK, SL, ST, BO = 0x9d998f, 0x26262b, 0xb7b2a6, 0x6d6152, 0x7a766c
    rnd = random.Random('national')
    P.extrude(r, -2.5, 7, col=CON, top=0x6e6b64)                                       # 2-floor podium
    ring_windows(P, r, [0.8, 4.2], 2.4, 3.4, 4.4, DK)
    TL, TW, H0, FL, N = L - 4, W - 9, 7.0, 3.0, 14; H = H0 + N * FL
    f.box(P, 0, 0, H0, TL - 1.4, N * FL, TW - 1.8, DK)                                 # gutted interior (black)
    for k in range(N + 1):
        y = H0 + k * FL - 0.55
        if k == N: f.box(P, -TL * 0.12, 0, y, TL * 0.76, 0.55, TW, SL); continue     # top slab partly gone
        f.box(P, 0, 0, y, TL, 0.55, TW, SL)
    piers = int(TL // 6.2)
    for sv in (-1, 1):
        for i in range(piers + 1):
            u = -TL / 2 + 2.5 + i * (TL - 5) / piers
            f.box(P, u, sv * (TW / 2 - 0.7), H0, 1.0, N * FL - (FL if (i > piers * 0.7) else 0), 1.0, CON)
        for _ in range(9):                                                             # boarded / surviving panels
            i = rnd.randrange(piers); k = rnd.randrange(N - 1)
            u = -TL / 2 + 2.5 + (i + 0.5) * (TL - 5) / piers
            f.box(P, u, sv * (TW / 2 - 0.9), H0 + k * FL, (TL - 5) / piers - 0.8, FL - 0.4, 0.3, BO)
    for su in (-1, 1):
        f.box(P, su * (TL / 2 - 1.3), 0, H0, 2.6, N * FL - (2.2 if su > 0 else 0), TW - 1.2, CON)
        for k in range(3): f.box(P, su * (TL / 2 + 0.02), (k - 1) * 3.5, H0 + rnd.uniform(5, 20), 0.2, rnd.uniform(8, 16), 0.9, ST)
    f.box(P, -TL * 0.25, 0, H, 8, 3.2, 6, CON, top=0x5e5b55)                          # broken roof structure
    for k in range(5): f.box(P, -TL * 0.25 + 6 + k * 1.6, rnd.uniform(-3, 3), H, 0.25, rnd.uniform(1, 3), 0.25, 0x6b4a32)  # rebar
    for c, u in ((0xd04a8a, -0.3), (0x3fb0c8, 0.05), (0xe0c040, 0.3)):                 # graffiti on the podium
        f.box(P, u * L, -W / 2 + 0.05, 0.6, 4, 2.2, 0.15, c)
    return finish('national', P, cx, cz, [r], H, [b['c']])


def romanita():
    """Romanița (1986): 22-floor cylindrical tower, white ribs and floor rings over dark glazing, crowned by a ring of
    tall pointed pylons."""
    b = bld(365.8, 3756.5); r = b['ring']
    xs, zs = [p[0] for p in r], [p[1] for p in r]; cx, cz = (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2
    R = (max(xs) - min(xs) + max(zs) - min(zs)) / 4
    P = lp.Part(); WH, GL, GR = 0xf1efe9, 0x46566b, 0x8c9096
    N, FL, H0 = 22, 3.0, 4.0; H = H0 + N * FL
    P.cyl(R - 0.9, R - 0.9, H + 2.5, n=16, at=(cx, (H + 2.5) / 2 - 2.5, cz), col=GL)
    P.cyl(R + 0.3, R + 0.3, 0.8, n=16, at=(cx, H0 - 0.4, cz), col=WH, caps=False)
    for k in range(1, N + 1): P.cyl(R - 0.35, R - 0.35, 0.45, n=16, at=(cx, H0 + k * FL - 0.22, cz), col=WH, caps=False)
    for i in range(16):
        t = (i + 0.5) * 2 * PI / 16; x, z = cx + (R - 0.4) * math.cos(t), cz - (R - 0.4) * math.sin(t)
        P.box(0.9, N * FL, 1.6, at=(x, H0 + N * FL / 2, z), ry=PI / 2 + t, col=WH)
    P.cyl(R - 0.6, R - 0.6, 0.8, n=16, at=(cx, H + 0.4, cz), col=WH, top=GR)          # roof
    P.cyl(5.5, 5.5, 5, n=10, at=(cx, H + 3.3, cz), col=WH, top=GR)                    # core / machine room
    for i in range(12):                                                                # the crown
        t = i * 2 * PI / 12; x, z = cx + (R - 1.6) * math.cos(t), cz - (R - 1.6) * math.sin(t)
        P.box(1.3, 9, 1.3, at=(x, H + 0.8 + 4.5, z), ry=PI / 2 + t, col=WH)
        P.cyl(0.9, 0, 3.2, n=4, at=(x, H + 0.8 + 9 + 1.6, z), col=WH, a0=PI / 4)
    P.cyl(R - 1.2, R - 1.2, 1.2, n=12, at=(cx, H + 7.0, cz), col=WH, caps=False)
    P.cyl(R - 2.0, R - 2.0, 1.2, n=12, at=(cx, H + 7.0, cz), col=WH, caps=False)
    P.cyl(R + 2.5, R + 2.5, 0.5, n=16, at=(cx, H0 - 0.6, cz), col=0xd8d4cc)            # entrance canopy ring
    return finish('romanita', P, cx, cz, [r], H + 8, [b['c']])


def gate_tower(key, bx, bz, floors):
    """Porțile Orașului: one of the twin 1980s towers flanking Bd. Dacia at the airport entrance. White panel slab
    with dark ribbon windows, terracotta loggia stripes, a set-back two-floor crown."""
    b = bld(bx, bz); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    WH, GL, RB, GR = 0xe7e3d9, 0x39424e, 0xa04b35, 0x8e9196
    H0, FL = 4.0, 2.85; N = floors - 1; H = H0 + N * FL
    f.box(P, 0, 0, -2.5, L - 2.4, H0 + 2.5, W - 2.6, 0x5a5f66)                         # shopfronts / lobby
    f.box(P, 0, 0, H0, L - 0.8, N * FL, W - 1.4, GL)
    for k in range(N + 1): f.box(P, 0, 0, H0 + k * FL - 1.05, L, 1.05, W, WH)          # white spandrel bands
    piers = int(L // 5.6)
    for i in range(1, piers): f.box(P, -L / 2 + i * L / piers, 0, H0, 0.45, N * FL, W + 0.25, WH)
    for su in (-1, 1):
        f.box(P, su * (L / 2 - 1.1), 0, -2.5, 2.2, H + 3.2, W, WH)                     # end walls
        for k in range(N): f.quad_u(P, -0.9, 0.9, su * L / 2, H0 + k * FL + 0.5, H0 + k * FL + 1.6, GL, side=su)
        f.box(P, su * (L / 2 - 6.5), 0, H0, 5.0, N * FL, W + 1.3, RB)                  # loggia stripes
        for k in range(N): f.box(P, su * (L / 2 - 6.5), 0, H0 + k * FL - 0.25, 5.2, 0.25, W + 1.5, WH)
    f.box(P, 0, 0, H, L - 7, 5.4, W - 3.0, GL)                                        # crown
    f.box(P, 0, 0, H + 2.4, L - 6.6, 0.6, W - 2.6, WH)
    f.box(P, 0, 0, H + 5.4, L - 4.0, 0.9, W - 0.8, WH, top=GR)
    return finish(key, P, cx, cz, [r], H + 6, [b['c']])


def palatul():
    """Palatul Republicii (1984): low modernist hall wrapped in a colonnade of slender red-granite piers holding a
    heavy white cornice, gilded glazing behind, red granite plinth."""
    b = bld(-571.7, 68.8); r0 = b['ring']; r = simplify(r0, 1.6)
    P = lp.Part(); RG, GO, WH, PV = 0x8f4034, 0xc9a352, 0xe6e1d6, 0xa59a8c
    PL, HC = 1.8, 12.6
    P.extrude(r, -2.5, PL, col=RG, top=PV)                                             # granite plinth (stairs downhill)
    P.extrude(offset(r, -3.2), PL, PL + HC, col=GO)                               # gilded glass body
    for i in range(len(r)):                                                            # colonnade
        a, c = r[i], r[(i + 1) % len(r)]; L = math.hypot(c[0] - a[0], c[1] - a[1])
        if L < 3: continue
        n = max(1, round(L / 4.6)); ang = math.atan2(c[1] - a[1], c[0] - a[0])
        for k in range(n):
            t = (k + 0.5) / n; x, z = a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t
            P.box(1.0, HC, 0.8, at=(x, PL + HC / 2, z), ry=-ang, col=RG)
    ro = offset(r, 0.9)
    P.extrude(ro, PL + HC, PL + HC + 2.0, col=WH, top=0x9b968e)                        # cornice / roof
    f = F(-599.0, 31.5, math.radians(44.2))
    f.box(P, 0, 0, PL + HC + 2.0, 40, 4.5, 28, WH, top=0x9b968e)                       # raised hall volume
    f.box(P, 0, 0, PL + HC + 2.6, 40.3, 1.6, 28.3, GO)
    return finish('palatul', P, b['c'][0], b['c'][1], [r0], PL + HC + 6, [b['c']])


def gara():
    """Chișinău railway station: long cream two-floor building with white cornices along the tracks, a projecting
    central hall with a tall arched window, CHIȘINĂU letters, and the clock tower with a green cupola and gilded spire."""
    b = bld(2067.5, 1314.6); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    CR, WH, RF, DK, GN, GD = 0xebd9a4, 0xf6f2e8, 0x8a8277, 0x343b45, 0x4f8c70, 0xdcb441
    # +v = south-west = the station square
    P.extrude(r, -2.5, 8.5, col=CR, top=RF)
    P.extrude(offset(r, 0.35), 8.5, 9.3, col=WH, top=RF)
    ring_windows(P, r, [1.0, 4.9], 2.7, 1.7, 3.6, DK)
    for su in (-1, 1):                                                                 # end pavilions
        f.box(P, su * (L / 2 - 12), 0, -2.5, 15, 14.5, W - 2, CR, top=RF)
        f.box(P, su * (L / 2 - 12), 0, 11.8, 15.6, 0.9, W - 1.4, WH, top=RF)
        f.hip(P, su * (L / 2 - 12), 0, 12.7, 14, 3.0, W - 3, RF, ridge=0.3)
        for k in (-1, 0, 1): f.quad(P, su * (L / 2 - 12) + k * 4 - 1.1, su * (L / 2 - 12) + k * 4 + 1.1, (W - 2) / 2, 1.0, 9.5, DK)
    D = W / 2 + 2.0
    f.box(P, 0, 0, -2.5, 30, 18.5, 2 * D, CR, top=RF)                                 # central hall
    f.box(P, 0, 0, 15.5, 31, 1.2, 2 * D + 1, WH, top=RF)
    f.box(P, 0, 0, 16.7, 22, 1.4, 2 * D - 2, CR, top=RF)
    for sv in (-1, 1):
        f.quad(P, -4, 4, sv * D, 0.5, 9.5, DK, side=sv)                                # arched window / portal
        f.disc(P, 0, sv * (D - 0.05), 9.5, 4.0, 0.3, DK)
        for su in (-1, 1):
            f.box(P, su * 6.5, sv * (D + 0.2), -0.5, 1.4, 16, 0.6, WH)
            f.box(P, su * 12, sv * (D + 0.2), -0.5, 1.2, 16, 0.6, WH)
            f.quad(P, su * 9.25 - 1.3, su * 9.25 + 1.3, sv * D, 1.5, 6.5, DK, side=sv)
            f.quad(P, su * 9.25 - 1.3, su * 9.25 + 1.3, sv * D, 8.5, 12.5, DK, side=sv)
    text(P, f, 'CHISINAU', 0, D + 0.15, 13.0, 0.42, GD, side=1, depth=0.25)
    T = 9.0
    f.box(P, 0, 0, 18, T, 12, T, CR)                                                   # clock tower
    f.box(P, 0, 0, 29.3, T + 1, 0.9, T + 1, WH)
    for s in (-1, 1):
        f.disc(P, 0, s * (T / 2 + 0.05), 25.5, 1.9, 0.2, WH); f.disc(P, 0, s * (T / 2 + 0.2), 25.5, 0.25, 0.2, DK)
        f.disc(P, s * (T / 2 + 0.05), 0, 25.5, 1.9, 0.2, WH, axis='u'); f.disc(P, s * (T / 2 + 0.2), 0, 25.5, 0.25, 0.2, DK, axis='u')
        f.quad(P, -1.2, 1.2, s * T / 2, 19.5, 22.8, DK, side=s)
    f.cyl(P, 0, 0, 30.2, 3.4, 3.4, 4.2, n=8, col=CR, a0=PI / 8)                        # lantern
    f.cyl(P, 0, 0, 34.4, 3.9, 3.9, 0.6, n=8, col=WH, a0=PI / 8)
    f.cyl(P, 0, 0, 35.0, 3.7, 1.2, 3.4, n=8, col=GN, a0=PI / 8)                        # cupola
    f.cyl(P, 0, 0, 38.4, 1.2, 0.0, 13.0, n=8, col=GD, a0=PI / 8)                       # spire
    P.sphere(0.6, n=6, rings=3, at=(*f.p(0, 0)[:1], 44.5, f.p(0, 0)[1]), col=GD)
    return finish('gara', P, cx, cz, [r], 12, [b['c']])


def piata():
    """Piața Centrală: the long main market pavilion (cream walls, glazed band, metal barrel roofs)."""
    b = bld(873.9, 614.4); r = b['ring']; P = lp.Part()
    CRM, GL, RF, RF2, RFE = 0xe2d7bc, 0x56708a, 0x8ea3b0, 0x7f95a3, 0xd2c6a8
    P.extrude(r, -2.5, 7.0, col=CRM, top=0x7d8a92)
    ring_windows(P, r, [3.2], 2.9, 4.6, 5.6, GL)
    ring_windows(P, r, [0.0], 2.6, 3.0, 11.2, 0x3b3f44, minlen=10)                    # doors
    f = F(868.1, 581.0, math.atan2(72.4, 75.2))                                        # u: along the long strip, v: towards SW
    for k in range(8): f.vault(P, 0.5 + k * 12.875, 0.5 + (k + 1) * 12.875, 0.6, 17.4, 7.0, 4.8, RF if k % 2 else RF2, end=RFE)
    for k in range(3): f.vault_v(P, 3.0, 24.8, 17.4 + k * 13.27, 17.4 + (k + 1) * 13.27, 7.0, 5.4, RF if k % 2 else RF2, end=RFE)
    # main entrance on the Str. Mitropolit Varlaam side (-v), with the market's name over it
    WH, RD, DK = 0xf1ede4, 0xd3302a, 0x3b3f44
    f.box(P, 52, -1.2, -2.5, 15, 13.5, 4.6, WH, top=0x7d8a92)
    f.quad(P, 47.5, 56.5, -3.5, 0.0, 5.5, DK, side=-1)
    f.quad(P, 46.5, 57.5, -3.5, 6.5, 9.5, GL, side=-1)
    f.box(P, 52, -2.6, 11.0, 25.5, 3.4, 0.25, WH)
    text(P, f, 'PIATA CENTRALA', 52, -2.8, 11.6, 0.42, RD, side=-1, depth=0.2)
    for su in (-1, 1): f.box(P, 52 + su * 11.5, -2.4, 7.0, 0.35, 4.0, 0.35, 0x6b7177)
    cx, cz = _cen(r)
    return finish('piata', P, cx, cz, [r], 12, [b['c']])


def piata2():
    """Piața Centrală: the second (fruit) pavilion south of the main hall, same metal barrel roof."""
    b = bld(788.0, 538.0); r = b['ring']; cx, cz, a, L, W = mar(r); f = F(cx, cz, a); P = lp.Part()
    CRM, GL, RF, RF2, RFE = 0xe2d7bc, 0x56708a, 0x8ea3b0, 0x7f95a3, 0xd2c6a8
    P.extrude(r, -2.5, 6.5, col=CRM, top=0x7d8a92)
    ring_windows(P, r, [2.8], 2.9, 4.2, 5.4, GL)
    ring_windows(P, r, [0.0], 2.6, 3.0, 12.0, 0x3b3f44, minlen=10)
    nb = 4; bl = (L - 0.6) / nb
    for k in range(nb): f.vault(P, -L / 2 + 0.3 + k * bl, -L / 2 + 0.3 + (k + 1) * bl, -W / 2 + 0.3, W / 2 - 0.3, 6.5, 5.0, RF if k % 2 else RF2, end=RFE)
    return finish('piata2', P, cx, cz, [r], 11, [b['c']])


def hotelchisinau():
    """Hotel Chișinău (1950s Stalinist): L-shaped five-floor block on Bd. Negruzzi, cream walls over a rusticated
    ground floor, white cornices, a columned corner portico with an attic, grey-green hip roofs."""
    b = bld(1271.9, 1266.1); r = b['ring']; P = lp.Part()
    CR, RU, WH, DK, RF = 0xe9d6a8, 0xc9ae80, 0xf5f1e6, 0x3a3f46, 0x6c7a72
    # terrain: the ring's low corner is the east end; the SW wing climbs ~4 m (measured in game), so it steps up
    def wing(f, L, W, y0, wings=True):
        f.box(P, 0, 0, y0 - 2.5, L, 2.5 + 4.6, W, RU)                                  # rusticated ground floor
        f.box(P, 0, 0, y0 + 4.6, L - 0.6, 11.2, W - 0.6, CR)
        f.box(P, 0, 0, y0 + 4.4, L + 0.2, 0.4, W + 0.2, WH)
        f.box(P, 0, 0, y0 + 15.8, L + 0.6, 0.9, W + 0.6, WH)
        f.hip(P, 0, 0, y0 + 16.7, L, 3.2, W, RF, ridge=max(0.2, 1 - W / L))
        n = int((L - 3) // 3.4)
        for sv in (-1, 1):
            for i in range(n):
                u = -(n - 1) * 3.4 / 2 + i * 3.4
                f.quad(P, u - 0.75, u + 0.75, sv * W / 2, y0 + 1.0, y0 + 3.6, DK, side=sv)
                for k in range(4):
                    yy = y0 + 5.6 + k * 2.6
                    f.quad(P, u - 0.7, u + 0.7, sv * (W / 2 - 0.3), yy, yy + 1.7, DK, side=sv)
                    if k == 0: f.quad(P, u - 0.9, u + 0.9, sv * (W / 2 - 0.3), yy + 1.9, yy + 2.15, WH, side=sv)
    wing(F(1296.5, 1257.0, 0.02), 53, 12.5, 0.0)                                       # east wing
    a = math.atan2(1307.6 - 1270.0, 1230.0 - 1266.2)
    g = F(1248.1, 1288.8, a)
    wing(F(*g.p(-13, 0), a), 26.5, 15.8, 1.6)                                          # SW wing, near half
    wing(F(*g.p(13, 0), a), 26.5, 15.8, 3.2)                                           # SW wing, far half (uphill)
    c = F(1271.4, 1262.0, math.radians(156.5))                                          # corner block, +v = outward (north)
    c.box(P, 0, 0, -2.5, 18, 2.5 + 19.5, 18, CR)
    c.box(P, 0, 0, -2.5, 18.6, 2.5 + 4.6, 18.6, RU)
    c.box(P, 0, 0, 16.2, 19.2, 1.0, 19.2, WH)
    c.box(P, 0, 0, 17.2, 13, 4.2, 13, CR)                                               # attic
    c.box(P, 0, 0, 21.4, 13.6, 0.7, 13.6, WH)
    c.hip(P, 0, 0, 22.1, 12, 3.0, 12, RF, ridge=0.0)
    c.box(P, 0, 9.6, 4.6, 14, 0.8, 3.2, WH)                                            # portico
    for k in range(6): c.cyl(P, -6 + k * 2.4, 10.4, 5.4, 0.55, 0.5, 10.4, n=8, col=WH)
    c.box(P, 0, 9.9, 15.8, 14.6, 1.0, 2.4, WH)
    c.quad(P, -2, 2, 9.0, 0.0, 4.2, DK)
    text(P, c, 'HOTEL CHISINAU', 0, 9.1 + 0.2, 18.2, 0.32, 0xc7a23c, side=1, depth=0.15)
    return finish('hotelchisinau', P, b['c'][0], b['c'][1], [r], 19, [b['c']])


def ciuflea():
    """Ciuflea monastery church of St Theodore Tiron (1858): white cross-shaped church with sky-blue onion domes and
    gold crosses: big central dome, four corner domes, west bell tower over the entrance, east apse."""
    b = bld(1101.2, 1324.8); r = b['ring']; cx, cz, a, L, W = mar(r)
    # long axis is the church axis; make +v point west (entrance + bell tower), -v east (altar)
    f = F(cx, cz, a + PI / 2)
    if f.dir(0, 1)[0] > 0: f = F(cx, cz, a - PI / 2)
    P = lp.Part()
    WH, BS, BL, RF, GD, DK = 0xf4f1e8, 0xd9d2c0, 0x3b6fc0, 0x4f7fc4, 0xe4b23a, 0x40536a
    Lu, Wv = W, L  # after the quarter turn: u spans the narrow side, v the long axis
    vt = -1.5
    f.box(P, 0, 0, -2.5, 10.5, 13.0, Wv - 2.0, WH)                                    # nave
    f.box(P, 0, vt, -2.5, Lu - 0.4, 13.0, 9.0, WH)                                     # transept
    f.box(P, 0, 0, -2.5, 11.0, 3.2, Wv - 1.4, BS); f.box(P, 0, vt, -2.5, Lu, 3.2, 9.4, BS)
    f.gable(P, 0, 0, 10.5, 11.2, 3.0, Wv - 1.6, 'v', RF)
    f.gable(P, 0, vt, 10.5, 9.6, 3.0, Lu + 0.2, 'u', RF)
    for sv in (-1, 1):
        for vv in (-8.5, 4.5, 8.5): f.quad_u(P, vv - 0.8, vv + 0.8, sv * 5.25, 3.5, 7.6, DK, side=sv)
        f.quad_u(P, vt - 1.0, vt + 1.0, sv * (Lu / 2 - 0.2), 3.5, 8.2, DK, side=sv)
    f.cyl(P, 0, vt, 10.5, 4.3, 4.3, 7.5, n=8, col=WH, a0=PI / 8)                       # central drum
    x, z = f.p(0, vt)
    onion(P, x, 18.0, z, 4.6, BL, GD, ry=-f.a)
    for su in (-1, 1):
        for sv in (-1, 1):
            x, z = f.p(su * 4.0, vt + sv * 4.2)
            P.cyl(1.4, 1.4, 4.0, n=8, at=(x, 13.0, z), col=WH)
            onion(P, x, 15.0, z, 1.7, BL, GD, ry=-f.a)
    vb = Wv / 2 - 3.6                                                                  # bell tower (west)
    f.box(P, 0, vb, -2.5, 7.4, 2.5 + 15.5, 7.4, WH)
    f.box(P, 0, vb, 15.5, 7.8, 0.6, 7.8, BS)
    f.box(P, 0, vb, 16.1, 5.8, 6.0, 5.8, WH)
    for s in (-1, 1):
        f.quad(P, -1.0, 1.0, vb + s * 2.9, 17.0, 21.0, DK, side=s)
        f.quad_u(P, vb - 1.0, vb + 1.0, s * 2.9, 17.0, 21.0, DK, side=s)
    f.quad(P, -1.3, 1.3, vb + 3.7, 0.0, 4.2, DK, side=1)
    f.cyl(P, 0, vb, 22.1, 2.3, 2.3, 2.4, n=8, col=WH, a0=PI / 8)
    x, z = f.p(0, vb); onion(P, x, 24.5, z, 2.6, BL, GD, ry=-f.a)
    va = -(Wv / 2 - 4.2)                                                               # apse (east)
    f.cyl(P, 0, va, -2.5, 4.6, 4.6, 12.0, n=8, col=WH, a0=PI / 8)
    f.cyl(P, 0, va, 9.5, 5.0, 0.4, 2.6, n=8, col=RF, a0=PI / 8)
    return finish('ciuflea', P, cx, cz, [r], 12, [b['c']])


def mazarache():
    """Măzărache church (1752), the oldest in the city: small white stone church with green roofs, a squat bell tower
    with a tented roof at the west end, a little dome over the nave, a rounded east apse."""
    b = bld(1246.6, -691.8); r = b['ring']; P = lp.Part()
    WH, ST, RF, DK, GD = 0xefe9da, 0xb9ad93, 0x5c8f6b, 0x3a3f44, 0xe0b040
    f = F(1244.2, -691.4, math.atan2(-0.5, 8.0))                                      # u = east
    f.box(P, -10.2, -0.3, -2.5, 7.8, 2.5 + 14.5, 8.2, WH)                             # bell tower
    f.box(P, -10.2, -0.3, -2.5, 8.2, 3.5, 8.6, ST)
    f.box(P, -10.2, -0.3, 12.0, 8.4, 0.6, 8.8, ST)
    f.box(P, -10.2, -0.3, 12.6, 6.4, 4.2, 6.4, WH)
    for s in (-1, 1):
        f.quad(P, -11.2, -9.2, -0.3 + s * 3.2, 13.4, 16.2, DK, side=s)
        f.quad_u(P, -1.3, 0.7, -10.2 + s * 3.2, 13.4, 16.2, DK, side=s)
    f.box(P, -10.2, -0.3, 16.8, 7.0, 0.5, 7.0, ST)
    f.cyl(P, -10.2, -0.3, 17.3, 4.6, 0.3, 5.6, n=4, col=RF, a0=PI / 4)                 # tented roof
    x, z = f.p(-10.2, -0.3); onion(P, x, 22.6, z, 0.75, RF, GD, ry=-f.a)
    f.quad_u(P, -1.6, 1.0, -14.1, 0.0, 4.2, DK, side=-1)                               # west door
    f.box(P, -3.6, 0.0, -2.5, 5.2, 2.5 + 7.0, 15.4, WH)                                # side chapels / transept
    f.box(P, 4.0, -0.3, -2.5, 10.2, 2.5 + 7.4, 10.8, WH)                               # nave
    f.box(P, 4.0, -0.3, -2.5, 10.6, 3.4, 11.2, ST); f.box(P, -3.6, 0, -2.5, 5.6, 3.4, 15.8, ST)
    f.cyl(P, 9.6, -0.3, -2.5, 4.4, 4.4, 2.5 + 6.6, n=8, col=WH, a0=PI / 8)             # apse
    f.cyl(P, 9.6, -0.3, 4.1, 4.8, 0.6, 2.6, n=8, col=RF, a0=PI / 8)
    f.gable(P, 4.0, -0.3, 7.4, 11.4, 3.3, 11.0, 'u', RF)
    f.gable(P, -3.6, 0.0, 7.0, 6.2, 2.6, 16.2, 'v', RF)
    for s in (-1, 1):
        for u in (1.5, 6.5): f.quad(P, u - 0.6, u + 0.6, -0.3 + s * 5.4, 3.2, 5.6, DK, side=s)
    f.cyl(P, 4.0, -0.3, 9.6, 1.7, 1.7, 2.6, n=8, col=WH, a0=PI / 8)                     # nave dome
    x, z = f.p(4.0, -0.3); onion(P, x, 12.2, z, 1.9, RF, GD, ry=-f.a)
    return finish('mazarache', P, b['c'][0], b['c'][1], [r], 9, [b['c']])


def pantelimon():
    """St Pantelimon, the 'Greek church' (1891, Bernardazzi): neo-Byzantine, walls striped in red brick and cream
    stone, a tall drum with a grey-blue dome and four corner turrets with small domes."""
    b = bld(12.9, 451.5); r = b['ring']; P = lp.Part()
    RB, CS, RF, DM, DK, GD = 0xa8432f, 0xebdfc4, 0x6d7279, 0x5d6f82, 0x2f3238, 0xe0b040
    xs, zs = [p[0] for p in r], [p[1] for p in r]; f = F((max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2, 0.0)
    H = 10.4; bands = 13; y = -2.4
    for k in range(bands):
        y1 = -2.4 + (k + 1) * (H + 2.4) / bands
        ring_walls(P, r, y, y1, RB if k % 2 == 0 else CS); y = y1
    P.extrude(r, H, H + 0.6, col=CS, top=RF)
    f.gable(P, 0, 0, H + 0.6, 9.5, 3.4, 22.0, 'u', RF)
    f.gable(P, 0, 0, H + 0.6, 9.5, 3.4, 15.2, 'v', RF)
    ring_windows(P, r, [3.2], 3.6, 1.4, 3.6, DK, minlen=5)
    f.quad_u(P, -1.6, 1.6, -11.2, 0.0, 5.2, DK, side=-1)                               # west portal
    f.disc(P, -11.25, 0, 5.2, 1.6, 0.2, DK, axis='u')
    yd = H + 2.6
    for k in range(4):
        P.cyl(4.2, 4.2, 1.5, n=12, at=(f.cx, yd + k * 1.5 + 0.75, f.cz), col=RB if k % 2 == 0 else CS, caps=False)
    for k in range(12):
        t = (k + 0.5) * 2 * PI / 12; x, z = f.cx + 4.25 * math.cos(t), f.cz - 4.25 * math.sin(t)
        P.box(1.0, 3.2, 0.1, at=(x, yd + 3.2, z), ry=PI / 2 + t + PI / 2, col=DK)
    P.cyl(4.6, 4.6, 0.5, n=12, at=(f.cx, yd + 6.25, f.cz), col=CS)
    P.sphere(4.4, n=12, rings=3, hemi=True, sy=1.15, at=(f.cx, yd + 6.5, f.cz), col=DM)
    P.box(0.22, 2.4, 0.22, at=(f.cx, yd + 6.5 + 5.06 + 1.2, f.cz), col=GD)
    P.box(1.3, 0.22, 0.22, at=(f.cx, yd + 6.5 + 5.06 + 1.7, f.cz), col=GD)
    for su in (-1, 1):
        for sv in (-1, 1):
            x, z = f.p(su * 7.6, sv * 4.6)
            for k in range(3): P.cyl(1.35, 1.35, 1.1, n=8, at=(x, H + 0.6 + k * 1.1 + 0.55, z), col=RB if k % 2 == 0 else CS, caps=False)
            P.sphere(1.45, n=8, rings=2, hemi=True, sy=1.2, at=(x, H + 3.9, z), col=DM)
            P.box(0.14, 1.0, 0.14, at=(x, H + 3.9 + 1.74 + 0.5, z), col=GD)
    return finish('pantelimon', P, b['c'][0], b['c'][1], [r], 11, [b['c']])


def eternitate():
    """Eternitate memorial (1975): five rifle-shaped red-granite pylons leaning together over the eternal flame,
    on a round stepped granite platform, a five-pointed star around the flame."""
    b = bld(18.2, 1720.3); cx, cz = 19.6, 1721.0; P = lp.Part()
    RG, RGD, GRN, ST, FL, FY = 0x8f4a3b, 0x6e3329, 0x9e978d, 0x6a2a22, 0xff8a1e, 0xffd24a
    P.cyl(13.5, 13.5, 2.5, n=20, at=(cx, -1.0, cz), col=GRN)                           # steps
    P.cyl(11.8, 11.8, 0.35, n=20, at=(cx, 0.43, cz), col=GRN)
    star = []
    for k in range(10):
        t = -PI / 2 + k * PI / 5; rr = 4.4 if k % 2 == 0 else 1.8
        star.append((cx + rr * math.cos(t), cz + rr * math.sin(t)))
    P.extrude(star, 0.6, 1.0, col=ST)
    P.cyl(0.9, 0.0, 2.0, n=6, at=(cx, 2.0, cz), col=FL)
    P.cyl(0.5, 0.0, 1.4, n=5, at=(cx, 1.7, cz), col=FY, a0=0.4)
    fps = []; Hc = 24.5
    for k in range(5):
        t = PI / 2 + k * 2 * PI / 5                                                    # one pylon on the west axis
        g = F(cx, cz, t)
        def Q(rad, half, thick, y):  # quad around radius rad along direction t
            return [g.P3(rad - thick / 2, y, -half), g.P3(rad + thick / 2, y, -half), g.P3(rad + thick / 2, y, half), g.P3(rad - thick / 2, y, half)]
        lo, mid = Q(9.6, 1.9, 1.5, -2.5), Q(2.2, 0.85, 0.8, Hc)
        cen = g.P3(5.5, Hc * 0.4, 0)
        for i in range(4):
            oface(P, [lo[i], lo[(i + 1) % 4], mid[(i + 1) % 4], mid[i]], RGD if i == 1 else RG,
                  _sub(tuple((lo[i][j] + mid[(i + 1) % 4][j]) / 2 for j in range(3)), cen))
        apex = g.P3(0.7, Hc + 5.5, 0)
        for i in range(4): oface(P, [mid[i], mid[(i + 1) % 4], apex], RG, _sub(tuple((mid[i][j] + mid[(i + 1) % 4][j]) / 2 for j in range(3)), g.P3(1.8, Hc + 1, 0)))
        base = [g.p(rad + dt, s * h) for rad, dt, s, h in ((9.6, -0.9, -1, 2.0), (9.6, 0.9, -1, 2.0), (9.6, 0.9, 1, 2.0), (9.6, -0.9, 1, 2.0))]
        fps.append(base)
    return finish('eternitate', P, cx, cz, fps, 24, [b['c']])


def tvtower():
    """Chișinău TV tower (196 m): square steel lattice tapering in red/white sections, two platforms, red/white mast."""
    cx, cz = -1759.0, 2667.0; P = lp.Part()
    RD, WH, GR = 0xc8322a, 0xf2f2ee, 0x6d7076
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
        P.cyl(1.0 - k * 0.1, 0.9 - k * 0.1, 7.0, n=6, at=(cx, y0 + 3.5, cz), col=RD if k % 2 == 0 else WH)
    P.cyl(0.25, 0.1, 3.0, n=4, at=(cx, 196.5, cz), col=RD)
    fps = [square(c[0], c[2], 1.2) for c in corners(0)]
    return finish('tvtower', P, cx, cz, fps, 30, [])


def zimbru():
    """Zimbru stadium (2006): stands on three sides on a concrete podium, yellow seats with green rows, the main
    south stand with VIP glazing under a cantilever roof, four corner floodlight masts, the pitch."""
    U = bld(2700.7, 4884.6); S = bld(2683.0, 4955.0, r=15); P = lp.Part()
    YL, GN, CO, GL, WH, PG, PG2, LN = 0xf0c419, 0x1f7a3a, 0xb9bcbf, 0x3e4a57, 0xe9e9e6, 0x4f9a3a, 0x5aa846, 0xf4f4f0
    # the bowl is level, the hillside is not: lowest ground under the stands is ~2.6 m below the pitch (measured)
    PY = 2.6

    def stand(i0, i1, o0, o1, yin, yout, rows=6, pat=(GN, YL, YL, GN, YL, YL)):
        I0, I1, O0, O1 = [(p[0], p[1]) for p in (i0, i1, o0, o1)]
        lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        cen = ((I0[0] + I1[0] + O0[0] + O1[0]) / 4, (I0[1] + I1[1] + O0[1] + O1[1]) / 4)
        out = ((O0[0] + O1[0]) / 2 - (I0[0] + I1[0]) / 2, 0, (O0[1] + O1[1]) / 2 - (I0[1] + I1[1]) / 2)
        a_dir = (I1[0] - I0[0], 0, I1[1] - I0[1])
        yb = -1.5; prev = yin
        oface(P, [(I0[0], yb, I0[1]), (I1[0], yb, I1[1]), (I1[0], yin, I1[1]), (I0[0], yin, I0[1])], CO, (-out[0], 0, -out[2]))
        for k in range(rows):
            t0, t1 = k / rows, (k + 1) / rows; y1 = yin + (yout - yin) * t1
            a0, b0, a1, b1 = lerp(I0, O0, t0), lerp(I1, O1, t0), lerp(I0, O0, t1), lerp(I1, O1, t1)
            col = pat[k % len(pat)]
            oface(P, [(a0[0], prev, a0[1]), (b0[0], prev, b0[1]), (b0[0], y1, b0[1]), (a0[0], y1, a0[1])], col, (-out[0], 0, -out[2]))
            oface(P, [(a0[0], y1, a0[1]), (b0[0], y1, b0[1]), (b1[0], y1, b1[1]), (a1[0], y1, a1[1])], col, (0, 1, 0))
            for (p0, p1, sd) in ((a0, a1, -1), (b0, b1, 1)):
                oface(P, [(p0[0], yb, p0[1]), (p1[0], yb, p1[1]), (p1[0], y1, p1[1]), (p0[0], y1, p0[1])], CO, (sd * a_dir[0], 0, sd * a_dir[2]))
            prev = y1
        oface(P, [(O0[0], yb, O0[1]), (O1[0], yb, O1[1]), (O1[0], yout + 1.2, O1[1]), (O0[0], yout + 1.2, O0[1])], CO, out)
        oface(P, [(O0[0], yout, O0[1]), (O1[0], yout, O1[1]), (O1[0], yout + 1.2, O1[1]), (O0[0], yout + 1.2, O0[1])], CO, (-out[0], 0, -out[2]))
        L = math.hypot(*(O1[0] - O0[0], O1[1] - O0[1])); n = int(L // 6)               # green band + openings on the back
        ux, uz = (O1[0] - O0[0]) / L, (O1[1] - O0[1]) / L; on = _unit(out)
        for j in range(n):
            t = (j + 0.5) * L / n; x, z = O0[0] + ux * t + on[0] * 0.08, O0[1] + uz * t + on[2] * 0.08
            oface(P, [(x - ux * 1.6, PY + 2.5, z - uz * 1.6), (x + ux * 1.6, PY + 2.5, z + uz * 1.6), (x + ux * 1.6, PY + 5.0, z + uz * 1.6), (x - ux * 1.6, PY + 5.0, z - uz * 1.6)], GL, out)
        oface(P, [(O0[0] + on[0] * 0.08, yout - 1.0, O0[1] + on[2] * 0.08), (O1[0] + on[0] * 0.08, yout - 1.0, O1[1] + on[2] * 0.08),
                  (O1[0] + on[0] * 0.08, yout + 0.6, O1[1] + on[2] * 0.08), (O0[0] + on[0] * 0.08, yout - 0.0 + 0.6, O0[1] + on[2] * 0.08)], GN, out)

    yi, yo = PY + 1.2, PY + 11.0
    stand((2642.8, 4862.3), (2629.1, 4937.2), (2625.0, 4853.7), (2610.3, 4933.8), yi, yo)       # west
    stand((2642.8, 4862.3), (2754.5, 4882.5), (2647.0, 4843.2), (2755.2, 4862.6), yi, yo)       # north
    stand((2754.5, 4882.5), (2741.0, 4957.1), (2774.2, 4880.5), (2759.7, 4960.7), yi, yo)       # east
    P.extrude([(2625.0, 4853.7), (2637.7, 4844.0), (2647.0, 4843.2), (2642.8, 4862.3)], -1.5, yo + 1.2, col=CO)
    P.extrude([(2755.2, 4862.6), (2763.3, 4866.7), (2768.9, 4873.8), (2774.2, 4880.5), (2754.5, 4882.5)], -1.5, yo + 1.2, col=CO)
    # main (south) stand: the building strip from the data + seats in front + cantilever roof
    s = S['ring']; d = (2737.7 - 2630.3, 4961.3 - 4941.7); Ls = math.hypot(*d); ud = (d[0] / Ls, d[1] / Ls); nn = (ud[1], -ud[0])
    A, Bp = (2630.3, 4941.7), (2737.7, 4961.3)
    stand((A[0] + nn[0] * 5, A[1] + nn[1] * 5), (Bp[0] + nn[0] * 5, Bp[1] + nn[1] * 5), A, Bp, yi, PY + 7.0, rows=4, pat=(YL, GN, YL, YL))
    P.extrude(s, -1.5, PY + 17.0, col=CO, top=0x8e9196)
    fs = F((A[0] + Bp[0]) / 2, (A[1] + Bp[1]) / 2, math.atan2(d[1], d[0]))           # u along the stand, -v = towards the pitch
    fs.quad(P, -Ls / 2 + 6, Ls / 2 - 6, -0.0, PY + 8.5, PY + 12.5, GL, side=-1)
    for k in range(7): fs.quad(P, -Ls / 2 + 8 + k * (Ls - 16) / 6 - 2.5, -Ls / 2 + 8 + k * (Ls - 16) / 6 + 2.5, 7.0, PY + 0.0, PY + 3.4, GL, side=1)
    fs.box(P, 0, 7.4, PY + 13.0, Ls - 10, 1.4, 0.3, GN)
    rl, rd = Ls - 6, 17.0
    hexa(P, [fs.P3(-rl / 2, PY + 18.6, 3.0), fs.P3(rl / 2, PY + 18.6, 3.0), fs.P3(rl / 2, PY + 20.4, -rd), fs.P3(-rl / 2, PY + 20.4, -rd)],
         [fs.P3(-rl / 2, PY + 19.4, 3.0), fs.P3(rl / 2, PY + 19.4, 3.0), fs.P3(rl / 2, PY + 21.0, -rd), fs.P3(-rl / 2, PY + 21.0, -rd)], WH)
    for k in range(6):
        u = -rl / 2 + 4 + k * (rl - 8) / 5
        beam(P, fs.P3(u, PY + 17.0, 1.5), fs.P3(u, PY + 21.6, -rd + 1.0), 0.7, 0x9a9da1)
        beam(P, fs.P3(u, PY + 21.6, -rd + 1.0), fs.P3(u, PY + 21.6, 2.5), 0.6, 0x9a9da1)
    # pitch
    fp_ = F(2692.0, 4910.0, math.atan2(d[1], d[0]))
    fp_.box(P, 0, 0, -1.5, 112, PY + 1.55, 78, PG)
    for k in range(10):
        if k % 2: fp_.box(P, -52.5 + k * 10.5 + 5.25, 0, PY + 0.05, 10.5, 0.02, 68, PG2)
    Lp, Wp, y = 105, 68, PY + 0.09
    def line(u0, v0, u1, v1, w=0.15):
        du, dv = u1 - u0, v1 - v0; L = math.hypot(du, dv) or 1; nu, nv = -dv / L * w, du / L * w
        oface(P, [fp_.P3(u0 - nu, y, v0 - nv), fp_.P3(u1 - nu, y, v1 - nv), fp_.P3(u1 + nu, y, v1 + nv), fp_.P3(u0 + nu, y, v0 + nv)], LN, (0, 1, 0))
    for a0, b0, a1, b1 in ((-Lp / 2, -Wp / 2, Lp / 2, -Wp / 2), (-Lp / 2, Wp / 2, Lp / 2, Wp / 2), (-Lp / 2, -Wp / 2, -Lp / 2, Wp / 2), (Lp / 2, -Wp / 2, Lp / 2, Wp / 2), (0, -Wp / 2, 0, Wp / 2)):
        line(a0, b0, a1, b1)
    for sg in (-1, 1):
        e = sg * Lp / 2; i = sg * (Lp / 2 - 16.5)
        line(e, -20.2, i, -20.2); line(e, 20.2, i, 20.2); line(i, -20.2, i, 20.2)
        P.box(0.3, 2.44, 7.3, at=(*fp_.P3(e + sg * 1.0, PY + 1.22, 0)[:1], PY + 1.22, fp_.P3(e + sg * 1.0, 0, 0)[2]), ry=-fp_.a, col=LN)
    pts = [(9.15 * math.cos(k * 2 * PI / 16), 9.15 * math.sin(k * 2 * PI / 16)) for k in range(17)]
    for k in range(16): line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1])
    # floodlight masts
    for mx, mz in ((2619.0, 4843.0), (2772.0, 4864.0), (2765.0, 4971.0), (2606.0, 4945.0)):
        P.cyl(0.9, 0.55, PY + 43.5, n=6, at=(mx, (PY + 42.0) / 2 - 0.75, mz), col=0x8f9399)
        ang = math.atan2(4910.0 - mz, 2692.0 - mx); fl = F(mx, mz, ang)
        fl.box(P, 0.6, 0, PY + 40.5, 1.2, 4.6, 7.0, 0x7f8388)
        fl.quad_u(P, -3.2, 3.2, 1.2, PY + 40.9, PY + 44.7, 0xfff3c2, side=1)
    # the pitch is a 'clear' area: walkable, but vegetation plants no trees on the grass
    pitch = [fp_.p(-56, -39), fp_.p(56, -39), fp_.p(56, 39), fp_.p(-56, 39)]
    return finish('zimbru', P, 2692.0, 4910.0, [U['ring'], s], 14, [U['c'], S['c']], clear=[pitch])


def build():
    out = []
    for fn in (cosmos, national, romanita, lambda: gate_tower('gates', 2825.4, 5325.6, 16), lambda: gate_tower('gates2', 2912.7, 5205.5, 17),
               palatul, gara, piata, piata2, hotelchisinau, ciuflea, mazarache, pantelimon, eternitate, tvtower, zimbru):
        out.append(fn())
    return out
