"""Builds models/people.glb: the 7 rigid body parts shared by every pedestrian and the player (js/people.js).
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python tools/blender/people.py [-- --preview DIR]

PS2-era low poly: 6-8 sided limbs and torso, octagonal head with a nose ridge, mitten hands, block shoes, flat colours.
One node per part, named like js/people.js PPL_PARTS: torso, head, uArm, fArm, thigh, shin, foot, plus a far LOD of each
(<part>_lo: fewer sides, no face/lace/thumb details) for pedestrians beyond ~50 m. Each node's origin is
its joint (rest pose, left side = +x), so the vertices are in the part's local frame exactly as ppl_pose() expects:
  torso: feet (0, 0, 0)       head: neck (0, 1.535, 0)        uArm: shoulder (0.2, 1.44, 0)   fArm: elbow, 0.29 below
  thigh: hip (0.095, 0.92, 0)  shin: knee, 0.46 below the hip  foot: ankle, 0.44 below the knee
Arm and leg nodes are used for both sides, so keep them symmetric in x.

Colour comes from the material NAME, decoded by people.js into the per-vertex aSF attribute:
  s_<slot>[__f_<feature>|__nf_<feature>][__c_<rrggbb>]
slot = ppl_S key (fix skin top bot hair shoe acc sleeve shin topDk lip hairDk): the per-person palette colour;
__f_x: only drawn when the person has feature x (ppl_F key); __nf_x: hidden when they have it;
__c_rrggbb: tint multiplied with the slot colour (for 'fix' it is the colour itself).
"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lp

TAU = 2 * math.pi
FEATS = ('hairS', 'hairL', 'bun', 'cap', 'scarf', 'skirt', 'pack', 'bag', 'sleeves', 'pants', 'coat', 'beard', 'jacket', 'hair',
         'stripes', 'bust', 'glasses', 'shop', 'phone', 'hood')  # = ppl_F bit order (1 << index)
SLOTS = ('fix', 'skin', 'top', 'bot', 'hair', 'shoe', 'acc', 'sleeve', 'shin', 'topDk', 'lip', 'hairDk')  # = ppl_S

# skeleton (must match PPL_* in js/people.js)
HIP, THIGH, SHIN, UARM, SHO_Y, SHO_X, NECK = .95, .46, .44, .29, 1.44, .2, 1.535
JOINT = {'torso': (0, 0, 0), 'head': (0, NECK, 0), 'uArm': (SHO_X, SHO_Y, 0), 'fArm': (SHO_X, SHO_Y - UARM, 0),
         'thigh': (.095, HIP - .03, 0), 'shin': (.095, HIP - .03 - THIGH, 0), 'foot': (.095, HIP - .03 - THIGH - SHIN, 0)}
PARTS = ('torso', 'head', 'uArm', 'fArm', 'thigh', 'shin', 'foot')


LO_N = {12: 8, 10: 6, 8: 6}   # far-LOD side counts (<part>_lo nodes)


def C(slot, feat=None, tint=0xffffff, neg=False):
    assert slot in SLOTS and (feat is None or feat in FEATS)
    return (slot, feat, tint, neg)


def _mul(a, b):
    return sum(min(255, round(((a >> s) & 255) * ((b >> s) & 255) / 255)) << s for s in (16, 8, 0))


def _scale(a, r, g, b):
    return (min(255, round(((a >> 16) & 255) * r)) << 16) | (min(255, round(((a >> 8) & 255) * g)) << 8) | min(255, round((a & 255) * b))


def _newell(p):
    n = [0.0, 0.0, 0.0]
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return n


class Bld:
    """Collects one part's faces. look=None → export (slot materials); look=dict → preview (resolved colours, features
    filtered). off = the joint position: part code below draws in joint-local coordinates."""

    def __init__(self, look=None, off=(0, 0, 0), lo=False):
        self.p = lp.Part(); self.look = look; self.off = off; self.lo = lo

    def col(self, c):
        slot, feat, tint, neg = c
        L = self.look
        if L is None:
            name = 's_' + slot
            if feat: name += ('__nf_' if neg else '__f_') + feat
            if tint != 0xffffff: name += '__c_%06x' % tint
            return self.p.add_material(tint, name)
        m = L['mask']
        if feat and ((feat in m) == neg): return None
        sk, tp, bt, hr = L['skin'], L['top'], L['bot'], L['hair']
        rgb = {'fix': 0xffffff, 'skin': sk, 'top': tp, 'bot': bt, 'hair': hr, 'shoe': L['shoe'], 'acc': L['acc'],
               'sleeve': tp if 'sleeves' in m else sk, 'shin': bt if 'pants' in m else sk, 'topDk': _scale(tp, .62, .62, .62),
               'lip': _scale(sk, .8, .52, .52), 'hairDk': _scale(hr, .72, .72, .72)}[slot]
        return _mul(rgb, tint)

    def _o(self, p): return (p[0] + self.off[0], p[1] + self.off[1], p[2] + self.off[2])

    def face(self, pts, c, out=None):
        """Polygon in local coords. out: a direction the face should point along (winding is flipped to match)."""
        k = self.col(c)
        if k is None: return
        if out is not None:
            n = _newell(pts)
            if n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0: pts = pts[::-1]
        self.p.face([self._o(q) for q in pts], k)

    def box(self, w, h, d, at, c, rx=0.0, ry=0.0, rz=0.0, taper=1.0):
        k = self.col(c)
        if k is None: return
        self.p.box(w, h, d, at=self._o(at), rx=rx, ry=ry, rz=rz, col=k, taper=taper)

    def lathe(self, prof, n, c, at=(0, 0, 0), s=(1, 1, 1), rx=0.0, ry=0.0, rz=0.0, a0=0.0, ph=None, cols=None):
        """Revolve prof [(r, y[, dz]), ...] listed bottom → top (that keeps normals outward). a0 = angle of the first
        vertex (0 = +x, pi/2 = back/-z, 3pi/2 = front/+z); ph = (start, end) for a partial, open surface."""
        if self.lo and ph is None and n in LO_N:   # far LOD: fewer sides, same symmetry (a0 kept in half-steps)
            m = LO_N[n]; a0 = a0 / (math.pi / n) * (math.pi / m); n = m
        X = lp._xf(self._o(at), ry, rx, rz, s)
        if ph is None: ang = [a0 + i * TAU / n for i in range(n)]; idx = [(i, (i + 1) % n) for i in range(n)]
        else: ang = [ph[0] + i * (ph[1] - ph[0]) / n for i in range(n + 1)]; idx = [(i, i + 1) for i in range(n)]
        R = [[X((q[0] * math.cos(a), q[1], -q[0] * math.sin(a) + (q[2] if len(q) > 2 else 0))) for a in ang] for q in prof]
        for k in range(len(prof) - 1):
            cc = self.col(cols[k] if cols else c)
            if cc is None: continue
            for i, j in idx:
                if prof[k + 1][0] < 1e-6: self.p.face([R[k][i], R[k][j], R[k + 1][i]], cc)
                elif prof[k][0] < 1e-6: self.p.face([R[k][i], R[k + 1][j], R[k + 1][i]], cc)
                else: self.p.face([R[k][i], R[k][j], R[k + 1][j], R[k + 1][i]], cc)

    def ell(self, r, c, at=(0, 0, 0), s=(1, 1, 1), n=6, rings=3, th=(0, math.pi), **kw):
        """Faceted ellipsoid (radius r, scaled by s); th = polar range from the top pole (0) down (pi = full)."""
        if self.lo and rings > 2: rings -= 1
        prof = [(r * math.sin(t), r * math.cos(t)) for t in (th[1] - (th[1] - th[0]) * k / rings for k in range(rings + 1))]
        self.lathe(prof, n, c, at, s, **kw)

    def strip(self, prof, n, s, a0, fi, x0, x1, ys, c, lift=.004):
        """Flat strip lying on face fi of a lathe(prof, n, s, a0) solid, from u = x0 to x1 metres across the face
        (measured from its middle), over heights ys (zip lines, side stripes, coat openings). Skipped in the far LOD when
        that LOD has fewer sides."""
        if self.lo and n in LO_N: return
        def at(y):
            for k in range(len(prof) - 1):
                (r0, y0), (r1, y1) = prof[k][:2], prof[k + 1][:2]
                if y0 <= y <= y1 and y1 > y0: return r0 + (r1 - r0) * (y - y0) / (y1 - y0)
            raise ValueError(y)
        a, b = a0 + fi * TAU / n, a0 + (fi + 1) * TAU / n
        rows = []
        for y in ys:
            r = at(y)
            P = (r * math.cos(a) * s[0], -r * math.sin(a) * s[2]); Q = (r * math.cos(b) * s[0], -r * math.sin(b) * s[2])
            ex, ez = Q[0] - P[0], Q[1] - P[1]; L = math.hypot(ex, ez); mx, mz = (P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2
            nx, nz = -ez / L, ex / L
            if nx * mx + nz * mz < 0: nx, nz = -nx, -nz
            rows.append([(mx + ex / L * u + nx * lift, y, mz + ez / L * u + nz * lift) for u in (x0, x1)])
        for k in range(len(rows) - 1):
            A, B2 = rows[k], rows[k + 1]
            mid = ((A[0][0] + A[1][0]) / 2, 0, (A[0][2] + A[1][2]) / 2)
            self.face([A[0], A[1], B2[1], B2[0]], c, out=mid)

    def extrude_x(self, prof, hw, c, at=(0, 0, 0)):
        """Convex side profile [(z, y), ...] extruded across x (±hw) → block shoes."""
        cz = sum(p[0] for p in prof) / len(prof); cy = sum(p[1] for p in prof) / len(prof)
        P = lambda x, p: (at[0] + x, at[1] + p[1], at[2] + p[0])
        self.face([P(hw, p) for p in prof], c, out=(1, 0, 0)); self.face([P(-hw, p) for p in prof], c, out=(-1, 0, 0))
        for i in range(len(prof)):
            p, q = prof[i], prof[(i + 1) % len(prof)]
            self.face([P(-hw, p), P(hw, p), P(hw, q), P(-hw, q)], c, out=(0, (p[1] + q[1]) / 2 - cy, (p[0] + q[0]) / 2 - cz))


# ---------------------------------------------------------------- torso (feet origin)
T_N, T_A0, T_S = 8, math.pi / 8, (1, 1, .62)   # octagon with flat faces front/back/sides: face 5 = front, 1 = back, 7 = +x, 3 = -x
T_PROF = [(0, .82), (.10, .815), (.155, .87), (.168, .96), (.163, 1.03), (.173, 1.04), (.173, 1.072), (.16, 1.082), (.152, 1.17),
          (.166, 1.25), (.192, 1.35), (.205, 1.42), (.18, 1.48), (.095, 1.525), (0, 1.54)]
COAT = [(.25, .5), (.23, .72), (.2, .92), (.174, 1.075)]
SKIRT = [(.262, .64), (.228, .8), (.192, .95), (.174, 1.075)]


def torso(b):
    belt = C('fix', tint=0x2a2420)
    b.lathe(T_PROF, T_N, None, s=T_S, a0=T_A0, cols=[C('bot')] * 4 + [belt] * 3 + [C('top')] * 7)
    if not b.lo: b.box(.045, .03, .01, (0, 1.056, .104), C('fix', tint=0x9a8a60))                                     # buckle
    # jacket: zip + collar + hem band
    b.strip(T_PROF, T_N, T_S, T_A0, 5, -.007, .007, [1.082, 1.17, 1.25, 1.35, 1.42, 1.47], C('topDk', 'jacket'))
    b.lathe([(.1, 1.48), (.1, 1.53), (.082, 1.575)], 8, C('topDk', 'jacket'), at=(0, 0, .004), s=(1, 1, .95), a0=T_A0)
    b.lathe([(.164, 1.082), (.158, 1.13)], T_N, C('topDk', 'jacket'), s=(1.03, 1, .66), a0=T_A0)
    # hood bunched on the back
    b.ell(.11, C('top', 'hood'), at=(0, 1.475, -.105), s=(1.1, .7, .9), n=6, rings=2, th=(0, .6 * math.pi), rx=-1.1)
    # tracksuit side stripes
    for fi in (7, 3): b.strip(T_PROF, T_N, T_S, T_A0, fi, -.016, .016, [1.082, 1.17, 1.25, 1.35, 1.42], C('acc', 'stripes'))
    # bust
    b.ell(.07, C('top', 'bust'), at=(0, 1.325, .072), s=(1.7, .8, .55), n=8, rings=3, a0=math.pi / 8)
    # skirt / dress, long coat
    b.lathe(SKIRT, T_N, C('bot', 'skirt'), s=(1, 1, .78), a0=T_A0)
    b.lathe(COAT, T_N, C('top', 'coat'), s=(1, 1, .8), a0=T_A0)
    b.strip(COAT, T_N, (1, 1, .8), T_A0, 5, -.007, .007, [.5, .72, .92, 1.07], C('topDk', 'coat'))
    # backpack: body, rounded top, front pocket, straps over the chest
    b.box(.27, .32, .12, (0, 1.27, -.17), C('acc', 'pack'))
    b.ell(.135, C('acc', 'pack'), at=(0, 1.43, -.17), s=(1, .45, .45), n=6, rings=2, th=(0, .5 * math.pi), a0=math.pi / 6)
    b.box(.2, .12, .03, (0, 1.18, -.243), C('acc', 'pack', 0xbbbbbb))
    for x in (-.085, .085): b.box(.035, .32, .014, (x, 1.33, .112), C('fix', 'pack', 0x222222), rx=-.12)
    # shoulder bag on the left hip, strap across the chest and back
    b.box(.2, .16, .07, (.215, .99, .02), C('acc', 'bag'), rz=.05)
    b.box(.2, .03, .072, (.215, 1.06, .02), C('acc', 'bag', 0xb0b0b0), rz=.05)                             # flap
    b.box(.03, .68, .012, (.02, 1.24, .114), C('fix', 'bag', 0x2a2420), rx=-.08, rz=.6)
    b.box(.03, .68, .012, (.02, 1.24, -.114), C('fix', 'bag', 0x2a2420), rx=.08, rz=.6)


# ---------------------------------------------------------------- head (drawn in absolute heights, origin = neck)
H_N, H_S = 8, (.95, 1, 1.05)    # a0 = 0: a vertex ridge runs down the middle of the face (nose line)
H_PROF = [(0, 1.555, .03), (.05, 1.56, .03), (.072, 1.6, .015), (.088, 1.64, .005), (.098, 1.69, 0), (.098, 1.735, -.008),
          (.085, 1.775, -.012), (.05, 1.80, -.012), (0, 1.808, -.012)]


def head_face(x, y, lift=0.0):
    """Point on the right-front facet of the head (x >= 0) at height y → (z, yaw of the facet normal)."""
    for k in range(len(H_PROF) - 1):
        a, c = H_PROF[k], H_PROF[k + 1]
        if a[1] <= y <= c[1]:
            t = (y - a[1]) / (c[1] - a[1]); r = a[0] + (c[0] - a[0]) * t; dz = a[2] + (c[2] - a[2]) * t; break
    z0 = r * H_S[2]; vx, vz = r * .7071 * H_S[0], r * .7071 * H_S[2]
    ex, ez = vx, vz - z0; L = math.hypot(ex, ez); nx, nz = -ez / L, ex / L
    return z0 + x / vx * (vz - z0) + dz + nz * lift, math.atan2(nx, nz)


def head(b):
    sk = C('skin')
    b.lathe([(.055, 1.47), (.05, 1.6)], 6, sk, at=(0, 0, -.006))                                           # neck
    b.lathe(H_PROF, H_N, sk, s=H_S)
    # face on the two front facets: eyes, irises, brows, mouth; nose wedge on the ridge (near LOD only)
    zr = .09 * H_S[2] + .004
    if not b.lo: face_details(b, zr)
    # hair: cap + nape for any hair, sideburns
    hair_etc(b, zr)


def face_details(b, zr):
    for sx in (1, -1):
        z, ry = head_face(.034, 1.69, .002); b.box(.03, .017, .004, (sx * .034, 1.69, z), C('fix', tint=0xf3f1ea), ry=sx * ry)
        z, ry = head_face(.032, 1.689, .004); b.box(.012, .015, .004, (sx * .032, 1.689, z), C('fix', tint=0x2e2014), ry=sx * ry)
        z, ry = head_face(.036, 1.713, .004); b.box(.038, .01, .008, (sx * .036, 1.713, z), C('hairDk'), ry=sx * ry, rz=-sx * .12)
        z, ry = head_face(.011, 1.617, .002); b.box(.022, .011, .006, (sx * .011, 1.617, z), C('lip'), ry=sx * ry)
        b.box(.014, .046, .03, (sx * .094, 1.672, -.006), C('skin', tint=0xeedcd4))                        # ears
    top, bl, br, tip = (0, 1.682, zr - .006), (-.017, 1.636, zr - .004), (.017, 1.636, zr - .004), (0, 1.638, zr + .026)
    nose = C('skin', tint=0xf2e2dc); cen = (0, 1.65, zr - .02)
    for f in ([top, bl, tip], [top, tip, br], [bl, br, tip]):
        b.face(f, nose, out=tuple(sum(p[i] for p in f) / 3 - cen[i] for i in range(3)))


def hair_etc(b, zr):
    hr = C('hair', 'hair')
    b.lathe([(.104, -.03, -.004), (.107, .017, -.01), (.094, .06, -.014), (.056, .088, -.014), (0, .10, -.014)], H_N, hr,
            at=(0, 1.72, 0), s=H_S, rx=-.18)
    b.lathe([(.08, 1.595, -.002), (.097, 1.645, -.004), (.104, 1.70, -.006)], 4, hr, s=H_S, ph=(0, math.pi))
    for sx in (1, -1): b.box(.012, .05, .034, (sx * .095, 1.705, .014), hr)
    # short hair: chunky fringe
    b.box(.15, .03, .04, (0, 1.762, .083), C('hair', 'hairS'), rx=-.55, taper=.85)
    # long hair: back curtain, side curtains, top volume
    hl = C('hair', 'hairL')
    b.lathe([(.122, 1.44, -.014), (.126, 1.52, -.014), (.12, 1.62, -.014), (.113, 1.73, -.014)], 4, hl, s=(1, 1, 1.05), ph=(0, math.pi))
    for sx in (1, -1): b.box(.03, .2, .07, (sx * .106, 1.59, .008), hl, rz=sx * .05)
    b.ell(.11, hl, at=(0, 1.70, -.006), s=(1, 1.12, 1.1), n=8, rings=2, th=(0, .42 * math.pi), rx=-.12)
    b.ell(.048, C('hair', 'bun'), at=(0, 1.765, -.122), n=6, rings=3)
    # beard + moustache
    b.lathe([(.058, 1.552, .034), (.079, 1.6, .018), (.093, 1.646, .006)], 4, C('hair', 'beard'), s=(.97, 1, 1.08), ph=(math.pi, TAU))
    for sx in ((1, -1) if not b.lo else ()):
        z, ry = head_face(.014, 1.63, .004); b.box(.028, .012, .01, (sx * .014, 1.63, z), C('hair', 'beard'), ry=sx * ry)
    # flat cap: dome + brim
    b.ell(.122, C('acc', 'cap'), at=(0, 1.712, -.006), s=(1, .92, 1.06), n=8, rings=3, th=(0, .5 * math.pi))
    b.lathe([(0, -.006), (.078, -.006), (.078, .006), (0, .006)], 6, C('acc', 'cap', 0xdddddd), at=(0, 1.718, .112), s=(1, 1, 1.2), rx=-.12)
    # headscarf (babushka): shell, drape over the nape, knot under the chin
    b.ell(.126, C('acc', 'scarf'), at=(0, 1.685, -.02), s=(1.03, 1.12, 1.1), n=8, rings=3, th=(0, .56 * math.pi), rx=-.42)
    b.lathe([(.165, 1.47), (.135, 1.56), (.118, 1.63)], 4, C('acc', 'scarf'), at=(0, 0, -.015), ph=(0, math.pi))
    b.box(.06, .045, .04, (0, 1.572, .078), C('acc', 'scarf', 0xcccccc), rz=.6)
    # dark glasses
    g = C('fix', 'glasses', 0x1a1a1a)
    if b.lo: b.box(.11, .024, .02, (0, 1.69, .092), g); return
    for sx in (1, -1):
        z, ry = head_face(.035, 1.69, .009); b.box(.04, .026, .006, (sx * .035, 1.69, z), g, ry=sx * ry)
        b.box(.005, .006, .1, (sx * .092, 1.694, .045), g)
    b.box(.02, .006, .006, (0, 1.695, zr + .004), g)


# ---------------------------------------------------------------- limbs (joint-local)
# limb tubes: 6 sides with a flat face on each side (a0 = 30°), so the tracksuit stripes can lie flat on them;
# face 5 = +x, face 2 = -x (the arm/leg nodes serve both sides)
L_A0 = math.pi / 6


def limb(b, prof, slot, ys, w):
    b.lathe(prof, 6, C(slot), a0=L_A0)
    for fi in (5, 2): b.strip(prof, 6, (1, 1, 1), L_A0, fi, -w, w, ys, C('acc', 'stripes'), lift=.002)


def u_arm(b):
    b.ell(.062, C('top'), at=(-.004, -.015, 0), n=6, rings=3)
    limb(b, [(.047, -.29), (.058, -.12), (.062, .02)], 'top', [-.27, -.12, 0], .008)
    b.ell(.046, C('top'), at=(0, -.29, 0), n=6, rings=2)


def f_arm(b):
    limb(b, [(.034, -.245), (.045, -.07), (.047, 0)], 'sleeve', [-.21, -.07, -.005], .007)
    b.lathe([(.037, -.25), (.042, -.245), (.042, -.222), (.039, -.214)], 6, C('topDk', 'sleeves'), a0=L_A0)   # cuff
    sk = C('skin')
    b.lathe([(.03, -.27), (.034, -.235)], 6, sk, a0=L_A0)                                               # wrist
    b.box(.058, .11, .032, (0, -.315, .004), sk, taper=.82)                                              # mitten hand
    if not b.lo: b.box(.018, .05, .02, (0, -.29, .027), sk, rx=.55)                                      # thumb (forward)
    b.box(.06, .11, .012, (0, -.31, .032), C('fix', 'phone', 0x111418), rx=-.1)                        # phone
    if not b.lo: b.box(.048, .086, .003, (0, -.31, .039), C('fix', 'phone', 0x4a6e8a), rx=-.1)         # its screen
    b.box(.2, .24, .07, (0, -.5, 0), C('acc', 'shop'), taper=.82)                                         # plastic shopping bag
    for sx in (1, -1): b.box(.012, .13, .008, (sx * .022, -.37, 0), C('acc', 'shop'), rz=sx * .3)       # its handles


def thigh(b):
    b.ell(.085, C('bot'), n=6, rings=3)
    limb(b, [(.06, -.46), (.075, -.33), (.088, -.08), (.087, .02)], 'bot', [-.43, -.33, -.08, .01], .01)
    b.ell(.059, C('bot'), at=(0, -.46, .004), n=6, rings=2)


def shin(b):
    limb(b, [(.038, -.42), (.045, -.3), (.06, -.1), (.058, .02)], 'shin', [-.38, -.3, -.1, .01], .008)
    b.lathe([(.046, -.42), (.047, -.39), (.044, -.36)], 6, C('bot', 'pants'), a0=L_A0)                 # trouser hem


def foot(b):
    b.lathe([(.046, -.03), (.044, .03)], 6, C('shoe'))                                                   # ankle collar
    b.extrude_x([(-.075, -.036), (.165, -.036), (.165, -.02), (.12, -.004), (.03, .026), (-.075, .03)], .046, C('shoe'))
    b.box(.1, .014, .262, (0, -.041, .046), C('fix', tint=0xe4e2dc))                                     # sole
    if not b.lo: b.box(.03, .005, .075, (0, .014, .07), C('fix', tint=0xf2f2f2), rx=.32)                 # laces


BUILD = {'torso': torso, 'head': head, 'uArm': u_arm, 'fArm': f_arm, 'thigh': thigh, 'shin': shin, 'foot': foot}


def build_part(name, look=None, side=1, prefix='', lo=False):
    j = JOINT[name]; j = (j[0] * side, j[1], j[2])
    b = Bld(look, off=j if name not in ('torso', 'head') else (0, 0, 0), lo=lo)
    BUILD[name](b)
    return b.p.obj(prefix + name + ('_lo' if lo else ''), origin=j)


# ---------------------------------------------------------------- preview people
def person(look, pose, dx, dz=0.0, tag='p', lo=False):
    """Assemble a whole person (both sides) for the preview, posed with joint rotations (game rx; rz)."""
    look = dict(look); look['mask'] = set(look['mask'])
    objs = {}; wpos = {}
    for part in PARTS:
        for side in ((1, -1) if part not in ('torso', 'head') else (1,)):
            L = dict(look); L['mask'] = set(look['mask'])
            if part == 'fArm':
                ex = look.get('armL') if side == 1 else look.get('armR')
                if ex: L['mask'].add(ex)
                if ex == 'shop': L['acc'] = look.get('shopCol', 0xf0f0f0)
            o = build_part(part, L, side, '%s_%s%s_' % (tag, part, 'L' if side == 1 else 'R'), lo=lo)
            objs[(part, side)] = o; wpos[(part, side)] = o.location.copy()
    def link(child, parent):
        c = objs[child]; c.parent = objs[parent]; c.location = wpos[child] - wpos[parent]
    for side in (1, -1):
        link(('uArm', side), ('torso', 1)); link(('fArm', side), ('uArm', side))
        link(('shin', side), ('thigh', side)); link(('foot', side), ('shin', side))
    link(('head', 1), ('torso', 1))
    for (part, side), (rx, rz) in pose.items():
        o = objs[(part, side)]; o.rotation_euler.x = rx; o.rotation_euler.y = -rz * side
    roots = [objs[('torso', 1)], objs[('thigh', 1)], objs[('thigh', -1)]]
    for o in roots: o.location.x += dx; o.location.y -= dz
    import bpy; bpy.context.view_layer.update()
    return roots


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


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    pdir = argv[argv.index('--preview') + 1] if '--preview' in argv else None
    lp.reset()
    nodes = [build_part(p) for p in PARTS] + [build_part(p, lo=True) for p in PARTS]
    tris = {o.name: sum(len(f.vertices) - 2 for f in o.data.polygons) for o in nodes}
    for sfx in ('', '_lo'):
        print('people tris per part', {k: tris[k + sfx] for k in PARTS}, 'per person',
              tris['torso' + sfx] + tris['head' + sfx] + 2 * sum(tris[k + sfx] for k in PARTS[2:]))
    lp.export(os.path.join(lp.MODELS, 'people.glb'), nodes)
    if not pdir: return
    os.makedirs(pdir, exist_ok=True)
    groups = [LOOKS[:5], LOOKS[5:]]
    for gi, grp in enumerate(groups):
        objs = []
        for k, (tag, look, pose) in enumerate(grp):
            objs += person(look, pose, (k - (len(grp) - 1) / 2) * .75, tag=tag)
        lp.preview(objs, os.path.join(pdir, 'front%d.png' % gi), yaw=15, pitch=8, size=1100)
        lp.preview(objs, os.path.join(pdir, 'back%d.png' % gi), yaw=160, pitch=12, size=1100)
    objs = []
    for k, (tag, look, pose) in enumerate(LOOKS[:5]):
        objs += person(look, pose, (k - 2) * .75, tag='L_' + tag, lo=True)
    lp.preview(objs, os.path.join(pdir, 'lod.png'), yaw=15, pitch=8, size=1100)
    # head close-ups
    objs = []
    for k, (tag, look, pose) in enumerate(LOOKS):
        objs += person(look, IDLE, (k - 4) * .32, tag='H_' + tag)
    heads = [o for o in bpy_objects() if o.name.startswith('H_') and '_head' in o.name]
    lp.preview(heads, os.path.join(pdir, 'heads.png'), yaw=20, pitch=5, size=1400)
    lp.preview(heads, os.path.join(pdir, 'heads_side.png'), yaw=110, pitch=5, size=1400)


def bpy_objects():
    import bpy
    return list(bpy.data.objects)


main()
