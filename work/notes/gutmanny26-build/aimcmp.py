"""aimcmp.py x z [y] — MagicQ target (stage-centred frame) → compare the desk's decoded pan/tilt with HighAsCG's own aim."""
import sys, json, urllib.request, collections
from proj import get, post, API
X, Z = float(sys.argv[1]), float(sys.argv[2]); Y = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
P = get()['fixtures']['patch']; t = get('/api/tracking/fixtures'); fx = t.get('fixtures') or t
items = dict(fx.items() if isinstance(fx, dict) else [(f.get('id'), f) for f in fx])
own = get('/api/fixtures/program')['values']
ids = [f['id'] for f in P]
for i in range(0, len(ids), 60): post('/api/fixtures/program/aim', {'ids': ids[i:i + 60], 'target': [16.31 + X, 47.97 - Z, Y]})
v = get('/api/fixtures/program')['values']
urllib.request.urlopen(urllib.request.Request(API + '/api/fixtures/program', method='DELETE')).read()
for fid, val in own.items(): post('/api/fixtures/program', {'ids': [fid], 'values': val, 'replace': True})
D = collections.defaultdict(list)
for f in P:
    a = items.get(f['id'], {}).get('axes') or {}; o = v.get(f['id'], {})
    if 'Pan' not in o or len(a) < 2: continue
    pan, tilt = list(a.values())[0], list(a.values())[1]
    D[f['name'].rsplit(' ', 1)[0]].append((f['name'].rsplit(' ', 1)[1], round(pan - o['Pan'], 1), round(tilt - o['Tilt'], 1), pan, tilt, o['Pan'], o['Tilt']))
for k, L in D.items():
    ok = sum(1 for r in L if abs(r[1]) < 3 and abs(r[2]) < 3)
    print(f'{k}: {ok}/{len(L)} within 3°', '| e.g.', [(r[0], 'desk %.0f/%.0f' % r[3:5], 'ours %.0f/%.0f' % r[5:7]) for r in L[:3] + L[-1:]])
