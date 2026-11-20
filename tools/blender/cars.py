"""PS2-era vehicles -> models/cars.glb: chunky smooth-shaded bodies, all small detail painted into one texture per model.

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/cars.py [-- <preview dir>]

Game coordinates (see lp.py): origin = ground under the car's centre, front = +z, +x = driver's (left) side.
One root node per model: yaris, taxi, logan, police, lada, suv, sprinter, trolley. Root prop 'car' (JSON):
  {L, W, wheel: {r, tw, zf, zr, x, style}, tail: [[x,y,z]...], head: [[x,y,z]...], poles?: [[x,y,z]...], bar?: [x,y,z]}
js/vehicles.js reads wheel placement, lamp-glow points, trolley pole pivots and the light-bar glow point from it.
L/W must match veh_DEFS there (collision boxes, camera); wheel numbers match the earlier cars (physics/ground fit).
Children (all share the model's texture: 256 px for cars, 512 px for the trolleybus):
  <m>_body     always drawn; also the far LOD (with <m>_wfar placed at the wheel positions)
  <m>_det      mirrors, roof rails, sign base...: near LOD only
  <m>_wheel    unit wheel (radius 1, width 1, axle along x, hub face at +x), instanced by the game (spins + steers)
  <m>_wfar     plain unit wheel for the far LOD
  police_bar   flashing light bar (own instanced mesh, tinted per frame)
  trolley_pole one current-collector pole, origin = pivot, lying along -z; the game draws two and lifts them
Materials are per model, named '<kind>.<model>'; kind 'paint' bakes as neutral light grey and is multiplied by the
car's paint colour in the game; 'glass' and 'chrome' get env-map shine; everything else is a plain textured surface.

Texture pipeline: geometry with flat colours -> lp.bake (weld, smooth, smart-UV, colour x AO) -> an extra EMIT bake of
object-space position / normal / object+material id per texel -> numpy paints the detail by 3D position: seams,
handles, grime on sills and round the wheel arches, lamp/grille/plate graphics, lettering (5x7 bitmap font), glass
reflection streaks, rims and tyre sidewalls. Original designs, no badges or logos.
"""
import sys, os, math, json, tempfile
import numpy as np
import bpy, bmesh
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp

PAINT = ('named', 0xededed, 'paint')
GLASS = ('named', 0x1c2731, 'glass')
CHROME = ('named', 0xc4c9ce, 'chrome')
BLACK, DARK, UNDER, TYRE = 0x1a1b1c, 0x0d0d0e, 0x202122, 0x1d1d1e
RED, AMBER, LENS, GREY, PLATE = 0xb01219, 0xe2891b, 0xd8dee2, 0x4c4f53, 0xf2f2ee
OBJ_BODY, OBJ_DET, OBJ_WHEEL, OBJ_WFAR, OBJ_BAR, OBJ_POLE = 1, 2, 3, 4, 5, 6


# ---------------------------------------------------------------- vector helpers
def _dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def _add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def _sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def _mul(a, k): return (a[0] * k, a[1] * k, a[2] * k)
def _cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def _norm(a): l = math.sqrt(_dot(a, a)) or 1; return (a[0] / l, a[1] / l, a[2] / l)
def _lerp(a, b, t): return a + (b - a) * t


def rot(v, ry=0.0, rx=0.0):
    """same order as lp's _xf: rx about x, then ry yaw."""
    x, y, z = v
    if rx: c, n = math.cos(rx), math.sin(rx); y, z = y * c - z * n, y * n + z * c
    if ry: c, n = math.cos(ry), math.sin(ry); x, z = x * c + z * n, -x * n + z * c
    return (x, y, z)


def interp(st, k):
    def f(z):
        if z <= st[0][0]: return st[0][k]
        for a, b in zip(st, st[1:]):
            if z <= b[0]: return _lerp(a[k], b[k], (z - a[0]) / ((b[0] - a[0]) or 1))
        return st[-1][k]
    return f


# ---------------------------------------------------------------- geometry helpers
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
    face(p, q, col); face(p, [(-x, y, z) for x, y, z in q[::-1]], col)


def panel(p, c, n, up, w, h, col):
    n = _norm(n); u = _norm(_sub(up, _mul(n, _dot(up, n)))); r = _cross(u, n)
    p.face([_add(c, _add(_mul(r, sx * w / 2), _mul(u, sy * h / 2))) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))], col)


def beam(p, a, b, w, h, col):
    d = _sub(b, a); l = math.sqrt(_dot(d, d))
    p.box(w, h, l, at=_mul(_add(a, b), .5), rx=-math.asin(d[1] / l), ry=math.atan2(d[0], d[2]), col=col)


def loft(p, R, col, cap):
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
    """Lower body loft: stations D['st'] = [(z, hw, yt)], bottom D['yb'], chamfers cb/ct, side colour bands."""
    yb, cb, ct, cr, tum = D['yb'], D['cb'], D['ct'], D.get('crown', 0), D.get('tum', 0)
    bands, side, top = D.get('bands', []), D.get('side', [PAINT]), D.get('top', PAINT)
    def prof(s):
        z, hw, yt = s; c = min(ct, (yt - yb) * .35)
        lo, hi = yb + cb + .004, yt - c - .004
        return ([(0, yb), (hw - cb, yb), (hw, yb + cb)] + [(hw, min(hi, max(lo, y))) for y in bands] +
                [(hw, yt - c), (hw - c - tum, yt), (0, yt + cr)])
    nb = len(bands); over = D.get('over', lambda i, j: None)
    def col(i, j):
        o = over(i, j)
        if o is not None: return o
        if j == 0: return UNDER
        if j == 1: return side[0]
        if j <= 2 + nb: return side[j - 2]
        return D.get('chamfer', top) if j == 3 + nb else top
    loft(p, [(s[0], prof(s)) for s in D['st']], col, lambda front: D.get('caps', (PAINT, PAINT))[front])
    CTX.yb = yb; CTX.st = D['st']
    return interp(D['st'], 1), interp(D['st'], 2)


def cabin(p, C, hwAt, ytAt):
    """Greenhouse: C['cols'] = [(z at belt, z at roof, roof y)] rear -> front, C['kind'][k] = side band colour."""
    cols, kind, hwR = C['cols'], C['kind'], C['hwR']
    tum, inset, sill, head = C.get('tum', .03), C.get('inset', .016), C.get('sill', .06), C.get('head', .05)
    frame = C.get('frame', PAINT)
    P = []
    for zb, zt, yr in cols:
        B = (hwAt(zb) - tum, ytAt(zb) - .006, zb); T = (hwR, yr, zt)
        H = T[1] - B[1]; f1, f2 = sill / H, 1 - head / H
        L = lambda f, e=0: (_lerp(B[0], T[0], f) - e, _lerp(B[1], T[1], f), _lerp(B[2], T[2], f))
        P.append([B, L(f1, inset), L(f2, inset), T])
    for c in range(len(P) - 1):
        a, b = P[c], P[c + 1]
        for r in range(3):
            mirror_face(p, [a[r], a[r + 1], b[r + 1], b[r]], kind[c] if r == 1 else frame)
    cr = C.get('crown', .025)
    for c in range(len(P) - 1):
        a, b = P[c][3], P[c + 1][3]
        mirror_face(p, [a, (0, a[1] + cr, a[2]), (0, b[1] + cr, b[2]), b], C.get('roof', PAINT))
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


# ---------------------------------------------------------------- painting: model context + ops
class Ctx:
    def __init__(self, name):
        self.name = name; self.ops = []; self.vseams = []; self.hseams = []; self.wheel = None; self.yb = 0; self.st = None
        self.grime = 1.0; self.pillars = []; self.belt = None
CTX = None


def op(c, n, up, w, h, fn, depth=.05, objs=(OBJ_BODY, OBJ_DET), kinds=None):
    """Paint fn(u, v, outer, w, h) -> (rgb, alpha) onto every texel within the w x h rectangle centred at c facing n
    (u right, v up as seen from outside, `outer` = 1 if u -> 1 points away from the car's centreline)."""
    n = _norm(n); U = _norm(_sub(up, _mul(n, _dot(up, n)))); R = _cross(U, n)
    outer = 1 if R[0] * (1 if c[0] >= 0 else -1) > 0 else 0
    CTX.ops.append(dict(c=c, n=n, U=U, R=R, w=w, h=h, fn=fn, depth=depth, outer=outer, objs=objs, kinds=kinds))


def kn(col): return col[2] if isinstance(col, tuple) else 'c_%06x' % col


def lamp(p, fn, w, h, d, at, ry=0.0, rx=0.0, col=LENS, back=False):
    """box with a graphic painted on its front face only (never on the body it is sunk into)."""
    p.box(w, h, d, at=at, ry=ry, rx=rx, col=col)
    n = rot((0, 0, -1 if back else 1), ry, rx); up = rot((0, 1, 0), ry, rx)
    op(_add(at, _mul(n, d / 2)), n, up, w, h, fn, depth=.02, kinds=(kn(col),))


def plate(p, front, y, z, x=0.0):
    n = (0, 0, 1 if front else -1)
    panel(p, (x, y, z), n, (0, 1, 0), .52, .115, PLATE)
    op((x, y, z), n, (0, 1, 0), .52, .115, f_plate, depth=.02, kinds=(kn(PLATE),))


def mirror_pair(p, x, y, z, col=PAINT, arm=BLACK, big=False):
    for s in (1, -1):
        if big:
            p.box(.06, .05, .05, at=(s * (x - .1), y + .05, z), col=arm)
            p.box(.1, .34, .2, at=(s * (x + .02), y, z), ry=s * -.15, col=arm)
        else:
            p.box(.12, .04, .05, at=(s * (x - .04), y - .03, z), col=arm)
            p.box(.07, .1, .16, at=(s * (x + .04), y, z), ry=s * -.2, col=col)


def handles(hwAt, zs, y, col=0x1b1b1b):
    for z in zs:
        for s in (1, -1):
            op((s * (hwAt(z) + .002), y, z), (s, 0, 0), (0, 1, 0), .13, .035, f_solid(col, .9), depth=.04, kinds=('paint',))


def side_text(txt, hwAt, z, y, w, h, fg, bg=None, sides=(1, -1), kinds=('paint',)):
    for s in sides:
        op((s * (hwAt(z) + .005), y, z), (s, 0, 0), (0, 1, 0), w, h, f_text(txt, fg, bg), depth=.04, kinds=kinds)


# ---------------------------------------------------------------- bitmaps & painters (numpy, vectorised over texels)
def _rgb(col): return np.array([((col >> s) & 255) / 255 for s in (16, 8, 0)], np.float32)


FONT = {
    'A': "01110 10001 10001 11111 10001 10001 10001", 'B': "11110 10001 10001 11110 10001 10001 11110",
    'C': "01111 10000 10000 10000 10000 10000 01111", 'D': "11110 10001 10001 10001 10001 10001 11110",
    'E': "11111 10000 10000 11110 10000 10000 11111", 'H': "10001 10001 10001 11111 10001 10001 10001",
    'I': "01110 00100 00100 00100 00100 00100 01110", 'K': "10001 10010 10100 11000 10100 10010 10001",
    'L': "10000 10000 10000 10000 10000 10000 11111", 'M': "10001 11011 10101 10101 10001 10001 10001",
    'N': "10001 11001 10101 10011 10001 10001 10001", 'O': "01110 10001 10001 10001 10001 10001 01110",
    'P': "11110 10001 10001 11110 10000 10000 10000", 'R': "11110 10001 10001 11110 10100 10010 10001",
    'S': "01111 10000 10000 01110 00001 00001 11110", 'T': "11111 00100 00100 00100 00100 00100 00100",
    'U': "10001 10001 10001 10001 10001 10001 01110", 'X': "10001 10001 01010 00100 01010 10001 10001",
    '0': "01110 10011 10101 10101 10101 11001 01110", '1': "00100 01100 00100 00100 00100 00100 01110",
    '2': "01110 10001 00001 00010 00100 01000 11111", '3': "11110 00001 00001 01110 00001 00001 11110",
    '4': "00010 00110 01010 10010 11111 00010 00010", '5': "11111 10000 11110 00001 00001 10001 01110",
    '6': "00110 01000 10000 11110 10001 10001 01110", '7': "11111 00001 00010 00100 01000 01000 01000",
    '8': "01110 10001 10001 01110 10001 10001 01110", '9': "01110 10001 10001 01111 00001 00010 01100",
    ' ': "00000 00000 00000 00000 00000 00000 00000", '.': "00000 00000 00000 00000 00000 00000 00100",
}


def text_bitmap(s):
    """bool array (rows top -> bottom) for s in the 5x7 font, one column gap between glyphs."""
    g = [np.array([[c == '1' for c in row] for row in FONT[ch].split()]) for ch in s]
    out = np.zeros((7, len(s) * 6 - 1), bool)
    for i, a in enumerate(g): out[:, i * 6:i * 6 + 5] = a
    return out


def f_solid(col, a=1.0):
    c = _rgb(col)
    return lambda u, v, o, w, h: (np.broadcast_to(c, (len(u), 3)), np.full(len(u), a, np.float32))


def f_text(s, fg, bg=None, fill=.78, bold=False):
    """lettering scaled to fill `fill` of the rectangle height (or its width if longer), centred."""
    bm = text_bitmap(s); fgc, bgc = _rgb(fg), (_rgb(bg) if bg is not None else None)
    H, W = bm.shape
    def fn(u, v, o, w, h):
        px = min(h * fill / H, w * .92 / W)                  # metres per font pixel
        x = (u - .5) * w / px + W / 2; y = (.5 - v) * h / px + H / 2
        ix, iy = np.floor(x).astype(int), np.floor(y).astype(int)
        ins = (ix >= 0) & (ix < W) & (iy >= 0) & (iy < H)
        on = np.zeros(len(u), bool); on[ins] = bm[iy[ins], ix[ins]]
        if bold:
            ix2 = np.clip(ix - 1, 0, W - 1); on2 = np.zeros(len(u), bool); on2[ins] = bm[iy[ins], ix2[ins]]; on |= on2 & ins
        rgb = np.where(on[:, None], fgc, bgc if bgc is not None else fgc)
        return rgb, (np.ones(len(u), np.float32) if bgc is not None else on.astype(np.float32))
    return fn


def f_plate(u, v, o, w, h):
    rgb = np.broadcast_to(_rgb(PLATE), (len(u), 3)).copy()
    rgb[u < .14] = _rgb(0x1f4fb5)
    blocks = (u > .2) & (u < .95) & (v > .22) & (v < .78) & (((u - .2) * 9) % 1 < .72)
    rgb[blocks] = _rgb(0x1a1a1a)
    rgb[(u < .025) | (u > .975) | (v < .08) | (v > .92)] = _rgb(0x2a2a2a)
    return rgb, np.ones(len(u), np.float32)


def f_head(kind='twin'):
    """headlamp graphic: dark housing, bright lamp discs on a chrome reflector, amber indicator at the outer end."""
    def fn(u, v, o, w, h):
        x, y = (u - .5) * w, (v - .5) * h
        rgb = np.broadcast_to(_rgb(0x2b2f34), (len(u), 3)).copy()
        inner = (np.abs(x) < w / 2 - .015) & (np.abs(y) < h / 2 - .012)
        rgb[inner] = _rgb(0xaeb6bd)
        uo = u if o else 1 - u
        if kind == 'square':                                     # VAZ: two square lamps in a chrome frame
            for cx in (-.25, .25):
                m = (np.abs(x - cx * w) < w * .22) & (np.abs(y) < h * .38); rgb[m] = _rgb(0xf6f4ea)
                m = (np.abs(x - cx * w) < w * .12) & (np.abs(y) < h * .2); rgb[m] = _rgb(0xffffff)
            return rgb, np.ones(len(u), np.float32)
        r = h * .34
        for cx in ((-.18, .2) if kind == 'twin' else (0,)):
            d = np.hypot(x - cx * w, y); rgb[d < r] = _rgb(0xf4f5ee); rgb[d < r * .45] = _rgb(0xffffff)
            rgb[(d > r) & (d < r * 1.25)] = _rgb(0x7d858c)
        rgb[inner & (uo > .82)] = _rgb(AMBER)
        return rgb, np.ones(len(u), np.float32)
    return fn


def f_tail(kind='vert'):
    def fn(u, v, o, w, h):
        x, y = (u - .5) * w, (v - .5) * h
        rgb = np.broadcast_to(_rgb(0x7a0b10), (len(u), 3)).copy()
        inner = (np.abs(x) < w / 2 - .012) & (np.abs(y) < h / 2 - .012)
        rgb[inner] = _rgb(0xc4161f)
        ribs = inner & (((v * (6 if kind == 'vert' else 3)) % 1) < .18); rgb[ribs] = _rgb(0x9a1016)
        uo = u if o else 1 - u
        if kind == 'vert':
            rgb[inner & (v < .3)] = _rgb(0xe8e8e2)                    # reverse lamp at the bottom
        elif kind == 'lada':                                         # red | amber | white, chrome rim
            rgb[~inner] = _rgb(0xc4c9ce)
            rgb[inner & (uo > .45)] = _rgb(AMBER); rgb[inner & (uo > .75)] = _rgb(0xe8e8e2)
        else:
            rgb[inner & (uo < .28)] = _rgb(0xe8e8e2); rgb[inner & (uo > .8)] = _rgb(AMBER)
        return rgb, np.ones(len(u), np.float32)
    return fn


def f_grille(n=4, vertical=False, bg=0x111213, slat=0x45484c, frame=None):
    def fn(u, v, o, w, h):
        t = u if vertical else v
        rgb = np.where(((t * n) % 1 < .45)[:, None], _rgb(slat), _rgb(bg))
        if frame is not None:
            e = (u < .04) | (u > .96) | (v < .1) | (v > .9); rgb = np.where(e[:, None], _rgb(frame), rgb)
        return rgb, np.ones(len(u), np.float32)
    return fn


def f_band(col, v0, v1, a=1.0):
    c = _rgb(col)
    return lambda u, v, o, w, h: (np.broadcast_to(c, (len(u), 3)), ((v > v0) & (v < v1)).astype(np.float32) * a)


def f_board(txt, fg=0xff9a1a, bg=0x0b0b0b, fill=.7):
    t = f_text(txt, fg, bg, fill)
    def fn(u, v, o, w, h):
        rgb, a = t(u, v, o, w, h)
        rgb = rgb * np.where(((v * h / .012) % 2 < 1)[:, None], 1.0, .82)   # LED scan lines
        return rgb, a
    return fn


def f_taxi(u, v, o, w, h):
    rgb, a = f_text('TAXI', 0x111111, 0xffd23f, .92)(u, (v - .15) / .85, o, w, h * .85)
    chk = v < .13
    rgb[chk] = np.where((((u * 14).astype(int) + (v * 10).astype(int)) % 2 == 0)[chk][:, None], _rgb(0x111111), _rgb(0xffd23f))
    return rgb, np.ones(len(u), np.float32)


# wheel painters: local coords of the unit wheel (axle x, hub face +x)
def wheel_paint(style, x, y, z, nx):
    r = np.hypot(y, z); a = np.arctan2(z, y); k = len(x)
    rgb = np.broadcast_to(_rgb(0x1f1f1f), (k, 3)).copy()
    tread = np.abs(nx) < .5
    rgb[tread & ((np.abs(np.abs(x) - .2) < .05) | (np.abs(x) < .03))] = _rgb(0x121212)          # grooves
    rgb[tread & ((a * 12 / math.pi) % 1 < .2)] *= .8                                       # blocks
    out = nx > .5
    side = out & (r >= .66)
    rgb[side] = _rgb(0x2b2b2b)
    rgb[side & (r > .79) & (r < .87) & ((a * 9) % 1 < .55)] = _rgb(0x3d3d3d)                 # sidewall lettering band
    rgb[side & (r < .70)] = _rgb(0x141414)                                                 # bead
    rim = out & (r < .66)
    R = lambda m, col: rgb.__setitem__(rim & m, _rgb(col))
    if style == 'alloy':
        R(r < 9, 0xbfc4c8); R(r > .6, 0xd7dadd)
        R((r > .2) & (r < .57) & (np.cos(5 * a) < .25), 0x24262a)                          # 5 spokes
        R(r < .14, 0x989da2); R(r < .05, 0x2e3033)
    elif style == 'hubcap':                                                                # plastic trim (Logan)
        R(r < 9, 0xb8bdc2); R(r > .62, 0x55595e)
        R((r > .38) & (r < .55) & ((a * 10 / (2 * math.pi)) % 1 < .45), 0x2a2c2f)
        R(r < .13, 0x8a8f94)
    elif style == 'lada':                                                                  # chrome dome cap on black steel
        R(r < 9, 0x2b2c2e); R(r < .5, 0xd5d9dd); R((r < .32) & (y > 0), 0xf2f4f6)
        R((r > .53) & (r < .6) & ((a * 6 / (2 * math.pi)) % 1 < .3), 0x111111); R(r < .1, 0x9a9ea2)
    elif style == 'heavy':                                                                 # van / trolleybus steel
        R(r < 9, 0x8a8e93); R(r > .58, 0x5c6065); R(r < .24, 0x4a4e52)
        for i in range(8):
            q = i * math.pi / 4; R(np.hypot(y - .34 * math.cos(q), z - .34 * math.sin(q)) < .05, 0x2c2e31)
        R(np.abs(r - .5) < .025, 0x3a3d40)
    else:                                                                                  # steel with slots
        R(r < 9, 0x7a7f85); R(r > .6, 0x5e6267)
        R((np.abs(r - .46) < .07) & ((a * 8 / (2 * math.pi)) % 1 < .35), 0x1b1c1e)
        R(r < .22, 0x9da2a7); R(r < .1, 0x55595e)
    rgb[nx < -.5] = _rgb(0x121212)
    return rgb


# ---------------------------------------------------------------- per-texel 3D position bake + paint pass
def posbake(ms, size, margin=0):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 1
    mats = []
    for o in ms:
        for m in o.data.materials:
            if m and m not in mats: mats.append(m)
    K = 1 / 16
    tgt = bpy.data.images.new('_pb', size, size, alpha=True, float_buffer=True); tgt.colorspace_settings.name = 'Non-Color'
    added = []
    for i, m in enumerate(mats):
        nt = m.node_tree; N = nt.nodes; L = nt.links
        out = next(n for n in N if n.type == 'OUTPUT_MATERIAL')
        tc = N.new('ShaderNodeTexCoord'); em = N.new('ShaderNodeEmission')
        vp = N.new('ShaderNodeVectorMath'); vp.operation = 'MULTIPLY_ADD'
        vp.inputs[1].default_value = (K, K, K); vp.inputs[2].default_value = (.5, .5, .5)
        vn = N.new('ShaderNodeVectorMath'); vn.operation = 'MULTIPLY_ADD'
        vn.inputs[1].default_value = (.5, .5, .5); vn.inputs[2].default_value = (.5, .5, .5)
        gm = N.new('ShaderNodeNewGeometry')   # true (flat) face normal; objects are unrotated, so world = object axes
        L.new(tc.outputs['Object'], vp.inputs[0]); L.new(gm.outputs['True Normal'], vn.inputs[0])
        oi = N.new('ShaderNodeObjectInfo'); dv = N.new('ShaderNodeMath'); dv.operation = 'MULTIPLY'; dv.inputs[1].default_value = 1 / 16
        L.new(oi.outputs['Object Index'], dv.inputs[0])
        cc = N.new('ShaderNodeCombineColor'); L.new(dv.outputs[0], cc.inputs[0]); cc.inputs[1].default_value = (i + 1) / 255; cc.inputs[2].default_value = 1
        im = N.new('ShaderNodeTexImage'); im.image = tgt
        L.new(em.outputs[0], out.inputs['Surface']); N.active = im
        added.append((m, out, em, vp, vn, cc, [tc, gm, em, vp, vn, oi, dv, cc, im]))
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    res = {}
    for key in ('pos', 'nrm', 'id'):
        for m, out, em, vp, vn, cc, _ in added:
            L = m.node_tree.links
            for l in list(em.inputs['Color'].links): L.remove(l)
            L.new({'pos': vp, 'nrm': vn, 'id': cc}[key].outputs[0], em.inputs['Color'])
        bpy.ops.object.bake(type='EMIT', use_clear=True, margin=margin)
        a = np.empty(size * size * 4, np.float32); tgt.pixels.foreach_get(a); res[key] = a.reshape(size, size, 4).copy()
    for m, out, em, vp, vn, cc, nodes in added:   # restore: baked texture -> BSDF -> output
        N = m.node_tree.nodes
        for n in nodes: N.remove(n)
        bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED'); m.node_tree.links.new(bsdf.outputs[0], out.inputs['Surface'])
        N.active = N['_bake']
    bpy.data.images.remove(tgt)
    sc.render.engine = 'BLENDER_WORKBENCH'
    B = (res['pos'][..., :3] - .5) / K; Nb = res['nrm'][..., :3] * 2 - 1
    P = np.stack([B[..., 0], B[..., 2], -B[..., 1]], -1); Nn = np.stack([Nb[..., 0], Nb[..., 2], -Nb[..., 1]], -1)
    obj = np.rint(res['id'][..., 0] * 16).astype(int); mid = np.rint(res['id'][..., 1] * 255).astype(int) - 1
    cov = res['id'][..., 2] > .5
    kinds = np.array([m.name.split('.')[0] for m in mats] + [''])
    return P, Nn, obj, kinds[np.where(mid >= 0, mid, len(mats))], cov


def paint(img, ms, size):
    P, Nn, obj, kind, cov = posbake(ms, size)
    col = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(col); col = col.reshape(size, size, 4)
    idx = np.nonzero(cov)
    p, n, ob, kd = P[idx], Nn[idx], obj[idx], kind[idx]
    c = col[idx][:, :3].copy()
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    rng = np.random.default_rng(len(CTX.name))
    noise = lambda f: np.sin(x * 7.1 * f + 1.3) * np.sin(y * 9.7 * f + .7) * np.sin(z * 5.3 * f + 2.1)
    bod = (ob == OBJ_BODY) | (ob == OBJ_DET)
    # glass: darker low, sky-ish high, two painted reflection streaks
    g = (kd == 'glass') & bod
    s = (z * .9 + y * 1.3 + x * .15) / 1.5 % 1
    c[g] += .035 * np.clip(n[g, 1], 0, 1)[:, None] + .02
    c[g & (s > .14) & (s < .25)] += .11
    c[g & (s > .31) & (s < .345)] += .07
    # grime: darker towards the sills, blotchy
    if CTX.st is not None:
        h = np.clip((y - CTX.yb) / .38, 0, 1)
        dirt = (1 - .32 * CTX.grime * (1 - h) ** 1.5 * (.75 + .25 * noise(1.0)))
        m = bod & (kd != 'glass'); c[m] *= dirt[m, None]
        hw = np.interp(z, [q[0] for q in CTX.st], [q[1] for q in CTX.st])
        sidef = bod & (np.abs(n[:, 0]) > .5) & (np.abs(x) > hw - .06)
        W = CTX.wheel
        if W:
            for zw in (W['zf'], W['zr']):
                d = np.hypot(y - (W['r'] + .01), z - zw); R0 = W['r'] + .06
                well = sidef & (d < R0) & (y > CTX.yb - .01)
                c[well] = _rgb(0x0e0e0f)
                ring = sidef & (d >= R0) & (d < R0 + .16) & (kd != 'glass')
                c[ring] *= (.55 + .45 * np.clip((d[ring] - R0) / .16, 0, 1) + .08 * noise(2.0)[ring])[:, None]
                if CTX.lip: lp_ = sidef & (d >= R0) & (d < R0 + CTX.lip[0]); c[lp_] = _rgb(CTX.lip[1])
        # door / panel seams on the sides, lines on the top
        for zs, y0, y1, sd in CTX.vseams:
            m = sidef & (np.abs(z - zs) < .011) & (y > y0) & (y < y1) & (np.sign(x) != -sd)
            c[m] *= .35
        for zs, x0 in CTX.hseams:
            m = bod & (n[:, 1] > .6) & (np.abs(z - zs) < .011) & (np.abs(x) < x0)
            c[m] *= .45
    # trolleybus window pillars painted onto the glass band
    for zc, wdt, y0, y1, sd in CTX.pillars:
        m = (kd == 'glass') & (np.abs(n[:, 0]) > .8) & (np.abs(z - zc) < wdt / 2) & (y > y0) & (y < y1) & (np.sign(x) == sd)
        c[m] = _rgb(0xf0f0ec)
    # texel footprint in 3D (to the next texel right / up on the same island) for anti-aliased graphics
    def step(axis):
        q = np.roll(P, -1, axis); ok = cov & np.roll(cov, -1, axis) & (np.roll(obj, -1, axis) == obj)
        dlt = q - P; L = np.linalg.norm(dlt, axis=-1); med = np.median(L[ok]) if ok.any() else .02
        ok &= L < 2.5 * med
        qb = np.roll(P, 1, axis); okb = cov & np.roll(cov, 1, axis) & ~ok
        dlb = P - qb; Lb = np.linalg.norm(dlb, axis=-1); okb &= Lb < 2.5 * med
        out = np.where(ok[..., None], dlt, np.where(okb[..., None], dlb, 0)); return out[idx]
    du, dv = step(1), step(0)
    # projected graphics, 4x4 supersampled over each texel's footprint
    SS = [(-.375 + .25 * i) for i in range(4)]
    for o in CTX.ops:
        on, oR, oU = np.array(o['n']), np.array(o['R']), np.array(o['U'])
        d = p - np.array(o['c']); dn = d @ on
        u = d @ oR / o['w'] + .5; v = d @ oU / o['h'] + .5
        m = (np.abs(dn) < o['depth']) & (n @ on > .35) & (u >= -.05) & (u <= 1.05) & (v >= -.05) & (v <= 1.05) & np.isin(ob, o['objs'])
        if o['kinds'] is not None: m &= np.isin(kd, o['kinds'])
        if not m.any(): continue
        acc = np.zeros((m.sum(), 3), np.float32); aa = np.zeros(m.sum(), np.float32)
        for a_ in SS:
            for b_ in SS:
                dd = d[m] + a_ * du[m] + b_ * dv[m]
                uu = dd @ oR / o['w'] + .5; vv = dd @ oU / o['h'] + .5
                rgb, a = o['fn'](uu, vv, o['outer'], o['w'], o['h'])
                a = a * ((uu >= 0) & (uu <= 1) & (vv >= 0) & (vv <= 1))
                acc += rgb * a[:, None]; aa += a
        aa /= len(SS) ** 2; acc /= np.maximum(aa * len(SS) ** 2, 1e-6)[:, None]
        c[m] = c[m] * (1 - aa[:, None]) + acc * aa[:, None]
    # wheels
    for oid in (OBJ_WHEEL, OBJ_WFAR):
        m = ob == oid
        if m.any():
            R, T = CTX.wheel['r'], CTX.wheel['tw']
            w = wheel_paint(CTX.wheel['paint'] if oid == OBJ_WHEEL else 'far', x[m] / T, y[m] / R, z[m] / R, n[m, 0])
            if oid == OBJ_WFAR: w[(n[m, 0] > .5) & (np.hypot(y[m], z[m]) / R < .62)] = _rgb(0x6c7075)
            c[m] = w
    col[idx[0], idx[1], :3] = np.clip(c, 0, 1)
    col = dilate(col, cov, n=24)
    img.pixels.foreach_set(col.ravel())
    img.filepath_raw = os.path.join(tempfile.gettempdir(), img.name + '_p.jpg'); img.file_format = 'JPEG'
    if img.packed_file: img.unpack(method='REMOVE')
    img.save(); img.pack()


# ---------------------------------------------------------------- wheels
def wheel_parts(name, root, W):
    """<m>_wheel (near, 46 tris, recessed dish) and <m>_wfar (plain, 28 tris) at the model's real wheel size,
    centred on the origin, axle x, hub face +x."""
    n = 8; a0 = math.pi / n; R, T = W['r'], W['tw']
    ring = lambda r, x: [(x * T, R * r * math.cos(a0 + i * 2 * math.pi / n), R * r * math.sin(a0 + i * 2 * math.pi / n)) for i in range(n)]
    p = lp.Part()
    p.cyl(R, R, T, n=n, rz=-math.pi / 2, col=TYRE, caps=False, a0=a0)
    p.face(ring(1, -.5)[::-1], TYRE)
    o, rim = ring(1, .5), ring(.66, .5)
    for i in range(n):
        j = (i + 1) % n
        p.face([o[i], o[j], rim[j], rim[i]], TYRE)
        p.face([rim[i], rim[j], (.42 * T, 0, 0)], 0x8a8e93)
    w = p.obj(name + '_wheel', parent=root)
    q = lp.Part(); q.cyl(R, R, T, n=8, rz=-math.pi / 2, col=TYRE, top=0x6c7075, a0=a0)
    f = q.obj(name + '_wfar', parent=root)
    return w, f


def wheel_props(W, x): return {'r': W['r'], 'tw': W['tw'], 'zf': W['zf'], 'zr': W['zr'], 'x': round(x, 3), 'style': W['style'], 'real': 1}


def finish(name, parts, props, extra=()):
    root = lp.empty(name, props={'car': props})
    objs = []
    for suffix, part, oid in parts:
        if part.f: o = part.obj(name + suffix, parent=root); o.pass_index = oid; objs.append(o)
    w, f = wheel_parts(name, root, json.loads(root['car'])['wheel']); w.pass_index = OBJ_WHEEL; f.pass_index = OBJ_WFAR
    for o_name, part, oid in extra:
        o = part.obj(o_name, parent=root); o.pass_index = oid
    CTXS[name] = CTX
    return root


# ---------------------------------------------------------------- Toyota Yaris XP90 5-door hatch (+ taxi)
def yaris(name='yaris', taxi=False):
    global CTX; CTX = Ctx(name)
    W = {'r': .30, 'tw': .19, 'zf': 1.07, 'zr': -1.39, 'style': 'alloy'}
    b, d = lp.Part(), lp.Part()
    D = {'yb': .25, 'cb': .09, 'ct': .07, 'crown': .02, 'tum': .01,
         'st': [(-1.875, .74, .90), (-1.82, .835, .99), (-1.0, .847, 1.0), (.62, .847, .935), (1.05, .838, .88),
                (1.5, .80, .79), (1.79, .73, .70), (1.875, .60, .60)]}
    hwAt, ytAt = body(b, D)
    cabin(b, {'cols': [(-1.80, -1.60, 1.47), (-1.30, -1.36, 1.51), (-.42, -.40, 1.53), (-.32, -.30, 1.53), (.60, -.12, 1.515)],
              'kind': [PAINT, GLASS, BLACK, GLASS], 'hwR': .66, 'tum': .035, 'pillar': .06}, hwAt, ytAt)
    for s in (1, -1):
        lamp(b, f_head('twin'), .38, .17, .08, (s * .55, .69, 1.775), ry=s * .62, rx=-.35)
        lamp(b, f_tail('vert'), .15, .36, .08, (s * .70, 1.12, -1.80), ry=s * -.45, col=RED, back=True)
    lamp(b, f_grille(3), .5, .09, .06, (0, .655, 1.86), col=DARK)
    lamp(b, f_grille(4, False, 0x101010, 0x2c2e30), 1.05, .17, .1, (0, .43, 1.83), col=BLACK)
    for s in (1, -1): op((s * .45, .43, 1.88), (0, 0, 1), (0, 1, 0), .1, .07, f_solid(0xe8eaec), depth=.02, kinds=(kn(BLACK),))   # fog lamps
    b.box(1.42, .07, .12, at=(0, .29, 1.79), col=BLACK)
    b.box(1.5, .14, .1, at=(0, .33, -1.84), col=BLACK)
    b.box(1.15, .05, .2, at=(0, 1.48, -1.66), col=PAINT)                                              # roof spoiler
    plate(b, True, .52, 1.889); plate(b, False, .70, -1.878)
    mirror_pair(d, .86, .99, .48)
    CTX.vseams = [(.6, .33, .93, 0), (-.38, .33, .94, 0), (-1.28, .33, .95, 0)]
    CTX.hseams = [(1.75, .5), (.66, .62)]
    handles(hwAt, [.08, -.86], .87)
    if taxi:
        d.box(.78, .05, .34, at=(0, 1.575, -.55), col=BLACK)
        b.box(.72, .24, .3, at=(0, 1.72, -.55), col=0xffd23f)
        for f in (1, -1): op((0, 1.72, -.55 + f * .15), (0, 0, f), (0, 1, 0), .72, .24, f_taxi, depth=.02, kinds=('c_ffd23f',))
        side_text('TAXI', lambda z: .79, -.9, .62, .5, .1, 0x111111)                        # door lettering
    W['paint'] = 'alloy'; CTX.wheel = W
    props = {'L': 3.75, 'W': 1.695, 'wheel': wheel_props(W, .752),
             'tail': [[.70, 1.12, -1.85], [-.70, 1.12, -1.85]], 'head': [[.55, .69, 1.83], [-.55, .69, 1.83]]}
    return finish(name, [('_body', b, OBJ_BODY), ('_det', d, OBJ_DET)], props)


# ---------------------------------------------------------------- Dacia Logan L90 (+ police)
def logan(name='logan', police=False):
    global CTX; CTX = Ctx(name)
    W = {'r': .31, 'tw': .19, 'zf': 1.33, 'zr': -1.30, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    D = {'yb': .26, 'cb': .09, 'ct': .07, 'crown': .015, 'tum': .01,
         'st': [(-2.145, .77, .90), (-2.09, .85, .985), (-1.5, .87, 1.0), (.4, .872, .955), (1.13, .868, .93),
                (1.85, .845, .86), (2.08, .80, .79), (2.145, .68, .70)]}
    if police: D['bands'] = [.62, .80]; D['side'] = [PAINT, 0x1f4fa8, PAINT]
    hwAt, ytAt = body(b, D)
    cabin(b, {'cols': [(-1.42, -.78, 1.49), (-1.12, -.70, 1.505), (-.22, -.20, 1.525), (-.13, -.11, 1.525), (1.13, .36, 1.51)],
              'kind': [PAINT, GLASS, BLACK, GLASS], 'hwR': .705, 'tum': .035}, hwAt, ytAt)
    for s in (1, -1):
        lamp(b, f_head('twin'), .44, .16, .08, (s * .6, .745, 2.10), ry=s * .35, rx=-.15)
        lamp(b, f_tail('wide'), .42, .2, .08, (s * .64, .89, -2.12), ry=s * -.25, col=RED, back=True)
    lamp(b, f_grille(4, False, 0x101112, 0x3c3f43, 0xc4c9ce), .72, .17, .06, (0, .75, 2.12), col=DARK)
    lamp(b, f_grille(3, False, 0x0e0e0e, 0x2a2c2e), 1.1, .16, .08, (0, .45, 2.11), col=BLACK)
    b.box(1.46, .06, .12, at=(0, .29, 2.07), col=BLACK)
    b.box(1.6, .12, .1, at=(0, .36, -2.11), col=BLACK)
    op((0, .83, -2.16), (0, 0, -1), (0, 1, 0), .5, .03, f_solid(0xc4c9ce), depth=.03, kinds=('paint',))   # boot chrome strip
    plate(b, True, .50, 2.156); plate(b, False, .70, -2.153)
    mirror_pair(d, .9, 1.0, 1.0)
    CTX.vseams = [(1.11, .34, .92, 0), (-.2, .34, .95, 0), (-1.28, .34, .97, 0)]
    CTX.hseams = [(2.0, .55), (1.18, .65), (-1.47, .7), (-2.06, .7)]
    handles(hwAt, [.5, -.7], .86)
    extra = []
    if police:
        side_text('POLITIA', hwAt, 0, .71, 1.3, .17, 0xffffff, kinds=('c_1f4fa8',))
        k = (ytAt(1.85) - ytAt(1.13)) / .72
        op((0, ytAt(1.6) + .015, 1.6), _norm((0, 1, -k)), (0, 0, -1), 1.2, .3, f_text('POLITIA', 0x1f4fa8), depth=.06, kinds=('paint',))
        op((0, ytAt(-1.8) + .015, -1.8), (0, 1, 0), (0, 0, 1), 1.05, .26, f_text('POLITIA', 0x1f4fa8), depth=.06, kinds=('paint',))
        op((0, .97, -2.12), (0, 0, -1), (0, 1, 0), .8, .1, f_text('POLITIA', 0x1f4fa8), depth=.08, kinds=('paint',))
        b.box(1.4, .1, .1, at=(0, .48, 2.2), col=BLACK)                                                   # push bar
        bar = lp.Part()
        bar.box(1.22, .08, .3, at=(0, 1.545, -.1), col=BLACK)
        bar.box(.56, .12, .26, at=(-.31, 1.645, -.1), col=0xff2020)
        bar.box(.56, .12, .26, at=(.31, 1.645, -.1), col=0x2050ff)
        for sx in (-.31, .31):
            for f in (1, -1):
                op((sx, 1.645, -.1 + f * .13), (0, 0, f), (0, 1, 0), .5, .09, f_grille(5, True, 0xffffff, 0xffd0d0), depth=.02, objs=(OBJ_BAR,))
        extra.append(('police_bar', bar, OBJ_BAR))
        W['paint'] = 'steel'
    else:
        W['paint'] = 'hubcap'
    CTX.wheel = W
    props = {'L': 4.29, 'W': 1.74, 'wheel': wheel_props(W, .781),
             'tail': [[.64, .89, -2.16], [-.64, .89, -2.16]], 'head': [[.6, .745, 2.15], [-.6, .745, 2.15]]}
    if police: props['bar'] = [0, 1.65, -.1]
    return finish(name, [('_body', b, OBJ_BODY), ('_det', d, OBJ_DET)], props, extra)


# ---------------------------------------------------------------- VAZ-2107
def lada(name='lada'):
    global CTX; CTX = Ctx(name)
    W = {'r': .29, 'tw': .17, 'zf': 1.21, 'zr': -1.21, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    D = {'yb': .30, 'cb': .05, 'ct': .04, 'crown': .0, 'tum': .0,
         'st': [(-2.065, .77, .86), (-2.03, .80, .915), (-1.95, .81, .93), (1.9, .81, .915), (2.03, .80, .89), (2.065, .77, .84)]}
    hwAt, ytAt = body(b, D)
    cabin(b, {'cols': [(-1.25, -.96, 1.415), (-1.02, -.90, 1.425), (-.24, -.22, 1.44), (-.15, -.14, 1.44), (.98, .42, 1.43)],
              'kind': [PAINT, GLASS, PAINT, GLASS], 'hwR': .68, 'tum': .03, 'crown': .01, 'frame': CHROME, 'sill': .035,
              'head': .03, 'apil': PAINT, 'roof': PAINT, 'pillar': .06}, hwAt, ytAt)
    for s in (1, -1):
        lamp(b, f_head('square'), .44, .23, .06, (s * .53, .74, 2.05), col=CHROME)
        lamp(b, f_solid(AMBER), .17, .07, .04, (s * .6, .40, 2.09), col=AMBER)                           # indicators
        lamp(b, f_tail('lada'), .56, .21, .05, (s * .5, .78, -2.06), col=CHROME, back=True)
        b.box(.04, .04, 3.3, at=(s * .815, .62, 0), col=CHROME)                                            # side moulding
    lamp(b, f_grille(7, True, 0x141414, 0xc4c9ce, 0xd0d4d8), .5, .25, .05, (0, .74, 2.065), col=CHROME)
    for z in (2.09, -2.09):                                                                                # chrome bumpers
        b.box(1.68, .13, .13, at=(0, .47, z), col=CHROME)
        op((0, .47, z + (.07 if z > 0 else -.07)), (0, 0, 1 if z > 0 else -1), (0, 1, 0), 1.68, .13, f_band(0x151515, .35, .65), depth=.03, kinds=('chrome',))
    plate(b, True, .60, 2.095); plate(b, False, .62, -2.08)
    for s in (1, -1): d.box(.08, .08, .1, at=(s * .84, .99, .88), col=CHROME)
    CTX.vseams = [(.98, .36, .9, 0), (-.2, .36, .92, 0), (-1.2, .36, .92, 0)]
    CTX.hseams = [(1.98, .6), (1.0, .7), (-1.3, .7), (-2.0, .7)]
    handles(hwAt, [.45, -.65], .86, 0xc4c9ce)
    W['paint'] = 'lada'; CTX.wheel = W; CTX.grime = 1.3
    props = {'L': 4.13, 'W': 1.62, 'wheel': wheel_props(W, .745),
             'tail': [[.42, .78, -2.1], [-.42, .78, -2.1]], 'head': [[.53, .74, 2.1], [-.53, .74, 2.1]]}
    return finish(name, [('_body', b, OBJ_BODY), ('_det', d, OBJ_DET)], props)


# ---------------------------------------------------------------- Toyota RAV4 XA20
def suv(name='suv'):
    global CTX; CTX = Ctx(name)
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
    for s in (1, -1):
        lamp(b, f_head('single'), .42, .17, .08, (s * .6, .82, 1.95), ry=s * .45, rx=-.2)
        lamp(b, f_tail('vert'), .14, .42, .08, (s * .79, 1.2, -1.985), col=RED, back=True)
    lamp(b, f_grille(3, False, 0x111213, 0x3f4246, 0xc4c9ce), .64, .16, .06, (0, .80, 1.99), col=DARK)
    b.box(1.62, .30, .16, at=(0, .56, 1.96), col=CL)
    op((0, .44, 2.045), (0, 0, 1), (0, 1, 0), 1.1, .08, f_solid(0x9a9da0), depth=.03, kinds=('c_3a3c3f',))   # skid plate
    op((0, .58, 2.045), (0, 0, 1), (0, 1, 0), .9, .1, f_grille(2, False, 0x151515, 0x2c2e30), depth=.03, kinds=('c_3a3c3f',))
    b.box(1.65, .26, .14, at=(0, .56, -1.98), col=CL)
    b.cyl(.33, .33, .2, n=8, at=(.05, 1.02, -2.12), rx=math.pi / 2, col=PAINT, top=CL, a0=math.pi / 8)   # spare wheel cover
    op((.05, 1.02, -2.221), (0, 0, -1), (0, 1, 0), .66, .66, lambda u, v, o, w, h: (
        np.broadcast_to(_rgb(0x2a2c2f), (len(u), 3)),
        ((np.hypot(u - .5, v - .5) < .3) | (np.abs(np.hypot(u - .5, v - .5) - .45) < .02)).astype(np.float32)), depth=.03, kinds=('paint',))
    plate(b, True, .58, 2.045); plate(b, False, .80, -2.006)
    for s in (1, -1):
        d.box(.04, .035, 1.6, at=(s * .6, 1.735, -.95), col=BLACK)
        for z in (-1.75, -.15): d.box(.05, .05, .06, at=(s * .6, 1.705, z), col=BLACK)
    mirror_pair(d, .9, 1.12, .75)
    CTX.vseams = [(.72, .66, 1.08, 0), (-.55, .66, 1.1, 0), (-1.62, .66, 1.11, 0)]
    CTX.hseams = [(1.9, .55), (.78, .65)]
    handles(hwAt, [.2, -1.05], 1.0)
    CTX.lip = (.07, CL)
    W['paint'] = 'alloy'; CTX.wheel = W
    props = {'L': 4.0, 'W': 1.735, 'wheel': wheel_props(W, .765),
             'tail': [[.79, 1.22, -2.03], [-.79, 1.22, -2.03]], 'head': [[.6, .82, 2.0], [-.6, .82, 2.0]]}
    return finish(name, [('_body', b, OBJ_BODY), ('_det', d, OBJ_DET)], props)


# ---------------------------------------------------------------- Mercedes Sprinter high-roof minibus (rutiera)
def sprinter(name='sprinter'):
    global CTX; CTX = Ctx(name)
    W = {'r': .37, 'tw': .22, 'zf': 1.98, 'zr': -1.69, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    st = [(-2.955, .93, 2.55), (-2.90, .99, 2.62), (.62, .995, 2.64), (.88, .99, 2.48), (1.72, .975, 1.38),
          (2.25, .96, 1.24), (2.65, .93, 1.12), (2.85, .88, 1.02), (2.955, .80, .90)]
    D = {'yb': .42, 'cb': .1, 'ct': .16, 'crown': .02, 'tum': .03, 'st': st, 'bands': [.74, .86], 'side': [PAINT, 0x1d1e20, PAINT]}
    D['over'] = lambda i, j: (GLASS if (i == 3 and j == 6) else None)        # windscreen
    hwAt, ytAt = body(b, D)
    def win(s, z0, z1, y0, y1):
        q = [(hwAt(z0) + .006, y0, z0), (hwAt(z0) + .006, y1, z0), (hwAt(z1) + .006, y1, z1), (hwAt(z1) + .006, y0, z1)]
        face(b, q if s > 0 else [(-x, y, z) for x, y, z in q[::-1]], GLASS)
    for s in (1, -1):
        win(s, .80, 1.50, 1.42, 2.18)
        for z0, z1 in ((-2.7, -1.95), (-1.8, -1.05), (-.9, -.12), (.02, .62)): win(s, z0, z1, 1.45, 2.2)
        q = [(s * .06, 1.5, -2.962), (s * .06, 2.3, -2.962), (s * .84, 2.3, -2.962), (s * .84, 1.5, -2.962)]
        face(b, q if s > 0 else q[::-1], GLASS)
    for s in (1, -1):
        lamp(b, f_head('twin'), .46, .24, .08, (s * .72, .98, 2.87), ry=s * .55, rx=-.25)
        lamp(b, f_tail('vert'), .14, .66, .08, (s * .935, 1.07, -2.955), col=RED, back=True)
    lamp(b, f_grille(4, False, 0x111213, 0xb8bdc2), .86, .3, .06, (0, .95, 2.935), col=DARK)
    b.box(1.96, .36, .2, at=(0, .62, 2.92), col=0x2a2b2d)
    b.box(1.96, .26, .16, at=(0, .55, -2.95), col=0x2a2b2d)
    b.box(.6, .08, .6, at=(0, 2.68, -.5), col=0xdedede)
    plate(b, True, .62, 3.022); plate(b, False, .75, -2.963)
    mirror_pair(d, 1.18, 1.62, 1.62, big=True)
    zA, yA, zB, yB = .88, 2.48, 1.72, 1.38
    nws = _norm((0, zB - zA, -(yB - yA)))
    t = lambda u: (_lerp(zA, zB, u), _lerp(yA, yB, u))
    z, y = t(.14); op((.12, y, z), nws, (0, 1, 0), .9, .22, f_board('121'), depth=.05, kinds=('glass',))
    z, y = t(.8); op((-.5, y, z), nws, (0, 1, 0), .36, .2, f_text('121', 0x111111, 0xfbfbf6, .6), depth=.05, kinds=('glass',))
    op((-(hwAt(.25) + .004), 2.36, .25), (-1, 0, 0), (0, 1, 0), .6, .2, f_board('121'), depth=.04, kinds=('paint',))
    op((0, 2.3, -2.962), (0, 0, -1), (0, 1, 0), .6, .2, f_board('121'), depth=.04, kinds=('glass',))
    CTX.vseams = [(1.62, .6, 2.4, 0), (-2.75, .6, 2.4, 0), (-.1, .6, 2.35, -1), (.7, .6, 2.35, -1)]
    CTX.hseams = [(2.8, .6)]
    op((0, 1.5, -2.963), (0, 0, -1), (0, 1, 0), .02, 1.9, f_solid(0x222222), depth=.02, kinds=('paint', 'glass'))   # rear door split
    op((-(hwAt(-.3) + .003), 1.0, -.3), (-1, 0, 0), (0, 1, 0), .15, .035, f_solid(0x1b1b1b), depth=.04, kinds=('paint',))
    CTX.lip = (.07, 0x1d1e20)
    W['paint'] = 'heavy'; CTX.wheel = W
    props = {'L': 5.91, 'W': 1.99, 'wheel': wheel_props(W, .90),
             'tail': [[.935, 1.05, -3.0], [-.935, 1.05, -3.0]], 'head': [[.72, .98, 2.93], [-.72, .98, 2.93]]}
    return finish(name, [('_body', b, OBJ_BODY), ('_det', d, OBJ_DET)], props)


# ---------------------------------------------------------------- trolleybus (12 m low-floor, original design)
def trolley(name='trolley'):
    global CTX; CTX = Ctx(name)
    W = {'r': .5, 'tw': .3, 'zf': 3.9, 'zr': -2.5, 'style': 'steel'}
    b, d = lp.Part(), lp.Part()
    WH, RF, SK, LN = 0xf2f2ee, 0xd4d7da, 0x33363b, 0x2b2f33
    st = [(-6.0, 1.20, 3.30), (-5.94, 1.26, 3.36), (-5.80, 1.275, 3.38), (5.70, 1.275, 3.38), (5.88, 1.262, 3.34), (6.0, 1.225, 3.28)]
    D = {'yb': .32, 'cb': .06, 'ct': .26, 'crown': .03, 'tum': .04, 'st': st,
         'bands': [.52, 1.0, 1.18, 1.22, 2.62, 2.72, 2.86],
         'side': [SK, PAINT, WH, LN, GLASS, WH, PAINT, WH], 'chamfer': RF, 'top': RF, 'caps': (WH, WH)}
    hwAt, ytAt = body(b, D)
    doors = ((4.45, 5.65), (0, 1.25), (-4.65, -3.4))
    for s in (1, -1):
        for zc in (-5.6, -4.25, -2.85, -1.45, -.05, 1.35, 2.75, 4.15):
            if s < 0 and any(a - .1 < zc < c + .1 for a, c in doors): continue
            CTX.pillars.append((zc, .1, 1.2, 2.64, s))
    X = 1.275 + .006
    for z0, z1 in doors:                                                                                     # doors (kerb side = -x)
        m = (z0 + z1) / 2
        panel(b, (-X, 1.51, m), (-1, 0, 0), (0, 1, 0), z1 - z0, 2.3, 0xc5cacf)
        for zz in ((z0 + m) / 2, (m + z1) / 2):
            panel(b, (-(X + .004), 1.53, zz), (-1, 0, 0), (0, 1, 0), (z1 - z0) / 2 - .1, 2.08, GLASS)
        op((-(X + .004), .40, m), (-1, 0, 0), (0, 1, 0), z1 - z0, .08, f_solid(0x151515), depth=.02, kinds=('c_c5cacf',))
        op((-(X + .004), 1.5, m), (-1, 0, 0), (0, 1, 0), .03, 2.2, f_solid(0x222426), depth=.02, kinds=('c_c5cacf', 'glass'))
    F, Bk = 6.0 + .006, -6.0 - .006
    panel(b, (0, 2.05, F), (0, 0, 1), (0, 1, 0), 2.3, 1.8, GLASS)
    panel(b, (0, 3.14, F + .002), (0, 0, 1), (0, 1, 0), 2.1, .3, DARK)
    op((0, 3.14, F + .002), (0, 0, 1), (0, 1, 0), 2.05, .27, f_board('10 CENTRU', fill=.62), depth=.02, kinds=(kn(DARK),))
    op((-(1.275 + .004), 2.42, 4.0), (-1, 0, 0), (0, 1, 0), 1.2, .2, f_board('10 CENTRU', fill=.62), depth=.02, kinds=('glass',))
    op((1.275 + .004, 2.42, 4.6), (1, 0, 0), (0, 1, 0), .5, .2, f_board('10', fill=.62), depth=.02, kinds=('glass',))
    panel(b, (0, 2.3, Bk), (0, 0, -1), (0, 1, 0), 1.9, .95, GLASS)
    op((0, 2.55, Bk), (0, 0, -1), (0, 1, 0), .5, .22, f_board('10', fill=.62), depth=.02, kinds=('glass',))
    for f, zz in ((1, F), (-1, Bk)): panel(b, (0, .82, zz), (0, 0, f), (0, 1, 0), 2.44, .5, PAINT)        # livery band round the ends
    side_text('3912', hwAt, 5.0, 2.94, .3, .08, 0x222222, kinds=('c_f2f2ee',))
    for s in (1, -1):
        lamp(b, f_head('twin'), .38, .2, .06, (s * .92, .82, 6.01))
        op((s * .92, .66, 6.04), (0, 0, 1), (0, 1, 0), .36, .07, f_solid(AMBER), depth=.02, kinds=('paint',))
        lamp(b, f_tail('vert'), .22, .78, .06, (s * 1.02, 1.0, -6.01), col=RED, back=True)
    b.box(2.5, .32, .24, at=(0, .5, 6.02), col=LN)
    b.box(2.5, .30, .22, at=(0, .48, -6.02), col=LN)
    plate(b, True, .42, 6.142); plate(b, False, .42, -6.132)
    b.box(1.95, .36, 2.3, at=(0, 3.55, 3.5), col=0xd9dcdf, top=0xc9ccd0)
    b.box(1.6, .26, 1.7, at=(0, 3.5, 1.0), col=0xc9ccd0)
    b.box(2.0, .32, 2.5, at=(0, 3.52, -3.6), col=0xd9dcdf, top=0xc9ccd0)
    op((0, 3.69, -3.6), (0, 1, 0), (0, 0, -1), 1.7, 2.0, f_grille(6, False, 0xa9adb1, 0xd9dcdf), depth=.03, kinds=('c_c9ccd0',))  # roof vents
    for s in (1, -1): b.box(.24, .16, .55, at=(s * .32, 3.66, 1.0), col=0x2a2a2a)
    for s in (1, -1):
        beam(d, (s * 1.12, 3.05, 5.96), (s * 1.42, 2.86, 6.34), .05, .05, BLACK)
        d.box(.1, .46, .24, at=(s * 1.44, 2.62, 6.36), col=BLACK)
        d.box(.1, .12, .3, at=(s * .32, 3.42, -5.75), col=0x333333)
    CTX.hseams = []
    CTX.vseams = [(-5.9, .35, 1.2, 0), (5.85, .35, 1.2, 0)]
    pole = lp.Part()
    pole.cyl(.035, .03, 6.2, n=6, at=(0, 0, -3.1), rx=math.pi / 2, col=0x262626)
    pole.cyl(.07, .07, .45, n=6, at=(0, 0, -.15), rx=math.pi / 2, col=0x262626)
    pole.box(.1, .09, .32, at=(0, .04, -6.22), col=0x262626)
    W['paint'] = 'heavy'; CTX.wheel = W; CTX.grime = 1.2
    props = {'L': 12, 'W': 2.55, 'wheel': wheel_props(W, 1.155),
             'tail': [[1.02, 1.05, -6.05], [-1.02, 1.05, -6.05]], 'head': [[.92, .82, 6.05], [-.92, .82, 6.05]],
             'poles': [[.32, 3.75, 1.0], [-.32, 3.75, 1.0]]}
    return finish(name, [('_body', b, OBJ_BODY), ('_det', d, OBJ_DET)], props, [('trolley_pole', pole, OBJ_POLE)])


# ---------------------------------------------------------------- bake one model
CTXS = {}
Ctx.lip = None


def localise(root):
    """per-model material copies named '<kind>.<model>' (lp.bake rewires materials to the model's own texture)."""
    cache = {}
    for o in lp._all([root]):
        if o.type != 'MESH': continue
        for i, m in enumerate(o.data.materials):
            if m.name not in cache:
                c = m.copy(); c.name = m.name + '.' + root.name; cache[m.name] = c
            o.data.materials[i] = cache[m.name]


# texel-density multipliers per material kind (detail that carries painted graphics gets more texels)
BOOST = {'c_%06x' % LENS: 2.0, 'c_%06x' % RED: 2.0, 'c_%06x' % AMBER: 2.0, 'c_%06x' % PLATE: 2.2, 'c_ffd23f': 1.8,
         'c_1f4fa8': 2.0, 'c_%06x' % DARK: 1.5, 'chrome': 1.2, 'glass': 1.2, 'c_%06x' % UNDER: .2}


def unwrap(ms, margin):
    """weld + smooth, then smart-UV each material on its own (material borders = island borders, so texture filtering
    never mixes glass into paint), even out the texel density, scale islands by BOOST (and shrink tyre tread / inner
    faces, far wheels, poles), pack with a wide margin."""
    for o in ms: lp.smooth(o, 50)
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    names = sorted({m.name for o in ms for m in o.data.materials})
    for name in names:
        for o in ms:
            for pg in o.data.polygons: pg.select = o.data.materials[pg.material_index].name == name
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT'); bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in ms:
        bm = bmesh.new(); bm.from_mesh(o.data); uv = bm.loops.layers.uv.active
        for f in bm.faces:
            k = BOOST.get(o.data.materials[f.material_index].name.split('.')[0], 1.0)
            if o.pass_index == OBJ_WHEEL and (f.normal.x < -.5 or abs(f.normal.x) < .5): k = .35
            if o.pass_index == OBJ_WFAR: k = .3
            if o.pass_index == OBJ_POLE: k = .5
            if k != 1:
                c = sum((l[uv].uv for l in f.loops), start=f.loops[0][uv].uv * 0) / len(f.loops)
                for l in f.loops: l[uv].uv = c + (l[uv].uv - c) * k
        bm.to_mesh(o.data); bm.free()
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT'); bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def dilate(col, cov, n=16):
    """grow painted texels outward into empty texels (n steps, 8-neighbour average) so mip-mapping and bilinear
    filtering at island borders only ever see the island's own colours."""
    c = col[..., :3] * cov[..., None]; m = cov.astype(np.float32)
    H, W = m.shape
    for _ in range(n):
        if m.min() > 0: break
        cp = np.pad(c, ((1, 1), (1, 1), (0, 0))); mp = np.pad(m, 1)
        acc = np.zeros_like(c); w = np.zeros_like(m)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy or dx:
                    acc += cp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]; w += mp[1 + dy:1 + dy + H, 1 + dx:1 + dx + W]
        new = (m == 0) & (w > 0)
        c[new] = acc[new] / w[new, None]; m[new] = 1
    col[..., :3] = c
    return col


def bake_model(root, size):
    global CTX
    CTX = CTXS[root.name]
    mine = lp._all([root]); ms = [o for o in mine if o.type == 'MESH']
    for o in bpy.context.scene.objects:
        if o.type == 'MESH': o.hide_render = o not in mine
    P = json.loads(root['car']); W = P['wheel']
    # wheels / poles out of the way while AO bakes; temporary wheel occluders in the arches
    away = [o for o in ms if o.pass_index in (OBJ_WHEEL, OBJ_WFAR, OBJ_POLE)]
    for k, o in enumerate(away): o.location = lp.B(20 + k * 3, 0, 0)
    wheel = next(o for o in ms if o.pass_index == OBJ_WHEEL)
    tmp = []
    for z in (W['zf'], W['zr']):
        for s in (1, -1):
            t = bpy.data.objects.new('_occ', wheel.data); bpy.context.scene.collection.objects.link(t)
            t.location = lp.B(s * W['x'], W['r'], z); tmp.append(t)
    unwrap(ms, margin=4.0 / size)
    img = lp.bake([root], size=size, name=root.name + '_tex', ao=.7, ao_dist=.5 if size > 256 else .3, smooth_angle=None, unwrap=False, samples=32, margin=2)
    for t in tmp: t.hide_render = True
    paint(img, ms, size)
    for t in tmp: bpy.data.objects.remove(t)
    for o in away: o.location = (0, 0, 0)
    for o in bpy.context.scene.objects:
        if o.type == 'MESH': o.hide_render = False
    tri = lambda os_: sum(len(pg.vertices) - 2 for o in os_ for pg in o.data.polygons)
    body = [o for o in ms if o.pass_index in (OBJ_BODY, OBJ_DET, OBJ_BAR)]
    print('%-9s body+det %4d tris + 4 wheels x %d = %4d   far %d   texture %d px' % (
        root.name, tri(body), tri([wheel]), tri(body) + 4 * tri([wheel]),
        tri([o for o in ms if o.pass_index == OBJ_BODY]) + 4 * tri([o for o in ms if o.pass_index == OBJ_WFAR]), size))


# ---------------------------------------------------------------- build
lp.reset()
roots = [yaris(), yaris('taxi', taxi=True), logan(), logan('police', police=True), lada(), suv(), sprinter(), trolley()]
for r in roots: localise(r)
for r in roots: bake_model(r, 512 if r.name == 'trolley' else 256)
lp.export(os.path.join(lp.MODELS, 'cars.glb'), roots)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if argv:
    out = argv[0]; os.makedirs(out, exist_ok=True)
    for r in roots:   # preview copies of the wheels / poles in place
        P = json.loads(r['car']); w = P['wheel']
        wd = bpy.data.objects[r.name + '_wheel']; wd.hide_render = True; bpy.data.objects[r.name + '_wfar'].hide_render = True
        for z in (w['zf'], w['zr']):
            for s in (1, -1):
                o = bpy.data.objects.new('pw', wd.data); bpy.context.scene.collection.objects.link(o)
                o.parent = r; o.location = lp.B(s * w['x'], w['r'], z)
                if s < 0: o.rotation_euler = (0, 0, math.pi)
        for pv in P.get('poles', []):
            pole = bpy.data.objects['trolley_pole']
            o = bpy.data.objects.new('pp', pole.data); bpy.context.scene.collection.objects.link(o)
            o.parent = r; o.location = lp.B(*pv); o.rotation_euler = (.33, 0, 0)
    bpy.data.objects['trolley_pole'].hide_render = True
    hide = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.hide_render]
    for r in roots:
        lp.preview([r], os.path.join(out, r.name + '_a.png'), yaw=-40, pitch=15, size=800)
        lp.preview([r], os.path.join(out, r.name + '_b.png'), yaw=150, pitch=20, size=800)
        for o in hide: o.hide_render = True
    for r in roots:
        img = bpy.data.images.get(r.name + '_tex')
        if img: img.save_render(os.path.join(out, r.name + '_tex.png'))
