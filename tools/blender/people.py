"""Builds models/people.glb: the 7 rigid body parts shared by every pedestrian and the player (js/people.js).
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/people.py [-- --preview DIR]

PS2-era look: simple smooth-shaded silhouettes (~1,400 triangles for a whole character including every optional piece,
~1,000 in the far LOD) and all small detail painted into ONE 256x256 atlas shared by the 7 parts (128x128 for the far LOD): face,
hairline, folds and creases, seams, pockets, belt and buckle, cuffs, soles and laces, hand lines, top-down light, grime.

Nodes: torso, head, uArm, fArm, thigh, shin, foot (= js/people.js PPL_PARTS) and the far LOD <part>_lo. Each node's
origin is its joint in the rest pose (left side = +x), so vertices are in the part's local frame exactly as ppl_pose()
expects. Arm and leg nodes serve both sides: everything on them (geometry and paint) is symmetric in x.
  torso: feet (0, 0, 0)       head: neck (0, 1.535, 0)        uArm: shoulder (0.2, 1.44, 0)   fArm: elbow, 0.29 below
  thigh: hip (0.095, 0.92, 0)  shin: knee, 0.46 below the hip  foot: ankle, 0.44 below the knee

Material NAME = what the faces are, decoded by people.js into the per-vertex aSF attribute:
  s_<slot>[__f_<feature>|__nf_<feature>][__lo]
slot = ppl_S key (fix skin top bot hair shoe acc sleeve shin topDk …): the per-person palette colour; __f_x: only drawn when
the person has feature x (ppl_F key); __nf_x: hidden when they have it; __lo marks the far-LOD copies (own atlas).
Texture: RGB = light-grey paint for tintable slots (the game multiplies it by the person's slot colour) or the real colour
for 'fix' faces; ALPHA = 1 where the slot colour applies, 0 for painted detail that keeps its own colour (eye whites and
irises, buckle, phone screen…).

Painting works in 3D: after unwrapping, the object-space position, normal and part/material id of every texel are baked
(EMIT passes), then numpy paints each texel from those (paint_* functions below).
"""
import sys, os, math, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp
import bpy
import numpy as np

TAU = 2 * math.pi
FEATS = ('hairS', 'hairL', 'bun', 'cap', 'scarf', 'skirt', 'pack', 'bag', 'sleeves', 'pants', 'coat', 'beard', 'jacket', 'hair',
         'stripes', 'bust', 'glasses', 'shop', 'phone', 'hood')  # = ppl_F bit order (1 << index)
SLOTS = ('fix', 'skin', 'top', 'bot', 'hair', 'shoe', 'acc', 'sleeve', 'shin', 'topDk', 'lip', 'hairDk')  # = ppl_S

# skeleton (must match PPL_* in js/people.js)
HIP, THIGH, SHIN, UARM, SHO_Y, SHO_X, NECK = .95, .46, .44, .29, 1.44, .2, 1.535
JOINT = {'torso': (0, 0, 0), 'head': (0, NECK, 0), 'uArm': (SHO_X, SHO_Y, 0), 'fArm': (SHO_X, SHO_Y - UARM, 0),
         'thigh': (.095, HIP - .03, 0), 'shin': (.095, HIP - .03 - THIGH, 0), 'foot': (.095, HIP - .03 - THIGH - SHIN, 0)}
PARTS = ('torso', 'head', 'uArm', 'fArm', 'thigh', 'shin', 'foot')
ABS = ('torso', 'head')          # drawn (and painted) in absolute heights; limbs in joint-local coordinates
LO_N = {8: 6, 6: 4}              # far-LOD side counts
GREY = 0xe8e8e8                  # tintable paint base (× the person's colour in game)
FIXC = {None: 0x30281f, 'phone': 0x1a1c20, 'glasses': 0x1c1c1e, 'pack': 0x2a2a2e, 'bag': 0x33291f}  # 'fix' faces


def C(slot, feat=None, neg=False):
    assert slot in SLOTS and (feat is None or feat in FEATS)
    return (slot, feat, neg)


def _newell(p):
    n = [0.0, 0.0, 0.0]
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return n


class Bld:
    """Collects one part's faces (joint-local coords: off = the joint for limbs). lo = far LOD (fewer sides)."""

    def __init__(self, off=(0, 0, 0), lo=False):
        self.p = lp.Part(); self.off = off; self.lo = lo

    def col(self, c):
        slot, feat, neg = c
        name = 's_' + slot + ((('__nf_' if neg else '__f_') + feat) if feat else '') + ('__lo' if self.lo else '')
        return self.p.add_material(FIXC.get(feat, FIXC[None]) if slot == 'fix' else GREY, name)

    def _o(self, p): return (p[0] + self.off[0], p[1] + self.off[1], p[2] + self.off[2])

    def face(self, pts, c, out=None):
        """Polygon in local coords. out: a direction the face should point along (winding is flipped to match)."""
        if out is not None:
            n = _newell(pts)
            if n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0: pts = pts[::-1]
        self.p.face([self._o(q) for q in pts], self.col(c))

    def box(self, w, h, d, at, c, rx=0.0, ry=0.0, rz=0.0, taper=1.0):
        self.p.box(w, h, d, at=self._o(at), rx=rx, ry=ry, rz=rz, col=self.col(c), taper=taper)

    def lathe(self, prof, n, c, at=(0, 0, 0), s=(1, 1, 1), rx=0.0, ry=0.0, rz=0.0, a0=0.0, ph=None, cols=None):
        """Revolve prof [(r, y[, dz]), ...] listed bottom → top (keeps normals outward). a0 = angle of the first vertex
        (0 = +x, pi/2 = back/-z, 3pi/2 = front/+z); ph = (start, end) for a partial, open surface."""
        if self.lo and ph is None and n in LO_N:   # far LOD: fewer sides, same symmetry (a0 kept in half-steps)
            m = LO_N[n]; a0 = a0 / (math.pi / n) * (math.pi / m); n = m
        X = lp._xf(self._o(at), ry, rx, rz, s)
        if ph is None: ang = [a0 + i * TAU / n for i in range(n)]; idx = [(i, (i + 1) % n) for i in range(n)]
        else: ang = [ph[0] + i * (ph[1] - ph[0]) / n for i in range(n + 1)]; idx = [(i, i + 1) for i in range(n)]
        R = [[X((q[0] * math.cos(a), q[1], -q[0] * math.sin(a) + (q[2] if len(q) > 2 else 0))) for a in ang] for q in prof]
        for k in range(len(prof) - 1):
            cc = self.col(cols[k] if cols else c)
            for i, j in idx:
                if prof[k + 1][0] < 1e-6: self.p.face([R[k][i], R[k][j], R[k + 1][i]], cc)
                elif prof[k][0] < 1e-6: self.p.face([R[k][i], R[k + 1][j], R[k + 1][i]], cc)
                else: self.p.face([R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]], cc)

    def ell(self, r, c, at=(0, 0, 0), s=(1, 1, 1), n=6, rings=2, th=(0, math.pi), **kw):
        """Low-poly ellipsoid (radius r, scaled by s); th = polar range from the top pole (0) down (pi = full)."""
        prof = [(r * math.sin(t), r * math.cos(t)) for t in (th[1] - (th[1] - th[0]) * k / rings for k in range(rings + 1))]
        self.lathe(prof, n, c, at, s, **kw)

    def strip(self, prof, n, s, a0, fi, x0, x1, ys, c, lift=.003):
        """Flat strip lying on face fi of a lathe(prof, n, s, a0) solid, u = x0..x1 metres across the face from its
        middle, over heights ys (tracksuit stripes, jacket zip: feature decals the shared texture can't carry). Skipped
        in the far LOD when that LOD has fewer sides."""
        if self.lo and n in LO_N: return
        a, b = a0 + fi * TAU / n, a0 + (fi + 1) * TAU / n
        rows = []
        for y in ys:
            r = prof_r(prof, y)
            P = (r * math.cos(a) * s[0], -r * math.sin(a) * s[2]); Q = (r * math.cos(b) * s[0], -r * math.sin(b) * s[2])
            ex, ez = Q[0] - P[0], Q[1] - P[1]; L = math.hypot(ex, ez); mx, mz = (P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2
            nx, nz = -ez / L, ex / L
            if nx * mx + nz * mz < 0: nx, nz = -nx, -nz
            rows.append([(mx + ex / L * u + nx * lift, y, mz + ez / L * u + nz * lift) for u in (x0, x1)])
        for k in range(len(rows) - 1):
            A, B2 = rows[k], rows[k + 1]
            self.face([A[0], A[1], B2[1], B2[0]], c, out=((A[0][0] + A[1][0]) / 2, 0, (A[0][2] + A[1][2]) / 2))

    def band(self, pts, w, c, out):
        """Flat strap: a strip of quads through pts (centre line), w wide, facing `out` (backpack/bag straps)."""
        for k in range(len(pts) - 1):
            a, b = pts[k], pts[k + 1]
            dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy); px, py = -dy / L * w / 2, dx / L * w / 2
            self.face([(a[0] - px, a[1] - py, a[2]), (a[0] + px, a[1] + py, a[2]), (b[0] + px, b[1] + py, b[2]), (b[0] - px, b[1] - py, b[2])], c, out=out)

    def extrude_x(self, prof, hw, c, at=(0, 0, 0)):
        """Convex side profile [(z, y), ...] extruded across x (±hw) → block shoes."""
        cz = sum(p[0] for p in prof) / len(prof); cy = sum(p[1] for p in prof) / len(prof)
        P = lambda x, p: (at[0] + x, at[1] + p[1], at[2] + p[0])
        self.face([P(hw, p) for p in prof], c, out=(1, 0, 0)); self.face([P(-hw, p) for p in prof], c, out=(-1, 0, 0))
        for i in range(len(prof)):
            p, q = prof[i], prof[(i + 1) % len(prof)]
            self.face([P(-hw, p), P(hw, p), P(hw, q), P(-hw, q)], c, out=(0, (p[1] + q[1]) / 2 - cy, (p[0] + q[0]) / 2 - cz))


def prof_r(prof, y):
    for k in range(len(prof) - 1):
        (r0, y0), (r1, y1) = prof[k][:2], prof[k + 1][:2]
        if y0 <= y <= y1 and y1 > y0: return r0 + (r1 - r0) * (y - y0) / (y1 - y0)
    raise ValueError(y)


def surf_z(prof, n, a0, s, x, y, sign=1):
    """z of a lathe(prof, n, s, a0) surface at (x, y) on the front (sign 1) or back (-1)."""
    r = prof_r(prof, y)
    V = [(r * math.cos(a0 + i * TAU / n) * s[0], -r * math.sin(a0 + i * TAU / n) * s[2]) for i in range(n)]
    best = None
    for i in range(n):
        (ax, az), (bx, bz) = V[i], V[(i + 1) % n]
        if (ax - x) * (bx - x) <= 0 and ax != bx:
            z = az + (bz - az) * (x - ax) / (bx - ax)
            if z * sign > 0 and (best is None or abs(z) > abs(best)): best = z
    return best


# ---------------------------------------------------------------- torso (feet origin)
T_N, T_A0, T_S = 8, math.pi / 8, (1, 1, .62)   # octagon with flat faces front/back/sides: face 5 = front, 7 = +x, 3 = -x
T_PROF = [(0, .82), (.10, .815), (.158, .9), (.166, 1.03), (.174, 1.04), (.174, 1.072), (.153, 1.17), (.19, 1.33),
          (.205, 1.42), (.18, 1.48), (.095, 1.525), (0, 1.54)]
COAT = [(.25, .5), (.215, .8), (.174, 1.075)]
SKIRT = [(.262, .64), (.205, .88), (.174, 1.075)]


def torso(b):
    belt = C('fix')
    b.lathe(T_PROF, T_N, None, s=T_S, a0=T_A0, cols=[C('bot')] * 3 + [belt] * 2 + [C('top')] * 6)
    # jacket: collar + zip decal
    b.lathe([(.1, 1.49), (.084, 1.572)], 8, C('topDk', 'jacket'), at=(0, 0, .004), s=(1, 1, .95), a0=T_A0)
    b.strip(T_PROF, T_N, T_S, T_A0, 5, -.008, .008, [1.075, 1.17, 1.33, 1.47], C('topDk', 'jacket'))
    # hood bunched on the back
    b.ell(.11, C('top', 'hood'), at=(0, 1.475, -.105), s=(1.1, .7, .9), n=6, rings=2, th=(0, .6 * math.pi), rx=-1.1)
    # tracksuit side stripes (decals)
    for fi in (7, 3): b.strip(T_PROF, T_N, T_S, T_A0, fi, -.016, .016, [1.075, 1.17, 1.33, 1.42], C('acc', 'stripes'))
    # bust
    b.ell(.07, C('top', 'bust'), at=(0, 1.325, .072), s=(1.7, .8, .55), n=8, rings=3, a0=math.pi / 8)
    # skirt / dress, long coat
    b.lathe(SKIRT, T_N, C('bot', 'skirt'), s=(1, 1, .78), a0=T_A0)
    b.lathe(COAT, T_N, C('top', 'coat'), s=(1, 1, .8), a0=T_A0)
    # backpack: body, rounded top, straps over the chest
    b.box(.27, .32, .12, (0, 1.27, -.17), C('acc', 'pack'))
    b.ell(.135, C('acc', 'pack'), at=(0, 1.43, -.17), s=(1, .45, .45), n=6, rings=2, th=(0, .5 * math.pi), a0=math.pi / 6)
    fz = lambda x, y, sg=1: surf_z(T_PROF, T_N, T_A0, T_S, x, y, sg) + sg * .006
    for x in (-.085, .085): b.band([(x, 1.16, fz(x, 1.16)), (x, 1.33, fz(x, 1.33)), (x * .9, 1.47, fz(x * .9, 1.47))], .035, C('acc', 'pack'), (0, 0, 1))
    # shoulder bag on the left hip, strap from the hip across the chest (and the back) to the right shoulder
    b.box(.2, .16, .07, (.215, .99, .02), C('acc', 'bag'), rz=.05)
    for sg in (1, -1):
        pts = [(x, y, fz(x, y, sg)) for x, y in ((.13, 1.07), (.03, 1.2), (-.07, 1.33), (-.14, 1.43))]
        b.band(pts, .03, C('acc', 'bag'), (0, 0, sg))


# ---------------------------------------------------------------- head (absolute heights, origin = neck)
H_N, H_A0, H_S = 8, math.pi / 8, (.96, 1, 1.06)    # boxy-but-rounded: flat face front, flat sides
H_PROF = [(0, 1.555, .026), (.056, 1.562, .026), (.082, 1.61, .012), (.097, 1.67, 0), (.1, 1.72, -.006), (.088, 1.775, -.012),
          (.05, 1.805, -.012), (0, 1.812, -.012)]


def head(b):
    sk = C('skin')
    b.lathe([(.056, 1.47), (.05, 1.6)], 6, sk, at=(0, 0, -.006), a0=math.pi / 6)                       # neck
    b.lathe(H_PROF, H_N, sk, s=H_S, a0=H_A0)
    for sx in (1, -1): b.ell(.03, sk, at=(sx * .094, 1.672, -.006), s=(.38, 1, .7), n=4, rings=2)     # ears
    # hair: cap + nape for any hair
    hr = C('hair', 'hair')
    b.lathe([(.108, -.03, -.004), (.112, .02, -.01), (.097, .068, -.014), (.05, .097, -.014), (0, .106, -.014)], H_N, hr,
            at=(0, 1.72, 0), s=H_S, rx=-.12, a0=H_A0)
    b.lathe([(.084, 1.595, -.002), (.107, 1.70, -.006)], 4, hr, s=H_S, ph=(0, math.pi))
    b.box(.15, .03, .04, (0, 1.762, .084), C('hair', 'hairS'), rx=-.55, taper=.85)                       # short fringe
    # long hair: back curtain + side curtains
    hl = C('hair', 'hairL')
    b.lathe([(.122, 1.44, -.014), (.126, 1.53, -.014), (.12, 1.63, -.014), (.113, 1.735, -.014)], 4, hl, s=(1, 1, 1.05), ph=(0, math.pi))
    for sx in (1, -1): b.box(.03, .2, .07, (sx * .106, 1.6, .008), hl, rz=sx * .05)
    b.ell(.048, C('hair', 'bun'), at=(0, 1.765, -.122), n=6, rings=2)
    b.lathe([(.06, 1.552, .034), (.081, 1.6, .018), (.096, 1.648, .006)], 4, C('hair', 'beard'), s=(.97, 1, 1.08), ph=(math.pi, TAU))
    # flat cap: dome + brim
    b.ell(.122, C('acc', 'cap'), at=(0, 1.712, -.006), s=(1, .92, 1.06), n=8, rings=2, th=(0, .5 * math.pi), a0=H_A0)
    b.box(.15, .012, .1, (0, 1.718, .118), C('acc', 'cap'), rx=-.12, taper=.8)
    # headscarf (babushka): shell, drape over the nape, knot under the chin
    b.ell(.126, C('acc', 'scarf'), at=(0, 1.685, -.02), s=(1.03, 1.12, 1.1), n=8, rings=2, th=(0, .56 * math.pi), rx=-.42, a0=H_A0)
    b.lathe([(.165, 1.47), (.118, 1.63)], 4, C('acc', 'scarf'), at=(0, 0, -.015), ph=(0, math.pi))
    b.box(.06, .045, .04, (0, 1.572, .078), C('acc', 'scarf'), rz=.6)
    # dark glasses: one wrap-around band (lenses + temples)
    b.lathe([(.104, 1.679), (.104, 1.703)], 4, C('fix', 'glasses'), s=H_S, ph=(math.pi * .97, TAU * 1.015))


# ---------------------------------------------------------------- limbs (joint-local)
L_A0 = math.pi / 6   # 6-sided tubes with a flat face on each side: face 5 = +x, face 2 = -x


def limb(b, prof, slot, ys, w):
    b.lathe(prof, 6, C(slot), a0=L_A0)
    for fi in (5, 2): b.strip(prof, 6, (1, 1, 1), L_A0, fi, -w, w, ys, C('acc', 'stripes'), lift=.002)


def u_arm(b):
    b.ell(.06, C('top'), at=(-.008, -.03, 0), s=(1, .9, 1), n=6, rings=2, a0=L_A0)
    limb(b, [(.047, -.29), (.058, -.12), (.062, .02)], 'top', [-.27, -.12, 0], .008)
    b.ell(.046, C('top'), at=(0, -.29, 0), n=6, rings=2, a0=L_A0)


def f_arm(b):
    limb(b, [(.034, -.245), (.045, -.07), (.047, 0)], 'sleeve', [-.21, -.07, -.005], .007)
    b.lathe([(.042, -.248), (.041, -.214)], 6, C('topDk', 'sleeves'), a0=L_A0)                           # cuff
    sk = C('skin')
    b.lathe([(.03, -.27), (.034, -.235)], 6, sk, a0=L_A0)                                                 # wrist
    b.ell(.042, sk, at=(0, -.313, .004), s=(.74, 1.3, .46), n=6, rings=3, a0=L_A0)                       # mitten hand
    b.ell(.016, sk, at=(0, -.293, .022), s=(.9, 1.9, 1), n=4, rings=2, rx=.5)                             # thumb (forward)
    b.box(.06, .11, .012, (0, -.31, .032), C('fix', 'phone'), rx=-.1)                                      # phone
    b.box(.2, .24, .07, (0, -.5, 0), C('acc', 'shop'), taper=.82)                                           # plastic shopping bag
    b.box(.07, .13, .008, (0, -.37, 0), C('acc', 'shop'), taper=.5)                                          # its handles


def thigh(b):
    b.ell(.085, C('bot'), n=6, rings=2, a0=L_A0)
    limb(b, [(.06, -.46), (.082, -.2), (.087, .02)], 'bot', [-.44, -.2, .01], .01)
    b.ell(.059, C('bot'), at=(0, -.46, .004), n=6, rings=2, a0=L_A0)


def shin(b):
    limb(b, [(.038, -.42), (.047, -.3), (.06, -.1), (.058, .02)], 'shin', [-.36, -.3, -.1, .01], .008)
    b.lathe([(.047, -.42), (.045, -.37)], 6, C('bot', 'pants'), a0=L_A0)                                   # trouser hem


def foot(b):
    b.lathe([(.046, -.03), (.044, .03)], 6, C('shoe'), a0=L_A0)                                             # ankle collar
    b.extrude_x([(-.075, -.05), (.168, -.05), (.172, -.03), (.13, -.006), (.03, .026), (-.075, .03), (-.082, -.01)], .047, C('shoe'))


BUILD = {'torso': torso, 'head': head, 'uArm': u_arm, 'fArm': f_arm, 'thigh': thigh, 'shin': shin, 'foot': foot}


def build_part(name, lo=False):
    j = JOINT[name]
    b = Bld(off=j if name not in ABS else (0, 0, 0), lo=lo)
    BUILD[name](b)
    return b.p.obj(name + ('_lo' if lo else ''), origin=j)


# ================================================================ painting
def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def line(d, w, soft=.0015):
    """Coverage of a line of half-width w at signed distance d."""
    return 1 - ss(w, w + soft, np.abs(d))


def bump(x, c, w): return 1 - ss(0, w, np.abs(x - c))


def vnoise(P, s, seed=0.0):
    """3D value noise in [0, 1], feature size s metres (P: (n, 3) array, or 3 arrays with per-axis stretch)."""
    q = P / s + seed; i = np.floor(q); f = q - i; f = f * f * (3 - 2 * f)
    def h(o):
        k = i + o; v = np.sin(k[:, 0] * 127.1 + k[:, 1] * 311.7 + k[:, 2] * 74.7) * 43758.5453; return v - np.floor(v)
    c = {o: h(np.array(o, float)) for o in [(a, b_, c_) for a in (0, 1) for b_ in (0, 1) for c_ in (0, 1)]}
    x, y, z = f[:, 0], f[:, 1], f[:, 2]
    l = lambda a, b_, t: a + (b_ - a) * t
    return l(l(l(c[0, 0, 0], c[1, 0, 0], x), l(c[0, 1, 0], c[1, 1, 0], x), y), l(l(c[0, 0, 1], c[1, 0, 1], x), l(c[0, 1, 1], c[1, 1, 1], x), y), z)


def rgb(h): return np.array([((h >> s) & 255) / 255 for s in (16, 8, 0)])


class Px:
    """Texels of one part × material: positions (game coords; absolute for torso/head), normals, colour, alpha."""

    def __init__(self, P, N, col):
        self.P = P; self.x, self.y, self.z = P[:, 0], P[:, 1], P[:, 2]; self.ax = np.abs(self.x)
        self.nx, self.ny, self.nz = N[:, 0], N[:, 1], N[:, 2]
        self.c = col.copy(); self.a = np.ones(len(P))

    def mul(self, f):
        f = np.asarray(f, float)
        self.c *= f[:, None] if f.ndim == 1 else f

    def dark(self, cov, k):
        """Darken (k < 1) / lighten (k > 1) by coverage cov, keeps the slot tint."""
        self.mul(1 + (k - 1) * cov)

    def tint(self, cov, mult):
        """Multiply by an RGB factor with coverage (e.g. lips, blush), keeps the slot tint."""
        self.c *= 1 + (np.array(mult) - 1)[None, :] * np.asarray(cov)[:, None]

    def put(self, cov, col):
        """Paint an own colour (not tinted in game) with coverage cov."""
        cov = np.clip(np.asarray(cov, float), 0, 1)
        self.c = self.c * (1 - cov[:, None]) + rgb(col)[None, :] * cov[:, None]; self.a = self.a * (1 - cov)

    def fabric(self, k=1.0, s=.04):
        self.mul((1 - .1 * k + .1 * k * vnoise(self.P, s)) * (1 - .05 * k + .05 * k * vnoise(self.P, s * .22, 7.3)))

    def grime(self, k=.12, s=.12):
        self.mul(1 - k * ss(.45, .75, vnoise(self.P, s, 3.1)))


def paint_torso(p, slot, feat):
    x, y, z, ax = p.x, p.y, p.z, p.ax
    fr, bk = (z > .02).astype(float), (z < -.02).astype(float)
    if slot == 'bot' and feat is None:          # trousers top: fly, front pockets, back pockets, side seams, crotch
        p.fabric(1.2); p.grime(.08)
        p.dark(line(x, .0025) * fr * ss(.84, .87, y), .55)
        p.dark(line(x - .02, .001) * fr * ss(.88, .9, y) * (y < 1.02), .8)
        p.dark(line(y - (1.03 - (ax - .05) * 1.2), .0018) * fr * (ax > .05) * (ax < .15), .55)
        bx, by = ax - .08, y - .955
        out = np.maximum(np.abs(bx) - .043, np.abs(by) - .05)
        p.dark(line(out, .0015) * bk, .6); p.dark((out < 0) * bk, .94)
        p.dark(line(z, .0015) * (ax > .1), .78)
        p.dark(ss(.9, .83, y) * (1 - ss(.02, .08, ax)), .7)
        p.dark(bump(y, 1.026, .006), .8)                                              # waistband edge under the belt
    elif slot == 'fix' and feat is None:        # belt: edges, stitching, buckle
        p.fabric(.6, .02)
        p.dark(bump(y, 1.069, .003) + bump(y, 1.043, .003), 1.45)
        p.dark(line(y - 1.066, .0008) * (np.sin(np.arctan2(x, z) * 90) > 0), 1.6)
        p.dark(line(ax - .1, .006, .001), .75)
        inb = (ax < .022) * (np.abs(y - 1.056) < .013) * fr
        p.put(inb, 0xa89868)
        p.put((ax < .012) * (np.abs(y - 1.056) < .005) * fr, 0x2a2018)
        p.put(line(x, .0012) * (np.abs(y - 1.056) < .006) * fr, 0xc8b888)
    elif slot == 'top' and feat is None:        # top: hem, neckline, seams, armpits, waist folds, chest light
        p.fabric(); p.grime(.06)
        p.dark(ss(1.1, 1.075, y), .72); p.dark(line(y - 1.098, .0008), .82)
        p.dark(bump(y, 1.497, .006), .65); p.dark(ss(1.5, 1.52, y), .8)
        p.dark(line(z, .0014) * (ax > .09), .78)
        p.dark(ss(.15, .2, ax) * bump(y, 1.3, .1), .72)
        n = vnoise(p.P, .05, 5)
        f = np.maximum(0, np.sin(y * 240 + x * 25 + n * 4)) ** 6 * bump(y, 1.14, .07)
        p.dark(f, .8)
        f2 = np.maximum(0, np.sin((y - ax * .8) * 200 + n * 3)) ** 6 * bump(y, 1.32, .06) * ss(.08, .16, ax)
        p.dark(f2, .85)
        p.dark(bump(y, 1.36, .08) * fr * (1 - ss(.0, .12, ax)), 1.05)
    elif feat == 'bust':
        p.fabric(); p.dark(ss(0, -.6, p.ny), .75); p.dark(ss(.3, .8, p.ny), 1.06)
    elif feat == 'jacket':
        p.fabric(.8)
        zip_ = ((y < 1.485) & (ax < .012)).astype(float)       # the zip decal / the collar (same material)
        p.put(line(x, .0025) * (np.sin(y * 900) > 0) * zip_, 0x8c8c88)
        p.dark(line(ax - .006, .001) * zip_, .7)
        p.dark((.5 + .5 * np.cos(np.arctan2(x, z) * 36)) * (1 - zip_), .88); p.dark(bump(y, 1.53, .01) * (1 - zip_), .8)
    elif feat == 'hood':
        p.fabric(); p.dark(ss(.2, .7, p.ny), .7); p.dark(line(p.nz, .1, .2), .9)
    elif feat == 'stripes':
        p.dark(ss(.009, .014, np.abs(z if np.mean(np.abs(p.nx)) > .5 else x)), .7)
    elif feat == 'skirt':
        p.fabric(.8); a = np.arctan2(x, z)
        p.dark(.5 + .5 * np.cos(a * 14 + vnoise(p.P, .08) * 2), .84)
        p.dark(ss(.69, .645, y), .78); p.dark(line(y - .69, .0008), .85); p.dark(ss(1.04, 1.075, y), .85)
    elif feat == 'coat':
        p.fabric(1.3, .05); p.grime(.12)
        p.dark(line(x, .0018) * fr, .4); p.dark(line(x + .01, .004) * fr, .82)
        for yb in (.62, .77, .92):
            d = np.hypot(x - .03, y - yb); p.put((1 - ss(.006, .0085, d)) * fr, 0x221a14)
            p.put((1 - ss(.0015, .003, np.hypot(x - .028, y - yb - .002))) * fr, 0x5a4a3a)
        p.dark(line(y - .82, .0015) * (ax > .09) * (ax < .17) * (z > .05), .5)
        p.dark(((y < .82) & (y > .79)).astype(float) * (ax > .09) * (ax < .17) * (z > .05), .9)
        p.dark(ss(.54, .5, y), .8); p.dark(line(x, .0018) * bk * (y < .74), .55)
        p.dark(np.maximum(0, np.sin(np.arctan2(x, z) * 9 + vnoise(p.P, .1) * 3)) ** 4 * ss(1.0, .6, y), .85)
    elif feat == 'pack' and slot == 'acc':
        p.fabric(1.2, .03); p.grime(.1)
        back = (z < -.225).astype(float)
        out = np.maximum(np.abs(x) - .1, np.abs(y - 1.18) - .065)
        p.dark(line(out, .0016) * back, .55); p.dark((out < 0) * back, .9)
        p.dark(line(y - 1.235, .0012) * back * (np.abs(x) < .1), .75)
        p.put(line(x - .06, .004) * line(y - 1.24, .006) * back, 0x8a8a86)
        p.dark(ss(.6, .9, np.abs(p.nx)), .82); p.dark(ss(-.3, -.8, p.ny), .7)
        p.dark(line(z + .17, .0015) * (y > 1.43), .6)
        p.dark((z > -.09).astype(float), .55)                                           # the straps over the chest
    elif feat == 'bag':
        p.fabric(.8, .03)
        strap = ((y > 1.075) | (x < .1)).astype(float)                                  # strap bands (same material)
        p.dark(strap, .58)
        p.dark(line(y - 1.0, .0015), .5); p.dark((y > 1.0).astype(float), 1.08)
        p.put((np.abs(x - .215) < .014) * (np.abs(y - .998) < .012) * (z > .045), 0xa09060)
        p.dark(ss(-.3, -.8, p.ny), .7)


EYE_Y = 1.692


def paint_head(p, slot, feat):
    x, y, z, ax = p.x, p.y, p.z, p.ax
    fr = ss(.035, .06, z)
    if slot == 'skin':
        p.mul(.97 + .03 * vnoise(p.P, .01))
        neck = (y < 1.585) & (np.hypot(x, z + .006) < .062)
        p.dark(ss(1.53, 1.585, y) * neck, .62)
        ear = ax > .084
        p.dark((1 - ss(.0, .012, np.hypot(ax - .096, (y - 1.672) * .5))) * ear, .75)
        for sx in (1, -1):
            ex, ey = x - sx * .033, y - EYE_Y
            p.dark((1 - ss(.4, 1.3, (ex / .026) ** 2 + ((ey - .002) / .017) ** 2)) * fr, .86)        # eye socket
            e = (ex / .0175) ** 2 + (ey / .0082) ** 2
            p.put((1 - ss(.7, 1.2, e)) * fr, 0xe0dbd0)                                                 # white
            p.put((1 - ss(.0062, .0082, np.hypot(ex + sx * .0015, ey + .0005))) * fr, 0x4a3422)        # iris
            p.put((1 - ss(.0026, .0038, np.hypot(ex + sx * .0015, ey + .0005))) * fr, 0x120a06)        # pupil
            p.put((1 - ss(.0012, .002, np.hypot(ex + sx * .0015 - .002, ey - .0025))) * fr, 0xf0f0f0)   # glint
            p.dark(line(ey - .0082 * np.sqrt(np.clip(1 - (ex / .019) ** 2, 0, 1)), .0016, .0012) * (np.abs(ex) < .02) * fr, .25)
            bx = x - sx * .036
            p.dark(line(y - (1.716 + .004 * (1 - (bx / .021) ** 2) - sx * bx * .05), .0036, .0014) * (np.abs(bx) < .022) * fr, .3)  # brow
            p.tint((1 - ss(.2, 1, ((x - sx * .05) / .02) ** 2 + ((y - 1.645) / .018) ** 2)) * fr, (1.04, .93, .92))  # blush
        nose = (y > 1.64) & (y < 1.692)
        for sx in (1, -1): p.dark(line(x - sx * .013, .003, .005) * nose * fr, .76)
        p.dark(line(x, .005) * nose * fr, 1.1)
        p.dark(line(y - 1.642, .0025, .003) * (ax < .018) * fr, .55)
        for sx in (1, -1): p.dark((1 - ss(.003, .005, np.hypot(x - sx * .008, y - 1.645))) * fr, .45)
        my = y - (1.619 - 3 * x * x)
        p.tint(((my > -.008) & (my < .006)).astype(float) * (ax < .022) * fr, (1, .7, .68))       # lips
        p.dark(line(my, .0014, .001) * (ax < .023) * fr, .35)
        p.dark(bump(my, -.0045, .002) * (ax < .015) * fr, 1.08)
        p.dark(ss(-.2, -.7, p.ny) * (y < 1.62), .74)                                                 # under the jaw
        p.dark(ss(1.74, 1.79, y), .9)                                                                 # hairline shade
        p.dark(ss(.03, -.05, z) * (y > 1.6), .94)
    elif slot == 'hair':
        streak = vnoise(np.c_[x / .25, y / 6, z / .25] if feat in ('hairL', 'hairS') else np.c_[x, y / 3, z / 5], .006, 2)
        p.mul(.74 + .3 * streak); p.dark(ss(.5, .9, p.ny) * ss(.3, .6, vnoise(p.P, .02, 9)), 1.12)
        if feat == 'hair': p.dark(ss(1.71, 1.66, y), .8); p.dark(line(x - .025, .0018) * (y > 1.77) * (z > -.02), .6)
        if feat == 'hairL': p.dark(ss(1.5, 1.44, y), .78)
        if feat == 'beard':
            p.mul(.78 + .22 * vnoise(p.P, .004, 4)); p.dark(line(y - (1.619 - 3 * x * x), .003) * (ax < .022), .35)
    elif feat == 'cap':
        p.fabric(.7, .02)
        a = np.arctan2(x, z); brim = ((z > .07) & (y < 1.74)).astype(float)
        d = np.abs(((a / (TAU / 6)) % 1) - .5) * 2      # 1 at the panel seams
        p.dark(ss(.85, .97, d) * (y > 1.73) * (1 - brim), .7)
        p.dark((np.hypot(x, z + .006) < .012) * (y > 1.81), .7)
        p.dark(ss(1.735, 1.715, y) * (1 - brim), .8)
        p.dark(ss(-.3, -.7, p.ny) * brim, .55)
        p.dark(line(z - .155, .0015) * brim, .75)
    elif feat == 'scarf':
        p.mul(.78)
        q = p.P / .024; d = np.linalg.norm((q % 1) - .5, axis=1)          # small flower dots (3D lattice)
        p.dark(1 - ss(.2, .3, d), 1.32); p.dark(1 - ss(.06, .11, d), .55)
        p.dark(np.maximum(0, np.sin(np.arctan2(x, z) * 7 + y * 30)) ** 4, .85)
        p.dark(ss(-.2, -.7, p.ny), .7)
    elif feat == 'glasses':
        p.put(ss(.3, .7, vnoise(np.c_[x + y, y, z], .015)) * .35 * (z > .04), 0x6a7a8a)


def paint_uArm(p, slot, feat):
    x, y, z = p.x, p.y, p.z
    if feat == 'stripes': p.dark(ss(.005, .0085, np.abs(z)), .7); return
    p.fabric(); p.dark(ss(-.255, -.29, y), .85); p.dark(line(y + .262, .0008), .85)
    n = vnoise(p.P, .03, 2)
    p.dark(np.maximum(0, np.sin((y + z * .6) * 260 + n * 3)) ** 6 * ss(-.2, -.27, y) * (z > 0), .78)
    p.dark(ss(.0, .04, y), .85)


def paint_fArm(p, slot, feat):
    x, y, z, ax = p.x, p.y, p.z, p.ax
    if feat == 'stripes': p.dark(ss(.004, .0075, np.abs(z)), .7); return
    if feat == 'sleeves': p.dark(.5 + .5 * np.cos(np.arctan2(x, z) * 24), .85); return
    if feat == 'phone':
        scr = (ax < .024) * (np.abs(y + .31) < .044) * (p.nz > .6)
        p.put(scr, 0x3a5878); p.put(scr * ss(-.31, -.27, y) * .5, 0x8aa8c8)
        p.dark(line(y + .272, .0008) * (ax < .008) * (p.nz > .6), 1.8); return
    if feat == 'shop':
        p.mul(.82 + .26 * vnoise(p.P, .025)); p.dark(np.maximum(0, np.sin(x * 120 + y * 40)) ** 8, .85)
        d = np.hypot(x, y + .51); p.dark(line(d - .042, .006) * (np.abs(p.nz) > .6), .55); return
    if slot == 'sleeve':
        p.fabric(.8); n = vnoise(p.P, .03, 4)
        p.dark(np.maximum(0, np.sin((y - z * .5) * 240 + n * 3)) ** 6 * ss(-.08, -.01, y) * (z > 0), .8)
        p.dark(ss(-.2, -.245, y), .9); return
    # skin: wrist crease, mitten fingers, knuckles, palm crease
    hand = y < -.265
    p.dark(line(y + .262, .0012) * (y > -.275), .85)
    for xi in (-.011, 0, .011): p.dark(line(x - xi, .0011, .0012) * ss(-.322, -.334, y) * hand, .6)
    p.dark(line(y + .324, .0016) * (z < -.002) * hand, .8)
    p.dark(line(y + .3 + x * .4, .0013) * (z > .008) * hand * (ax < .02), .78)
    p.dark(ss(-.35, -.37, y) * hand, .88)


def paint_thigh(p, slot, feat):
    x, y, z, ax = p.x, p.y, p.z, p.ax
    if feat == 'stripes': p.dark(ss(.006, .0095, np.abs(z)), .7); return
    p.fabric(1.1); p.grime(.08)
    p.dark(line(z, .0016) * (np.abs(p.nx) > .5), .72); p.dark(line(np.abs(z) - .006, .0007) * (np.abs(p.nx) > .5), 1.15)
    p.dark(line(x, .002) * (z > .02), .9)
    n = vnoise(p.P, .03, 1)
    p.dark(np.maximum(0, np.sin(y * 300 + n * 4)) ** 6 * ss(-.36, -.43, y) * (z < 0), .78)
    p.dark(np.maximum(0, np.sin((y + ax) * 250 + n * 3)) ** 8 * ss(-.05, .0, y) * (z > 0), .85)
    p.dark(ss(-.02, .06, y), .75)


def paint_shin(p, slot, feat):
    x, y, z = p.x, p.y, p.z
    if feat == 'stripes': p.dark(ss(.005, .0085, np.abs(z)), .7); return
    if feat == 'pants': p.fabric(); p.dark(line(y + .405, .0008), .8); p.dark(ss(-.39, -.42, y), .8); p.grime(.15, .05); return
    p.fabric(.9); p.grime(.1)
    n = vnoise(p.P, .025, 6)
    p.dark(np.maximum(0, np.sin(y * 280 + np.arctan2(x, z) * 2 + n * 4)) ** 5 * ss(-.28, -.36, y), .86)
    p.dark(line(z, .0016) * (np.abs(p.nx) > .5), .82)
    p.dark(ss(-.03, .02, y), .8)


def paint_foot(p, slot, feat):
    x, y, z, ax = p.x, p.y, p.z, p.ax
    p.fabric(.6, .02); p.grime(.15, .04)
    col = ((np.hypot(x, z) < .052) & (np.abs(p.ny) < .5) & (y > -.028)).astype(float)   # ankle collar (same material)
    p.dark(ss(.01, .03, y) * col, .7)
    p.c = p.c  # shoe body below
    body = 1 - col
    sole = ss(-.031, -.035, y) * body
    p.mul(1 + .25 * sole); p.dark(line(y + .033, .0012), .5); p.dark(ss(-.4, -.8, p.ny), .45)
    top = ss(.2, .5, p.ny) * (y > -.03) * body
    for k in range(5):
        zk = .02 + k * .021; p.dark(line(z - zk, .0028) * (ax < .019) * top, 1.3)
    for sx in (1, -1): p.dark((1 - ss(.002, .0035, np.hypot(x - sx * .02, (z - .062) / 3.5))) * top, .55)
    p.dark(line(x, .0012) * (z > .01) * (z < .115) * top, .7)
    p.dark(line(z - .118, .0016) * (y > -.033), .7)
    p.dark(line(z + .048, .0016) * (y > -.033) * (y < .02), .75)
    p.dark(line(y - (-.012 + (z - .02) * .08), .0012) * (np.abs(p.nx) > .6) * (z > -.05) * (z < .12), .8)
    p.dark(ss(.03, .016, y) * ss(-.03, -.07, z), .7)


PAINT = {'torso': paint_torso, 'head': paint_head, 'uArm': paint_uArm, 'fArm': paint_fArm, 'thigh': paint_thigh,
         'shin': paint_shin, 'foot': paint_foot}


def parse(name):
    s = name.split('__'); slot = s[0][2:]; feat = None
    for t in s[1:]:
        if t.startswith('f_') or t.startswith('nf_'): feat = t.split('_', 1)[1]
    return slot, feat


# ================================================================ unwrap, bake, paint
UV_SCALE = {'head': 2.7, 'foot': 1.4, 'fArm': 1.25}


def unwrap(ms, margin):
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in ms:   # more texels for the face, the shoes and the hands
        k = UV_SCALE.get(o.name.replace('_lo', ''), 1.0)
        if k != 1.0:
            uv = o.data.uv_layers.active.data; a = np.empty(len(uv) * 2, np.float32); uv.foreach_get('uv', a); uv.foreach_set('uv', a * k)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def aux_bake(ms, mats, size, kind):
    """EMIT-bake per-texel data: 'pos' (object coords /4 + .5), 'nrm' (normal /2 + .5), 'id' (R = material #, G = part #)."""
    img = bpy.data.images.new('aux_' + kind, size, size, alpha=True, float_buffer=True); img.colorspace_settings.name = 'Non-Color'
    added = []
    for mi, m in enumerate(mats):
        nt = m.node_tree; N = nt.nodes; L = nt.links
        olds = [n for n in N if n.type == 'OUTPUT_MATERIAL']
        t = N.new('ShaderNodeTexImage'); t.image = img; N.active = t
        em = N.new('ShaderNodeEmission'); out = N.new('ShaderNodeOutputMaterial')
        new = [t, em, out]
        if kind == 'id':
            oi = N.new('ShaderNodeObjectInfo'); dv = N.new('ShaderNodeMath'); dv.operation = 'DIVIDE'; dv.inputs[1].default_value = 255
            cc = N.new('ShaderNodeCombineColor'); cc.inputs['Red'].default_value = (mi + 1) / 255
            L.new(oi.outputs['Object Index'], dv.inputs[0]); L.new(dv.outputs[0], cc.inputs['Green']); L.new(cc.outputs['Color'], em.inputs['Color'])
            new += [oi, dv, cc]
        else:
            src = N.new('ShaderNodeTexCoord' if kind == 'pos' else 'ShaderNodeNewGeometry')
            vm = N.new('ShaderNodeVectorMath'); vm.operation = 'MULTIPLY_ADD'
            k = .25 if kind == 'pos' else .5
            vm.inputs[1].default_value = (k, k, k); vm.inputs[2].default_value = (.5, .5, .5)
            L.new(src.outputs['Object' if kind == 'pos' else 'Normal'], vm.inputs[0]); L.new(vm.outputs['Vector'], em.inputs['Color'])
            new += [src, vm]
        L.new(em.outputs['Emission'], out.inputs['Surface'])
        for n in olds: n.is_active_output = False
        out.is_active_output = True
        added.append((m, new, olds))
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 1
    bpy.ops.object.select_all(action='DESELECT')
    for o in ms: o.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.bake(type='EMIT', use_clear=True, margin=4)
    a = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(a)
    for m, new, olds in added:
        for n in new: m.node_tree.nodes.remove(n)
        for n in olds: n.is_active_output = True
        m.node_tree.nodes.active = m.node_tree.nodes['_bake']
    bpy.data.images.remove(img)
    sc.render.engine = 'BLENDER_WORKBENCH'
    return a.reshape(size, size, 4)


def atlas(ms, size, name, margin, smooth):
    """Unwrap ms into one atlas, bake base colours, paint everything, store as one RGBA PNG on all their materials.
    smooth(part) = the angle above which edges stay hard (> the tube facet angles, < the 90° of boxes)."""
    for k, o in enumerate(ms): lp.smooth(o, smooth(o.name.replace('_lo', ''))); o.pass_index = k + 1
    unwrap(ms, margin)
    img = lp.bake(ms, size=size, name=name + '_base', ao=0, smooth_angle=None, unwrap=False, jpeg=False, samples=1)
    mats = []
    for o in ms:
        for m in o.data.materials:
            if m and m not in mats: mats.append(m)
    base = np.empty(size * size * 4, np.float32); img.pixels.foreach_get(base); base = base.reshape(size, size, 4)
    pos = (aux_bake(ms, mats, size, 'pos')[..., :3] - .5) * 4
    nrm = (aux_bake(ms, mats, size, 'nrm')[..., :3] - .5) * 2
    ids = np.rint(aux_bake(ms, mats, size, 'id')[..., :2] * 255).astype(int)
    P = np.stack([pos[..., 0], pos[..., 2], -pos[..., 1]], -1)       # Blender → game axes
    Nn = np.stack([nrm[..., 0], nrm[..., 2], -nrm[..., 1]], -1)
    out = base.copy(); out[..., 3] = 1
    for k, o in enumerate(ms):
        part = o.name.replace('_lo', '')
        for mi, m in enumerate(mats):
            sel = (ids[..., 0] == mi + 1) & (ids[..., 1] == k + 1)
            if not sel.any(): continue
            Pk = P[sel] + (np.array(JOINT[part]) if part in ABS else 0)
            px = Px(Pk, Nn[sel], base[sel][:, :3])
            slot, feat = parse(m.name)
            PAINT[part](px, slot, feat)
            px.mul(.86 + .14 * np.clip(px.ny * .5 + .5, 0, 1) ** .7)     # painted top light
            out[sel, :3] = np.clip(px.c, 0, 1); out[sel, 3] = px.a
    fin = bpy.data.images.new(name, size, size, alpha=True); fin.colorspace_settings.name = 'Non-Color'
    fin.pixels.foreach_set(out.ravel()); fin.file_format = 'PNG'
    fin.filepath_raw = os.path.join(tempfile.gettempdir(), name + '.png'); fin.save(); fin.pack()
    for m in mats: m.node_tree.nodes['_bake'].image = fin
    bpy.data.images.remove(img)
    return fin, out


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    pdir = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    lp.reset()
    near = [build_part(p) for p in PARTS]
    far = [build_part(p, lo=True) for p in PARTS]
    for grp in (near, far):
        tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in grp}
        t = list(tris.values())
        print('people tris per part', tris, 'whole character', t[0] + t[1] + 2 * sum(t[2:]))
    _, a_near = atlas(near, 256, 'people_tex', .008, lambda part: 65)
    _, a_far = atlas(far, 128, 'people_lo_tex', .012, lambda part: 65 if part in ABS else 95)  # 4-sided far limbs
    lp.export(os.path.join(lp.MODELS, 'people.glb'), near + far)
    if pdir:
        os.makedirs(pdir, exist_ok=True)
        for nm, a in (('atlas.png', a_near), ('atlas_lo.png', a_far)):
            im = bpy.data.images.new('dump', a.shape[1], a.shape[0], alpha=True); im.colorspace_settings.name = 'Non-Color'
            v = a.copy(); v[..., :3] *= (.55 + .45 * v[..., 3:4]); v[..., 3] = 1   # untinted texels shown darker-edged
            im.pixels.foreach_set(v.ravel()); im.filepath_raw = os.path.join(pdir, nm); im.file_format = 'PNG'; im.save()
            bpy.data.images.remove(im)
        lp.preview(near, os.path.join(pdir, 'raw_front.png'), yaw=20, pitch=8, size=1000)
        lp.preview(near, os.path.join(pdir, 'raw_back.png'), yaw=200, pitch=8, size=1000)
        for gi, grp in enumerate((LOOKS[:5], LOOKS[5:])):
            objs = [o for k, (tag, look, pose) in enumerate(grp) for o in person(near, look, pose, (k - (len(grp) - 1) / 2) * .75, tag)]
            render(objs, os.path.join(pdir, 'people%d.png' % gi), yaw=15, pitch=6, size=1100)
            render(objs, os.path.join(pdir, 'people%d_back.png' % gi), yaw=165, pitch=10, size=1100)
            hide(objs)
        objs = [o for k, (tag, look, pose) in enumerate(LOOKS) for o in person(near, look, IDLE, (k - 4) * .3, 'H' + tag)]
        render([o for o in objs if '_head' in o.name], os.path.join(pdir, 'heads.png'), yaw=12, pitch=3, size=1400)
        hide(objs)
        objs = [o for k, (tag, look, pose) in enumerate(LOOKS[:5]) for o in person(far, look, pose, (k - 2) * .75, 'L' + tag)]
        render(objs, os.path.join(pdir, 'people_lo.png'), yaw=15, pitch=6, size=900)


# ================================================================ tinted preview (what the game shows)
def _visible(name, mask):
    slot, feat = parse(name); neg = '__nf_' in name
    return not feat or ((feat in mask) != neg)


def _slot_col(slot, L, mask):
    tp, sk = L['top'], L['skin']
    return {'fix': 0xffffff, 'skin': sk, 'top': tp, 'bot': L['bot'], 'hair': L['hair'], 'shoe': L['shoe'], 'acc': L['acc'],
            'sleeve': tp if 'sleeves' in mask else sk, 'shin': L['bot'] if 'pants' in mask else sk,
            'topDk': ((int(((tp >> 16) & 255) * .62) << 16) | (int(((tp >> 8) & 255) * .62) << 8) | int((tp & 255) * .62))}.get(slot, 0xffffff)


_TM = {}
def _tinted(src, col):
    key = (src.name, col)
    if key in _TM: return _TM[key]
    m = bpy.data.materials.new('pv_' + src.name); m.use_nodes = True; nt = m.node_tree; N = nt.nodes; L = nt.links
    bsdf = next(n for n in N if n.type == 'BSDF_PRINCIPLED'); bsdf.inputs['Roughness'].default_value = 1
    t = N.new('ShaderNodeTexImage'); t.image = src.node_tree.nodes['_bake'].image
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    L.new(t.outputs['Alpha'], mx.inputs[0]); mx.inputs[6].default_value = (1, 1, 1, 1); mx.inputs[7].default_value = (*lp._hex(col), 1)
    mu = N.new('ShaderNodeMix'); mu.data_type = 'RGBA'; mu.blend_type = 'MULTIPLY'; mu.inputs[0].default_value = 1
    L.new(t.outputs['Color'], mu.inputs[6]); L.new(mx.outputs[2], mu.inputs[7]); L.new(mu.outputs[2], bsdf.inputs['Base Color'])
    _TM[key] = m
    return m


def person(src, look, pose, dx, tag):
    """Assemble a posed, dressed copy of the baked parts (src = near or far set) for the preview."""
    import bmesh
    by = {o.name.replace('_lo', ''): o for o in src}
    objs = {}; wpos = {}
    for part in PARTS:
        for side in ((1, -1) if part not in ABS else (1,)):
            mask = set(look['mask']); L = dict(look)
            if part == 'fArm':
                ex = look.get('armL') if side == 1 else look.get('armR')
                if ex: mask.add(ex)
                if ex == 'shop': L['acc'] = look.get('shopCol', 0xf0f0f0)
            o = by[part].copy(); o.data = by[part].data.copy(); o.name = '%s_%s%d' % (tag, part, side)
            bpy.context.scene.collection.objects.link(o)
            j = JOINT[part]; o.location = lp.B(j[0] * side, j[1], j[2])
            bm = bmesh.new(); bm.from_mesh(o.data); ms = o.data.materials
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if not _visible(ms[f.material_index].name, mask)], context='FACES')
            bm.to_mesh(o.data); bm.free()
            for i, m in enumerate(o.data.materials): o.data.materials[i] = _tinted(m, _slot_col(parse(m.name)[0], L, mask))
            objs[(part, side)] = o; wpos[(part, side)] = o.location.copy()
    def link(c, p):
        objs[c].parent = objs[p]; objs[c].location = wpos[c] - wpos[p]
    for sd in (1, -1):
        link(('uArm', sd), ('torso', 1)); link(('fArm', sd), ('uArm', sd)); link(('shin', sd), ('thigh', sd)); link(('foot', sd), ('shin', sd))
    link(('head', 1), ('torso', 1))
    for (part, sd), (rx, rz) in pose.items():
        o = objs[(part, sd)]; o.rotation_euler.x = rx; o.rotation_euler.y = -rz * sd
    for k in (('torso', 1), ('thigh', 1), ('thigh', -1)): objs[k].location.x += dx
    bpy.context.view_layer.update()
    return list(objs.values())


def hide(objs):
    for o in objs: o.hide_render = True


def render(objs, path, yaw=20, pitch=8, size=1000):
    from mathutils import Vector
    sc = bpy.context.scene; bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo_ = Vector([min(p[i] for p in pts) for i in range(3)]); hi_ = Vector([max(p[i] for p in pts) for i in range(3)])
    c = (lo_ + hi_) / 2; rad = (hi_ - lo_).length / 2
    cd = bpy.data.cameras.new('pv'); cam = bpy.data.objects.new('pv', cd); sc.collection.objects.link(cam)
    yw, pt = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(yw) * math.cos(pt), -math.cos(yw) * math.cos(pt), math.sin(pt)))
    cd.lens = 50; cam.location = c + d * rad * 3.0; cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler(); sc.camera = cam
    sun = bpy.data.objects.get('pv_sun')
    if not sun:
        ld = bpy.data.lights.new('pv_sun', 'SUN'); ld.energy = 2.2; sun = bpy.data.objects.new('pv_sun', ld)
        sc.collection.objects.link(sun); sun.rotation_euler = (math.radians(40), 0, math.radians(30))
    w = sc.world or bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (.35, .37, .4, 1)
    sc.render.engine = 'CYCLES'; sc.cycles.samples = 16; sc.cycles.use_denoising = False
    sc.view_settings.view_transform = 'Standard'
    sc.render.resolution_x = sc.render.resolution_y = size; sc.render.filepath = path; sc.render.image_settings.file_format = 'PNG'
    keep = set(objs) | {sun, cam}
    hid = [o for o in sc.objects if o not in keep and not o.hide_render]
    for o in hid: o.hide_render = True
    bpy.ops.render.render(write_still=True)
    for o in hid: o.hide_render = False
    bpy.data.objects.remove(cam); print('render', path)


WALK = {('thigh', 1): (-.38, 0), ('shin', 1): (.12, 0), ('foot', 1): (.2, 0), ('thigh', -1): (.32, 0), ('shin', -1): (.55, 0),
        ('foot', -1): (-.4, 0), ('uArm', 1): (.3, .09), ('fArm', 1): (-.25, 0), ('uArm', -1): (-.3, .09), ('fArm', -1): (-.5, 0)}
IDLE = {('uArm', 1): (0, .09), ('uArm', -1): (0, .09), ('fArm', 1): (-.16, 0), ('fArm', -1): (-.16, 0)}
PHONE = dict(WALK); PHONE[('uArm', 1)] = (-.55, .32); PHONE[('fArm', 1)] = (-2.35, 0)
LOOKS = [
    ('hero', dict(skin=0xe8c3a0, hair=0x1c1410, top=0xff7a1a, bot=0x2b3a5c, shoe=0xf4f4f2, acc=0xf4f4f2,
                  mask={'hair', 'hairS', 'sleeves', 'pants', 'jacket', 'stripes'}), IDLE),
    ('man', dict(skin=0xd9a77f, hair=0x2a1c13, top=0x2c4f86, bot=0x33507a, shoe=0xf0f0ee, acc=0x8a6a4a,
                 mask={'hair', 'hairS', 'pants', 'beard', 'bag'}), WALK),
    ('track', dict(skin=0xf0d2b6, hair=0x3a281b, top=0x123063, bot=0x123063, shoe=0xf0f0ee, acc=0xf2f2f2,
                   mask={'hair', 'hairS', 'pants', 'sleeves', 'jacket', 'stripes', 'cap', 'hood'}), WALK),
    ('office', dict(skin=0xe8c3a0, hair=0x4f3624, top=0x262a33, bot=0x232529, shoe=0x2a1d14, acc=0x2a1d14,
                    mask={'hair', 'hairS', 'pants', 'sleeves', 'jacket', 'glasses', 'bag'}), IDLE),
    ('dress', dict(skin=0xf0d2b6, hair=0x8c3324, top=0x7a1f3a, bot=0x7a1f3a, shoe=0x7a1f2a, acc=0xc8b090,
                   mask={'hair', 'hairL', 'skirt', 'bust', 'bag'}), WALK),
    ('woman', dict(skin=0xd9a77f, hair=0x1c1410, top=0xc95a7c, bot=0x1e283e, shoe=0x222222, acc=0x111111,
                   mask={'hair', 'bun', 'pants', 'bust', 'sleeves'}, armL='phone'), PHONE),
    ('granny', dict(skin=0xe8c3a0, hair=0xb4b2ae, top=0x4a3b30, bot=0x232529, shoe=0x2a1d14, acc=0x8a1f2a,
                    mask={'scarf', 'coat', 'sleeves', 'pants', 'bust'}, armR='shop', shopCol=0xf2f2f0), WALK),
    ('student', dict(skin=0xf0d2b6, hair=0x6b4a2e, top=0x3d7a46, bot=0x2a3a58, shoe=0x222222, acc=0xd8b13a,
                     mask={'hair', 'hairL', 'pants', 'bust', 'pack', 'sleeves', 'hood'}), WALK),
    ('oldman', dict(skin=0xc69072, hair=0x8e8c88, top=0x3b2f28, bot=0x2c2e34, shoe=0x2a1d14, acc=0x3a3530,
                    mask={'hair', 'pants', 'sleeves', 'jacket', 'cap', 'coat', 'glasses'}, armR='shop', shopCol=0x2a6a2a), IDLE),
]


main()
