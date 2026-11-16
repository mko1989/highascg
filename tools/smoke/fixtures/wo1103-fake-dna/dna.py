"""WO-1103 test stand-in for Epic's `dna` Python module (OpenRigLogic): the reader calls tools/people/dna_to_glb.py
makes, answered from a JSON file of OUR OWN synthetic character (written by smoke-wo1103-dna-convert.test.js) — never
an excerpt of a real MetaHuman. Only the API shape is Epic's (5.8 headers); the data is invented."""

import json

DataLayer_All = 0
TranslationUnit_cm, TranslationUnit_m = 0, 1
RotationUnit_degrees, RotationUnit_radians = 0, 1
_ok = [True, ""]


class Status:
    @staticmethod
    def isOk():
        return _ok[0]

    @staticmethod
    def get():
        return type("S", (), {"message": _ok[1]})()


class FileStream:
    AccessMode_Read, AccessMode_Write = 1, 2
    OpenMode_Binary = 1

    def __init__(self, path, access, mode):
        self.path = path


class _CS:
    def __init__(self, a):
        self.xAxis, self.yAxis, self.zAxis = a


class BinaryStreamReader:
    def __init__(self, stream, layer):
        self.path = stream.path

    def read(self):
        try:
            with open(self.path) as f:
                self.d = json.load(f)
            _ok[:] = [True, ""]
        except Exception as e:
            _ok[:] = [False, str(e)]

    def getCoordinateSystem(self): return _CS(self.d["axes"])
    def getTranslationUnit(self): return self.d["tunit"]
    def getRotationUnit(self): return self.d["runit"]
    def getRotationSequence(self): return self.d.get("seq", 0)
    def getLODCount(self): return len(self.d["lods"])
    def getMeshIndicesForLOD(self, lod): return self.d["lods"][lod]
    def getJointCount(self): return len(self.d["joints"])
    def getJointName(self, i): return self.d["joints"][i][0]
    def getJointParentIndex(self, i): return self.d["joints"][i][1]
    def getNeutralJointTranslation(self, i): return self.d["joints"][i][2]
    def getNeutralJointRotation(self, i): return self.d["joints"][i][3]
    def _m(self, m): return self.d["meshes"][m]
    def getMeshName(self, m): return self._m(m)["name"]
    def getVertexPositionCount(self, m): return len(self._m(m)["pos"])
    def getVertexPositionXs(self, m): return [p[0] for p in self._m(m)["pos"]]
    def getVertexPositionYs(self, m): return [p[1] for p in self._m(m)["pos"]]
    def getVertexPositionZs(self, m): return [p[2] for p in self._m(m)["pos"]]
    def getVertexTextureCoordinateUs(self, m): return [p[0] for p in self._m(m)["uv"]]
    def getVertexTextureCoordinateVs(self, m): return [p[1] for p in self._m(m)["uv"]]
    def getVertexNormalXs(self, m): return [p[0] for p in self._m(m)["nrm"]]
    def getVertexNormalYs(self, m): return [p[1] for p in self._m(m)["nrm"]]
    def getVertexNormalZs(self, m): return [p[2] for p in self._m(m)["nrm"]]
    def getVertexLayoutPositionIndices(self, m): return [l[0] for l in self._m(m)["layouts"]]
    def getVertexLayoutTextureCoordinateIndices(self, m): return [l[1] for l in self._m(m)["layouts"]]
    def getVertexLayoutNormalIndices(self, m): return [l[2] for l in self._m(m)["layouts"]]
    def getFaceCount(self, m): return len(self._m(m)["faces"])
    def getFaceVertexLayoutIndices(self, m, f): return self._m(m)["faces"][f]
    def getSkinWeightsCount(self, m): return len(self._m(m)["skin"])
    def getSkinWeightsValues(self, m, v): return [w for w, _ in self._m(m)["skin"][v]]
    def getSkinWeightsJointIndices(self, m, v): return [j for _, j in self._m(m)["skin"][v]]
