#!/usr/bin/env python3
"""Guttmanny 2026 venue .glb = the Capture export's event layers (stage, LED frames, trusses) + the textured Hilton
ballroom of the PGRP project (same SketchUp room, same frame once PGRP's registration is undone) + a red carpet.
usage: build_venue.py <capture.glb> <pgrp venue.glb> <mvr GeneralSceneDescription.xml> <out.glb>"""
import sys, json, struct, re, uuid
import numpy as np

def read_glb(p):
    b = open(p, 'rb').read()
    jl, = struct.unpack_from('<I', b, 12)
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl, = struct.unpack_from('<I', b, off)
    return j, b[off + 8: off + 8 + bl]

class Out:
    def __init__(s):
        s.bin = bytearray(); s.j = dict(asset={'version': '2.0', 'generator': 'HighAsCG gutmanny26 venue build'},
            scene=0, scenes=[{'nodes': []}], nodes=[], meshes=[], accessors=[], bufferViews=[], materials=[],
            textures=[], images=[], samplers=[])
    def add_bytes(s, data, target=None, stride=None):
        while len(s.bin) % 4: s.bin.append(0)
        bv = {'buffer': 0, 'byteOffset': len(s.bin), 'byteLength': len(data)}
        if target: bv['target'] = target
        if stride: bv['byteStride'] = stride
        s.bin += data; s.j['bufferViews'].append(bv); return len(s.j['bufferViews']) - 1

class Src:
    """One source file copied on demand into Out with re-indexing."""
    def __init__(s, path, out, mat_edit=None, drop_mat=None):
        s.j, s.bin = read_glb(path); s.out = out; s.m = {k: {} for k in ('bv', 'acc', 'img', 'smp', 'tex', 'mat', 'mesh')}
        s.mat_edit = mat_edit; s.drop_mat = drop_mat or (lambda m: False)
    def bv(s, i):
        if i not in s.m['bv']:
            v = s.j['bufferViews'][i]; o = v.get('byteOffset', 0)
            s.m['bv'][i] = s.out.add_bytes(s.bin[o:o + v['byteLength']], v.get('target'), v.get('byteStride'))
        return s.m['bv'][i]
    def acc(s, i):
        if i not in s.m['acc']:
            a = dict(s.j['accessors'][i])
            if 'bufferView' in a: a['bufferView'] = s.bv(a['bufferView'])
            assert 'sparse' not in a
            s.out.j['accessors'].append(a); s.m['acc'][i] = len(s.out.j['accessors']) - 1
        return s.m['acc'][i]
    def tex(s, i):
        if i not in s.m['tex']:
            t = dict(s.j['textures'][i])
            if 'source' in t:
                si = t['source']
                if si not in s.m['img']:
                    im = dict(s.j['images'][si]); im['bufferView'] = s.bv(im['bufferView'])
                    s.out.j['images'].append(im); s.m['img'][si] = len(s.out.j['images']) - 1
                t['source'] = s.m['img'][si]
            if 'sampler' in t:
                pi = t['sampler']
                if pi not in s.m['smp']:
                    s.out.j['samplers'].append(dict(s.j['samplers'][pi])); s.m['smp'][pi] = len(s.out.j['samplers']) - 1
                t['sampler'] = s.m['smp'][pi]
            s.out.j['textures'].append(t); s.m['tex'][i] = len(s.out.j['textures']) - 1
        return s.m['tex'][i]
    def mat(s, i):
        if i not in s.m['mat']:
            m = json.loads(json.dumps(s.j['materials'][i]))
            def fix(d):
                for k, v in d.items():
                    if isinstance(v, dict):
                        if k.endswith('Texture') and 'index' in v: v['index'] = s.tex(v['index'])
                        else: fix(v)
            fix(m)
            if s.mat_edit: s.mat_edit(m)
            s.out.j['materials'].append(m); s.m['mat'][i] = len(s.out.j['materials']) - 1
        return s.m['mat'][i]
    def mesh(s, i, force_mat=None):
        """→ new mesh index or None when every primitive was dropped. force_mat: an Out material index for every
        primitive (nothing dropped) — the PA stacks."""
        key = (i, force_mat)
        if key not in s.m['mesh']:
            prims = []
            for p in s.j['meshes'][i]['primitives']:
                if force_mat is None and 'material' in p and s.drop_mat(s.j['materials'][p['material']]): continue
                q = dict(p); q['attributes'] = {k: s.acc(v) for k, v in p['attributes'].items() if force_mat is None or not k.startswith('TEXCOORD')}
                if 'indices' in p: q['indices'] = s.acc(p['indices'])
                if force_mat is not None: q['material'] = force_mat
                elif 'material' in p: q['material'] = s.mat(p['material'])
                q.pop('targets', None); prims.append(q)
            if prims:
                s.out.j['meshes'].append({'primitives': prims}); s.m['mesh'][key] = len(s.out.j['meshes']) - 1
            else: s.m['mesh'][key] = None
        return s.m['mesh'][key]
    def worlds(s):
        N = s.j['nodes']; parent = {}
        for i, n in enumerate(N):
            for c in n.get('children', []): parent[c] = i
        def local(n):
            if 'matrix' in n: return np.array(n['matrix'], float).reshape(4, 4).T
            m = np.eye(4)
            if 'rotation' in n or 'scale' in n:
                x, y, z, w = n.get('rotation', [0, 0, 0, 1]); sc = n.get('scale', [1, 1, 1])
                R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)], [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)], [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
                m[:3, :3] = R * np.array(sc)
            if 'translation' in n: m[:3, 3] = n['translation']
            return m
        W = {}
        def world(i):
            if i not in W: W[i] = (world(parent[i]) @ local(N[i])) if i in parent else local(N[i])
            return W[i]
        return parent, world, local

cap_p, pg_p, xml_p, out_p = sys.argv[1:5]
out = Out()
xml = open(xml_p, encoding='utf-8').read()
fixture_uuids = {u.lower() for u in re.findall(r'<Fixture uuid="([^"]+)"', xml)}

# ---- Capture: keep the event's own layers -------------------------------------------------------------------------
KEEP = {'Default Layer', None}  # stage decks + trusses, LED frames / ground support ("None" = no layer)
def cap_mat(m):
    if m.get('name') == 'Black, Gloss':  # the stage: black HIPS in polish
        m['pbrMetallicRoughness'] = {'baseColorFactor': [0.010, 0.010, 0.011, 1], 'metallicFactor': 0.0, 'roughnessFactor': 0.07}
        m['name'] = 'Stage — black HIPS, polish'
cap = Src(cap_p, out, mat_edit=cap_mat, drop_mat=lambda m: m.get('name') == 'LED Grid')
layers = {l['identifier']: l['name'] for l in cap.j['asset']['extensions']['CAPTURE_model']['layers']}
parent, world, _ = cap.worlds()
def layer_of(i):
    while True:
        l = cap.j['nodes'][i].get('extensions', {}).get('CAPTURE_model', {}).get('layer_identifier')
        if l: return l
        if i not in parent: return None
        i = parent[i]
stats = {'capture_nodes': 0, 'fixtures_dropped': 0}
BACK = [None]
for i, n in enumerate(cap.j['nodes']):
    if 'mesh' not in n: continue
    ext = n.get('extensions', {}).get('CAPTURE_model', {}); uid = str(ext.get('identifier', '')).lower()
    lid = layer_of(i)
    if layers.get(lid) not in KEEP: continue
    if uid in fixture_uuids: stats['fixtures_dropped'] += 1; continue
    # LED panels: the stage objects (led_wall) show the picture. Each panel's own face stays in the file (else the
    # MVR's flat 3DS part would be drawn in its place) as a black back 2 cm behind the picture. The two 4 x 8 side
    # wings are drawn facing upstage in the Capture file (frames on the audience side — the owner saw their grey
    # backs, 17.11): their frames move behind the picture so the wings face the audience like the rest.
    W = world(i).copy()
    prim_mats = {cap.j['materials'][p['material']].get('name') for p in cap.j['meshes'][n['mesh']]['primitives'] if 'material' in p}
    c = W[:3, 3]
    if lid is None and c[1] > 0.6:
        wing = c[2] > -49.6
        if wing: nrm = np.array([0.457, 0, 0.89]) if c[0] < 16 else np.array([-0.265, 0, 0.964])
        elif c[2] < -56: nrm = np.array([0, 0, 1.0])
        else: nrm = np.array([0.78, 0, 0.62]) if c[0] < 16 else np.array([-0.82, 0, 0.57])
        if 'LED Grid' in prim_mats:
            if BACK[0] is None:
                out.j['materials'].append({'name': 'LED panel back', 'doubleSided': True,
                    'pbrMetallicRoughness': {'baseColorFactor': [0.01, 0.01, 0.01, 1], 'metallicFactor': 0, 'roughnessFactor': 0.8}})
                BACK[0] = len(out.j['materials']) - 1
            W[:3, 3] -= 0.02 * nrm; stats['led_panels'] = stats.get('led_panels', 0) + 1
        elif wing and prim_mats & {'<Charcoal>2', 'Kolor_4', 'default'}:
            W[:3, 3] -= 0.09 * nrm; stats['wing_frames_moved'] = stats.get('wing_frames_moved', 0) + 1
    mi = cap.mesh(n['mesh'], BACK[0] if 'LED Grid' in prim_mats else None)
    if mi is None: continue
    e = {'identifier': ext.get('identifier')}
    if lid: e['layer_identifier'] = lid
    out.j['nodes'].append({'mesh': mi, 'matrix': W.T.reshape(-1).round(7).tolist(), 'extensions': {'CAPTURE_model': e}})
    stats['capture_nodes'] += 1

# ---- PGRP venue: the textured room, registration undone -----------------------------------------------------------
NAMES = {'Walls': 'Room walls', 'Floor': 'Room carpet', 'Ceiling': 'Room ceiling', 'Chandeliers': 'Room chandeliers',
         'Haki': 'Hang points', 'Haki plan': 'Hang plan'}
pg = Src(pg_p, out)
pl = {l['identifier']: l['name'] for l in pg.j['asset']['extensions']['HIGHASCG_venue']['layers']}
pparent, pworld, plocal = pg.worlds()
roots = pg.j['scenes'][pg.j.get('scene', 0)]['nodes']
reg = plocal(pg.j['nodes'][roots[0]])  # the "venue" root = PGRP's registration onto its own project frame
unreg = np.linalg.inv(reg)
# The Capture file's room shell is this room turned 180 deg about the vertical (window wall on the other side; measured:
# glass wall x 0.95 vs 31.64, kitchen-door photo on the z -62.16 end wall vs z +0.05) while its chandeliers are not.
# Shell, carpet and ceiling follow the Capture file (x -> SX - x, z -> SZ - z, sums from the two floors); the hang
# points land on the Capture file's own 63 circles (RMS 0.000 m with the extra shift); chandeliers stay as in both files.
SX, SZ = float(sys.argv[10]), float(sys.argv[11])
def rot180(sx, sz):
    m = np.diag([-1.0, 1.0, -1.0, 1.0]); m[0, 3] = sx; m[2, 3] = sz; return m
ROT = rot180(SX, SZ); ROT_HANG = rot180(SX + 0.132, SZ + 0.361)
new_layers = {}
for i, n in enumerate(pg.j['nodes']):
    if 'mesh' not in n: continue
    name = NAMES[pl[n['extensions']['HIGHASCG_venue']['layer_identifier']]]
    lid = new_layers.setdefault(name, str(uuid.uuid5(uuid.NAMESPACE_URL, 'highascg:gutmanny26:' + name)))
    kind = pl[n['extensions']['HIGHASCG_venue']['layer_identifier']]
    T = np.eye(4) if kind == 'Chandeliers' else (ROT_HANG if kind.startswith('Haki') else ROT)
    out.j['nodes'].append({'name': n.get('name', name), 'mesh': pg.mesh(n['mesh']), 'matrix': (T @ unreg @ pworld(i)).T.reshape(-1).round(7).tolist(),
                           'extensions': {'CAPTURE_model': {'layer_identifier': lid}}})
stats['room_nodes'] = sum(1 for n in pg.j['nodes'] if 'mesh' in n); stats['unregistered_by'] = unreg[:3, 3].round(4).tolist(); stats['room_turned_180_about'] = [SX / 2, SZ / 2]

# ---- the red carpet: 2 m wide, from the catwalk's front edge to 3/4 of the room -----------------------------------
x0, x1, z0, z1, y = [float(v) for v in sys.argv[5:10]]
P = np.array([[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]], np.float32)  # top face, CCW seen from above
Nn = np.tile(np.array([0, 1, 0], np.float32), (4, 1))
UV = np.array([[0, 0], [(x1 - x0), 0], [(x1 - x0), abs(z1 - z0)], [0, abs(z1 - z0)]], np.float32)
I = np.array([0, 2, 1, 0, 3, 2], np.uint16)
def acc(arr, typ, comp, target):
    bv = out.add_bytes(arr.tobytes(), target)
    a = {'bufferView': bv, 'componentType': comp, 'count': len(arr) if arr.ndim > 1 else arr.size, 'type': typ}
    if typ == 'VEC3' and target == 34962: a['min'] = arr.min(0).tolist(); a['max'] = arr.max(0).tolist()
    out.j['accessors'].append(a); return len(out.j['accessors']) - 1
out.j['materials'].append({'name': 'Red carpet', 'doubleSided': True,
    'pbrMetallicRoughness': {'baseColorFactor': [0.42, 0.012, 0.022, 1], 'metallicFactor': 0, 'roughnessFactor': 0.95}})
out.j['meshes'].append({'primitives': [{'attributes': {'POSITION': acc(P, 'VEC3', 5126, 34962), 'NORMAL': acc(Nn, 'VEC3', 5126, 34962),
    'TEXCOORD_0': acc(UV, 'VEC2', 5126, 34962)}, 'indices': acc(I, 'SCALAR', 5123, 34963), 'material': len(out.j['materials']) - 1}]})
lid = new_layers.setdefault('Red carpet', str(uuid.uuid5(uuid.NAMESPACE_URL, 'highascg:gutmanny26:Red carpet')))
out.j['nodes'].append({'name': 'Red carpet', 'mesh': len(out.j['meshes']) - 1, 'extensions': {'CAPTURE_model': {'layer_identifier': lid}}})

out.j['scenes'][0]['nodes'] = list(range(len(out.j['nodes'])))
out.j['asset']['extensions'] = {'CAPTURE_model': {'identifier': cap.j['asset']['extensions']['CAPTURE_model']['identifier'],
    'layers': cap.j['asset']['extensions']['CAPTURE_model']['layers'] + [{'identifier': v, 'name': k} for k, v in new_layers.items()]}}
out.j['asset']['extras'] = {'highascg_build': {'capture': cap_p.split('/')[-1], 'room': pg_p.split('/')[-1], **stats,
    'red_carpet': {'x': [x0, x1], 'z': [z0, z1], 'y': y}}}
used = ['CAPTURE_model'] + (['KHR_texture_transform'] if 'KHR_texture_transform' in json.dumps(out.j['materials']) else [])
out.j['extensionsUsed'] = used
for k in ('textures', 'images', 'samplers'):
    if not out.j[k]: del out.j[k]
while len(out.bin) % 4: out.bin.append(0)
out.j['buffers'] = [{'byteLength': len(out.bin)}]
js = json.dumps(out.j, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
js += b' ' * (-len(js) % 4)
with open(out_p, 'wb') as f:
    f.write(struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(out.bin)))
    f.write(struct.pack('<I4s', len(js), b'JSON')); f.write(js)
    f.write(struct.pack('<I4s', len(out.bin), b'BIN\0')); f.write(out.bin)
print(json.dumps(stats), 'nodes', len(out.j['nodes']), 'meshes', len(out.j['meshes']), 'materials', len(out.j['materials']), 'MB', round((len(js) + len(out.bin)) / 1e6, 1))
