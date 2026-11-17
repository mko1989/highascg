#!/usr/bin/env python3
"""Lighting looks for gutmanny 26 (dark blue + gold) — programmed through the live engine (colour per fixture type like
the Godot programmer, Pan / Tilt from the engine's own aim IK), read back and stored as looks with fixture states."""
import json, uuid, urllib.request, collections
from proj import get, post, edit, API
def delete(path):
    urllib.request.urlopen(urllib.request.Request(API + path, method='DELETE')).read()
doc = get(); P = doc['fixtures']['patch']
G = collections.OrderedDict()
for f in P: G.setdefault(f['name'].rsplit(' ', 1)[0], []).append(f)
F = {}
ids = [f['id'] for f in P]
for i in range(0, len(ids), 40): F.update(get('/api/fixtures/program/features?ids=' + ','.join(ids[i:i + 40]))['fixtures'])
NAVY = (0.02, 0.06, 0.60); DEEP = (0.0, 0.02, 0.85); GOLD = (1.0, 0.66, 0.16); WARM = (1.0, 0.84, 0.62)
RGB = {'ColorAdd_R': 0, 'ColorAdd_G': 1, 'ColorAdd_B': 2, 'ColorRGB_Red': 0, 'ColorRGB_Green': 1, 'ColorRGB_Blue': 2}
CMY = {'ColorSub_C': 0, 'ColorSub_M': 1, 'ColorSub_Y': 2}
def colour(f, c):
    """programmer_model.gd color_values: RGB mixing (other emitters off), else CMY (wheels open), else nearest wheel slot."""
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
TRIM = {GOLD: 0.38, WARM: 0.55, NAVY: 1.0, DEEP: 1.0}
BARS = {'Pixel Line IP': 0.3, 'Pixel Strobe': 0.5, 'X-Dot Max': 0.6}  # look straight at the audience: glare
def val(fx, c, dim, gobo=None, zoom=None):
    f = F.get(fx['id'], {}); v = colour(f, c)
    dim = round(min(1.0, dim * TRIM.get(c, 1.0) * BARS.get(kind(fx), 1.0) / (0.75 if c in (NAVY, DEEP) else 1.0)), 3)
    if f.get('dimmer'): v['Dimmer'] = {'norm': dim}
    else: v = {k: ({'norm': round(x['norm'] * dim, 3)} if 'norm' in x else x) for k, x in v.items()}  # no dimmer channel: scale the mix
    if gobo is not None:
        g = [s for s in f.get('gobos', []) if s['attr'] == 'Gobo1']
        if len(g) > gobo: v['Gobo1'] = {'set': g[gobo]['name']}
    if zoom is not None and f.get('zoom'): v['Zoom'] = f['zoom']['from'] + zoom * (f['zoom']['to'] - f['zoom']['from'])
    return v
def pos(fx): return fx['pose']['x'], fx['pose']['y'], fx['pose']['z']
CX = 16.31  # the catwalk / red carpet axis
def build(name, plan):
    """plan: fixture → (values, target | None)"""
    delete('/api/fixtures/program')
    n = 0
    for fx in P:
        r = plan(fx)
        if not r: continue
        v, target = r
        post('/api/fixtures/program', {'ids': [fx['id']], 'values': v, 'replace': True}); n += 1
        if target: post('/api/fixtures/program/aim', {'ids': [fx['id']], 'target': list(target)})
    values = get('/api/fixtures/program')['values']
    print(f'{name}: {n} fixtures programmed, {len(values)} stored, {sum(1 for v in values.values() if "Pan" in v)} aimed')
    return values
def kind(fx): return fx['name'].rsplit(' ', 1)[0]
def onstage(fx): return fx['pose']['y'] > 47.5

def walk_in(fx):
    k = kind(fx); x, y, z = pos(fx)
    if k == 'Robin 600 LEDWash+': return val(fx, NAVY, 0.75, zoom=0.8), None
    if k == 'MAC Quantum Profile': return val(fx, GOLD, 0.8, gobo=3, zoom=0.6), (CX + (x - CX) * 0.35, y + 1.5, 0)  # gold break-ups drawn in towards the carpet
    if k == 'Pixel Line IP': return val(fx, GOLD, 0.45), None
    if k == 'X-Dot': return val(fx, NAVY, 0.6, zoom=0.3), (x, y - 6, 9)
    if k == 'X-Dot Max': return val(fx, GOLD, 0.5, zoom=0.2), (x, y - 1, 8)
def speech(fx):
    k = kind(fx); x, y, z = pos(fx)
    if k == 'Focus Profile':  # warm key from the front trusses: lectern at the stage front, the catwalk, the stage width
        t = (CX, 49.0, 2.2) if abs(x - CX) < 4 else ((CX, 43.0, 2.2) if abs(x - CX) < 8 else (CX + (x - CX) * 0.75, 51.0, 2.2))
        return val(fx, WARM, 1.0, zoom=0.7), t
    if k == 'Robin 600 LEDWash+': return (val(fx, DEEP, 0.9, zoom=0.6), None) if onstage(fx) or y > 44 else (val(fx, NAVY, 0.25, zoom=1.0), None)
    if k == 'Pixel Line IP': return val(fx, GOLD, 0.3), None
    if k == 'X-Dot': return val(fx, NAVY, 0.5, zoom=0.8), (x, y - 2, 0.6)
    if k == 'X-Dot Max': return val(fx, GOLD, 0.25, zoom=0.5), (x, y + 2, 5)
def gold_beams(fx):
    k = kind(fx); x, y, z = pos(fx)
    if k == 'Vizi Beam CMY': return val(fx, GOLD, 1.0), (CX + (x - CX) * 2.4, y - 26, 9.0)  # a fan over the audience
    if k == 'X-Dot Max': return val(fx, GOLD, 1.0, zoom=0.0), (x, y - 3, 12)
    if k == 'X-Dot': return val(fx, GOLD, 0.8, zoom=0.1), (CX + (x - CX) * 1.6, y - 12, 8)
    if k == 'Robin 600 LEDWash+': return val(fx, NAVY, 0.45, zoom=0.9), None
    if k == 'Pixel Line IP': return val(fx, GOLD, 1.0), None
    if k == 'Pixel Strobe': return val(fx, GOLD, 0.15), None
    if k == 'MAC Quantum Profile': return val(fx, DEEP, 0.6, gobo=5, zoom=0.9), (x + (x - CX) * 0.2, y, 0)
def blue_entrance(fx):
    k = kind(fx); x, y, z = pos(fx)
    if k == 'Vizi Beam CMY': return val(fx, DEEP, 1.0), (CX - (x - CX) * 0.6, 30.0, 0.5)  # crossing over the aisle
    if k == 'MAC Quantum Profile':  # gold pools down the carpet and the catwalk from the nearest heads
        return (val(fx, GOLD, 1.0, zoom=0.35), (CX, max(16.5, min(47.0, y)), 0.3)) if abs(x - CX) < 6 else (val(fx, NAVY, 0.5, gobo=2, zoom=0.8), (x, y, 0))
    if k == 'Focus Profile': return (val(fx, WARM, 0.8, zoom=0.5), (CX, 42.0, 2.0)) if abs(x - CX) < 6 else None
    if k == 'Robin 600 LEDWash+': return val(fx, DEEP, 0.6, zoom=0.7), None
    if k == 'Pixel Line IP': return val(fx, DEEP, 0.8), None
    if k == 'X-Dot': return val(fx, GOLD, 0.7, zoom=0.15), (x, y - 1, 10)
    if k == 'X-Dot Max': return val(fx, DEEP, 0.9, zoom=0.1), (CX + (x - CX) * 0.3, y - 14, 7)
LOOKS = [('Walk-in — navy & gold', walk_in), ('Speech — stage key', speech), ('Gold beams', gold_beams), ('Blue entrance — carpet', blue_entrance)]
built = [(n, build(n, fn)) for n, fn in LOOKS]
delete('/api/fixtures/program')
def store(d):
    sc = d['scenes']; old = {s['name']: s for s in sc['scenes']}
    for name, values in built:
        s = old.get(name)
        if not s:
            s = {'id': str(uuid.uuid4()), 'name': name, 'layers': [], 'mainScope': '0', 'defaultTransition': {'type': 'MIX', 'duration': 75, 'tween': 'linear'}}
            sc['scenes'].append(s)
        d['fixtures'].setdefault('looks', {})[s['id']] = {'values': values}
    d['fixtures']['groups'] = [{'name': k, 'ids': [f['id'] for f in v]} for k, v in G.items()]
doc = edit(store)
ids = {s['name']: s['id'] for s in doc['scenes']['scenes']}
print(ids)
print(get('/api/fixtures/looks'))
print(post('/api/fixtures/looks/recall', {'lookId': ids[LOOKS[0][0]], 'fade_ms': 2000}))
