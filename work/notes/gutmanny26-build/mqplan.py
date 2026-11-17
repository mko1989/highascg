#!/usr/bin/env python3
"""mqplan.py — gutmanny 26 rig ↔ heads of the MagicQ show "gutmanny26" (the Narvil show + clones): which head plays which
fixture, and the DMX addresses. Writes mq/plan.json, mq/pass1.csv (park every involved head on universes 41+) and
mq/pass2.csv (final addresses)."""
import csv, json, collections, sys, os
S = os.path.join(os.path.dirname(__file__), '..', 'mq')
H = [r for r in csv.DictReader(open(f'{S}/gmmorph.csv')) if 'vdim' not in r['Headtype']]
byno = {int(r['Headno']): r for r in H}
P = json.load(open('/home/casparcg/highascg/projects/gutmanny_26.json'))['fixtures']['patch']
kind = lambda f: f['name'].rsplit(' ', 1)[0]
G = collections.defaultdict(list)
for f in P: G[kind(f)].append(f)
CX = 16.31
def truss(fs, y): return sorted([f for f in fs if round(f['pose']['y']) == y], key=lambda f: f['pose']['x'])
def byx(nos): return sorted(nos, key=lambda n: float(byno[n]['X']))
pairs = []  # (head no, fixture)
def put(nos, fs):
    assert len(nos) == len(fs), (len(nos), len(fs))
    pairs.extend(zip(nos, fs))
Q = G['MAC Quantum Profile']
put(byx([1, 2, 3, 4, 5, 10820]), truss(Q, 47)); put(byx([6, 7, 8, 9, 10, 10821]), truss(Q, 39))
put(byx([11, 12, 13, 14, 10822, 10823]), truss(Q, 31)); put([21, 22, 23, 24, 25, 26], truss(Q, 23))
put([27, 28, 91, 92, 93, 94], truss(Q, 16)); put([51, 52, 53, 56, 57, 58], truss(Q, 8))
F = sorted(G['Focus Profile'], key=lambda f: (-round(f['pose']['y']), f['pose']['x']))
put(byx(range(10824, 10848))[:9] if False else list(range(10824, 10848)), F)
R = G['Robin 600 LEDWash+']
put(byx(range(401, 409)), truss(R, 47)); put(byx(range(409, 417)), truss(R, 39))
for i, y in enumerate((31, 23, 16, 8)): put(byx(range(10848 + 8 * i, 10856 + 8 * i)), truss(R, y))
put(byx(range(601, 607)), truss(R, 55))
St = G['Pixel Strobe']
put(byx(range(701, 707)), truss(St, 47)); put(byx(range(707, 713)), truss(St, 39))
for i, y in enumerate((31, 23, 16, 8)): put(byx(range(10880 + 6 * i, 10886 + 6 * i)), truss(St, y))
V = G['Vizi Beam CMY']; up = sorted([f for f in V if f['pose']['y'] >= 56.5], key=lambda f: f['pose']['x']); side = [f for f in V if f['pose']['y'] < 56.5]
L = sorted([f for f in side if f['pose']['x'] < CX], key=lambda f: f['pose']['y']); Rr = sorted([f for f in side if f['pose']['x'] >= CX], key=lambda f: f['pose']['y'])
sl = list(range(121, 129)); sr = list(range(131, 139))
put(sl[:len(L)], L); put(sr[:len(Rr)], Rr)
mid = up[1:-1] if len(up) == 18 else up
put(byx(list(range(101, 117)))[:len(mid)], mid)
if len(up) == 18: put([sl[len(L)], sr[len(Rr)]], [up[0], up[-1]])
X = sorted(G['X-Dot'], key=lambda f: (round(f['pose']['z'], 1), f['pose']['x']))
put(list(range(201, 211)) + list(range(301, 313)) + list(range(10908, 10914)), X)
put(byx(range(501, 513)), sorted(G['X-Dot Max'], key=lambda f: f['pose']['x']))
PL = sorted(G['Pixel Line IP'], key=lambda f: (-round(f['pose']['z'], 1), f['pose']['x']))
put(list(range(1001, 1026)) + list(range(1041, 1046)) + list(range(10904, 10908)), PL)
assert len(pairs) == len(P) == len({id(f) for _, f in pairs}) == len({n for n, _ in pairs}), (len(pairs), len(P))
FOOT = {'MacQuantumProf_Extended': 27, 'FocusProfile_36ch': 36, 'Rob600LEDWash_Mode 3': 15, 'Rob600LEDWash_Mode 1': 37, 'PIXEL STROBE IP_15Ch': 15,
        'ViziBeamCMY_24ch': 24, 'X-DOT_51Ch': 51, 'ALEDABEyeK20_Shapes': 35, 'PixellineIP_68ch': 68, 'PixelBar8_24ch': 24}
def foot(r): return next(v for k, v in FOOT.items() if k in r['Headtype'])
MODE = {'MacQuantumProf_Extended': ('c24ac67a2350', 'Extended'), 'FocusProfile_36ch': ('cb73a616bb97', 'Basic Mode 36ch'),
        'Rob600LEDWash_Mode 3': ('289fa8cde237', 'Mode 3 Reduced RGBW Wash 8bit'), 'Rob600LEDWash_Mode 1': ('289fa8cde237', 'Mode 1 Extended with all zones 16bit'),
        'PIXEL STROBE IP_15Ch': ('b6c4b750cbc7', 'Advanced 1 (15ch)'), 'ViziBeamCMY_24ch': ('0daf0fdca282', '24 CH'), 'X-DOT_51Ch': ('d5aecf674475', '51Ch'),
        'ALEDABEyeK20_Shapes': ('d3963b9eeb1e', '35Ch'), 'PixellineIP_68ch': ('6ad826d14d1b', 'Mode 9 68DMX')}
UNIS = [2, 3, 4, 5, 6, 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 27, 7, 8]
ui, at = 0, 1; plan = []
order = {k: i for i, k in enumerate(G)}  # keep the project's type order, fixtures in patch order
for n, f in sorted(pairs, key=lambda p: (order[kind(p[1])], P.index(p[1]))):
    r = byno[n]; w = foot(r)
    if at + w - 1 > 512: ui += 1; at = 1
    typeId, mode = next(v for k, v in MODE.items() if k in r['Headtype'])
    plan.append({'head': n, 'fixture': f['id'], 'name': f['name'], 'uni': UNIS[ui], 'addr': at, 'foot': w, 'typeId': typeId, 'mode': mode, 'headname': r['Headname'], 'headtype': r['Headtype']})
    at += w
print('universes used', ui + 1, 'of', len(UNIS), '→ last', UNIS[ui], at - 1)
json.dump(plan, open(f'{S}/plan.json', 'w'), indent=0)
used = {p['head'] for p in plan}
park = [r for r in H if r['Dmxno'] != 'Unpatched' and (int(r['Headno']) in used or any(k in r['Headtype'] for k in FOOT))]
cols = list(H[0].keys())
def write(name, rows):
    with open(f'{S}/{name}', 'w', newline='') as fh:
        w = csv.DictWriter(fh, cols); w.writeheader(); w.writerows(rows)
u, a = 41, 1; rows = []
for r in park:
    w = foot(r)
    if a + w - 1 > 512: u += 1; a = 1
    rows.append(dict(r, Dmxno=f'{u}-{a:03d}')); a += w
write('pass1.csv', rows); print('pass1', len(rows), 'heads parked on', 41, '…', u)
write('pass2.csv', [dict(byno[p['head']], Dmxno=f"{p['uni']}-{p['addr']:03d}") for p in plan]); print('pass2', len(plan))
c = collections.Counter((p['headtype'][:26], p['headname']) for p in plan)
