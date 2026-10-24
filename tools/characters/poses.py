"""
Selbst gebaute (prozedurale) Animationen für das MPFB-„mixamo“-Skelett.

Die Stehanimation des Mixamo-Testmodells wirkt bei Kindern steif (gerader Rücken,
gestreckte Knie, Arme am Körper). Hier wird stattdessen eine lockere Kinderhaltung
erzeugt: Knie leicht gebeugt, Oberkörper leicht vorgebeugt, Schultern locker,
Ellbogen angewinkelt, Finger entspannt, dazu Atmen und Gewichtsverlagerung.

Koordinaten (Blender-Welt): Die Figur schaut nach -Y, +X ist ihre linke Seite, +Z oben.
"""

import math
import random

import bpy
from mathutils import Matrix, Quaternion, Vector

from retarget import _hierarchy, _rest_dir_world, _rot, _short

FORWARD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))
X = Vector((1, 0, 0))


def _q(axis, deg):
    return Quaternion(axis, math.radians(deg))


class Pose:
    """Pose zu einem Zeitpunkt.

    local:  Drehung im Ruhe-Achsensystem des Knochens, wird an Kinder vererbt
    aim:    Knochen zeigt in diese Weltrichtung
    lock:   feste Welt-Drehung relativ zur Ruhepose (z. B. Füße flach auf dem Boden)
    ankles: Zielposition der Sprunggelenke (Bein-IK), Weltkoordinaten
    twist:  (Vektor in Ruhepose, Weltziel) – dreht den Knochen um seine eigene Achse,
            bis der Vektor möglichst zum Ziel zeigt (z. B. Handfläche zum Oberschenkel)
    """

    def __init__(self):
        self.hips_offset = Vector()
        self.local = {}
        self.aim = {}
        self.lock = {}
        self.ankles = {}
        self.twist = {}


def bake_procedural(arm, name, duration, pose_fn, fps=30):
    bpy.context.view_layer.update()
    mw = arm.matrix_world.copy()
    mw_inv = mw.inverted()
    mw_rot_inv = _rot(mw).inverted()
    bones = _hierarchy(arm.data.bones)
    rest_w = {b.name: _rot(mw @ b.matrix_local) for b in bones}
    rest_head = {b.name: mw @ b.head_local for b in bones}
    rest_dir = {b.name: _rest_dir_world(arm, b) for b in bones}
    feet = [b.name for b in bones if _short(b.name).endswith(("Foot", "ToeBase"))]
    rest_floor = min(rest_head[n].z for n in feet)

    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"

    n = max(1, round(duration * fps))
    prev_q = {}
    for i in range(n + 1):
        pose = pose_fn(i / fps)
        A = {}
        mats = {}
        knee = {}
        for b in bones:
            s = _short(b.name)
            ap = A[b.parent.name] if b.parent else Quaternion()
            if b.parent is None:
                head = mw_inv @ (rest_head[b.name] + pose.hips_offset)
            else:
                rel = b.parent.matrix_local.inverted() @ b.matrix_local
                head = (mats[b.parent.name] @ rel).translation
            head_w = mw @ head

            side = "Left" if s.startswith("Left") else "Right"
            if s in pose.lock:
                a = pose.lock[s]
            elif s.endswith("UpLeg") and side in pose.ankles:
                # Zwei-Knochen-IK: Knie so beugen, dass das Sprunggelenk am Ziel bleibt
                ankle = pose.ankles[side]
                kname = b.name.replace("UpLeg", "Leg")
                fname = b.name.replace("UpLeg", "Foot")
                la = (rest_head[kname] - rest_head[b.name]).length
                lb = (rest_head[fname] - rest_head[kname]).length
                to = ankle - head_w
                d = min(to.length, (la + lb) * 0.999)
                u = to.normalized()
                x = (la * la - lb * lb + d * d) / (2 * d)
                h = math.sqrt(max(0.0, la * la - x * x))
                pole = (FORWARD - u * FORWARD.dot(u)).normalized()
                k = head_w + u * x + pole * h
                knee[side] = (k, ankle)
                cur = ap @ rest_dir[b.name]
                a = cur.rotation_difference((k - head_w).normalized()) @ ap
            elif s.endswith("Leg") and not s.endswith("UpLeg") and side in knee:
                k, ankle = knee[side]
                cur = ap @ rest_dir[b.name]
                a = cur.rotation_difference((ankle - k).normalized()) @ ap
            elif s in pose.aim and rest_dir[b.name] is not None:
                cur = ap @ rest_dir[b.name]
                a = cur.rotation_difference(pose.aim[s]) @ ap
            else:
                a = ap @ pose.local.get(s, Quaternion())
            if s in pose.twist and rest_dir[b.name] is not None:
                vec, target = pose.twist[s]
                axis = (a @ rest_dir[b.name]).normalized()
                v = a @ vec
                v_p = (v - axis * v.dot(axis)).normalized()
                t_p = (target - axis * target.dot(axis)).normalized()
                ang = math.atan2(axis.dot(v_p.cross(t_p)), v_p.dot(t_p))
                a = Quaternion(axis, ang) @ a
            A[b.name] = a
            rot = (mw_rot_inv @ (a @ rest_w[b.name])).to_matrix().to_4x4()
            mats[b.name] = Matrix.Translation(head) @ rot

        # Füße auf den Boden stellen (die ganze Figur senkrecht verschieben)
        floor = min((mw @ mats[n_].translation).z for n_ in feet)
        shift = mw_inv.to_3x3() @ Vector((0, 0, rest_floor - floor))
        for k_ in mats:
            mats[k_] = Matrix.Translation(shift) @ mats[k_]

        for b in bones:
            pb = arm.pose.bones[b.name]
            if b.parent is None:
                basis = b.matrix_local.inverted() @ mats[b.name]
            else:
                rel = b.parent.matrix_local.inverted() @ b.matrix_local
                basis = rel.inverted() @ mats[b.parent.name].inverted() @ mats[b.name]
            q = basis.to_quaternion()
            if b.name in prev_q:
                q.make_compatible(prev_q[b.name])
            prev_q[b.name] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=i)
            if b.parent is None:
                pb.location = basis.translation
                pb.keyframe_insert("location", frame=i)

    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
    arm.animation_data.action = None
    return action


def _hand_frame(arm, side):
    """Fingerrichtung und Handflächen-Normale (zeigt dorthin, wohin sich Finger krümmen)."""
    mw = arm.matrix_world
    bones = arm.data.bones
    p = lambda n: mw @ bones[f"mixamorig:{side}{n}"].head_local  # noqa: E731
    finger = (p("HandMiddle2") - p("HandMiddle1")).normalized()
    across = (p("HandPinky1") - p("HandIndex1")).normalized()
    normal = finger.cross(across).normalized()
    if normal.dot(p("HandThumb3") - p("Hand")) < 0:
        normal = -normal
    return finger, normal


def make_idle(arm, seed, duration=6.4):
    """Lockere Kinder-Stehhaltung mit Atmen und Gewichtsverlagerung (nahtlose Schleife)."""
    rnd = random.Random(seed)
    # Individuelle Haltung je Spielertyp
    lean = rnd.uniform(4, 8)  # Oberkörper nach vorn (Grad, verteilt auf Becken und Wirbelsäule)
    knee_drop = rnd.uniform(0.012, 0.022)  # Becken tiefer -> Knie leicht gebeugt (m)
    weight = rnd.choice([-1, 1]) * rnd.uniform(0.012, 0.022)  # Gewicht auf einem Bein (m)
    arm_out = rnd.uniform(7, 12)  # Oberarme vom Körper weg (Grad)
    arm_fwd = rnd.uniform(2, 7)
    elbow = rnd.uniform(14, 26)  # Unterarm gegenüber der Senkrechten nach vorn (Grad)
    head_turn = rnd.uniform(-8, 8)
    phase = rnd.random()

    bones = arm.data.bones
    mw = arm.matrix_world
    ankle_rest = {s: mw @ bones[f"mixamorig:{s}Foot"].head_local for s in ("Left", "Right")}
    hand = {s: _hand_frame(arm, s) for s in ("Left", "Right")}

    def pose_fn(t):
        w = 2 * math.pi * (t / duration + phase)
        breath = math.sin(2 * w)  # zwei Atemzüge pro Schleife
        sway = math.sin(w)
        p = Pose()
        shift = weight + 0.006 * sway
        p.hips_offset = Vector((shift, -0.01, -knee_drop))
        # Becken: leicht nach vorn gekippt, auf der Spielbein-Seite etwas tiefer
        p.local["Hips"] = _q(FORWARD, -shift * 120) @ _q(X, lean * 0.3)
        p.local["Spine"] = _q(X, lean * 0.3 + 0.6 * breath)
        p.local["Spine1"] = _q(X, lean * 0.25 + 0.6 * breath)
        p.local["Spine2"] = _q(X, lean * 0.15 - 0.8 * breath) @ _q(FORWARD, shift * 80)
        p.local["Neck"] = _q(X, -lean * 0.4)
        p.local["Head"] = _q(UP, head_turn + 4 * math.sin(w + 1.3)) @ _q(X, -lean * 0.35 + 2)
        for s, sign in (("Left", 1), ("Right", -1)):
            p.ankles[s] = ankle_rest[s] - Vector((sign * 0.02, 0, 0))
            p.lock[f"{s}Foot"] = _q(UP, sign * 6)  # Fußspitzen leicht nach außen
            # Schultern locker nach vorn und unten, beim Einatmen minimal hoch
            p.local[f"{s}Shoulder"] = _q(UP, sign * -6) @ _q(FORWARD, -sign * (4 - 1.2 * breath))
            a_out = math.radians(arm_out + 1.5 * breath)
            a_fwd = math.radians(arm_fwd + 2 * sway * sign)
            p.aim[f"{s}Arm"] = Vector((sign * math.sin(a_out), -math.sin(a_fwd), -1)).normalized()
            e = math.radians(elbow + 3 * sway * sign)
            p.aim[f"{s}ForeArm"] = Vector((sign * math.sin(math.radians(3)), -math.sin(e), -math.cos(e))).normalized()
            finger, normal = hand[s]
            # Handfläche zeigt locker zum Oberschenkel (leicht nach hinten gedreht)
            p.twist[f"{s}ForeArm"] = (normal, Vector((-sign, 0.35, 0)).normalized())
            curl_axis = finger.cross(normal).normalized()
            # Die MPFB-Ruhepose hat das Handgelenk schon leicht gebeugt; etwas strecken
            p.local[f"{s}Hand"] = Quaternion(curl_axis, math.radians(-14))
            for f, deg in (("Index", 7), ("Middle", 9), ("Ring", 11), ("Pinky", 13)):
                for j in (1, 2, 3):
                    p.local[f"{s}Hand{f}{j}"] = Quaternion(curl_axis, math.radians(deg))
            for j in (1, 2, 3):
                p.local[f"{s}HandThumb{j}"] = Quaternion(curl_axis, math.radians(3))
        return p

    return bake_procedural(arm, "idle", duration, pose_fn)
