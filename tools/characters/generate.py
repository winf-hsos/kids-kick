"""
Erzeugt die Spielerfiguren (Kinder, 8–11 Jahre) als GLB-Dateien.

Ablauf je Spielertyp:
  1. Körper mit MakeHuman/MPFB erzeugen (Alter, Geschlecht, Größe, Statur, Herkunft)
  2. Mixamo-kompatibles Skelett, Haare, Augenbrauen, Augen und Schuhe anlegen
  3. Trikot, Hose und Stutzen als eng anliegende Hüllen aus dem Körper ableiten
  4. Animationen (Stehen, Gehen, Laufen) vom Mixamo-Modell übertragen
  5. Als GLB exportieren und Kennwerte in players.json schreiben

Aufruf (siehe README.md in diesem Ordner):
  python generate.py --out ../../public/models/players [--only kid01]
"""

import argparse
import json
import math
import os
import sys
import tempfile

import bpy  # muss vor addon_utils/bmesh importiert werden
import addon_utils
import bmesh
from mathutils import Vector
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from retarget import retarget_action  # noqa: E402

ASSETS = os.environ.get("MH_ASSETS", os.path.expanduser("~/.kids-kick-tools/mhassets/data"))
ANIM_SOURCE = os.path.join(HERE, "source", "Xbot.glb")
ANIMATIONS = ["idle", "walk", "run"]

# Haarfarben (sRGB 0..1)
HAIR = {
    "black": (0.08, 0.07, 0.06),
    "darkbrown": (0.22, 0.14, 0.08),
    "brown": (0.38, 0.25, 0.14),
    "darkblond": (0.55, 0.42, 0.25),
    "blond": (0.85, 0.70, 0.42),
    "red": (0.62, 0.28, 0.12),
}

# Spielertypen. Größe in Metern, Alter in Jahren.
VARIANTS = [
    dict(id="kid01", label="Ben", gender="m", years=10, height=1.40, weight=0.5, race="caucasian",
         skin="young_caucasian_male", hair="short02", hair_color="brown", eyes="brown", brows="eyebrow001"),
    dict(id="kid02", label="Malik", gender="m", years=10, height=1.43, weight=0.45, race="african",
         skin="young_african_male", hair="short04", hair_color="black", eyes="brown", brows="eyebrow006"),
    dict(id="kid03", label="Lena", gender="f", years=10, height=1.38, weight=0.45, race="caucasian",
         skin="young_caucasian_female", hair="ponytail01", hair_color="blond", eyes="blue", brows="eyebrow010"),
    dict(id="kid04", label="Kenji", gender="m", years=9, height=1.32, weight=0.5, race="asian",
         skin="young_asian_male", hair="short01", hair_color="black", eyes="brown", brows="eyebrow002"),
    dict(id="kid05", label="Paul", gender="m", years=9, height=1.30, weight=0.55, race="caucasian",
         skin="young_caucasian_male2", hair="short03", hair_color="blond", eyes="lightblue", brows="eyebrow003"),
    dict(id="kid06", label="Amara", gender="f", years=10, height=1.41, weight=0.45, race="african",
         skin="young_african_female", hair="afro01", hair_color="black", eyes="brown", brows="eyebrow011"),
    dict(id="kid07", label="Finn", gender="m", years=11, height=1.46, weight=0.5, race="caucasian",
         skin="young_caucasian_male", hair="short01", hair_color="red", eyes="green", brows="eyebrow004"),
    dict(id="kid08", label="Mei", gender="f", years=9, height=1.33, weight=0.45, race="asian",
         skin="young_asian_female", hair="bob01", hair_color="black", eyes="brown", brows="eyebrow012"),
    dict(id="kid09", label="Jonas", gender="m", years=10, height=1.37, weight=0.6, race="caucasian",
         skin="young_caucasian_male2", hair="short02", hair_color="darkblond", eyes="grey", brows="eyebrow005"),
    dict(id="kid10", label="Emre", gender="m", years=10, height=1.39, weight=0.5, race="caucasian",
         skin="young_caucasian_male", hair="short04", hair_color="darkbrown", eyes="brownlight", brows="eyebrow007"),
]


# ---------------------------------------------------------------------------
# Hilfsfunktionen
# ---------------------------------------------------------------------------

def mpfb():
    addon_utils.enable("bl_ext.user_default.mpfb", default_set=True)
    from bl_ext.user_default.mpfb.services.humanservice import HumanService
    from bl_ext.user_default.mpfb.services.targetservice import TargetService
    return HumanService, TargetService


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_height(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    zs = [(ev.matrix_world @ v.co).z for v in ev.data.vertices]
    return max(zs) - min(zs)


def create_body(v):
    """Erzeugt den Körper und passt den Größen-Regler an, bis die Zielgröße erreicht ist."""
    HumanService, TargetService = mpfb()
    race = {"african": 0.0, "asian": 0.0, "caucasian": 0.0}
    race[v["race"]] = 1.0

    def make(height_param):
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        macro = TargetService.get_default_macro_info_dict()
        # MakeHuman: Alter 0 = 1 Jahr, 0.1875 = 11 Jahre (linear dazwischen)
        macro["age"] = (v["years"] - 1) / 10 * 0.1875
        macro["gender"] = 1.0 if v["gender"] == "m" else 0.0
        macro["weight"] = v["weight"]
        macro["muscle"] = 0.5
        macro["height"] = height_param
        macro["race"] = race
        return HumanService.create_human(macro_detail_dict=macro, scale=0.1)

    lo, hi = 0.0, 1.0
    body = None
    for _ in range(7):
        mid = (lo + hi) / 2
        body = make(mid)
        h = mesh_height(body)
        if h < v["height"]:
            lo = mid
        else:
            hi = mid
    return body


def add_asset(body, path, asset_type):
    HumanService, _ = mpfb()
    return HumanService.add_mhclo_asset(path, body, asset_type=asset_type, subdiv_levels=0,
                                        material_type="MAKESKIN")


def bake_body(body):
    """Shape Keys einbacken und Hilfsgeometrie (MakeHuman-Helfer) entfernen."""
    if body.data.shape_keys:
        mix_key = body.shape_key_add(name="__mix", from_mix=True)
        mix = [d.co.copy() for d in mix_key.data]
        for k in list(body.data.shape_keys.key_blocks):
            body.shape_key_remove(k)
        for vert, co in zip(body.data.vertices, mix):
            vert.co = co
    for m in list(body.modifiers):
        if m.type == "MASK":
            body.modifiers.remove(m)

    gi = body.vertex_groups["body"].index
    bm = bmesh.new()
    bm.from_mesh(body.data)
    deform = bm.verts.layers.deform.active
    helpers = [vt for vt in bm.verts if gi not in vt[deform]]
    bmesh.ops.delete(bm, geom=helpers, context="VERTS")
    bm.to_mesh(body.data)
    bm.free()


# ---------------------------------------------------------------------------
# Kleidung
# ---------------------------------------------------------------------------

def side_free(name):
    return name.split(":")[-1].replace("Left", "").replace("Right", "")


def classify_vertices(body, rig):
    """Ordnet jedem Vertex einen Bereich zu: shirt, shorts, socks, foot oder skin."""
    bones = rig.data.bones
    bone_names = {b.name for b in bones}
    group_bone = {g.index: g.name for g in body.vertex_groups if g.name in bone_names}

    hips_z = bones["mixamorig:Hips"].head_local.z
    height = max(vt.co.z for vt in body.data.vertices)
    shirt_bottom = hips_z - 0.025 * height / 1.4
    shorts_top = hips_z + 0.075 * height / 1.4

    def param(vco, bone):
        h, t = bone.head_local, bone.tail_local
        d = t - h
        return (vco - h).dot(d) / d.length_squared

    region = {}
    tparam = {}
    for vt in body.data.vertices:
        best, bw = None, 0.0
        for g in vt.groups:
            if g.group in group_bone and g.weight > bw:
                best, bw = group_bone[g.group], g.weight
        part = side_free(best) if best else "Hips"
        z = vt.co.z
        r = "skin"
        if part in ("Neck", "Head") or part.startswith("Hand") or part in ("ForeArm",):
            r = "skin"
        elif part == "Arm":
            t = param(vt.co, bones[best])
            r = "shirt" if t < 0.48 else "skin"
            tparam[vt.index] = t
        elif part == "UpLeg":
            t = param(vt.co, bones[best])
            r = "shorts" if t < 0.5 else "skin"
            tparam[vt.index] = t
        elif part == "Leg":
            t = param(vt.co, bones[best])
            r = "socks" if t > 0.16 else "skin"
        elif part in ("Foot", "ToeBase"):
            r = "foot"
        else:  # Rumpf
            r = "shirt" if z >= shirt_bottom else "shorts"
            if r == "shirt" and z < shorts_top:
                r = "shirt+shorts"
        region[vt.index] = r
    return region, tparam, dict(shirt_bottom=shirt_bottom, shorts_top=shorts_top, hips_z=hips_z)


def make_shell(body, verts_in, name, offset_fn, hem_fn=None, smooth=0):
    """Kopiert die Flächen, deren Vertices alle in verts_in liegen, als eigenes Objekt
    und schiebt sie entlang der Normalen nach außen. Gewichte bleiben erhalten.
    hem_fn(vert) liefert für Randvertices eine begradigte Position (Saum), smooth glättet
    Körperdetails weg, damit der Stoff nicht wie aufgemalt wirkt."""
    shell = body.copy()
    shell.data = body.data.copy()
    shell.name = shell.data.name = name
    bpy.context.collection.objects.link(shell)
    shell.modifiers.clear()
    for m in body.modifiers:
        if m.type == "ARMATURE":
            mod = shell.modifiers.new("Armature", "ARMATURE")
            mod.object = m.object

    bm = bmesh.new()
    bm.from_mesh(shell.data)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    drop = [f for f in bm.faces if not all(vt.index in verts_in for vt in f.verts)]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    loose = [vt for vt in bm.verts if not vt.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    deform = bm.verts.layers.deform.active
    if hem_fn:
        for vt in bm.verts:
            if vt.is_boundary:
                co = hem_fn(vt, deform)
                if co is not None:
                    vt.co = co
    if smooth:
        inner = [vt for vt in bm.verts if not vt.is_boundary]
        for _ in range(smooth):
            bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.normal_update()
    offsets = [offset_fn(vt) for vt in bm.verts]
    for vt, d in zip(bm.verts, offsets):
        vt.co += vt.normal * d
    bm.to_mesh(shell.data)
    bm.free()
    shell.data.materials.clear()
    return shell


def delete_covered(body, covered):
    """Entfernt Körperflächen unter der Kleidung (verhindert Durchstechen beim Animieren).
    Am Rand bleibt ein Ring stehen, damit keine Lücken entstehen."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    inside = {vt.index for vt in bm.verts if vt.index in covered}
    border = set()
    for vt in bm.verts:
        if vt.index in inside and any(e.other_vert(vt).index not in inside for e in vt.link_edges):
            border.add(vt.index)
    core = inside - border
    drop = [f for f in bm.faces if all(vt.index in core for vt in f.verts)]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(body.data)
    bm.free()


def jersey_uv(shell, z0, z1):
    """Zylinder-Projektion um den Rumpf, so dass Schrift von außen lesbar ist:
    u = 0.25 Rückenmitte, 0.5 rechte Seite, 0.75 Brustmitte, Naht an der linken Seite.
    v = 0 Saum, 1 Halsansatz (im glTF ist v gespiegelt: oben im Bild = Hals)."""
    me = shell.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            theta = math.atan2(-co.y, co.x)
            us.append(((1.0 - theta / (2 * math.pi)) % 1.0, (co.z - z0) / (z1 - z0)))
        umin = min(u for u, _ in us)
        umax = max(u for u, _ in us)
        for li, (u, vv) in zip(poly.loop_indices, us):
            if umax - umin > 0.5 and u < 0.5:
                u += 1.0
            uv.data[li].uv = (u, vv)


def build_clothes(body, rig):
    region, tparam, levels = classify_vertices(body, rig)
    shirt = {i for i, r in region.items() if r in ("shirt", "shirt+shorts")}
    shorts = {i for i, r in region.items() if r in ("shorts", "shirt+shorts")}
    socks = {i for i, r in region.items() if r == "socks"}
    feet = {i for i, r in region.items() if r == "foot"}

    bones = rig.data.bones
    group_names = {g.index: g.name for g in body.vertex_groups}

    def dominant(vt, deform):
        best, bw = None, 0.0
        for gi, w in vt[deform].items():
            n = group_names.get(gi)
            if n in bones and w > bw:
                best, bw = n, w
        return best

    def limb_hem(part, t0):
        """Saum quer zum Knochen bei Parameter t0 (0 = Gelenkanfang, 1 = Gelenkende)."""
        def fn(vt, deform):
            b = dominant(vt, deform)
            if b is None or side_free(b) != part:
                # Nachbarknochen: auf den passenden Knochen derselben Seite abbilden
                side = "Left" if vt.co.x > 0 else "Right"
                b = f"mixamorig:{side}{part}"
            h, tl = bones[b].head_local, bones[b].tail_local
            d = tl - h
            t = (vt.co - h).dot(d) / d.length_squared
            if abs(t - t0) > 0.25:
                return None
            return vt.co + d * (t0 - t)
        return fn

    def shirt_hem(vt, deform):
        b = dominant(vt, deform)
        if b and side_free(b) == "Arm":
            return limb_hem("Arm", 0.48)(vt, deform)
        if vt.co.z < levels["shirt_bottom"] + 0.04:
            co = vt.co.copy()
            co.z = levels["shirt_bottom"]
            return co
        return None

    def shorts_hem(vt, deform):
        if vt.co.z > levels["shorts_top"] - 0.03:
            return None
        return limb_hem("UpLeg", 0.5)(vt, deform)

    shirt_obj = make_shell(body, shirt, "Jersey", lambda vt: 0.014, shirt_hem, smooth=4)
    shorts_obj = make_shell(
        body, shorts, "Shorts",
        lambda vt: 0.011 + 0.03 * max(0.0, tparam.get(vt.index, 0.0)),
        shorts_hem, smooth=8,
    )
    socks_obj = make_shell(body, socks, "Socks", lambda vt: 0.0075, limb_hem("Leg", 0.16), smooth=2)

    neck_z = rig.data.bones["mixamorig:Neck"].head_local.z
    jersey_uv(shirt_obj, levels["shirt_bottom"], neck_z)

    delete_covered(body, shirt | shorts | socks | feet)
    return shirt_obj, shorts_obj, socks_obj


def trim_boots(shoes, rig):
    """Der MakeHuman-Schuh hat einen kurzen Socken-Schaft; der würde aus unseren Stutzen
    herausschauen. Alles oberhalb des Knöchels wird entfernt."""
    ankle_z = max(rig.data.bones[f"mixamorig:{s}Foot"].head_local.z for s in ("Left", "Right"))
    bm = bmesh.new()
    bm.from_mesh(shoes.data)
    drop = [f for f in bm.faces if any(vt.co.z > ankle_z + 0.02 for vt in f.verts)]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(shoes.data)
    bm.free()


# ---------------------------------------------------------------------------
# Materialien
# ---------------------------------------------------------------------------

def read_mhmat_texture(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("diffuseTexture "):
                return os.path.join(os.path.dirname(path), line.split(" ", 1)[1].strip())
    return None


def prepare_image(src, size, tmpdir, name, *, tint=None, grayscale=False, fmt="PNG"):
    im = Image.open(src)
    has_alpha = im.mode in ("RGBA", "LA")
    im = im.convert("RGBA" if has_alpha else "RGB")
    im = im.resize((size, size), Image.LANCZOS)
    if grayscale or tint:
        alpha = im.getchannel("A") if has_alpha else None
        g = ImageOps.grayscale(im)
        g = ImageOps.autocontrast(g, cutoff=1)
        if tint:
            # Graustufen -> Haarfarbe (dunkle Strähnen dunkler, helle Spitzen heller)
            dark = tuple(int(c * 255 * 0.35) for c in tint)
            light = tuple(min(255, int(c * 255 * 1.35 + 20)) for c in tint)
            im = ImageOps.colorize(g, dark, light, mid=tuple(int(c * 255) for c in tint))
        else:
            im = g.convert("RGB")
        if alpha:
            im = im.convert("RGBA")
            im.putalpha(alpha)
    ext = "png" if fmt == "PNG" or im.mode == "RGBA" else "jpg"
    out = os.path.join(tmpdir, f"{name}.{ext}")
    if ext == "jpg":
        im.save(out, quality=88)
    else:
        im.save(out)
    img = bpy.data.images.load(out)
    img.name = name
    img.pack()
    return img


def make_material(name, *, color=(1, 1, 1), image=None, alpha_clip=False, roughness=0.6, double_sided=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if image is not None:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = image
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_clip:
            nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    mat.use_backface_culling = not double_sided
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.material_index = 0


# ---------------------------------------------------------------------------
# Kennwerte der Animationen
# ---------------------------------------------------------------------------

def natural_speed(rig, action, foot="mixamorig:LeftToeBase"):
    """Bodengeschwindigkeit, bei der die Animation ohne Fußrutschen aussieht (m/s)."""
    scene = bpy.context.scene
    for t in rig.animation_data.nla_tracks:
        t.mute = True
    rig.animation_data.action = action
    if len(action.slots):
        rig.animation_data.action_slot = action.slots[0]
    f0, f1 = action.frame_range
    pts = []
    for f in range(int(f0), int(f1) + 1):
        scene.frame_set(f)
        p = rig.matrix_world @ rig.pose.bones[foot].head
        pts.append(p)
    rig.animation_data.action = None
    for t in rig.animation_data.nla_tracks:
        t.mute = False
    fps = 30.0
    zmin = min(p.z for p in pts)
    speeds = []
    for a, b in zip(pts, pts[1:]):
        if a.z < zmin + 0.012 and b.z < zmin + 0.012:
            # Figur schaut nach -Y; Standbein wandert nach +Y
            speeds.append((b.y - a.y) * fps)
    speeds = sorted(s for s in speeds if s > 0)
    return round(speeds[len(speeds) // 2], 3) if speeds else None


# ---------------------------------------------------------------------------
# Hauptablauf
# ---------------------------------------------------------------------------

def build_variant(v, out_dir, tmpdir):
    HumanService, _ = mpfb()
    reset_scene()
    mpfb()
    body = create_body(v)
    body.name = "Body"
    rig = HumanService.add_builtin_rig(body, "mixamo")
    rig.name = "Rig"

    hair = add_asset(body, f"{ASSETS}/hair/{v['hair']}/{v['hair']}.mhclo", "Hair")
    brows = add_asset(body, f"{ASSETS}/eyebrows/{v['brows']}/{v['brows']}.mhclo", "Eyebrows")
    eyes = add_asset(body, f"{ASSETS}/eyes/low-poly/low-poly.mhclo", "Eyes")
    shoes = add_asset(body, f"{ASSETS}/clothes/shoes06/shoes06.mhclo", "Clothes")
    for o, n in ((hair, "Hair"), (brows, "Brows"), (eyes, "Eyes"), (shoes, "Boots")):
        o.name = o.data.name = n
        for m in list(o.modifiers):
            if m.type not in ("ARMATURE",):
                o.modifiers.remove(m)

    bake_body(body)
    trim_boots(shoes, rig)
    zs = [vt.co.z for vt in body.data.vertices]
    height = round(max(zs) - min(zs), 3)
    jersey, shorts, socks = build_clothes(body, rig)

    # Materialien
    skin_src = read_mhmat_texture(f"{ASSETS}/skins/{v['skin']}/{v['skin']}.mhmat")
    hair_src = read_mhmat_texture(f"{ASSETS}/hair/{v['hair']}/{v['hair']}.mhmat")
    brow_src = read_mhmat_texture(f"{ASSETS}/eyebrows/{v['brows']}/{v['brows']}.mhmat")
    eye_src = read_mhmat_texture(f"{ASSETS}/eyes/materials/{v['eyes']}.mhmat")
    shoe_src = read_mhmat_texture(f"{ASSETS}/clothes/shoes06/shoes06.mhmat")
    vid = v["id"]
    assign(body, make_material("Skin", image=prepare_image(skin_src, 1024, tmpdir, f"{vid}_skin", fmt="JPEG"), roughness=0.55))
    assign(hair, make_material("Hair", image=prepare_image(hair_src, 1024, tmpdir, f"{vid}_hair", tint=HAIR[v["hair_color"]]),
                               alpha_clip=True, roughness=0.7, double_sided=True))
    assign(brows, make_material("Brows", image=prepare_image(brow_src, 256, tmpdir, f"{vid}_brows", tint=HAIR[v["hair_color"]]),
                                alpha_clip=True, roughness=0.8, double_sided=True))
    assign(eyes, make_material("Eyes", image=prepare_image(eye_src, 256, tmpdir, f"{vid}_eyes"), roughness=0.15))
    assign(shoes, make_material("Boots", image=prepare_image(shoe_src, 512, tmpdir, "boots", grayscale=True), roughness=0.45))
    assign(jersey, make_material("Jersey", roughness=0.8, double_sided=True))
    assign(shorts, make_material("Shorts", roughness=0.75, double_sided=True))
    assign(socks, make_material("Socks", roughness=0.9))

    # Animationen übertragen
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=ANIM_SOURCE)
    imported = set(bpy.data.objects) - before
    src = [o for o in imported if o.type == "ARMATURE"][0]
    if src.animation_data:
        for t in list(src.animation_data.nla_tracks):
            src.animation_data.nla_tracks.remove(t)
    src_actions = {a.name: a for a in bpy.data.actions}
    for a in src_actions.values():
        a.name = "src_" + a.name
    actions = {}
    for name in ANIMATIONS:
        actions[name] = retarget_action(src, src_actions[name], rig, name)
    for o in imported:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a.name.startswith("src_"):
            bpy.data.actions.remove(a)

    # Die übertragenen Keyframes liegen im 30-fps-Raster
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1.0
    speeds = {n: natural_speed(rig, actions[n]) for n in ("walk", "run")}

    # Export
    out = os.path.join(out_dir, f"{vid}.glb")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_animation_mode="NLA_TRACKS",
        export_apply=True,
        export_yup=True,
        export_image_format="AUTO",
    )
    return dict(id=vid, label=v["label"], gender=v["gender"], heightM=height, hair=v["hair"],
                hairColor=v["hair_color"], skin=v["skin"], naturalSpeed=speeds, file=f"{vid}.glb")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)

    manifest_path = os.path.join(args.out, "players.json")
    manifest = {}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = {p["id"]: p for p in json.load(f)["players"]}

    with tempfile.TemporaryDirectory() as tmpdir:
        for v in VARIANTS:
            if args.only and v["id"] not in args.only:
                continue
            print(f"== {v['id']} ({v['label']})", flush=True)
            manifest[v["id"]] = build_variant(v, args.out, tmpdir)
            print(json.dumps(manifest[v["id"]]), flush=True)

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump({"players": [manifest[k] for k in sorted(manifest)]}, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
