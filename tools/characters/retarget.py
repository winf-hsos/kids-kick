"""
Überträgt Mixamo-Animationen (z. B. aus Xbot.glb) auf das MPFB-„mixamo“-Skelett
eines Kindermodells.

Verfahren: Für jeden Knochen wird die Rotation relativ zur Ruhepose in
Weltkoordinaten übertragen. Vorher wird die Ruhepose des Ziels (A-Pose) auf die
Ruhepose der Quelle (T-Pose) ausgerichtet, sonst würden z. B. die Arme in den
Körper drehen. Die Hüftbewegung wird mit dem Verhältnis der Hüfthöhen skaliert.
"""

import bpy
import math

from mathutils import Matrix, Quaternion, Vector

TARGET_FPS = 30

# Bevorzugtes Kind, das die Richtung eines Knochens festlegt (bei mehreren Kindern).
_MAIN_CHILD = {
    "Hips": "Spine",
    "Spine2": "Neck",
    "LeftHand": "LeftHandMiddle1",
    "RightHand": "RightHandMiddle1",
}


# Schlüsselbeine behalten ihre natürliche Neigung. Würden sie auf die waagerechten
# Mixamo-Schlüsselbeine ausgerichtet, zögen die Kinder die Schultern hoch.
_KEEP_REST_DIRECTION = {"LeftShoulder", "RightShoulder"}


def _short(name):
    return name.split(":")[-1]


def _main_child(bone):
    if not bone.children:
        return None
    want = _MAIN_CHILD.get(_short(bone.name))
    for c in bone.children:
        if want and _short(c.name) == want:
            return c
    return bone.children[0]


def _rest_dir_world(arm_obj, bone):
    """Ruherichtung eines Knochens in Weltkoordinaten (Kopf -> Kopf des Hauptkindes)."""
    child = _main_child(bone)
    if child is None:
        return None
    mw = arm_obj.matrix_world
    d = (mw @ child.head_local) - (mw @ bone.head_local)
    return d.normalized() if d.length > 1e-6 else None


def _rot(m):
    return m.to_3x3().normalized().to_quaternion()


def _hierarchy(bones):
    order = []

    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)

    for b in bones:
        if b.parent is None:
            walk(b)
    return order


def _offset_rotations(dst_bones, adduct):
    """Starre Drehung ganzer Gliedmaßen zum Körper hin (Grad, positiv = anlegen).
    Gilt für den genannten Knochen und alle Kinder. Achse: vorne/hinten (Blender-Y)."""
    out = {}
    for b in dst_bones:
        q = out[b.parent.name] if b.parent else Quaternion()
        short = _short(b.name)
        base = short.replace("Left", "").replace("Right", "")
        if base in adduct:
            sign = 1.0 if short.startswith("Left") else -1.0
            q = Quaternion(Vector((0, 1, 0)), math.radians(adduct[base]) * sign) @ q
        out[b.name] = q
    return out


def retarget_action(src_arm, src_action, dst_arm, name, adduct=None):
    """Erzeugt auf dst_arm eine neue Action `name` aus src_action von src_arm.
    adduct: z. B. {"Arm": 8, "UpLeg": 3} legt Arme/Beine etwas näher an den Körper."""
    scene = bpy.context.scene
    src_arm.animation_data_create()
    src_arm.animation_data.action = src_action
    # Blender 4.4+: Actions haben „Slots“; ohne zugewiesenen Slot wirkt die Action nicht.
    if hasattr(src_action, "slots") and len(src_action.slots) > 0:
        src_arm.animation_data.action_slot = src_action.slots[0]
    f_start, f_end = src_action.frame_range
    src_fps = scene.render.fps / scene.render.fps_base
    duration = (f_end - f_start) / src_fps
    n = max(1, round(duration * TARGET_FPS))

    bpy.context.view_layer.update()
    # Kopien: matrix_world ist sonst eine Live-Referenz und ändert sich beim Frame-Wechsel.
    src_mw = src_arm.matrix_world.copy()
    dst_mw = dst_arm.matrix_world.copy()
    dst_mw_rot_inv = _rot(dst_mw).inverted()

    dst_bones = _hierarchy(dst_arm.data.bones)
    src_bones = src_arm.data.bones

    # Ausrichtung Ziel-Ruhepose -> Quell-Ruhepose
    correction = {}
    for b in dst_bones:
        sb = src_bones.get(b.name)
        q = Quaternion()
        if sb is not None and _short(b.name) not in _KEEP_REST_DIRECTION:
            dd = _rest_dir_world(dst_arm, b)
            sd = _rest_dir_world(src_arm, sb)
            if dd is not None and sd is not None:
                q = dd.rotation_difference(sd)
        correction[b.name] = q

    offsets = _offset_rotations(dst_bones, adduct or {})

    hips = dst_bones[0]
    src_hips = src_bones[hips.name]
    src_hips_rest = src_mw @ src_hips.head_local
    dst_hips_rest_world = dst_mw @ hips.head_local
    hip_scale = dst_hips_rest_world.z / src_hips_rest.z

    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    dst_arm.animation_data_create()
    dst_arm.animation_data.action = action
    for pb in dst_arm.pose.bones:
        pb.rotation_mode = "QUATERNION"

    prev_q = {}
    for i in range(n + 1):
        src_frame = f_start + (f_end - f_start) * i / n
        scene.frame_set(int(src_frame), subframe=src_frame - int(src_frame))
        pose_mats = {}
        for b in dst_bones:
            pb = dst_arm.pose.bones[b.name]
            sb = src_bones.get(b.name)
            spb = src_arm.pose.bones.get(b.name)
            t_rest_w = _rot(dst_mw @ b.matrix_local)
            if spb is not None:
                s_rest_w = _rot(src_mw @ sb.matrix_local)
                s_anim_w = _rot(src_mw @ spb.matrix)
                delta = s_anim_w @ s_rest_w.inverted()
                w = delta @ correction[b.name] @ t_rest_w
            else:
                w = correction[b.name] @ t_rest_w
            w = offsets[b.name] @ w
            rot_arm = (dst_mw_rot_inv @ w).to_matrix().to_4x4()

            if b.parent is None:
                src_hips_now = src_mw @ spb.head
                offset_world = (src_hips_now - src_hips_rest) * hip_scale
                head_world = dst_hips_rest_world + offset_world
                head_arm = dst_mw.inverted() @ head_world
                m = Matrix.Translation(head_arm) @ rot_arm
                basis = b.matrix_local.inverted() @ m
            else:
                rel_rest = b.parent.matrix_local.inverted() @ b.matrix_local
                parent_pose = pose_mats[b.parent.name]
                head_arm = (parent_pose @ rel_rest).translation
                m = Matrix.Translation(head_arm) @ rot_arm
                basis = rel_rest.inverted() @ parent_pose.inverted() @ m
            pose_mats[b.name] = m

            q = basis.to_quaternion()
            if b.name in prev_q:
                q.make_compatible(prev_q[b.name])
            prev_q[b.name] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=i)
            if b.parent is None:
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=i)

    # Als NLA-Spur ablegen, damit der glTF-Export jede Animation einzeln schreibt
    track = dst_arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    dst_arm.animation_data.action = None
    return action
