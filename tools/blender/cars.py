"""Low-poly vehicles -> models/cars.glb (PS2-era look: chunky lofted bodies, flat colours, 8-sided wheels).

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/cars.py [-- <preview dir>]

Game coordinates (see lp.py): origin = ground under the car's centre, front = +z, +x = driver's (left) side.
One root node per model: yaris, taxi, logan, police, lada, suv, sprinter, trolley. Root prop 'car' (JSON):
  {L, W, wheel: {r, tw, zf, zr, x, style}, tail: [[x,y,z]...], head: [[x,y,z]...], poles: [[x,y,z]...] (trolley)}
js/vehicles.js reads wheel placement, lamp-glow points and trolley pole pivots from it. L/W must match veh_DEFS there
(collision boxes, camera); wheel numbers match the old procedural cars so the physics/ground fit is unchanged.
Children:
  <m>_body   always drawn; also the far LOD (with wheel_far baked at the wheel positions)
  <m>_det    small parts (mirrors, plates, wipers, handles...), near LOD only
  police_bar flashing light bar, drawn by its own instanced mesh (tinted per frame)
  trolley_pole one current-collector pole, origin = pivot, lying along -z; the game draws two and lifts them
Unit wheels (radius 1, width 1, axle along x, hub face at +x): wheel_steel, wheel_alloy, wheel_far.
Materials: 'paint' is tinted per car by the game (keep it white); 'glass' and 'chrome' get their own shading;
'dec_<row>' faces are mapped onto the game's decal atlas (plate, led, card, pol, polw, taxi, tled); the rest are flat
c_rrggbb colours. Original designs, no badges or logos.
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp

PAINT = ('named', 0xffffff, 'paint')
GLASS = ('named', 0x22303b, 'glass')
CHROME = ('named', 0xc4c9ce, 'chrome')
def DEC(k): return ('named', 0xffffff, 'dec_' + k)
BLACK, DARK, UNDER, TYRE = 0x18191a, 0x0b0b0c, 0x1e1f20, 0x1c1c1d
RED, AMBER, LENS, GREY = 0xb01219, 0xe2891b, 0xe6ecef, 0x4c4f53


# ---------------------------------------------------------------- helpers
def tris(parts):
    return sum(len(f) - 2 for p in parts for f in p.f)


def _clean(q):
    out = []
    for v in q:
        if not out or max(abs(a - b) for a, b in zip(v, out[-1])) > 1e-5: out.append(v)
    if len(out) > 1 and max(abs(a - b) for a, b in zip(out[0], out[-1])) <= 1e-5: out.pop()
    return out


def face(p, q, col):
    q = _clean(q)
    if len(q) >= 3: p.face(q, col)


def mirror_face(p, q, col):
    """face q on the +x side and its mirror on -x (winding flipped)."""
    face(p, q, col); face(p, [(-x, y, z) for x, y, z in q[::-1]], col)


def panel(p, c, n, up, w, h, col):
    """Rectangle w x h centred at c facing n (unit), 'up' in its plane (any vector not parallel to n)."""
    n = _norm(n); u = _norm(_sub(up, _mul(n, _dot(up, n)))); r = _cross(u, n)
    pts = [_add(c, _add(_mul(r, sx * w / 2), _mul(u, sy * h / 2))) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    p.face(pts, col)


def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _norm(a): l = math.sqrt(_dot(a, a)) or 1; return (a[0] / l, a[1] / l, a[2] / l)
def _lerp(a, b, t): return a + (b - a) * t


def interp(st, k):
    """piecewise-linear lookup of column k of stations (sorted by z)."""
    def f(z):
        if z <= st[0][0]: return st[0][k]
        for a, b in zip(st, st[1:]):
            if z <= b[0]: return _lerp(a[k], b[k], (z - a[0]) / ((b[0] - a[0]) or 1))
        return st[-1][k]
    return f


def loft(p, R, col, cap):
    """R: [(z, half profile [(x, y)...])] rear -> front; each profile runs from the bottom centre (x = 0) round the
    +x side to the top centre (x = 0), same point count. col(i, j): colour between stations i, i+1 and points j, j+1.
    cap(front) -> end-cap colour."""
    m = len(R[0][1])
    for i in range(len(R) - 1):
        (z0, a), (z1, b) = R[i], R[i + 1]
        for j in range(m - 1):
            mirror_face(p, [(a[j][0], a[j][1], z0), (a[j + 1][0], a[j + 1][1], z0), (b[j + 1][0], b[j + 1][1], z1), (b[j][0], b[j][1], z1)], col(i, j))
    for k, front in ((0, False), (len(R) - 1, True)):
        z, h = R[k]
        ring = [(x, y, z) for x, y in h] + [(-x, y, z) for x, y in h[-2:0:-1]]
        face(p, ring if front else ring[::-1], cap(front))


def body(p, D):
    """Lower body: stations D['st'] = [(z, hw, yt)], bottom at D['yb'], chamfers cb (bottom) / ct (top), optional
    side colour bands D['bands'] = [y...] with D['side'] = colours from the bottom up (len(bands) + 1)."""
    yb, cb, ct, cr, tum = D['yb'], D['cb'], D['ct'], D.get('crown', 0), D.get('tum', 0)
    bands, side = D.get('bands', []), D.get('side', [PAINT])
    top = D.get('top', PAINT)
    def prof(s):
        z, hw, yt = s; c = min(ct, (yt - yb) * .35)
        lo, hi = yb + cb + .004, yt - c - .004
        return ([(0, yb), (hw - cb, yb), (hw, yb + cb)] + [(hw, min(hi, max(lo, y))) for y in bands] +
                [(hw, yt - c), (hw - c - tum, yt), (0, yt + cr)])
    nb = len(bands)
    over = D.get('over', lambda i, j: None)
    def col(i, j):
        o = over(i, j)
        if o is not None: return o
        if j == 0: return UNDER
        if j == 1: return side[0]
        if j <= 2 + nb: return side[j - 2]
        return D.get('chamfer', top) if j == 3 + nb else top
    loft(p, [(s[0], prof(s)) for s in D['st']], col, lambda front: D.get('caps', (PAINT, PAINT))[front])
    return interp(D['st'], 1), interp(D['st'], 2)


def cabin(p, C, hwAt, ytAt):
    """Greenhouse on top of the body. C['cols'] = [(z at belt, z at roof, roof y)] rear -> front; C['kind'][k] for the
    side window band between columns k, k+1: GLASS, PAINT, BLACK...; hwR = roof half width; frame = sill/header colour."""
    cols, kind, hwR = C['cols'], C['kind'], C['hwR']
    tum, inset, sill, head = C.get('tum', .03), C.get('inset', .016), C.get('sill', .06), C.get('head', .05)
    frame = C.get('frame', PAINT)
    P = []  # P[c] = 4 row points on +x
    for zb, zt, yr in cols:
        B = (hwAt(zb) - tum, ytAt(zb) - .006, zb); T = (hwR, yr, zt)
        H = T[1] - B[1]
        f1, f2 = sill / H, 1 - head / H
        L = lambda f, e=0: (_lerp(B[0], T[0], f) - e, _lerp(B[1], T[1], f), _lerp(B[2], T[2], f))
        P.append([B, L(f1, inset), L(f2, inset), T])
    for c in range(len(P) - 1):
        a, b = P[c], P[c + 1]
        for r in range(3):
            colr = kind[c] if r == 1 else frame
            mirror_face(p, [a[r], a[r + 1], b[r + 1], b[r]], colr)
    # roof (slight crown)
    cr = C.get('crown', .025)
    for c in range(len(P) - 1):
        a, b = P[c][3], P[c + 1][3]
        mirror_face(p, [a, (0, a[1] + cr, a[2]), (0, b[1] + cr, b[2]), b], C.get('roof', PAINT))
    # windscreen (front) and rear window, with pillars at the edges
    for k, front in ((len(P) - 1, True), (0, False)):
        Q = P[k]; pil = C.get('pillar', .07)
        def xq(a, b, xa0, xb0, xa1, xb1, col):
            A, Bq, Cq, Dq = (xa0, a[1], a[2]), (xb0, a[1], a[2]), (xb1, b[1], b[2]), (xa1, b[1], b[2])
            face(p, [A, Dq, Cq, Bq] if front else [A, Bq, Cq, Dq], col)
        for r in range(3):
            a, b = Q[r], Q[r + 1]
            if r == 1:
                ia, ib = a[0] - pil, b[0] - pil
                xq(a, b, a[0], ia, b[0], ib, C.get('apil', frame))
                xq(a, b, ia, -ia, ib, -ib, C.get('ws' if front else 'rw', GLASS))
                xq(a, b, -ia, -a[0], -ib, -b[0], C.get('apil', frame))
            else:
                xq(a, b, a[0], -a[0], b[0], -b[0], frame if r == 0 else C.get('roof', PAINT))
    return P


def arches(p, hwAt, W, yb, col=DARK, lip=None):
    """dark wheel wells drawn on the body side (and an optional lip ring)."""
    for z in (W['zf'], W['zr']):
        R = W['r'] + .06; yc = W['r'] + .01
        x = max(hwAt(z - R * .7), hwAt(z + R * .7), hwAt(z)) + .005
        n = 8
        arc = [(x, yc + R * math.sin(math.pi * k / n), z - R * math.cos(math.pi * k / n)) for k in range(n + 1)]
        # CCW seen from +x (screen right = -z): front-bottom -> over the top -> rear-bottom is clockwise, so reverse
        q = [(x, yb + .03, z + R)] + arc[::-1] + [(x, yb + .03, z - R)]
        mirror_face(p, q[::-1], col)
        if lip:
            R2 = R + lip[0]
            for k in range(n):
                a0, a1 = math.pi * k / n, math.pi * (k + 1) / n
                pt = lambda rr, a: (x + .006, yc + rr * math.sin(a), z - rr * math.cos(a))
                mirror_face(p, [pt(R, a0), pt(R2, a0), pt(R2, a1), pt(R, a1)], lip[1])


def side_x(hwAt, z, s=1, off=.004): return s * (hwAt(z) + off)


def plate(p, front, x, y, z):
    n = (0, 0, 1) if front else (0, 0, -1)
    panel(p, (x, y, z), n, (0, 1, 0), .52, .115, DEC('plate'))


def mirror_pair(p, x, y, z, col=PAINT, arm=BLACK, big=False):
    for s in (1, -1):
        if big:
            p.box(.06, .05, .05, at=(s * (x - .1), y + .05, z), col=arm)
            p.box(.1, .34, .2, at=(s * (x + .02), y, z), ry=s * -.15, col=arm)
            panel(p, (s * (x + .02) - s * .051, y, z - .012), (-s * .25, 0, -1), (0, 1, 0), .14, .26, 0x6f8090)
        else:
            p.box(.12, .04, .05, at=(s * (x - .04), y - .03, z), col=arm)
            p.box(.07, .1, .16, at=(s * (x + .04), y, z), ry=s * -.2, col=col)


def wipers(p, z, y, slope, span=.55):
    for x0 in (.45, -.15):
        p.box(span, .015, .025, at=(x0 - span / 2 + .1, y, z), rz=.06, rx=slope, col=DARK)


def beam(p, a, b, w, h, col):
    """box of section w x h from point a to point b."""
    d = _sub(b, a); l = math.sqrt(_dot(d, d))
    p.box(w, h, l, at=_mul(_add(a, b), .5), rx=-math.asin(d[1] / l), ry=math.atan2(d[0], d[2]), col=col)


def seams(p, hwAt, zs, y0, y1):
    for z in zs:
        for s in (1, -1):
            x = s * (hwAt(z) + .003)
            panel(p, (x, (y0 + y1) / 2, z), (s, 0, 0), (0, 1, 0), .012, y1 - y0, DARK)


def handles(p, hwAt, zs, y, col=BLACK):
    for z in zs:
        for s in (1, -1):
            p.box(.025, .03, .12, at=(s * (hwAt(z) + .008), y, z), col=col)


def finish(name, parts, props):
    """root empty + _body/_det children."""
    root = lp.empty(name, props={'car': props})
    for suffix, part in parts:
        if part.f: part.obj(name + suffix, parent=root)
    print('%-9s body %4d  det %4d tris' % (name, tris([parts[0][1]]), tris([q for _, q in parts[1:]])))
    return root


def wheel_props(W, x): return {'r': W['r'], 'tw': W['tw'], 'zf': W['zf'], 'zr': W['zr'], 'x': round(x, 3), 'style': W['style']}


# ---------------------------------------------------------------- wheels (unit: radius 1, width 1, axle = x)
def wheels():
    out = []
    for style in ('steel', 'alloy'):
        p = lp.Part()
        n = 8; a0 = math.pi / n
        p.cyl(1, 1, 1, n=n, rz=-math.pi / 2, col=TYRE, caps=False, a0=a0)   # tread; rz -90deg: local y -> +x
        # inner face
        ring = lambda r, x: [(x, r * math.cos(a0 + i * 2 * math.pi / n), r * math.sin(a0 + i * 2 * math.pi / n)) for i in range(n)]
        p.face(ring(1, -.5)[::-1], TYRE)
        # outer sidewall annulus -> rim
        o, rim = ring(1, .5), ring(.66, .5)
        for i in range(n):
            j = (i + 1) % n
            p.face([o[i], o[j], rim[j], rim[i]], TYRE)
        if style == 'steel':
            rin = ring(.66, .42)
            for i in range(n):
                j = (i + 1) % n
                p.face([rim[i], rim[j], rin[j], rin[i]], 0x6c7075)
            p.face(ring(.66, .42), 0x6c7075)
            p.cyl(.42, .3, .1, n=n, rz=-math.pi / 2, at=(.47, 0, 0), col=CHROME, a0=a0)   # hub cap
            for i in range(4):  # slots
                a = i * math.pi / 2 + math.pi / 4
                c = (.425, .53 * math.cos(a), .53 * math.sin(a))
                panel(p, c, (1, 0, 0), (0, math.cos(a), math.sin(a)), .07, .13, DARK)
        else:
            rin = ring(.66, .46)
            for i in range(n):
                j = (i + 1) % n
                p.face([rim[i], rim[j], rin[j], rin[i]], 0xb9bec3)
            p.face(ring(.66, .46), 0xb9bec3)
            for i in range(5):  # dark pockets between 5 spokes
                a = i * 2 * math.pi / 5 + math.pi / 5
                c = (.465, .44 * math.cos(a), .44 * math.sin(a))
                panel(p, c, (1, 0, 0), (0, math.cos(a), math.sin(a)), .2, .26, 0x2a2c2f)
            p.cyl(.16, .12, .06, n=6, rz=-math.pi / 2, at=(.49, 0, 0), col=0x8e9398)
        out.append(p.obj('wheel_' + style))
    p = lp.Part()  # far LOD: plain tyre + grey disc
    p.cyl(1, 1, 1, n=8, rz=-math.pi / 2, col=TYRE, top=0x6c7075, a0=math.pi / 8)
    out.append(p.obj('wheel_far'))
    return out


# ---------------------------------------------------------------- Toyota Yaris XP90 5-door hatch (+ taxi)
def yaris(name='yaris', taxi=False):
    W = {'r': .30, 'tw': .19, 'zf': 1.07, 'zr': -1.39, 'style': 'alloy'}
    b, d = lp.Part(), lp.Part()
    D = {'yb': .25, 'cb': .09, 'ct': .07, 'crown': .02, 'tum': .01,
         'st': [(-1.875, .74, .90), (-1.82, .835, .99), (-1.0, .847, 1.0), (.62, .847, .935), (1.05, .838, .88),
                (1.5, .80, .79), (1.79, .73, .70), (1.875, .60, .60)]}
    hwAt, ytAt = body(b, D)
    cabin(b, {'cols': [(-1.80, -1.60, 1.47), (-1.30, -1.36, 1.51), (-.42, -.40, 1.53), (-.32, -.30, 1.53), (.60, -.12, 1.515)],
              'kind': [PAINT, GLASS, BLACK, GLASS], 'hwR': .66, 'tum': .035, 'pillar': .06}, hwAt, ytAt)
    arches(b, hwAt, W, D['yb'])
    for s in (1, -1):
        b.box(.36, .16, .08, at=(s * .55, .69, 1.775), ry=s * .62, rx=-.35, col=LENS)              # swept headlamps
        b.box(.10, .06, .06, at=(s * .66, .64, 1.70), ry=s * .9, col=AMBER)
        b.box(.15, .34, .08, at=(s * .70, 1.12, -1.80), ry=s * -.45, col=RED)                     # tall tail lamps
        b.box(.09, .08, .081, at=(s * .70, 1.0, -1.81), ry=s * -.45, col=0xf2f2ee)
        b.box(.08, .06, .04, at=(s * .5, .44, 1.84), col=LENS)                                     # fog lamps
    b.box(.5, .09, .06, at=(0, .655, 1.86), col=DARK)                                             # upper grille slot
    b.box(1.05, .17, .1, at=(0, .43, 1.83), col=BLACK)                                            # lower intake
    b.box(1.42, .07, .12, at=(0, .29, 1.79), col=BLACK)
    b.box(1.5, .14, .1, at=(0, .33, -1.84), col=BLACK)                                            # rear bumper strip
    b.box(1.15, .05, .2, at=(0, 1.48, -1.66), col=PAINT)                                          # roof spoiler
    mirror_pair(d, .86, .99, .48)
    wipers(d, .66, .99, -.2)
    d.box(.03, .3, .02, at=(0, 1.27, -1.79), rx=-.4, col=DARK)                                     # rear wiper
    plate(d, True, 0, .52, 1.888); plate(d, False, 0, .70, -1.878)
    seams(d, hwAt, [.6, -.38, -1.28], .34, .93)
    handles(d, hwAt, [.08, -.86], .87)
    extra = []
    if taxi:  # roof sign: yellow box, TAXI on front and back, black base
        d.box(.78, .05, .34, at=(0, 1.575, -.55), col=BLACK)
        b.box(.72, .24, .3, at=(0, 1.72, -.55), col=0xffd23f)
        panel(b, (0, 1.72, -.399), (0, 0, 1), (0, 1, 0), .66, .2, DEC('taxi'))
        panel(b, (0, 1.72, -.701), (0, 0, -1), (0, 1, 0), .66, .2, DEC('taxi'))
    props = {'L': 3.75, 'W': 1.695, 'wheel': wheel_props(W, .752),
             'tail': [[.70, 1.12, -1.85], [-.70, 1.12, -1.85]], 'head': [[.55, .69, 1.83], [-.55, .69, 1.83]]}
    return finish(name, [('_body', b), ('_det', d)], props)


# ---------------------------------------------------------------- Dacia Logan L90 (+ police)
def logan(name='logan', police=False):
    W = {'r': .31, 'tw': .19, 'zf': 1.33, 'zr': -1.30, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    D = {'yb': .26, 'cb': .09, 'ct': .07, 'crown': .015, 'tum': .01,
         'st': [(-2.145, .77, .90), (-2.09, .85, .985), (-1.5, .87, 1.0), (.4, .872, .955), (1.13, .868, .93),
                (1.85, .845, .86), (2.08, .80, .79), (2.145, .68, .70)]}
    if police:
        D['bands'] = [.62, .80]; D['side'] = [PAINT, 0x1f4fa8, PAINT]
    hwAt, ytAt = body(b, D)
    cabin(b, {'cols': [(-1.42, -.78, 1.49), (-1.12, -.70, 1.505), (-.22, -.20, 1.525), (-.13, -.11, 1.525), (1.13, .36, 1.51)],
              'kind': [PAINT, GLASS, BLACK, GLASS], 'hwR': .705, 'tum': .035}, hwAt, ytAt)
    arches(b, hwAt, W, D['yb'])
    for s in (1, -1):
        b.box(.42, .15, .08, at=(s * .6, .745, 2.10), ry=s * .35, rx=-.15, col=LENS)
        b.box(.1, .06, .081, at=(s * .76, .72, 2.05), ry=s * .5, col=AMBER)
        b.box(.42, .2, .08, at=(s * .64, .89, -2.12), ry=s * -.25, col=RED)
        b.box(.14, .08, .081, at=(s * .55, .86, -2.13), ry=s * -.25, col=0xf2f2ee)
    b.box(.72, .17, .06, at=(0, .75, 2.12), col=DARK)                                             # grille
    b.box(.76, .03, .07, at=(0, .84, 2.12), col=CHROME); b.box(.76, .03, .07, at=(0, .665, 2.125), col=CHROME)
    b.box(1.1, .16, .08, at=(0, .45, 2.11), col=BLACK)                                            # lower intake
    b.box(1.46, .06, .12, at=(0, .29, 2.07), col=BLACK)
    b.box(1.6, .12, .1, at=(0, .36, -2.11), col=BLACK)
    mirror_pair(d, .9, 1.0, 1.0)
    wipers(d, 1.15, .96, -.25)
    d.box(.5, .03, .03, at=(0, .83, -2.14), col=CHROME)
    plate(d, True, 0, .50, 2.155); plate(d, False, 0, .70, -2.152)
    seams(d, hwAt, [1.11, -.2, -1.28], .34, .92)
    handles(d, hwAt, [.5, -.7], .86)
    d.cyl(.006, .006, .6, n=3, at=(-.55, 1.2, -1.75), rx=-.3, col=DARK)                           # antenna
    extra = []
    if police:
        for s in (1, -1):
            panel(b, (s * (hwAt(0) + .006), .71, 0), (s, 0, 0), (0, 1, 0), 1.2, .17, DEC('pol'))
        k = (ytAt(1.85) - ytAt(1.13)) / .72                                                     # hood slope
        panel(b, (0, ytAt(1.6) + .015 + .006, 1.6), (0, 1, -k), (0, 0, -1), .9, .17, DEC('polw'))
        panel(b, (0, ytAt(-1.8) + .015 + .006, -1.8), (0, 1, 0), (0, 0, 1), .8, .15, DEC('polw'))
        panel(b, (0, .82, -2.152), (0, 0, -1), (0, 1, 0), .8, .15, DEC('pol'))
        b.box(1.4, .1, .1, at=(0, .48, 2.2), col=BLACK)                                            # push bar
        bar = lp.Part()
        bar.box(1.22, .08, .3, at=(0, 1.545, -.1), col=BLACK)
        bar.box(.56, .12, .26, at=(-.31, 1.645, -.1), col=0xff2020, top=0xff5050)
        bar.box(.56, .12, .26, at=(.31, 1.645, -.1), col=0x2050ff, top=0x5078ff)
        extra.append(bar)
    props = {'L': 4.29, 'W': 1.74, 'wheel': wheel_props(W, .781),
             'tail': [[.64, .89, -2.16], [-.64, .89, -2.16]], 'head': [[.6, .745, 2.15], [-.6, .745, 2.15]]}
    if police: props['bar'] = [0, 1.65, -.1]                                                       # glow centre of the bar
    root = finish(name, [('_body', b), ('_det', d)], props)
    if police: extra[0].obj('police_bar', parent=root)
    return root


# ---------------------------------------------------------------- VAZ-2107
def lada(name='lada'):
    W = {'r': .29, 'tw': .17, 'zf': 1.21, 'zr': -1.21, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    D = {'yb': .30, 'cb': .05, 'ct': .04, 'crown': .0, 'tum': .0,
         'st': [(-2.065, .77, .86), (-2.03, .80, .915), (-1.95, .81, .93), (1.9, .81, .915), (2.03, .80, .89), (2.065, .77, .84)]}
    hwAt, ytAt = body(b, D)
    cabin(b, {'cols': [(-1.25, -.96, 1.415), (-1.02, -.90, 1.425), (-.24, -.22, 1.44), (-.15, -.14, 1.44), (.98, .42, 1.43)],
              'kind': [PAINT, GLASS, PAINT, GLASS], 'hwR': .68, 'tum': .03, 'crown': .01, 'frame': CHROME, 'sill': .035,
              'head': .03, 'apil': PAINT, 'roof': PAINT, 'pillar': .06}, hwAt, ytAt)
    arches(b, hwAt, W, D['yb'], lip=(.05, 0x121212))
    for s in (1, -1):
        b.box(.44, .23, .06, at=(s * .53, .74, 2.05), col=CHROME)                                  # twin square lamps
        b.box(.19, .18, .04, at=(s * .43, .74, 2.075), col=0xfff8e6)
        b.box(.19, .18, .04, at=(s * .63, .74, 2.075), col=LENS)
        b.box(.17, .07, .04, at=(s * .6, .40, 2.1), col=AMBER)
        b.box(.54, .21, .05, at=(s * .5, .78, -2.06), col=CHROME)                                 # wide tail clusters
        b.box(.22, .17, .03, at=(s * .38, .78, -2.08), col=RED)
        b.box(.13, .17, .03, at=(s * .56, .78, -2.08), col=AMBER)
        b.box(.10, .17, .03, at=(s * .69, .78, -2.08), col=0xf2f2f0)
        b.box(.04, .04, 3.3, at=(s * .815, .62, 0), col=CHROME)                                   # side moulding
    b.box(.5, .25, .05, at=(0, .74, 2.065), col=CHROME)                                           # grille surround
    b.box(.44, .19, .02, at=(0, .74, 2.088), col=DARK)
    for i in range(-2, 3): b.box(.025, .19, .03, at=(i * .09, .74, 2.09), col=CHROME)
    for z in (2.09, -2.09):                                                                       # chrome bumpers
        b.box(1.68, .13, .13, at=(0, .47, z), col=CHROME)
        b.box(1.70, .045, .14, at=(0, .47, z), col=DARK)
    d.box(.08, .08, .1, at=(.84, .99, .88), col=CHROME); d.box(.08, .08, .1, at=(-.84, .99, .88), col=CHROME)
    for s in (1, -1):
        d.box(.02, .1, .1, at=(s * .87, 1.03, .88), col=0x8899aa)
        d.box(.018, .02, 1.38, at=(s * .70, 1.405, -.27), col=CHROME)                              # drip rails
    wipers(d, 1.0, .945, -.15, .5)
    plate(d, True, 0, .60, 2.115); plate(d, False, 0, .62, -2.105)
    seams(d, hwAt, [.98, -.2, -1.2], .36, .9)
    handles(d, hwAt, [.45, -.65], .86, CHROME)
    d.cyl(.006, .006, .7, n=3, at=(-.76, 1.2, 1.78), rx=-.12, col=DARK)
    for s in (1, -1): d.box(.18, .22, .01, at=(s * .62, .25, -1.72), col=DARK)                    # mud flaps
    props = {'L': 4.13, 'W': 1.62, 'wheel': wheel_props(W, .745),
             'tail': [[.42, .78, -2.1], [-.42, .78, -2.1]], 'head': [[.53, .74, 2.1], [-.53, .74, 2.1]]}
    return finish(name, [('_body', b), ('_det', d)], props)


# ---------------------------------------------------------------- Toyota RAV4 XA20
def suv(name='suv'):
    W = {'r': .34, 'tw': .22, 'zf': 1.22, 'zr': -1.27, 'style': 'alloy'}
    b, d = lp.Part(), lp.Part()
    CL = 0x3a3c3f
    D = {'yb': .40, 'cb': .08, 'ct': .08, 'crown': .015, 'tum': .01,
         'st': [(-2.0, .80, 1.05), (-1.95, .86, 1.12), (-.9, .87, 1.12), (.72, .868, 1.06), (1.1, .86, 1.0), (1.5, .84, .94),
                (1.85, .79, .87), (2.0, .68, .78)],
         'bands': [.64], 'side': [CL, PAINT]}
    hwAt, ytAt = body(b, D)
    cabin(b, {'cols': [(-1.93, -1.85, 1.66), (-1.60, -1.58, 1.675), (-1.16, -1.14, 1.685), (-1.08, -1.06, 1.685),
                       (-.58, -.56, 1.69), (-.50, -.48, 1.69), (.72, .02, 1.675)],
              'kind': [PAINT, GLASS, BLACK, GLASS, BLACK, GLASS], 'hwR': .72, 'tum': .04}, hwAt, ytAt)
    arches(b, hwAt, W, D['yb'], lip=(.09, CL))
    for s in (1, -1):
        b.box(.40, .16, .08, at=(s * .6, .82, 1.95), ry=s * .45, rx=-.2, col=LENS)
        b.box(.1, .06, .081, at=(s * .74, .78, 1.89), ry=s * .7, col=AMBER)
        b.box(.13, .40, .08, at=(s * .79, 1.22, -1.985), col=RED)
        b.box(.131, .1, .081, at=(s * .79, 1.08, -1.985), col=0xf2f2ee)
    b.box(.62, .15, .06, at=(0, .80, 1.99), col=DARK)
    b.box(.66, .03, .05, at=(0, .87, 2.0), col=CHROME)
    b.box(1.62, .30, .16, at=(0, .56, 1.96), col=CL)                                              # chunky bumpers
    b.box(1.1, .06, .12, at=(0, .42, 2.0), col=0x9a9da0)
    b.box(1.65, .26, .14, at=(0, .56, -1.98), col=CL)
    b.cyl(.33, .33, .2, n=8, at=(.05, 1.02, -2.12), rx=math.pi / 2, col=PAINT, top=PAINT, a0=math.pi / 8)  # spare wheel
    b.cyl(.22, .22, .02, n=8, at=(.05, 1.02, -2.225), rx=math.pi / 2, col=CL, a0=math.pi / 8)
    for s in (1, -1):
        d.box(.04, .035, 1.6, at=(s * .6, 1.735, -.95), col=BLACK)                                 # roof rails
        for z in (-1.75, -.15): d.box(.05, .05, .06, at=(s * .6, 1.705, z), col=BLACK)
    mirror_pair(d, .9, 1.12, .75)
    wipers(d, .75, 1.11, -.25)
    plate(d, True, 0, .58, 2.045); plate(d, False, 0, .76, -2.0)
    seams(d, hwAt, [.72, -.55, -1.62], .66, 1.08)
    handles(d, hwAt, [.2, -1.05], 1.0)
    props = {'L': 4.0, 'W': 1.735, 'wheel': wheel_props(W, .765),
             'tail': [[.79, 1.22, -2.03], [-.79, 1.22, -2.03]], 'head': [[.6, .82, 2.0], [-.6, .82, 2.0]]}
    return finish(name, [('_body', b), ('_det', d)], props)


# ---------------------------------------------------------------- Mercedes Sprinter high-roof minibus (rutiera)
def sprinter(name='sprinter'):
    W = {'r': .37, 'tw': .22, 'zf': 1.98, 'zr': -1.69, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    st = [(-2.955, .93, 2.55), (-2.90, .99, 2.62), (.62, .995, 2.64), (.88, .99, 2.48), (1.72, .975, 1.38),
          (2.25, .96, 1.24), (2.65, .93, 1.12), (2.85, .88, 1.02), (2.955, .80, .90)]
    D = {'yb': .42, 'cb': .1, 'ct': .16, 'crown': .02, 'tum': .03, 'st': st,
         'bands': [.74, .86], 'side': [PAINT, 0x1d1e20, PAINT]}
    nb = 2
    D['over'] = lambda i, j: (GLASS if (i == 3 and j == 4 + nb) else None)    # windscreen = top band between .88 and 1.72
    hwAt, ytAt = body(b, D)
    arches(b, hwAt, W, D['yb'], lip=(.07, 0x1d1e20))
    sx = lambda z, y=1.8: hwAt(z) + .006
    def win(s, z0, z1, y0, y1):
        q = [(sx(z0, y0), y0, z0), (sx(z0, y1), y1, z0), (sx(z1, y1), y1, z1), (sx(z1, y0), y0, z1)]
        if s > 0: face(b, q, GLASS)
        else: face(b, [(-x, y, z) for x, y, z in q[::-1]], GLASS)
    for s in (1, -1):
        win(s, .80, 1.50, 1.42, 2.18)                                                             # cab door
        for z0, z1 in ((-2.7, -1.95), (-1.8, -1.05), (-.9, -.12), (.02, .62)): win(s, z0, z1, 1.45, 2.2)
    for s in (1, -1):                                                                             # rear door windows
        q = [(s * .06, 1.5, -2.962), (s * .06, 2.3, -2.962), (s * .84, 2.3, -2.962), (s * .84, 1.5, -2.962)]
        face(b, q if s > 0 else q[::-1], GLASS)
    for s in (1, -1):
        b.box(.44, .24, .08, at=(s * .72, .98, 2.87), ry=s * .55, rx=-.25, col=LENS)
        b.box(.12, .08, .081, at=(s * .86, .94, 2.78), ry=s * .8, col=AMBER)
        b.box(.14, .62, .08, at=(s * .935, 1.05, -2.955), col=RED)
        b.box(.141, .14, .081, at=(s * .935, .83, -2.955), col=AMBER)
    b.box(.84, .28, .06, at=(0, .95, 2.935), col=DARK)                                            # grille + slats
    for i in range(3): b.box(.82, .025, .03, at=(0, .87 + i * .08, 2.965), col=CHROME)
    b.box(1.96, .36, .2, at=(0, .62, 2.92), col=0x2a2b2d)
    b.box(1.96, .26, .16, at=(0, .55, -2.95), col=0x2a2b2d)
    b.box(.6, .08, .6, at=(0, 2.68, -.5), col=0xdedede)                                           # roof vent
    mirror_pair(d, 1.18, 1.62, 1.62, big=True)
    wipers(d, 1.62, 1.55, -.9, .7)
    plate(d, True, 0, .62, 3.025); plate(d, False, 0, .75, -2.962)
    seams(d, hwAt, [1.62, -2.75], .6, 2.4)
    for z in (-.1, .7): panel(d, (-(hwAt(z) + .004), 1.45, z), (-1, 0, 0), (0, 1, 0), .012, 1.75, DARK)  # sliding door
    d.box(.03, .03, .15, at=(-(hwAt(-.3) + .012), 1.0, -.33), col=CHROME)
    panel(d, (0, .55 + .95, -2.963), (0, 0, -1), (0, 1, 0), .012, 1.9, DARK)
    # route boards: LED strip at the top of the windscreen, card behind its lower corner, LED on the door side
    zA, yA, zB, yB = .88, 2.48, 1.72, 1.38
    t = lambda u: (_lerp(zA, zB, u), _lerp(yA, yB, u))
    n = _norm((0, zB - zA, -(yB - yA)))   # windscreen normal (forward/up)
    z, y = t(.12); panel(d, (.12, y + n[1] * .012, z + n[2] * .012), (0, n[1], n[2]), (0, 1, 0), .9, .24, DEC('led'))
    z, y = t(.78); panel(d, (-.52, y + n[1] * .012, z + n[2] * .012), (0, n[1], n[2]), (0, 1, 0), .36, .2, DEC('card'))
    panel(d, (-(hwAt(.2) + .008), 2.36, .25), (-1, 0, 0), (0, 1, 0), .5, .2, DEC('led'))
    props = {'L': 5.91, 'W': 1.99, 'wheel': wheel_props(W, .90),
             'tail': [[.935, 1.05, -3.0], [-.935, 1.05, -3.0]], 'head': [[.72, .98, 2.93], [-.72, .98, 2.93]]}
    return finish(name, [('_body', b), ('_det', d)], props)


# ---------------------------------------------------------------- trolleybus (12 m low-floor, original design)
def trolley(name='trolley'):
    W = {'r': .5, 'tw': .3, 'zf': 3.9, 'zr': -2.5, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    WH, RF, SK, LN = 0xf4f4f1, 0xd4d7da, 0x33363b, 0x2b2f33
    st = [(-6.0, 1.20, 3.30), (-5.94, 1.26, 3.36), (-5.80, 1.275, 3.38), (5.70, 1.275, 3.38), (5.88, 1.262, 3.34), (6.0, 1.225, 3.28)]
    D = {'yb': .32, 'cb': .06, 'ct': .26, 'crown': .03, 'tum': .04, 'st': st,
         'bands': [.52, 1.0, 1.18, 1.22, 2.62, 2.72, 2.86],
         'side': [SK, PAINT, WH, LN, GLASS, WH, PAINT, WH], 'chamfer': RF, 'top': RF, 'caps': (WH, WH)}
    hwAt, ytAt = body(b, D)
    X = 1.275 + .006
    for s in (1, -1):                                                                             # window pillars
        for zc in (-5.6, -4.25, -2.85, -1.45, -.05, 1.35, 2.75, 4.15):
            if s < 0 and any(a - .1 < zc < c + .1 for a, c in ((4.45, 5.65), (0, 1.25), (-4.65, -3.4))): continue
            panel(b, (s * X, 1.92, zc), (s, 0, 0), (0, 1, 0), .1, 1.4, WH)
    for z0, z1 in ((4.45, 5.65), (0, 1.25), (-4.65, -3.4)):                                         # doors (kerb side = -x)
        m = (z0 + z1) / 2
        panel(b, (-X, 1.51, m), (-1, 0, 0), (0, 1, 0), z1 - z0, 2.3, 0xc5cacf)
        for zz in ((z0 + m) / 2, (m + z1) / 2):
            panel(b, (-(X + .004), 1.53, zz), (-1, 0, 0), (0, 1, 0), (z1 - z0) / 2 - .1, 2.08, GLASS)
        panel(b, (-(X + .006), .40, m), (-1, 0, 0), (0, 1, 0), z1 - z0, .08, DARK)
    # front: big windscreen, destination board, lamps, bumper
    F, Bk = 6.0 + .006, -6.0 - .006
    panel(b, (0, 2.05, F), (0, 0, 1), (0, 1, 0), 2.3, 1.8, GLASS)
    panel(b, (0, .82, F), (0, 0, 1), (0, 1, 0), 2.44, .5, PAINT)
    panel(b, (0, 3.14, F + .002), (0, 0, 1), (0, 1, 0), 2.1, .3, DARK)
    panel(b, (0, 3.14, F + .004), (0, 0, 1), (0, 1, 0), 1.95, .26, DEC('tled'))
    panel(b, (-(1.275 + .01), 2.4, 4.0), (-1, 0, 0), (0, 1, 0), 1.1, .2, DEC('tled'))
    panel(b, (0, 2.3, Bk), (0, 0, -1), (0, 1, 0), 1.9, .95, GLASS)
    panel(b, (0, .82, Bk), (0, 0, -1), (0, 1, 0), 2.44, .5, PAINT)
    for s in (1, -1):
        b.box(.36, .2, .06, at=(s * .92, .82, 6.01), col=LENS)
        b.box(.36, .07, .061, at=(s * .92, .68, 6.01), col=AMBER)
        b.box(.22, .7, .06, at=(s * 1.02, 1.05, -6.01), col=RED)
        b.box(.22, .14, .061, at=(s * 1.02, .62, -6.01), col=AMBER)
    b.box(2.5, .32, .24, at=(0, .5, 6.02), col=LN)
    b.box(2.5, .30, .22, at=(0, .48, -6.02), col=LN)
    # roof equipment and pole base
    b.box(1.95, .36, 2.3, at=(0, 3.55, 3.5), col=0xd9dcdf, top=0xc9ccd0)
    b.box(1.6, .26, 1.7, at=(0, 3.5, 1.0), col=0xc9ccd0)
    b.box(2.0, .32, 2.5, at=(0, 3.52, -3.6), col=0xd9dcdf, top=0xc9ccd0)
    for s in (1, -1): b.box(.24, .16, .55, at=(s * .32, 3.66, 1.0), col=0x2a2a2a)
    for s in (1, -1):                                                                             # rabbit-ear mirrors
        beam(d, (s * 1.12, 3.05, 5.96), (s * 1.42, 2.86, 6.34), .05, .05, BLACK)
        d.box(.1, .46, .24, at=(s * 1.44, 2.62, 6.36), col=BLACK)
        d.box(.1, .12, .3, at=(s * .32, 3.42, -5.75), col=0x333333)                                # pole hooks
    wipers(d, 6.02, 1.25, 0, 1.0)
    plate(d, True, 0, .4, 6.145); plate(d, False, 0, .4, -6.135)
    arches(b, hwAt, W, D['yb'], col=0x151617, lip=(.08, 0x1a1a1a))
    pole = lp.Part()                                                                              # pivot at origin, along -z
    pole.cyl(.035, .03, 6.2, n=6, at=(0, 0, -3.1), rx=math.pi / 2, col=0x262626)
    pole.cyl(.07, .07, .45, n=6, at=(0, 0, -.15), rx=math.pi / 2, col=0x262626)
    pole.box(.1, .09, .32, at=(0, .04, -6.22), col=0x262626)
    props = {'L': 12, 'W': 2.55, 'wheel': wheel_props(W, 1.155),
             'tail': [[1.02, 1.05, -6.05], [-1.02, 1.05, -6.05]], 'head': [[.92, .82, 6.05], [-.92, .82, 6.05]],
             'poles': [[.32, 3.75, 1.0], [-.32, 3.75, 1.0]]}
    root = finish(name, [('_body', b), ('_det', d)], props)
    pole.obj('trolley_pole', parent=root, origin=(0, 0, 0))
    return root


# ---------------------------------------------------------------- build
lp.reset()
roots = [yaris(), yaris('taxi', taxi=True), logan(), logan('police', police=True), lada(), suv(), sprinter(), trolley()]
wh = wheels()
lp.export(os.path.join(lp.MODELS, 'cars.glb'), roots + wh)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if argv:
    out = argv[0]
    os.makedirs(out, exist_ok=True)
    from mathutils import Vector
    # line the cars up side by side for the preview (export already written)
    import json, bpy
    wm = {o.name: o.data for o in wh}
    for r in roots:
        P = json.loads(r['car']); w = P['wheel']
        for z in (w['zf'], w['zr']):
            for s in (1, -1):
                o = bpy.data.objects.new('pw', wm['wheel_' + w['style']]); bpy.context.scene.collection.objects.link(o)
                o.parent = r; o.location = lp.B(s * w['x'], w['r'], z); o.scale = (w['tw'], w['r'], w['r'])
                if s < 0: o.rotation_euler = (0, 0, math.pi)
        for pv in P.get('poles', []):
            pole = bpy.data.objects['trolley_pole']
            o = bpy.data.objects.new('pp', pole.data); bpy.context.scene.collection.objects.link(o)
            o.parent = r; o.location = lp.B(*pv); o.rotation_euler = (.33, 0, 0)
        if 'poles' in P: pole.hide_render = True
    xs = 0.0
    for r in roots[:-1]:
        r.location = lp.B(xs, 0, 0); xs += 2.6
    bpy.context.view_layer.update()
    for o in wh: o.hide_render = True
    lp.preview(roots[:-1], os.path.join(out, 'cars_front.png'), yaw=30, pitch=18, size=1400)
    lp.preview(roots[:-1], os.path.join(out, 'cars_back.png'), yaw=200, pitch=18, size=1400)
    for r in roots: r.location = lp.B(0, 0, 0)
    bpy.context.view_layer.update()
    for r in roots:
        for o in roots: o.hide_render = True
        lp.preview([r], os.path.join(out, r.name + '_a.png'), yaw=-40, pitch=15, size=800)
        lp.preview([r], os.path.join(out, r.name + '_b.png'), yaw=150, pitch=20, size=800)
