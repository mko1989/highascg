#!/usr/bin/env python3
"""WO-1103 — a MetaHuman DNA character → one skinned GLB the "bring your own" test puppet loads (human_own.gd).

    dna_to_glb.py <puppet folder> [--lib <dir with the dna module>] [--lod N] [--out <file>]

The folder (~/.local/share/highascg/puppets/<name>/) holds the DNA file(s) of one character — a head and a body DNA
from MetaHuman Creator's DCC export or Fab's "OpenRigLogic Sample Content" — and its textures. The DNA files are read
with Epic's own DNA library (OpenRigLogic, MIT; tools/people/openriglogic_build.sh builds its `dna` Python module per
machine): the neutral joints (local translation + Euler rotation) and, at one LOD, every mesh's positions, UVs,
normals, polygons (fan-triangulated) and skin weights (the 4 heaviest). Head and body joints are merged by name.
Written in metres, Y up, as `<folder>/<name>.converted.glb` (beside the source, so the per-machine exclusions cover it;
delete it to convert again). Neutral face only: the rig's expressions (RigLogic, blend shapes) are not evaluated —
a previs puppet walks, it does not act. Progress: `<folder>/convert.json` {state, progress, step, error, out}.

Built without a real MetaHuman DNA file at hand (WO-1103): the API calls follow the 5.8 headers; the axis / unit /
Euler-order handling follows the descriptor; the triangle winding is chosen by agreement with the stored normals.
Standard library only (no numpy)."""

import argparse
import glob
import json
import math
import os
import struct
import sys
import time

DIRS = {0: (1, 0, 0), 1: (-1, 0, 0), 2: (0, 1, 0), 3: (0, -1, 0), 4: (0, 0, 1), 5: (0, 0, -1)}  # glTF: +X = the model's left
SEQ = ["xyz", "xzy", "yxz", "yzx", "zxy", "zyx"]  # tdm::rot_seq; the first letter is applied first


class Job:
    def __init__(self, folder):
        self.path = os.path.join(folder, "convert.json")
        self.state = {"state": "running", "progress": 0.0, "step": "start", "pid": os.getpid(), "started": time.time()}

    def put(self, **kw):
        self.state.update(kw)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.state, f)
        os.replace(tmp, self.path)


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]


def mat_inv_rigid(m):
    r = [[m[j][i] for j in range(3)] for i in range(3)]  # rotation transposed (a proper rotation; no scale)
    t = [-sum(r[i][k] * m[k][3] for k in range(3)) for i in range(3)]
    return [r[0] + [t[0]], r[1] + [t[1]], r[2] + [t[2]], [0.0, 0.0, 0.0, 1.0]]


def axis_rot(axis, ang):
    c, s = math.cos(ang), math.sin(ang)
    if axis == "x":
        return [[1, 0, 0], [0, c, -s], [0, s, c]]
    if axis == "y":
        return [[c, 0, s], [0, 1, 0], [-s, 0, c]]
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


def m3(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def euler(rx, ry, rz, seq):
    """Rotation matrix of Euler angles (rad) applied in `seq` order (the first letter first): R = R3 · R2 · R1."""
    ang = {"x": rx, "y": ry, "z": rz}
    r = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    for a in seq:
        r = m3(axis_rot(a, ang[a]), r)
    return r


def to_quat(r):
    t = r[0][0] + r[1][1] + r[2][2]
    if t > 0:
        s = math.sqrt(t + 1.0) * 2
        q = [(r[2][1] - r[1][2]) / s, (r[0][2] - r[2][0]) / s, (r[1][0] - r[0][1]) / s, 0.25 * s]
    elif r[0][0] > r[1][1] and r[0][0] > r[2][2]:
        s = math.sqrt(1.0 + r[0][0] - r[1][1] - r[2][2]) * 2
        q = [0.25 * s, (r[0][1] + r[1][0]) / s, (r[0][2] + r[2][0]) / s, (r[2][1] - r[1][2]) / s]
    elif r[1][1] > r[2][2]:
        s = math.sqrt(1.0 + r[1][1] - r[0][0] - r[2][2]) * 2
        q = [(r[0][1] + r[1][0]) / s, 0.25 * s, (r[1][2] + r[2][1]) / s, (r[0][2] - r[2][0]) / s]
    else:
        s = math.sqrt(1.0 + r[2][2] - r[0][0] - r[1][1]) * 2
        q = [(r[0][2] + r[2][0]) / s, (r[1][2] + r[2][1]) / s, 0.25 * s, (r[1][0] - r[0][1]) / s]
    n = math.sqrt(sum(v * v for v in q))
    return [v / n for v in q]


class Frame:
    """The DNA's axes / units → glTF (metres, Y up, the front +Z)."""

    def __init__(self, rd, dna):
        cs = rd.getCoordinateSystem()
        axes = [getattr(cs, "xAxis", 1), getattr(cs, "yAxis", 2), getattr(cs, "zAxis", 4)]
        self.m = [[DIRS[int(a)][i] for a in axes] for i in range(3)]  # columns: where the DNA's x / y / z point
        det = (self.m[0][0] * (self.m[1][1] * self.m[2][2] - self.m[1][2] * self.m[2][1])
               - self.m[0][1] * (self.m[1][0] * self.m[2][2] - self.m[1][2] * self.m[2][0])
               + self.m[0][2] * (self.m[1][0] * self.m[2][1] - self.m[1][1] * self.m[2][0]))
        self.mirror = det < 0
        self.k = 1.0 if int(rd.getTranslationUnit()) == int(getattr(dna, "TranslationUnit_m", 1)) else 0.01
        self.deg = int(rd.getRotationUnit()) != int(getattr(dna, "RotationUnit_radians", 1))
        seq = rd.getRotationSequence() if hasattr(rd, "getRotationSequence") else 0
        self.seq = SEQ[int(seq)] if 0 <= int(seq) < 6 else "xyz"
        sign = rd.getRotationSign() if hasattr(rd, "getRotationSign") else None
        self.sign = [float(getattr(sign, a, 1) or 1) for a in "xyz"] if sign is not None else [1.0, 1.0, 1.0]

    def p(self, v):
        return [self.k * sum(self.m[i][j] * v[j] for j in range(3)) for i in range(3)]

    def d(self, v):  # a direction (normals)
        return [sum(self.m[i][j] * v[j] for j in range(3)) for i in range(3)]

    def local(self, t, r):
        """A joint's neutral local transform (DNA translation + Euler) as a glTF 4×4."""
        f = math.pi / 180.0 if self.deg else 1.0
        rs = euler(r[0] * f * self.sign[0], r[1] * f * self.sign[1], r[2] * f * self.sign[2], self.seq)
        rg = m3(m3(self.m, rs), [[self.m[j][i] for j in range(3)] for i in range(3)])  # M R Mᵀ (M orthonormal)
        tg = self.p(t)
        return [rg[0] + [tg[0]], rg[1] + [tg[1]], rg[2] + [tg[2]], [0.0, 0.0, 0.0, 1.0]]


def read(path, dna):
    stream = dna.FileStream(path, dna.FileStream.AccessMode_Read, dna.FileStream.OpenMode_Binary)
    layer = getattr(dna, "DataLayer_GeometryWithoutBlendShapes", getattr(dna, "DataLayer_All"))
    rd = dna.BinaryStreamReader(stream, layer)
    rd.read()
    if not dna.Status.isOk():
        raise RuntimeError("cannot read %s: %s" % (path, dna.Status.get().message))
    return rd


def joints_of(rd, fr):
    out = []
    for i in range(rd.getJointCount()):
        p = rd.getJointParentIndex(i)
        out.append({"name": rd.getJointName(i), "parent": rd.getJointName(p) if p != i else None,
                    "local": fr.local(list(rd.getNeutralJointTranslation(i)), list(rd.getNeutralJointRotation(i)))})
    return out


def mesh_of(rd, fr, m, jindex, names):
    """One DNA mesh → glTF arrays: positions / normals / uvs / joints / weights per vertex layout, triangles."""
    xs, ys, zs = rd.getVertexPositionXs(m), rd.getVertexPositionYs(m), rd.getVertexPositionZs(m)
    us, vs = rd.getVertexTextureCoordinateUs(m), rd.getVertexTextureCoordinateVs(m)
    nx, ny, nz = rd.getVertexNormalXs(m), rd.getVertexNormalYs(m), rd.getVertexNormalZs(m)
    lp, lt, ln = rd.getVertexLayoutPositionIndices(m), rd.getVertexLayoutTextureCoordinateIndices(m), rd.getVertexLayoutNormalIndices(m)
    skin = []
    for v in range(rd.getVertexPositionCount(m)):
        w = list(rd.getSkinWeightsValues(m, v)) if v < rd.getSkinWeightsCount(m) else []
        j = list(rd.getSkinWeightsJointIndices(m, v)) if w else []
        top = sorted(zip(w, j), reverse=True)[:4] or [(1.0, 0)]
        s = sum(a for a, _ in top) or 1.0
        top = [(a / s, jindex[names[b]]) for a, b in top] + [(0.0, 0)] * (4 - len(top))
        skin.append(top)
    pos, nrm, uv, jn, wt = [], [], [], [], []
    for i in range(len(lp)):
        p, t, n = lp[i], lt[i], ln[i]
        pos.append(fr.p([xs[p], ys[p], zs[p]]))
        d = fr.d([nx[n], ny[n], nz[n]])
        ln_ = math.sqrt(sum(c * c for c in d)) or 1.0
        nrm.append([c / ln_ for c in d])
        uv.append([us[t], 1.0 - vs[t]])
        jn.append([b for _, b in skin[p]])
        wt.append([a for a, _ in skin[p]])
    tris = []
    for f in range(rd.getFaceCount(m)):
        poly = list(rd.getFaceVertexLayoutIndices(m, f))
        for k in range(1, len(poly) - 1):
            tris.append((poly[0], poly[k], poly[k + 1]))
    agree = 0.0  # the winding the stored normals agree with (glTF fronts are counter-clockwise)
    for a, b, c in tris[:: max(len(tris) // 4000, 1)]:
        e1 = [pos[b][i] - pos[a][i] for i in range(3)]
        e2 = [pos[c][i] - pos[a][i] for i in range(3)]
        cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
        agree += sum(cr[i] * (nrm[a][i] + nrm[b][i] + nrm[c][i]) for i in range(3))
    if agree < 0:
        tris = [(a, c, b) for a, b, c in tris]
    return {"pos": pos, "nrm": nrm, "uv": uv, "jn": jn, "wt": wt, "tris": tris}


def material_name(mesh_name):
    """head_lod1_mesh → head (texture matching in human_own_tex.gd goes by these words)."""
    n = mesh_name.lower()
    for cut in ["_lod", "lod"]:
        if cut in n:
            n = n[: n.index(cut)]
    return n.rstrip("_") or mesh_name


class Glb:
    def __init__(self):
        self.bin = bytearray()
        self.views, self.accs = [], []

    def acc(self, fmt, rows, typ, comp, target=None, minmax=False):
        while len(self.bin) % 4:
            self.bin.append(0)
        off = len(self.bin)
        for r in rows:
            self.bin += struct.pack("<" + fmt * (len(r) if isinstance(r, (list, tuple)) else 1), *(r if isinstance(r, (list, tuple)) else [r]))
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(self.bin) - off}
        if target:
            v["target"] = target
        self.views.append(v)
        a = {"bufferView": len(self.views) - 1, "componentType": comp, "count": len(rows), "type": typ}
        if minmax:
            a["min"] = [min(r[i] for r in rows) for i in range(3)]
            a["max"] = [max(r[i] for r in rows) for i in range(3)]
        self.accs.append(a)
        return len(self.accs) - 1


def skeleton(readers):
    """The joints of every DNA merged by name (the body DNA — most non-facial joints — first), their globals."""
    joints, jindex = [], {}
    for f, rd, fr in readers:
        for j in joints_of(rd, fr):
            if j["name"] not in jindex:
                jindex[j["name"]] = len(joints)
                joints.append(j)
    for j in joints:
        j["children"] = []
    roots = []
    for i, j in enumerate(joints):
        (joints[jindex[j["parent"]]]["children"] if j["parent"] in jindex else roots).append(i)
    glob_ = [None] * len(joints)

    def walk(i, parent):
        glob_[i] = mat_mul(parent, joints[i]["local"])
        for c in joints[i]["children"]:
            walk(c, glob_[i])
    for r in roots:
        walk(r, [[1.0, 0, 0, 0], [0, 1.0, 0, 0], [0, 0, 1.0, 0], [0, 0, 0, 1.0]])
    return joints, jindex, roots, glob_


def mirrored(joints, glob_):
    """True if the character came out mirrored: its left joints (…_l) not on the side up × front points to (glTF: the
    front is where the feet point, ball_l − foot_l; with Y up and the front +Z, the left is +X)."""
    at = {j["name"].lower(): [glob_[i][r][3] for r in range(3)] for i, j in enumerate(joints)}
    if not all(k in at for k in ("foot_l", "ball_l")):
        return False
    lx = [v[0] for k, v in at.items() if k.endswith("_l")]
    rx = [v[0] for k, v in at.items() if k.endswith("_r")]
    if not lx or not rx:
        return False
    front = [at["ball_l"][i] - at["foot_l"][i] for i in range(3)]
    left = [front[2], 0.0, -front[0]]  # Y × front
    side = sum(lx) / len(lx) - sum(rx) / len(rx)
    return side * left[0] < 0


def convert(folder, dna, lod, out, job):
    files = sorted(glob.glob(os.path.join(folder, "**", "*.dna"), recursive=True))
    if not files:
        raise RuntimeError("no .dna file in %s" % folder)
    readers = []
    for i, f in enumerate(files):
        job.put(step="reading %s" % os.path.basename(f), progress=0.05 + 0.35 * i / len(files))
        rd = read(f, dna)
        readers.append((f, rd, Frame(rd, dna)))
    readers.sort(key=lambda r: -sum(1 for i in range(r[1].getJointCount()) if not r[1].getJointName(i).upper().startswith("FACIAL")))
    joints, jindex, roots, glob_ = skeleton(readers)
    if mirrored(joints, glob_):  # "x: right" declared from the other side: the left joints came out on the right
        for _, _, fr in readers:
            fr.m[0] = [-v for v in fr.m[0]]
        joints, jindex, roots, glob_ = skeleton(readers)
    g = Glb()
    meshes, mats = [], []
    used = []
    for n, (f, rd, fr) in enumerate(readers):
        lods = rd.getLODCount()
        pick = min(lod, lods - 1)
        names = [rd.getJointName(i) for i in range(rd.getJointCount())]
        ids = list(rd.getMeshIndicesForLOD(pick))
        for k, m in enumerate(ids):
            job.put(step="mesh %s (LOD %d)" % (rd.getMeshName(m), pick), progress=0.4 + 0.5 * (n + k / max(len(ids), 1)) / len(readers))
            mm = mesh_of(rd, fr, m, jindex, names)
            if not mm["tris"]:
                continue
            mat = material_name(rd.getMeshName(m))
            if mat not in mats:
                mats.append(mat)
            prim = {"attributes": {
                "POSITION": g.acc("f", mm["pos"], "VEC3", 5126, 34962, True),
                "NORMAL": g.acc("f", mm["nrm"], "VEC3", 5126, 34962),
                "TEXCOORD_0": g.acc("f", mm["uv"], "VEC2", 5126, 34962),
                "JOINTS_0": g.acc("H", mm["jn"], "VEC4", 5123, 34962),
                "WEIGHTS_0": g.acc("f", mm["wt"], "VEC4", 5126, 34962)},
                "indices": g.acc("I", [i for t in mm["tris"] for i in t], "SCALAR", 5125, 34963),
                "material": mats.index(mat)}
            meshes.append({"name": rd.getMeshName(m), "primitives": [prim]})
            used.append(len(mm["tris"]))
    job.put(step="writing", progress=0.92)
    nodes = []
    for j in joints:
        q = to_quat([row[:3] for row in j["local"][:3]])
        nodes.append({"name": j["name"], "translation": [j["local"][i][3] for i in range(3)], "rotation": q, "children": j["children"]})
    ibm = g.acc("f", [[mat_inv_rigid(m_)[r][c] for c in range(4) for r in range(4)] for m_ in glob_], "MAT4", 5126)
    skin = {"joints": list(range(len(joints))), "inverseBindMatrices": ibm, "skeleton": roots[0]}
    first_mesh = len(nodes)
    for i, m in enumerate(meshes):
        nodes.append({"name": m["name"], "mesh": i, "skin": 0})
    doc = {"asset": {"version": "2.0", "generator": "HighAsCG dna_to_glb.py (WO-1103)"},
           "scene": 0, "scenes": [{"nodes": roots + list(range(first_mesh, len(nodes)))}], "nodes": nodes, "meshes": meshes,
           "skins": [skin], "materials": [{"name": m, "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 0.6}} for m in mats],
           "accessors": g.accs, "bufferViews": g.views, "buffers": [{"byteLength": len(g.bin)}]}
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    while len(g.bin) % 4:
        g.bin.append(0)
    body = struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(g.bin), b"BIN\0") + bytes(g.bin)
    tmp = out + ".tmp"
    with open(tmp, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)
    os.replace(tmp, out)
    return {"joints": len(joints), "meshes": len(meshes), "triangles": sum(used), "dna": [os.path.basename(f) for f, _, _ in readers]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("folder")
    ap.add_argument("--lib", default=os.path.expanduser("~/.local/share/highascg/openriglogic/lib"))
    ap.add_argument("--lod", type=int, default=1, help="mesh LOD (0 = finest; default 1)")
    ap.add_argument("--out", default="")
    a = ap.parse_args(argv)
    folder = os.path.abspath(a.folder)
    job = Job(folder)
    out = a.out or os.path.join(folder, os.path.basename(folder.rstrip("/")) + ".converted.glb")
    try:
        job.put(step="loading the DNA library", progress=0.01)
        sys.path.insert(0, a.lib)
        try:
            import dna  # noqa: E402 — Epic's module, built per machine by openriglogic_build.sh
        except ImportError as e:
            raise RuntimeError("the DNA library is not built on this machine (%s) — run tools/people/openriglogic_build.sh" % e)
        info = convert(folder, dna, a.lod, out, job)
        job.put(state="done", progress=1.0, step="done", out=out, **info)
        print(json.dumps(job.state))
        return 0
    except Exception as e:  # the GUI shows it
        job.put(state="failed", step="failed", error=str(e))
        print("dna_to_glb: %s" % e, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
