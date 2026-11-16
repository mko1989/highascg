# WO-1103 — build one MakeHuman/MPFB human (CC0 assets) and export a skinned GLB with LOD0 + LOD1 meshes.
# blender -b --python build_human.py -- <spec.json> <out.glb>
import bpy, sys, json, os, bmesh
argv = sys.argv[sys.argv.index("--") + 1:]
spec = json.load(open(argv[0]))
out = argv[1]
from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.exportservice import ExportService
from bl_ext.user_default.mpfb.services.assetservice import AssetService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

def find(frag, sub):
    p = AssetService.find_asset_absolute_path(frag, asset_subdir=sub)
    assert p, (frag, sub)
    return p

def make(lod):
    macro = TargetService.get_default_macro_info_dict()
    macro.update({k: v for k, v in spec["macro"].items() if k != "race"})
    macro["race"] = spec["macro"]["race"]
    base = HumanService.create_human(macro_detail_dict=macro)
    for t in spec.get("targets", []):  # [name, path-fragment, weight]
        TargetService.load_target(base, t[0], weight=t[1], name=os.path.basename(t[0]).replace(".target.gz", ""))
    rig = HumanService.add_builtin_rig(base, "game_engine")
    if lod == 1:
        prox = HumanService.add_mhclo_asset(find(spec["proxy"], "proxymeshes"), base, asset_type="Proxymeshes", subdiv_levels=0, material_type="NONE")
        m = base.modifiers.new("Hide base mesh", "MASK"); m.vertex_group = "body"; m.invert_vertex_group = True
    parts = {}
    for kind, frag in spec["bodyparts"]:
        if lod == 1 and kind in ("eyes",):
            frag = spec.get("eyes_lod1", frag)
        parts[kind] = HumanService.add_mhclo_asset(find(frag, kind), base, asset_type=kind, subdiv_levels=0, material_type="GAMEENGINE")
    for frag in spec["clothes"]:
        parts[frag] = HumanService.add_mhclo_asset(find(frag, "clothes"), base, asset_type="Clothes", subdiv_levels=0, material_type="GAMEENGINE")
    HumanService.set_character_skin(find(spec["skin"], "skins"), base, skin_type="GAMEENGINE")
    ExportService.bake_modifiers_remove_helpers(base, bake_masks=True, remove_helpers=True, also_proxy=True)
    return base, rig

def objs_of(rig):
    return [o for o in bpy.data.objects if o.type == "MESH" and (o.parent == rig or (o.parent and o.parent.parent == rig))]

base0, rig0 = make(0)
rig0.name = "rig"
lod0 = objs_of(rig0)
for o in lod0:
    o.name = "lod0_" + o.name.split(".")[-1]
base1, rig1 = make(1)
lod1 = objs_of(rig1)
for o in lod1:
    o.name = "lod1_" + o.name.split(".")[-1]
    for m in o.modifiers:
        if m.type == "ARMATURE":
            m.object = rig0
    mw = o.matrix_world.copy()
    o.parent = rig0
    o.matrix_world = mw
bpy.data.objects.remove(rig1, do_unlink=True)
# drop invisible body (LOD1 basemesh is masked away entirely) and non-wanted parts
for o in list(bpy.data.objects):
    if o.type != "MESH":
        continue
    for m in list(o.modifiers):
        if m.type in ("MASK",):
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=m.name)
    if len(o.data.polygons) == 0:
        bpy.data.objects.remove(o, do_unlink=True)
for o in list(bpy.data.objects):
    if o.name == "lod1_Human":
        bpy.data.objects.remove(o, do_unlink=True)
ROLE = spec["roles"]  # asset fragment (object name suffix) -> role name (material name)
def role_of(o):
    suf = o.name.split("_", 1)[1]
    if suf == "Human" or suf == spec["proxy"].replace(".proxy", ""):
        return "skin"
    return ROLE.get(suf, suf)
mats = {}
tex = {}
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    r = role_of(o)
    m = o.data.materials[0]
    if r not in mats:
        m.name = r
        mats[r] = m
        imgs = {}
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image:
                imgs[n.label or n.name] = bpy.path.abspath(n.image.filepath)
        tex[r] = imgs
    o.data.materials[0] = mats[r]
    o.name = o.name.split("_", 1)[0] + "_" + r
    o.data.name = o.name
def decimate(o, ratio, protect=None):
    if ratio >= 1.0:
        return
    bpy.context.view_layer.objects.active = o
    if o.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    d = o.modifiers.new("dec", "DECIMATE")
    d.decimate_type = "COLLAPSE"
    d.ratio = ratio
    d.use_collapse_triangulate = True
    if protect and protect in o.vertex_groups:
        d.vertex_group = protect
        d.invert_vertex_group = True
        d.vertex_group_factor = 1.0
    o.modifiers.move(len(o.modifiers) - 1, 0)
    bpy.ops.object.modifier_apply(modifier="dec")
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    lod, r = o.name.split("_", 1)
    ratio = spec["decimate"][lod].get(r, 1.0)
    decimate(o, ratio, "head" if r == "skin" and lod == "lod0" else None)
for o in [o for o in bpy.data.objects if o.type == "MESH"]:
    bpy.context.view_layer.objects.active = o
    if o.data.shape_keys:
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    if o.name == "lod1_eyelashes":
        bpy.data.objects.remove(o, do_unlink=True)
def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)
stats = {o.name: tris(o) for o in bpy.data.objects if o.type == "MESH"}
lo, hi = 9e9, -9e9
for o in bpy.data.objects:
    if o.type == "MESH" and o.name.startswith("lod0"):
        for v in o.data.vertices:
            z = (o.matrix_world @ v.co).z
            lo, hi = min(lo, z), max(hi, z)
json.dump({"tex": tex, "tris": stats, "height_m": hi - lo, "bones": len(bpy.data.objects["rig"].data.bones)}, open(out.replace(".glb", ".stats.json"), "w"), indent=1)
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="NONE", export_animations=False, export_skins=True,
    export_morph=False, export_apply=False, export_yup=True, export_texcoords=True, export_normals=True, export_tangents=True)
print("OBJECTS", [(o.name, o.type, len(o.data.polygons) if o.type == "MESH" else 0, [m.name for m in getattr(o.data, "materials", [])]) for o in bpy.data.objects])
bpy.ops.wm.save_as_mainfile(filepath=out.replace(".glb", ".blend"))
