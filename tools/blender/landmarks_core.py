"""The 14 original landmarks as PS2-style low-poly models (flat colours, flat shading, chunky shapes).
build() → one Blender object per landmark, named by its key, with prop 'lm' (see lm_glbList in js/landmarks.js):
  {x, z, fp:[ring...], h, hs:[h per ring] (optional), skip:[[x,z]...], base:ring (optional, default fp[0])}
Geometry is in game coordinates relative to (x, base, z); y = 0 is the lowest ground under the base ring, so walls and
plinths start below 0 (-1.5 m) to stay grounded on the downhill side.

Placement: arc / cathedral / belltower / statue from world.json `special` ([x, z, angle, size]); the others are fitted to
their OSM footprints (lp.footprint) and the State Circus to its drum + back wing rings. Fronts face the nearest named road.
Run through tools/blender/landmarks.py."""
import sys, os, math, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp
from mathutils import Vector
from mathutils.geometry import tessellate_polygon

TAU = 2 * math.pi

# ---------------- palette (hex = colour on screen) ----------------
CREAM = 0xefe3c4; WHITE = 0xf8f4ea; IVORY = 0xf3ecdc; BEIGE = 0xd8ceb8; PAVE = 0xc9c1b1
DOME = 0x4b6172; ROOF = 0x7d7a74; GOLD = 0xd8b24a; BRONZE = 0x46553f; BRONZE2 = 0x34412f
GLASS = 0x2b3743; DARK = 0x2a2623; DOOR = 0x4a2f22; BRICK = 0xb0503a; BRICK2 = 0xa5452f
STONE = 0xd9d3c6; COPPER = 0x5d7468


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
    """Cornice / string course: a strip `out` metres proud of the wall (outer face, top and underside only)."""
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
    """Window outline (world xyz) centred at c=(x,z) along unit u: rect / arch (round top) / point (gothic)."""
    P = lambda dx, y: (c[0] + u[0] * dx, y, c[1] + u[1] * dx)
    if shape == 'arch':
        ys = yt - w / 2
        return [P(-w / 2, yb), P(w / 2, yb)] + [P(w / 2 * math.cos(a), ys + w / 2 * math.sin(a)) for a in [k * math.pi / 4 for k in range(5)]]
    if shape == 'point':
        ys = yt - w * .6
        return [P(-w / 2, yb), P(w / 2, yb), P(w / 2, ys), P(0, yt), P(-w / 2, ys)]
    return [P(-w / 2, yb), P(w / 2, yb), P(w / 2, yt), P(-w / 2, yt)]


def window(p, c, u, n, yb, h, w, col, shape='rect', frame=None, fw=.25, out=.08):
    if frame is not None:
        qface(p, win_shape((c[0] + n[0] * out * .5, c[1] + n[1] * out * .5), u, yb - fw, yb + h + fw, w + 2 * fw, shape), frame, n=(n[0], 0, n[1]))
    qface(p, win_shape((c[0] + n[0] * out, c[1] + n[1] * out), u, yb, yb + h, w, shape), col, n=(n[0], 0, n[1]))


def ring_windows(p, ring, rows, sp, w, col, shape='rect', frame=None, fw=.25, minL=None, ok=None, out=.08):
    """Windows on every wall edge of a ring: rows = [(y_bottom, height)...], one column per `sp` metres."""
    for e in edges(ring):
        a, b, L, u, n = e
        if L < (minL if minL is not None else sp * .9) or (ok and not ok(e)): continue
        k = max(1, int(L / sp))
        for i in range(k):
            t = (i + .5) * L / k; c = (a[0] + u[0] * t, a[1] + u[1] * t)
            for yb, h in rows: window(p, c, u, n, yb, h, w, col, shape, frame, fw, out)


def ring_fins(p, ring, y0, y1, sp, w, d, col, minL=None, ends=True, ok=None):
    """Vertical fins / pilasters standing proud of the wall between window columns."""
    for e in edges(ring):
        a, b, L, u, n = e
        if L < (minL if minL is not None else sp * .9) or (ok and not ok(e)): continue
        k = max(1, int(L / sp))
        for i in range(0 if ends else 1, k + 1 if ends else k):
            t = i * L / k; t = min(max(t, w / 2), L - w / 2)
            x, z = a[0] + u[0] * t + n[0] * d / 2, a[1] + u[1] * t + n[1] * d / 2
            p.box(w, y1 - y0, d, at=(x, (y0 + y1) / 2, z), ry=math.atan2(-u[1], u[0]), col=col)


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


def column(F, lx, lz, y0, h, r, col, cap=None, n=8, base=True):
    """Classical column: square plinth, n-gon shaft, capital block (chunky PS2 style)."""
    cap = cap if cap is not None else col
    if base: F.box(r * 2.5, r * .5, r * 2.5, lx, y0, lz, cap)
    F.cyl(r, r * .88, h - r * 1.2, lx, y0 + r * .5, lz, col, n=n, caps=False)
    F.cyl(r * .95, r * 1.3, r * .4, lx, y0 + h - r * 1.1, lz, cap, n=n, caps=False)
    F.box(r * 2.6, r * .45, r * 2.6, lx, y0 + h - r * .7, lz, cap)


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
    """Clock face on a wall whose outward normal is local +z (after ry): white octagon, dark rim and hands."""
    G = F.sub(0, 0, ry)
    oc = lambda rr, dz: [(rr * math.cos(k * TAU / 8 + math.pi / 8), y + rr * math.sin(k * TAU / 8 + math.pi / 8), lz + dz) for k in range(8)]
    G.face(oc(r * 1.15, .05), DARK, n=(0, 0, 1)); G.face(oc(r, .1), WHITE, n=(0, 0, 1))
    G.face([(-r * .06, y, lz + .14), (r * .06, y, lz + .14), (r * .06, y + r * .8, lz + .14), (-r * .06, y + r * .8, lz + .14)], DARK, n=(0, 0, 1))
    G.face([(0, y - r * .05, lz + .15), (r * .55, y - r * .05, lz + .15), (r * .55, y + r * .05, lz + .15), (0, y + r * .05, lz + .15)], DARK, n=(0, 0, 1))


def flag(F, lx, lz, y0, h=6.0, ry=0.0):
    """Moldovan flag on a pole (blue-yellow-red, with the arms)."""
    F.cyl(.08, .06, h, lx, y0, lz, 0xdddddd, n=6)
    G = F.sub(lx, lz, ry)
    for i, c in enumerate((0x0046ae, 0xffd200, 0xcc092f)): G.box(.9, 1.8, .06, .5 + i * .9, y0 + h - 2.0, 0, c)
    G.box(.35, .5, .1, 1.4, y0 + h - 1.35, 0, 0x8a6a2a)


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


def make(p, key, x, z, fp, h, skip=(), hs=None, base=None):
    lm = {'x': round(x, 2), 'z': round(z, 2), 'fp': [r2(r) for r in fp], 'h': h, 'skip': [[round(c[0], 2), round(c[1], 2)] for c in skip]}
    if hs: lm['hs'] = hs
    if base: lm['base'] = r2(base)
    return p.obj(key, props={'lm': lm}, origin=(x, 0, z))


STF = lambda name, w: 'Ștefan cel Mare' in name


# ================= special landmarks (world.json special) =================
def arc(S):
    x, z, ang, size = S['arc']; k = size / 10.2; p = lp.Part(); F = Fr(p, x, z, ang)
    A, W, PL = 0xeadfc2, WHITE, 0xd2c7ad
    Sz, ws, pw = 10.2 * k, 5.2 * k, 2.5 * k; o = ws / 2 + pw / 2
    yS, yT = 6.0 * k, 9.05 * k
    for sx in (-1, 1):
        for sz in (-1, 1):
            F.box(pw + .7 * k, 1.5 + .8 * k, pw + .7 * k, sx * o, -1.5, sz * o, PL)
            F.box(pw, yT - .8 * k, pw, sx * o, .8 * k, sz * o, A)
            F.box(pw + .25 * k, .35 * k, pw + .25 * k, sx * o, yS - .35 * k, sz * o, W)   # impost
    for i in range(4):
        G = F.sub(0, 0, i * math.pi / 2)
        arch_span(G.sub(0, o), ws, yS, yT, pw, A, n=6, under=0xe2d6b8)
        G.box(.55 * k, .9 * k, pw + .2 * k, 0, yS + ws / 2 - .2 * k, o, W)            # keystone
        for lat in (o - pw / 2 + .45 * k, o + pw / 2 - .45 * k):                        # 2 engaged columns per pylon face
            for sd in (-1, 1): column(G, sd * lat, Sz / 2 + .12 * k, .8 * k, yT - .8 * k, .3 * k, W, n=8)
        clock(G, (Sz - .6 * k) / 2, 11.55 * k, .9 * k)
        for sd in (-1, 1): G.box(2.2 * k, 1.0 * k, .12, sd * 3.0 * k, 11.05 * k, (Sz - .6 * k) / 2 + .02, 0xdccfae)  # attic panels
    F.box(ws, .45 * k, ws, 0, yS + ws / 2, 0, 0xd8ccb0)                                     # vault over the crossing
    F.box(Sz + .5 * k, 1.0 * k, Sz + .5 * k, 0, yT, 0, A)                                   # entablature
    F.box(Sz + .7 * k, .25 * k, Sz + .7 * k, 0, yT + .1 * k, 0, W)
    F.box(Sz + 1.2 * k, .38 * k, Sz + 1.2 * k, 0, yT + 1.0 * k, 0, W)                     # cornice
    F.box(Sz - .6 * k, 2.3 * k, Sz - .6 * k, 0, yT + 1.38 * k, 0, A)                     # attic
    F.box(Sz - .2 * k, .3 * k, Sz - .2 * k, 0, yT + 3.68 * k, 0, W)
    F.box(Sz - 2.6 * k, .8 * k, Sz - 2.6 * k, 0, yT + 3.98 * k, 0, A)
    F.box(Sz - 2.2 * k, .22 * k, Sz - 2.2 * k, 0, yT + 4.78 * k, 0, W)
    pyl = [F.rect(pw + .7 * k, pw + .7 * k, sx * o, sz * o) for sx in (-1, 1) for sz in (-1, 1)]
    return make(p, 'arc', x, z, pyl, round(yT + 5.0 * k, 1), base=F.rect(Sz * 1.35, Sz * 1.35))


def cathedral(S):
    x, z, ang, size = S['cathedral']; k = size / 31; p = lp.Part(); F = Fr(p, x, z, ang)
    a, e, H, dep = 6.5 * k, 14 * k, 13.5 * k, 4.6 * k
    W, WT, RF = 0xf1e7cf, WHITE, 0x667c89
    cross = lambda a, e: F.ring([(-a, -e), (a, -e), (a, -a), (e, -a), (e, a), (a, a), (a, e), (-a, e), (-a, a), (-e, a), (-e, -a), (-a, -a)])
    extrude(p, cross(a + 1.4 * k, e + dep + 1.0 * k), -1.5, .9 * k, BEIGE)                  # podium
    C = cross(a, e)
    extrude(p, C, .9 * k, H, W)
    band(p, C, .9 * k, 2.0 * k, 0xe3d8c0, .2)
    side = lambda ed: ed[2] < 2 * a - .5                                                     # the 8 side walls of the arms
    ring_windows(p, C, [(3.4 * k, 5.6 * k)], 3.9 * k, 1.7 * k, GLASS, 'arch', WT, .3 * k, ok=side)
    ring_windows(p, C, [(10.6 * k, 1.8 * k)], 3.9 * k, 1.4 * k, GLASS, 'rect', WT, .2 * k, ok=side)
    ring_fins(p, C, .9 * k, H, 8 * k, .7 * k, .3, WT, ok=side)                                # corner pilasters
    band(p, C, H, H + .7 * k, WT, .45 * k)
    rh = 3.6 * k
    for i in range(4):
        G = F.sub(0, 0, i * math.pi / 2)
        G.face([(-1.6 * k, .9 * k, e + .06), (1.6 * k, .9 * k, e + .06), (1.6 * k, 5.6 * k, e + .06), (-1.6 * k, 5.6 * k, e + .06)], DOOR, n=(0, 0, 1))
        for sd in (-1, 1): window(p, G.P(sd * 3.6 * k, e), G.D(1, 0), G.D(0, 1), 3.4 * k, 4.2 * k, 1.5 * k, GLASS, 'arch', WT, .25 * k)
        for j in range(6):                                                                    # hexastyle portico
            column(G, (-5 + j * 2) * k * 1.04, e + dep - .8 * k, .9 * k, H - 1.0 * k - .9 * k, .52 * k, 0xfbf8f0, WT)
        G.box(2 * a + 1.0 * k, 1.7 * k, dep + .5 * k, 0, H - 1.0 * k, e + dep / 2 - .05 * k, WT)          # entablature
        G.box(2 * a + 1.4 * k, .3 * k, dep + .9 * k, 0, H + .4 * k, e + dep / 2, IVORY)
        zt = e + dep + .25 * k + .06
        G.face([(-a + .5 * k, H + 1.0 * k, zt), (a - .5 * k, H + 1.0 * k, zt), (0, H + .7 * k + rh - .6 * k, zt)], 0xe6dcc6, n=(0, 0, 1))  # tympanum
        G.box(.14 * k, 1.4 * k, .14 * k, 0, H + .7 * k + rh, e + dep, GOLD); G.box(.7 * k, .12 * k, .12 * k, 0, H + .7 * k + rh + .9 * k, e + dep, GOLD)
        steps(G, 2 * a + 1.0 * k, e + dep + 1.0 * k, 3, .9 * k)
    for ry in (0, math.pi / 2): F.prism(2 * a + .9 * k, rh, 2 * (e + dep) + .5 * k, 0, H + .7 * k, 0, RF, ry=ry, ends=IVORY)
    c = 7 * k; yb = H + .7 * k
    F.box(2 * c, 4.6 * k, 2 * c, 0, yb, 0, W); F.box(2 * c + .8 * k, .55 * k, 2 * c + .8 * k, 0, yb + 4.6 * k, 0, WT)
    R, yd, hd = 5.6 * k, yb + 5.15 * k, 7 * k
    F.cyl(R, R, hd, 0, yd, 0, W, n=16)
    for j in range(16):
        ac = (j + .5) * TAU / 16; G = F.sub(0, 0, math.pi / 2 + ac); ap = R * math.cos(math.pi / 16)
        if j % 2 == 0: window(p, G.P(0, ap), G.D(1, 0), G.D(0, 1), yd + 1.4 * k, 4.2 * k, 1.3 * k, GLASS, 'arch', WT, .2 * k)
        else: G.box(.55 * k, hd, .35, 0, yd, ap + .1, WT)
    F.cyl(R + .5 * k, R + .5 * k, .6 * k, 0, yd + hd, 0, WT, n=16)
    F.dome(R + .2 * k, 0, yd + hd + .6 * k, 0, DOME, n=16, rings=5, sy=1.05)
    yt = yd + hd + .6 * k + (R + .2 * k) * 1.05 - .3 * k
    F.cyl(1.15 * k, 1.15 * k, 2.4 * k, 0, yt, 0, W, n=8); F.cyl(1.4 * k, 1.4 * k, .3 * k, 0, yt + 2.4 * k, 0, WT, n=8)
    F.dome(1.35 * k, 0, yt + 2.7 * k, 0, DOME, n=8, rings=3, sy=1.2)
    F.ball(.35 * k, 0, yt + 4.5 * k, 0, GOLD); F.box(.22 * k, 3 * k, .22 * k, 0, yt + 4.6 * k, 0, GOLD); F.box(1.4 * k, .2 * k, .2 * k, 0, yt + 6.6 * k, 0, GOLD)
    fp = [F.rect(2 * a + .8, 2 * (e + dep)), F.rect(2 * (e + dep), 2 * a + .8)]
    return make(p, 'cathedral', x, z, fp, 30, base=F.rect(size * 1.15, size * 1.15))


def belltower(S):
    x, z, ang, size = S['belltower']; k = size / 12.2; p = lp.Part(); F = Fr(p, x, z, ang)
    W, WT = 0xf4eedf, WHITE
    F.box(13.4 * k, 2.3, 13.4 * k, 0, -1.5, 0, BEIGE); y = .8
    for ti, (w, h) in enumerate([(12.2, 15.0), (10.2, 12.5), (8.8, 10.5), (7.4, 9.0)]):
        w *= k; F.box(w, h, w, 0, y, 0, W)
        for i in range(4):
            G = F.sub(0, 0, i * math.pi / 2); P0, U, N = G.P(0, w / 2), G.D(1, 0), G.D(0, 1)
            if ti == 0:
                window(p, P0, U, N, y, 6.0, 3.4 * k, DOOR, 'arch', WT, .35)
                window(p, P0, U, N, y + 8.4, 4.4, 2.0 * k, GLASS, 'arch', WT, .3)
            else:
                window(p, P0, U, N, y + h * .14, h * .66, w * .36, DARK, 'arch', WT, .35)
                G.box(w * .4, .9, .25, 0, y + h * .14, w / 2 + .12, WT)                  # balustrade in the opening
        for sx in (-1, 1):
            for sz in (-1, 1):
                F.box(.9 * k, h, .9 * k, sx * (w / 2 + .05), y, sz * (w / 2 + .05), WT)    # corner pilasters
        if ti > 0:
            for i in range(4):
                G = F.sub(0, 0, i * math.pi / 2)
                for sd in (-1, 1): column(G, sd * w * .3, w / 2 + .3 * k, y, h - .5, .3 * k, WT, n=6, base=False)
        F.box(w + .5 * k, .35, w + .5 * k, 0, y + h - .45, 0, 0xe7dcc6)
        F.box(w + 1.0 * k, .5, w + 1.0 * k, 0, y + h - .1, 0, WT)
        if ti > 0:
            for sx in (-1, 1):
                for sz in (-1, 1): F.cyl(.35 * k, .18 * k, .9, sx * (w / 2 + .1), y + h + .4, sz * (w / 2 + .1), WT, n=6)
        y += h + .4
    R = 2.8 * k
    F.cyl(R, R, 4, 0, y, 0, W, n=8, a0=math.pi / 8)
    for j in range(8):
        G = F.sub(0, 0, math.pi / 2 + j * TAU / 8); ap = R * math.cos(math.pi / 8)
        window(p, G.P(0, ap), G.D(1, 0), G.D(0, 1), y + .6, 2.6, 1.0, DARK, 'arch', WT, .15)
    F.cyl(R + .4, R + .4, .4, 0, y + 4, 0, WT, n=8, a0=math.pi / 8)
    F.dome(R + .15, 0, y + 4.4, 0, DOME, n=12, rings=4, sy=1.25)
    ys = y + 4.4 + (R + .15) * 1.25 - .2
    F.cyl(.7, .5, 1.4, 0, ys, 0, DOME, n=6); F.ball(.42, 0, ys + 1.7, 0, GOLD); F.cyl(.25, .06, 3.2, 0, ys + 2.0, 0, GOLD, n=6)
    F.box(.16, 2.4, .16, 0, ys + 5.0, 0, GOLD); F.box(1.2, .14, .14, 0, ys + 6.4, 0, GOLD)
    return make(p, 'belltower', x, z, [F.rect(13.4 * k, 13.4 * k)], 60)


def statue(S):
    x, z, ang, size = S['statue']
    ang = 2.3535   # baked: faces the nearest bd. Ștefan cel Mare segment (as the old runtime nearestSeg did)
    p = lp.Part(); F = Fr(p, x, z, ang); GR, GR2, BR, BR2 = 0x7a5b52, 0x684a42, BRONZE, BRONZE2
    F.box(5.6, 1.9, 5.6, 0, -1.5, 0, 0xa39d94)
    F.box(4.6, .9, 4.6, 0, .4, 0, GR2); F.box(3.6, .5, 3.6, 0, 1.3, 0, GR)
    F.box(3.0, 3.4, 3.0, 0, 1.8, 0, GR); F.box(3.4, .45, 3.4, 0, 5.2, 0, GR2); F.box(3.0, .3, 3.0, 0, 5.65, 0, GR)
    F.box(1.6, 1.1, .1, 0, 3.0, 1.52, BR2)                                                # bronze plaque
    y0 = 5.95
    F.box(.8, .25, .55, 0, y0, .05, BR)
    F.lathe([(.8, 0), (.62, 1.2), (.5, 2.3), (.48, 2.6), (.42, 3.25), (.15, 3.6)], 0, y0 + .2, 0, BR, n=8)   # robe + torso
    F.prism(1.3, .5, .55, 0, y0 + 2.95, -.05, BR2)                                         # mantle over shoulders
    F.box(1.15, .3, .55, 0, y0 + 3.2, 0, BR)                                               # shoulders
    F.ball(.28, 0, y0 + 3.85, .02, BR, n=8, rings=3)                                       # head
    F.box(.3, .3, .1, 0, y0 + 3.62, .22, BR2)                                              # beard
    F.cyl(.27, .3, .25, 0, y0 + 4.05, 0, 0x7a6a35, n=6)                                    # crown
    for i in range(6): F.box(.08, .2, .08, math.cos(i * TAU / 6) * .26, y0 + 4.28, math.sin(i * TAU / 6) * .26, 0x7a6a35)
    F.box(.25, .95, .25, -.62, y0 + 3.0, 0, BR, rz=-.25)                                    # right upper arm
    F.box(.22, .9, .22, -.78, y0 + 3.85, .05, BR)                                           # forearm raised
    F.box(.12, 2.2, .12, -.8, y0 + 4.2, .07, BR)                                            # the cross
    F.box(.8, .12, .12, -.8, y0 + 5.9, .07, BR); F.box(.5, .1, .1, -.8, y0 + 5.6, .07, BR)
    F.box(.24, 1.05, .24, .62, y0 + 2.4, .05, BR, rx=.15)                                   # left arm down
    F.box(.09, 1.7, .09, .55, y0 + .9, .3, BR2, rx=-.12); F.box(.42, .08, .08, .55, y0 + 2.45, .32, BR2)   # sword
    for i in range(8):
        t = i / 8 * TAU + math.pi / 8; F.cyl(.1, .08, .8, math.cos(t) * 3.6, 0, math.sin(t) * 3.6, 0x2e2e2e, n=4)
    return make(p, 'statue', x, z, [F.rect(4.6, 4.6)], 10, base=F.rect(6, 6))


# ================= buildings on OSM footprints =================
def fp_of(x, z, tol=.35):
    b = lp.footprint(x, z, 4)
    if not b: raise RuntimeError('no footprint near %s,%s' % (x, z))
    b = dict(b); b['ring'] = simplify(b['ring'], tol)
    return b


def gov():
    b = fp_of(-105.2, 100.7); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H, FH = 27.0, 3.2; rows = [(4.8 + FH * i, 2.0) for i in range(7)]
    extrude(p, ring, -1.5, H, STONE, top=ROOF)
    band(p, ring, -1.5, 4.2, 0xc8c1b3, .15)
    ring_windows(p, ring, rows, 3.1, 1.9, GLASS)
    ring_windows(p, ring, [(.4, 3.2)], 3.1, 2.3, 0x323e49)
    ring_fins(p, ring, 4.2, H, 3.1, .5, .45, 0xe9e5dc, minL=6)
    band(p, ring, H, H + .9, 0xcfc9bc, .25)
    fe = front(ring, 60, STF); G = front_frame(p, fe)   # main facade: towards the Arc / bd. Ștefan cel Mare
    blk = G.rect(44, 17.6, 0, -8.8 + .01)
    extrude(p, blk, H + .9, H + 10.5, 0xdcd6ca, top=ROOF)
    ring_windows(p, blk, [(H + 1.9 + FH * i, 2.0) for i in range(2)], 3.1, 1.9, GLASS)
    ring_fins(p, blk, H + .9, H + 10.5, 3.1, .5, .45, 0xe9e5dc)
    band(p, blk, H + 10.5, H + 11.3, 0xcfc9bc, .3)
    G.box(7, 3.6, .3, 0, H + 6.2, .2, 0xb89a4a); G.box(5.6, 2.6, .35, 0, H + 6.7, .25, 0x2f5c3a)  # state emblem panel
    flag(G, 0, -8.8, H + 11.3, 7)
    for i in range(10): G.box(1.2, 10.4, 1.2, -20 + i * 40 / 9, -1.5, 4.2, 0xeeeae2)              # entrance pillars
    G.box(46, .9, 6.0, 0, 8.9, 2.6, 0xe4dfd4); G.box(46.6, .25, 6.6, 0, 9.8, 2.6, 0xc9c2b4)
    steps(G, 48, 5.0, 4, .8, .7, .2)
    return make(p, 'gov', cx, cz, [ring], H + 11, skip=[b['c']])


def parl():
    b = fp_of(-478.5, -262.6); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H = 27.5; W = 0xeceae3
    extrude(p, ring, -1.5, H, 0x9aa3aa, top=0x84817b)
    ring_windows(p, ring, [(.3, 3.6)], 3.0, 2.4, 0x2a3742, minL=2.6)
    ring_windows(p, ring, [(5.2 + 3.3 * i, 2.5) for i in range(7)], 3.0, 2.2, 0x24303b, minL=2.6)
    for i in range(7): band(p, ring, 4.4 + 3.3 * i, 5.1 + 3.3 * i, W, .05)                         # floor slabs
    ring_fins(p, ring, 4.4, H, 3.0, .7, .7, W, minL=2.6)
    extrude(p, offset_ring(ring, .3), H, H + 2.4, W, top=0x84817b, bottom=True)                       # attic
    band(p, ring, H + 2.4, H + 2.9, 0xdedcd4, .5)
    fe = front(ring, 30, STF); G = front_frame(p, fe)
    flag(G, 0, -7, H + 2.9, 8)
    G.box(min(26, fe['L'] * .6), .7, 5, 0, 4.6, 2.2, W)                                                # entrance canopy
    for sd in (-1, 1):
        for j in range(3): G.box(.7, 6.1, .7, sd * (3 + j * 4), -1.5, 4.2, W)
    steps(G, min(26, fe['L'] * .6), 5.0, 4, 0, .7)
    return make(p, 'parl', cx, cz, [ring], H + 3, skip=[b['c']])


def prim():
    b = fp_of(139.9, 230.7); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H = 15.0; WT = 0xf2ede2
    extrude(p, ring, -1.5, H, BRICK, top=0x6e4f43)
    band(p, ring, -1.5, 1.0, 0xd6cbb9, .15)
    for yy in (5.0, 10.0): band(p, ring, yy, yy + .35, WT, .15)
    band(p, ring, H - .6, H, WT, .3)
    ring_windows(p, ring, [(1.7, 2.4), (6.1, 2.9), (11.0, 2.6)], 3.3, 1.3, GLASS, 'point', WT, .22, minL=2.8)
    ring_merlons(p, ring, H, 1.7, .8, .9, .45, BRICK2)
    fe = front(ring, 15, STF); G = front_frame(p, fe); tw = 7.5
    T = G.sub(0, -(tw / 2 - .8))
    T.box(tw, 28.5, tw, 0, -1.5, 0, BRICK)
    for yy in (5.0, 10.0, 15.0, 20.5, 25.6): T.box(tw + .3, .38, tw + .3, 0, yy, 0, WT)
    for i in range(4):
        Q = T.sub(0, 0, i * math.pi / 2); P0, U, N = Q.P(0, tw / 2), Q.D(1, 0), Q.D(0, 1)
        if i == 0: window(p, P0, U, N, 0, 4.0, 2.6, DOOR, 'point', WT, .35)
        else: window(p, P0, U, N, 1.7, 2.4, 1.3, GLASS, 'point', WT, .22)
        for yb, hh in ((6.1, 2.9), (11.0, 2.6), (16.0, 3.4), (21.3, 3.4)):
            for sd in ((-1.3, 1.3) if yb < 15 else (0,)): window(p, Q.P(sd, tw / 2), U, N, yb, hh, 1.2 if yb < 15 else 1.6, GLASS, 'point', WT, .22)
    T.box(tw - .6, 5.2, tw - .6, 0, 27.0, 0, BRICK)
    for i in range(4): clock(T, (tw - .6) / 2, 29.6, 1.55, i * math.pi / 2)
    T.box(tw + .5, .45, tw + .5, 0, 26.6, 0, WT); T.box(tw + .2, .45, tw + .2, 0, 32.2, 0, WT)
    ring_merlons(p, T.rect(tw, tw), 32.65, 1.25, .6, .8, .4, BRICK2)
    for sx in (-1, 1):
        for sz in (-1, 1):
            T.cyl(.6, .6, 6.6, sx * tw / 2, 26.6, sz * tw / 2, BRICK2, n=6)
            T.cyl(.8, 0, 2.4, sx * tw / 2, 33.2, sz * tw / 2, 0x4e5a52, n=6)
    T.hip(tw - .2, 9.0, tw - .2, 0, 32.65, 0, 0x4e5a52, ridge=0)
    T.ball(.3, 0, 41.8, 0, GOLD); flag(T, 0, 0, 41.6, 3.6)
    return make(p, 'prim', cx, cz, [ring, T.rect(tw, tw)], H + 1, hs=[H + 1, 42], skip=[b['c']])


def opera():
    b = fp_of(-160.3, -358.3); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H = 21.0; WT = 0xf6f6f2
    extrude(p, ring, -1.5, H, 0xc9cccc, top=0xa29f98)
    ring_fins(p, ring, -1.5, H, 2.6, 1.1, .9, WT, minL=4)                                         # the white slats
    extrude(p, offset_ring(ring, 1.2), H, H + 1.6, WT, top=0xa29f98, bottom=True)                 # overhanging attic
    fe = front(ring, 40, STF); G = front_frame(p, fe); L = fe['L']; D = depth_behind(ring, G)   # glass lobby towards the boulevard
    lw = L * .8
    lob = G.rect(lw, 7.5, 0, 3.75)
    extrude(p, lob, -1.5, 13.5, 0x41586b, top=0xd9d9d4)
    ring_fins(p, lob, -1.5, 13.5, 3.2, .25, .2, 0xe8ecee)                                         # mullions
    band(p, lob, 6.4, 6.7, 0xe8ecee, .1)
    for i in range(14): G.cyl(.5, .5, 15.0, -lw / 2 + .8 + i * (lw - 1.6) / 13, -1.5, 9.4, WT, n=8)
    G.box(L * .86, 1.1, 11.5, 0, 13.5, 4.9, WT)                                                    # canopy
    steps(G, lw + 4, 10.3, 4, 0, .8)
    fly = G.rect(28, 22, 0, -D * .62)
    extrude(p, fly, H, H + 10, 0xe9e9e5, top=0x9a9893)
    ring_fins(p, fly, H, H + 10, 2.6, .9, .6, WT)
    return make(p, 'opera', cx, cz, [ring], H + 10, skip=[b['c']])


def water():
    b = fp_of(-772.5, 596.4); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    WT = 0xf2ece0
    extrude(p, ring, -1.5, 17.0, BRICK2, top=0x6f4a3c)
    for yy in (5.8, 11.4): band(p, ring, yy, yy + .4, WT, .15)
    band(p, ring, 16.4, 17.6, WT, .5)
    extrude(p, offset_ring(ring, .45), 17.6, 19.2, BRICK2, top=0x6f4a3c, bottom=True)
    ring_merlons(p, offset_ring(ring, .45), 19.2, 1.3, .7, .8, .5, BRICK2)
    ring_windows(p, ring, [(1.2, 3.0), (7.2, 3.0), (12.8, 2.8)], 3.6, 1.2, GLASS, 'arch', WT, .25, minL=3.0)
    F = Fr(p, cx, cz, 0)
    F.cyl(3.6, 3.6, 4.2, 0, 17.6, 0, WT, n=8, a0=math.pi / 8)
    for j in range(8):
        G = F.sub(0, 0, math.pi / 2 + j * TAU / 8)
        window(p, G.P(0, 3.6 * math.cos(math.pi / 8)), G.D(1, 0), G.D(0, 1), 18.6, 2.2, 1.2, DARK, 'arch', None)
    F.cyl(4.2, 4.2, .35, 0, 21.8, 0, WT, n=8, a0=math.pi / 8)
    F.cyl(4.6, 0, 4.0, 0, 22.15, 0, 0x56635b, n=8, a0=math.pi / 8)
    F.cyl(.06, .06, 2.5, 0, 26.0, 0, 0x333333, n=4); F.ball(.25, 0, 26.3, 0, GOLD)
    return make(p, 'water', cx, cz, [ring], 22, skip=[b['c']])


def emin():
    b = fp_of(250.9, 348.8); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H = 17.0; C, WT = 0xf0dfba, 0xfaf3e2
    extrude(p, ring, -1.5, H, C, top=0x7e7a72)
    band(p, ring, -1.5, 4.5, 0xe2cfa6, .15); band(p, ring, 4.5, 4.9, WT, .25)
    ring_windows(p, ring, [(1.4, 2.3)], 3.6, 1.5, GLASS, 'arch', None)
    ring_windows(p, ring, [(6.2, 3.4), (11.6, 3.0)], 3.6, 1.5, GLASS, 'rect', WT, .25)
    band(p, ring, H, H + .8, WT, .55)
    extrude(p, offset_ring(ring, .15), H + .8, H + 1.6, C, top=0x7e7a72)
    fe = front(ring, 12, STF); G = front_frame(p, fe); w = min(19, fe['L'] * .85)
    for i in range(6): column(G, -w / 2 + .9 + i * (w - 1.8) / 5, 3.4, .9, 11.6, .6, 0xfbf6ea, WT)
    G.box(w + 1.2, 1.5, 4.6, 0, 12.5, 2.1, WT)
    G.prism(w + 1.6, 3.4, 5.0, 0, 14.0, 2.1, 0x8a8478, ends=WT)
    G.face([(-w / 2 + .5, 14.4, 4.66), (w / 2 - .5, 14.4, 4.66), (0, 16.7, 4.66)], 0xeee3c8, n=(0, 0, 1))
    G.box(w + 1.2, 2.4, 4.6, 0, -1.5, 2.1, 0xd9d1c0)
    steps(G, w + 1.2, 4.4, 3, .9, .6)
    return make(p, 'emin', cx, cz, [ring], H + 2, skip=[b['c']])


def art():
    b = fp_of(-195.3, 316.8); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H = 14.0; C, WT = 0xeedcb8, 0xfaf3e2
    extrude(p, ring, -1.5, H, C, top=0x6f6c66)
    band(p, ring, -1.5, 4.2, 0xe0cba3, .15); band(p, ring, 4.2, 4.55, WT, .25)
    ring_windows(p, ring, [(1.3, 2.2)], 3.6, 1.5, GLASS)
    ring_windows(p, ring, [(5.6, 3.6)], 3.6, 1.5, GLASS, 'arch', WT, .28)
    ring_windows(p, ring, [(10.1, 2.6)], 3.6, 1.4, GLASS, 'rect', WT, .22)
    band(p, ring, H, H + .7, WT, .5)
    extrude(p, offset_ring(ring, .15), H + .7, H + 1.4, C, top=0x6f6c66)
    # corner rotunda with a copper dome at the Pușkin / 31 August corner
    v = min(ring, key=lambda q: math.hypot(q[0] + 132, q[1] - 352)); d = math.hypot(cx - v[0], cz - v[1])
    rx, rz = v[0] + (cx - v[0]) / d * 2.6, v[1] + (cz - v[1]) / d * 2.6; F = Fr(p, rx, rz, 0)
    F.cyl(4.0, 4.0, H + 4.5, 0, -1.5, 0, C, n=12)
    for j in range(12):
        G = F.sub(0, 0, math.pi / 2 + (j + .5) * TAU / 12); ap = 4.0 * math.cos(math.pi / 12)
        if j % 2 == 0:
            for yb, hh in ((5.6, 3.6), (H + .8, 1.6)): window(p, G.P(0, ap), G.D(1, 0), G.D(0, 1), yb, hh, 1.2, GLASS, 'arch', WT, .22)
    F.cyl(4.5, 4.5, .5, 0, H + 3.0, 0, WT, n=12)
    F.dome(4.15, 0, H + 3.5, 0, COPPER, n=12, rings=4, sy=1.3)
    F.cyl(.6, .4, 1.6, 0, H + 8.6, 0, COPPER, n=6); F.ball(.35, 0, H + 10.4, 0, GOLD)
    return make(p, 'art', cx, cz, [ring], H + 2, skip=[b['c']])


def bnm():
    b = fp_of(422.5, -508.1); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H = 30.0; W = 0xe9e8e2
    extrude(p, ring, -1.5, H, W, top=0x7f7d78)
    ring_windows(p, ring, [(.4, 4.0)], 3.4, 3.0, 0x2b3b4a, minL=3)
    ring_windows(p, ring, [(5.6 + 3.05 * i, 2.5) for i in range(8)], 3.4, 1.7, 0x324558, minL=3)
    ring_fins(p, ring, 5.0, H - 1.0, 3.4, .55, .5, 0xf5f4f0, minL=3)
    band(p, ring, 4.6, 5.0, 0xd2d0c8, .3)
    extrude(p, offset_ring(ring, .6), H - 1.0, H + 1.6, 0xf5f4f0, top=0x7f7d78, bottom=True)
    fe = front(ring, 20, lambda n, w: 'Grigore Vieru' in n); G = front_frame(p, fe)
    G.box(min(30, fe['L'] * .55), .8, 7, 0, 4.4, 3.5, 0xf5f4f0)
    for sd in (-1, 1): G.box(.8, 5.9, .8, sd * min(14, fe['L'] * .26), -1.5, 6.4, 0xf5f4f0)
    G.box(10, 2.2, .3, 0, H - 4.2, .7, 0x9c8a55)                                                  # bank name plate
    steps(G, min(30, fe['L'] * .55), 7.0, 3, 0, .6)
    return make(p, 'bnm', cx, cz, [ring], H + 2, skip=[b['c']])


def cath2():
    b = fp_of(-281.9, -491.3); ring = ring_open(b['ring']); cx, cz = centroid(ring); p = lp.Part()
    H = 12.0; C, WT = 0xf3e2b6, 0xfbf5e6
    extrude(p, ring, -1.5, H, C, top=0x8a7a68)
    band(p, ring, -1.5, 1.0, 0xe2cfa6, .15)
    ring_windows(p, ring, [(3.0, 5.2)], 3.8, 1.6, GLASS, 'arch', WT, .25, minL=3.0)
    band(p, ring, H, H + .6, WT, .35)
    # principal axis of the footprint
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
    A = Fr(p, cx + u[0] * 0 + n[0] * nc, cz + u[1] * 0 + n[1] * nc, math.atan2(u[0], u[1]))   # local z along the axis
    # nave gable roof between the rotunda and the apse
    za, zb = (ruc + rr * .6, u1 - nw / 2) if rot_end == 0 else (u0 + nw / 2, ruc - rr * .6)
    A.prism(nw + .6, nw * .42, zb - za, 0, H + .6, (za + zb) / 2, 0x8b5a44, ends=C)
    A.box(.15, 1.2, .15, 0, H + .6 + nw * .42, zb if rot_end == 0 else za, GOLD)
    # rotunda: drum + low copper dome + lantern + cross
    Rf = Fr(p, cx + u[0] * ruc + n[0] * rnc, cz + u[1] * ruc + n[1] * rnc, 0)
    rr *= .82
    Rf.cyl(rr * .82, rr * .82, 2.6, 0, H + .6, 0, C, n=12)
    for j in range(6):
        G = Rf.sub(0, 0, math.pi / 2 + (2 * j + .5) * TAU / 12)
        window(p, G.P(0, rr * .82 * math.cos(math.pi / 12)), G.D(1, 0), G.D(0, 1), H + 1.1, 1.4, .9, GLASS, 'arch', WT, .15)
    Rf.cyl(rr * .82 + .35, rr * .82 + .35, .35, 0, H + 3.2, 0, WT, n=12)
    Rf.dome(rr * .85, 0, H + 3.5, 0, 0x5f7a6a, n=12, rings=4, sy=.8)
    yl = H + 3.5 + rr * .85 * .8 - .2
    Rf.cyl(.9, .9, 1.6, 0, yl, 0, C, n=6); Rf.cyl(1.1, 0, 1.0, 0, yl + 1.6, 0, 0x5f7a6a, n=6)
    Rf.box(.15, 2.0, .15, 0, yl + 2.4, 0, GOLD); Rf.box(.9, .14, .14, 0, yl + 3.7, 0, GOLD)
    return make(p, 'cath2', cx, cz, [ring], H + 3, skip=[b['c']])


# State Circus: drum fitted to the Overture/OSM ring + the back-of-house wing (footprint minus drum), decimetres
CIRC_C, CIRC_R = (1257.7, -1394.9), 28.3
CIRC_WING = [[11644, -14333, 11640, -14186, 12214, -14175, 12323, -14081, 12324, -14084, 12328, -14090, 12331, -14097, 12335, -14103, 12339, -14108, 12343, -14114, 12347, -14120, 12351, -14125, 12356, -14131, 12360, -14136, 12365, -14142, 12370, -14147, 12374, -14152, 12379, -14157, 12385, -14161, 12390, -14166, 12395, -14171, 12401, -14175, 12406, -14179, 12412, -14183, 12418, -14187, 12424, -14191, 12430, -14195, 12436, -14198, 12442, -14202, 12444, -14203, 12464, -14222, 12376, -14312, 12355, -14290, 12344, -14301, 12355, -14869, 12138, -14875, 12060, -14799, 12052, -14807, 12048, -14804, 12052, -14800, 11716, -14478, 11719, -14476, 11641, -14400, 11639, -14333],
             [11771, -14290, 11773, -14400, 11908, -14528, 11942, -14492, 12038, -14582, 12004, -14619, 12138, -14747, 12249, -14743, 12245, -14547, 12069, -14553, 11972, -14460, 11968, -14285]]


def circ():
    (cx, cz), R = CIRC_C, CIRC_R; p = lp.Part(); W, ST = 0xf4f1ea, 0xd2cbbd
    dm = lambda f: [(f[i] * .1, f[i + 1] * .1) for i in range(0, len(f), 2)]
    wing, hole = dm(CIRC_WING[0]), dm(CIRC_WING[1])
    best, bd = 0.0, 1e9                       # entrance faces the nearest wide road (bd. Renașterii Naționale)
    for kind, wd, name, P in roads():
        if kind != 0 or wd < 10: continue
        for q in P:
            d = math.hypot(q[0] - cx, q[1] - cz)
            if d < bd: bd, best = d, math.atan2(q[0] - cx, q[1] - cz)
    F = Fr(p, cx, cz, best)
    for r, y1, c in ((R + 6.6, .25, 0xbab3a5), (R + 5.8, .7, 0xc4bdaf), (R + 5.0, 1.4, ST)): F.cyl(r, r, y1 + 3, 0, -3, 0, c, n=32)
    F.cyl(R - 1.6, R - 1.6, 4.6, 0, 1.4, 0, 0x2c3a46, n=24)
    F.cyl(R - .6, R - .6, 10.6, 0, 6.0, 0, 0x587286, n=24, caps=False)
    F.cyl(R - .3, R - .3, .5, 0, 5.9, 0, W, n=24)
    N = 24; bay = TAU / N; chord = 2 * (R + .2) * math.sin(bay / 2)
    for i in range(N):
        a = (i + .5) * bay; G = F.sub(math.sin(a) * (R + .2), math.cos(a) * (R + .2), a)
        G.box(1.2, 15.6, 1.8, 0, 1.4, 0, W)
        b2 = i * bay; Q = F.sub(math.sin(b2) * (R + .2) * math.cos(bay / 2), math.cos(b2) * (R + .2) * math.cos(bay / 2), b2)
        arch_span(Q, chord - 1.2, 13.4, 17.0, .9, W, n=4)
    F.cyl(R + .75, R + .75, 3.2, 0, 17.0, 0, W, n=24)
    F.cyl(R + 1.05, R + 1.05, .45, 0, 20.2, 0, 0xe2ddd2, n=24)
    F.cyl(R - 2, R - 2, 1.6, 0, 20.6, 0, 0xe8e4da, n=24)
    F.dome(R - 2, 0, 22.2, 0, 0xa8afb4, n=24, rings=4, sy=4.2 / (R - 2))
    F.cyl(3.0, 2.6, 1.6, 0, 25.9, 0, 0xe8e4da, n=12); F.cyl(3.0, 0, 1.4, 0, 27.5, 0, 0x8d969c, n=12)
    # entrance canopy on columns + the CIRC sign (block letters)
    F.box(26, .9, 9, 0, 5.95, R + 3.2, W)
    for i in range(6): F.cyl(.4, .4, 4.6, -11 + i * 4.4, 1.4, R + 7, W, n=8)
    for st in range(3): F.box(28, 1.6 - st * .45 + 1.5, 4 - st, 0, -1.5, R + 7.5 + st, 0xc4bdaf)
    zf = R + 1.2; F.box(9.6, 2.8, .3, 0, 17.2, zf, 0xfaf8f2); RD = 0xc8202a; zl = zf + .2; s = .38
    def L(x0, cells):
        for cx0, cy0, w, h in cells: F.box(w * s, h * s, .2, x0 + (cx0 + w / 2) * s, 17.4 + cy0 * s, zl, RD)
    L(-3.03, [(0, 0, 1, 5), (1, 4, 2, 1), (1, 0, 2, 1)])                                  # C
    L(-1.39, [(1, 0, 1, 5)])                                                              # I
    L(.25, [(0, 0, 1, 5), (1, 4, 2, 1), (2, 3, 1, 1), (1, 2, 2, 1), (2, 0, 1, 2)])      # R
    L(1.89, [(0, 0, 1, 5), (1, 4, 2, 1), (1, 0, 2, 1)])                                   # C
    # back-of-house wing (with its service yard)
    extrude(p, wing, -6, 12, 0xe3ded3, top=0x8e8b84, holes=[hole])
    away = lambda e: math.hypot((e[0][0] + e[1][0]) / 2 - cx, (e[0][1] + e[1][1]) / 2 - cz) > R + 2
    ring_windows(p, wing, [(1.2, 2.4), (5.0, 2.4), (8.6, 2.4)], 3.4, 2.2, GLASS, minL=3, ok=away)
    band(p, wing, 12, 12.6, 0xdedad0, .2)
    drum = [(cx + math.sin(i / 32 * TAU) * R, cz + math.cos(i / 32 * TAU) * R) for i in range(32)]
    skip = lp.footprint(1242.3, -1408.4, 4)
    return make(p, 'circ', cx, cz, [drum, wing], 26, hs=[26, 13], skip=[skip['c']] if skip else [])


def build():
    S = lp.special(); out = []
    for f in (arc, cathedral, belltower, statue):
        if f.__name__ in S: out.append(f(S))
    for f in (gov, parl, prim, opera, water, emin, art, bnm, cath2, circ): out.append(f())
    return out
