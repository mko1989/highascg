#!/usr/bin/env python3
"""LED panels of the Capture .glb (faces with material "LED Grid") → HighAsCG stage objects (led_wall, curved) with
their crops of one 60 × 8-panel canvas (11520 × 1536 px). usage: fit_led.py <gm.json> <gm_bounds.json> <out.json>"""
import sys, json, math
import numpy as np
j = json.load(open(sys.argv[1])); o = json.load(open(sys.argv[2]))
N = j['nodes']; M = j['meshes']; A = j['accessors']; mats = j['materials']
parent = {}
for i, n in enumerate(N):
    for c in n.get('children', []): parent[c] = i
def local(n): return np.array(n['matrix'], float).reshape(4, 4).T if 'matrix' in n else np.eye(4)
def world(i):
    m = local(N[i])
    while i in parent: i = parent[i]; m = local(N[i]) @ m
    return m
P = []
for x in o:
    if 'LED Grid' not in x['mats']: continue
    w = world(x['i'])
    for p in M[N[x['i']]['mesh']]['primitives']:
        if mats[p['material']]['name'] == 'LED Grid':
            a = A[p['attributes']['POSITION']]
            P.append((w @ np.append((np.array(a['min']) + np.array(a['max'])) / 2, 1))[:3])
P = np.array(P); assert len(P) == 420
PX = 192; PW = 0.5
def edges(cols, curve_deg):
    c = math.radians(curve_deg)
    if abs(c) < 1e-9: return np.array([[(k - cols / 2) * PW, 0.0] for k in range(cols + 1)])
    r = (PW / 2) / math.sin(abs(c) / 2); sg = 1 if c > 0 else -1
    return np.array([[r * math.sin((k - cols / 2) * abs(c)), sg * r * (1 - math.cos((k - cols / 2) * abs(c)))] for k in range(cols + 1)])
def fit(cols_xz, curve):
    """cols_xz: column centres (world x, z) left → right. → (rms, yaw_deg, origin xz)"""
    n = len(cols_xz); e = edges(n, curve); L = (e[:-1] + e[1:]) / 2
    lc = L.mean(0); wc = cols_xz.mean(0); a = L - lc; b = cols_xz - wc
    # world = R(th)·local : wx = x cos + z sin ; wz = -x sin + z cos
    num = (a[:, 0] * -b[:, 1] + a[:, 1] * b[:, 0]).sum(); den = (a[:, 0] * b[:, 0] + a[:, 1] * b[:, 1]).sum()
    th = math.atan2(-num, den) * -1
    best = None
    for t in (th, -th, th + math.pi, -th + math.pi):
        R = np.array([[math.cos(t), math.sin(t)], [-math.sin(t), math.cos(t)]])
        org = wc - R @ lc; res = (R @ L.T).T + org - cols_xz; rms = float(np.sqrt((res ** 2).sum(1).mean()))
        if best is None or rms < best[0]: best = (rms, math.degrees(t), org)
    return best
def wall(name, sel, col0, row0, id_):
    Q = P[sel]; xs = Q[:, [0, 2]]
    # columns: cluster by (x, z) within 3 cm
    cols = []
    for q in Q:
        for c in cols:
            if abs(c[0][0] - q[0]) < 0.03 and abs(c[0][2] - q[2]) < 0.03: c.append(q); break
        else: cols.append([q])
    cols.sort(key=lambda c: c[0][0])
    rows = len(cols[0]); assert all(len(c) == rows for c in cols), (name, [len(c) for c in cols])
    cxz = np.array([[np.mean([q[0] for q in c]), np.mean([q[2] for q in c])] for c in cols])
    best = min(((fit(cxz, cv), cv) for cv in np.arange(-6, 6.0001, 0.01)), key=lambda t: t[0][0])
    (rms, yaw, org), curve = best
    yaw = (yaw + 180) % 360 - 180
    y0 = float(Q[:, 1].min()) - 0.25
    face = [math.sin(math.radians(yaw)), math.cos(math.radians(yaw))]
    obj = {'id': id_, 'type': 'led_wall', 'name': name, 'panel_mm': [500, 500], 'panel_px': [PX, PX], 'panels': [len(cols), rows],
           'curve_deg': round(float(curve), 2), 'depth_m': 0.08, 'position': [round(float(org[0]), 3), round(y0, 3), round(float(org[1]), 3)],
           'rotation': [0, round(yaw, 2), 0], 'visible': True,
           'source': {'role': 'pgm1', 'rect': {'x': col0 * PX, 'y': row0 * PX, 'w': len(cols) * PX, 'h': rows * PX}}}
    print(f"{name:26s} {len(cols):2d}x{rows} curve {curve:+.2f} yaw {yaw:+8.2f} rms {rms*1000:5.1f} mm  y0 {y0:.3f} faces ({face[0]:+.2f},{face[1]:+.2f}) rect {obj['source']['rect']}")
    return obj
x, y, z = P[:, 0], P[:, 1], P[:, 2]
top, mid, bot = y > 3.6, (y > 2.1) & (y < 3.1), y < 1.62
objs = []
objs.append(wall('LED wing L', (z > -49.5) & (x < 10), 0, 0, 'led_wing_l'))
sl = (z < -50.5) & (z > -55.7) & (x < 9.5)
objs.append(wall('LED stripe L top', sl & top, 4, 0, 'led_stripe_l1'))
objs.append(wall('LED stripe L mid', sl & mid, 5, 3, 'led_stripe_l2'))
objs.append(wall('LED stripe L bottom', sl & bot, 4, 6, 'led_stripe_l3'))
objs.append(wall('LED centre', (z < -56), 17, 0, 'led_centre'))
sr = (z < -50.3) & (z > -55.7) & (x > 22.5)
objs.append(wall('LED stripe R top', sr & top, 43, 0, 'led_stripe_r1'))
objs.append(wall('LED stripe R mid', sr & mid, 44, 3, 'led_stripe_r2'))
objs.append(wall('LED stripe R bottom', sr & bot, 43, 6, 'led_stripe_r3'))
objs.append(wall('LED wing R', (z > -49.5) & (x > 20), 56, 0, 'led_wing_r'))
n = sum(o['panels'][0] * o['panels'][1] for o in objs); print('panels', n)
json.dump(objs, open(sys.argv[3], 'w'), indent=1)
