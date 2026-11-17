#!/usr/bin/env python3
"""ChamSys "tamoos-narvil" (Narvil IDE) → gutmanny 26 looks. Source: the BAND cue stack (PB10, page KONCERT) played in
MagicQ, its Art-Net captured and decoded with the Narvil project's patch (mqdecode.js → cue_N.json). The cues hold
colour, position, zoom and gobo; intensity is busked on that desk, so each look gets a level per fixture type here.
Fixture mapping: same type, left → right across the rig; types Narvil does not have take a relative's values."""
import json, uuid, collections, sys
from proj import get, post, edit, API
S = sys.argv[1]
CUES = [(1, 'Narvil — Red / Run'), (2, 'Narvil — Magenta / Promises'), (3, 'Narvil — Blue Grubson'), (4, 'Narvil — Green / Move'), (5, 'Narvil — 5.00')]
FROM = {'MAC Quantum Profile': 'MAC Quantum Profile', 'Focus Profile': 'MAC Quantum Profile', 'Vizi Beam CMY': 'MAC Quantum Profile',
        'Robin 600 LEDWash+': 'Robin 600 LEDWash+', 'Pixel Strobe': 'Pixel Strobe', 'Pixel Line IP': 'Pixel Line IP',
        'X-Dot Max': 'X-Dot Max', 'X-Dot': 'X-Dot Max'}
LEVEL = {'MAC Quantum Profile': 0.8, 'Focus Profile': 0.5, 'Vizi Beam CMY': 0.7, 'Robin 600 LEDWash+': 0.6, 'Pixel Strobe': 0.25,
         'Pixel Line IP': 0.3, 'X-Dot Max': 0.5, 'X-Dot': 0.5}
doc = get(); P = doc['fixtures']['patch']
kind = lambda n: n.rsplit(' ', 1)[0]
G = collections.OrderedDict()
for f in P: G.setdefault(kind(f['name']), []).append(f)
F = {}; ids = [f['id'] for f in P]
for i in range(0, len(ids), 40): F.update(get('/api/fixtures/program/features?ids=' + ','.join(ids[i:i + 40]))['fixtures'])
RGB = {'ColorAdd_R': 0, 'ColorAdd_G': 1, 'ColorAdd_B': 2, 'ColorRGB_Red': 0, 'ColorRGB_Green': 1, 'ColorRGB_Blue': 2}
CMY = {'ColorSub_C': 0, 'ColorSub_M': 1, 'ColorSub_Y': 2}
def colour(f, c):
    out = {}
    if any(k in RGB for k in f.get('add', [])):
        for k in f['add']: out[k] = {'norm': round(c[RGB[k]], 3) if k in RGB else 0.0}
    elif any(k in CMY for k in f.get('sub', [])):
        for k in f['sub']: out[k] = {'norm': round(1 - c[CMY[k]], 3) if k in CMY else 0.0}
    if out:
        for s in f.get('colors', []): out.setdefault(s['attr'], {'set': s['name']})
        return out
    if f.get('colors'):
        s = min(f['colors'], key=lambda s: sum((a - b) ** 2 for a, b in zip(s['rgb'], c)))
        out[s['attr']] = {'set': s['name']}
    return out
def look(n):
    src = collections.defaultdict(list)
    for o in json.load(open(f'{S}/cue_{n}.json')): src[o['kind']].append(o)
    for v in src.values(): v.sort(key=lambda o: (o['pose']['x'], o['pose']['y']))
    values = {}; note = []
    for k, fxs in G.items():
        s = src.get(FROM.get(k, ''), [])
        if not s: continue
        fxs = sorted(fxs, key=lambda f: (f['pose']['x'], f['pose']['y'])); used = 0
        for j, fx in enumerate(fxs):
            o = s[round(j * (len(s) - 1) / max(1, len(fxs) - 1))]
            if max(o['c']) <= 0: continue
            f = F.get(fx['id'], {}); v = colour(f, o['c']); lvl = LEVEL[k]
            if f.get('dimmer'): v['Dimmer'] = {'norm': lvl}
            else: v = {a: ({'norm': round(x['norm'] * lvl, 3)} if 'norm' in x else x) for a, x in v.items()}
            if f.get('pan') and o['pan'] is not None:
                v['Pan'] = max(min(o['pan'], max(f['pan']['from'], f['pan']['to'])), min(f['pan']['from'], f['pan']['to']))
                v['Tilt'] = max(min(o['tilt'], max(f['tilt']['from'], f['tilt']['to'])), min(f['tilt']['from'], f['tilt']['to']))
            if f.get('zoom') and o.get('zoom') and FROM[k] == k:
                lo, hi = sorted((f['zoom']['from'], f['zoom']['to'])); v['Zoom'] = max(lo, min(hi, o['zoom']))
            if o.get('gobo') and FROM[k] == k:
                g = [x for x in f.get('gobos', []) if x.get('media') and o['gobo'].endswith('/' + x['media'])]
                if g: v[g[0]['attr']] = {'set': g[0]['name']}
            values[fx['id']] = v; used += 1
        note.append(f'{k} {used}/{len(fxs)}')
    print(n, ' · '.join(note)); return values
built = [(name, look(n)) for n, name in CUES]
if '--dry' in sys.argv: print(json.dumps(list(built[2][1].values())[:2])); sys.exit()
def store(d):
    sc = d['scenes']; old = {s['name']: s for s in sc['scenes']}
    for name, values in built:
        s = old.get(name)
        if not s:
            s = {'id': str(uuid.uuid4()), 'name': name, 'layers': [], 'mainScope': '0', 'defaultTransition': {'type': 'MIX', 'duration': 75, 'tween': 'linear'}}
            sc['scenes'].append(s)
        d['fixtures'].setdefault('looks', {})[s['id']] = {'values': values}
doc = edit(store)
print({s['name']: s['id'] for s in doc['scenes']['scenes']})
