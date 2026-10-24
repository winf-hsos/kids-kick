import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER } from '../config';
import { NO_INPUT, type InputState } from '../input/input';
import type { Physics } from '../physics/world';
import type { Position } from '../teams';
import type { CharacterInstance } from './character';
import type { Skills } from './skills';

/** Ab welcher Geschwindigkeit nur noch die Laufanimation zu sehen ist (relativ zur Laufgeschwindigkeit). */
const RUN_BLEND_END = 0.85;

/** Beim Sprint wird die Schrittfrequenz höchstens so stark erhöht; den Rest macht die Schrittlänge. */
const MAX_CADENCE = 1.45;

/** Körper-Kollider (Kapsel) für den Ball */
const BODY_RADIUS = 0.2;
const BODY_HALF_HEIGHT = 0.42;

export type KickKind = 'pass' | 'shot';

interface KickState {
  kind: KickKind;
  t: number;
  duration: number;
  /** 0..1, skaliert die Ausholbewegung */
  strength: number;
  dir: THREE.Vector3;
  contact: () => void;
  contacted: boolean;
}

/** Zeitpunkt des Ballkontakts im Bewegungsablauf (0..1) */
const CONTACT_AT = 0.55;

export interface PlayerOptions {
  team: 0 | 1;
  role: Position;
  number: number;
  /** Bewegungsgrenzen (Weltkoordinaten x/z) */
  bounds: THREE.Box2;
  /** Blickrichtung beim Start (Radiant, 0 = +z) */
  yaw?: number;
  physics: Physics;
  skills: Skills;
}

/**
 * Eine Spielerfigur mit Bewegung, Drehung, Körperneigung,
 * Animationsüberblendung (Stehen -> Gehen -> Laufen) und Schussbewegung.
 */
export class Player {
  readonly root = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly info: CharacterInstance['info'];
  readonly team: 0 | 1;
  readonly role: Position;
  readonly number: number;
  readonly skills: Skills;

  private readonly body = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;
  private readonly bones: Record<string, THREE.Object3D | undefined>;
  private readonly collider: RAPIER.RigidBody;
  private phase = 0;
  private yaw: number;
  private lean = new THREE.Vector2();
  private kickState: KickState | null = null;
  /** Hechtsprung des Torwarts */
  private diveState: { t: number; dir: THREE.Vector3 } | null = null;
  /** Kurzer Ballkontakt beim Dribbeln (nur Optik) */
  private touchT: number | null = null;

  constructor(character: CharacterInstance, private opts: PlayerOptions) {
    this.info = character.info;
    this.team = opts.team;
    this.role = opts.role;
    this.number = opts.number;
    this.skills = opts.skills;
    this.model = character.root;
    this.body.add(character.root);
    this.root.add(this.body);
    this.root.name = `player-${character.info.id}`;
    this.yaw = opts.yaw ?? 0;
    this.root.rotation.y = this.yaw;

    this.mixer = new THREE.AnimationMixer(character.root);
    const clip = (name: string) => {
      const c = character.clips.find((c) => c.name === name);
      if (!c) throw new Error(`Animation „${name}“ fehlt bei ${character.info.id}`);
      return c;
    };
    this.idle = this.mixer.clipAction(clip('idle'));
    this.walk = this.mixer.clipAction(clip('walk'));
    this.run = this.mixer.clipAction(clip('run'));
    for (const a of [this.idle, this.walk, this.run]) a.play();
    // Nicht alle Kinder sollen synchron atmen
    this.idle.time = Math.random() * this.idle.getClip().duration;
    // Gehen und Laufen folgen einer gemeinsamen Schrittphase (kein Fußrutschen beim Überblenden)
    this.walk.timeScale = 0;
    this.run.timeScale = 0;

    const bone = (n: string) => character.root.getObjectByName(`mixamorig${n}`);
    this.bones = {
      upLeg: bone('RightUpLeg'),
      leg: bone('RightLeg'),
      spine: bone('Spine1'),
      leftArm: bone('LeftArm'),
      rightArm: bone('RightArm'),
    };

    const { R, world } = opts.physics;
    // Erst unter dem Boden parken; resetTo() stellt den Körper an seinen Platz
    this.collider = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -10, 0));
    world.createCollider(
      R.ColliderDesc.capsule(BODY_HALF_HEIGHT, BODY_RADIUS).setRestitution(0.3).setFriction(0.5),
      this.collider,
    );
  }

  get position() {
    return this.root.position;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  /** Blickrichtung (Einheitsvektor in der Ebene) */
  get facing(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get isKicking() {
    return this.kickState !== null;
  }

  get isDiving() {
    return this.diveState !== null;
  }

  /** Kleiner Ballkontakt beim Dribbeln (nur die Beinbewegung) */
  touch() {
    if (!this.kickState) this.touchT = 0;
  }

  /** Torwart: Hechtsprung zur Seite (dir = Richtung in der Ebene). */
  dive(dir: THREE.Vector3) {
    if (this.diveState) return;
    const d = dir.clone().setY(0).normalize();
    this.diveState = { t: 0, dir: d };
    this.velocity.copy(d).multiplyScalar(5.5);
    this.kickState = null;
  }

  /** Stellt den Spieler ruhend an eine Position (Anstoß). */
  resetTo(x: number, z: number, yaw: number) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.kickState = null;
    this.diveState = null;
    // Teleportieren statt Bewegen, sonst würde der Körper den Ball wegschleudern
    this.collider.setTranslation({ x, y: BODY_HALF_HEIGHT + BODY_RADIUS, z }, true);
  }

  /**
   * Startet eine Schuss- oder Passbewegung in Richtung dir.
   * contact() wird im Moment des Ballkontakts aufgerufen.
   */
  kick(kind: KickKind, dir: THREE.Vector3, strength: number, contact: () => void) {
    this.kickState = {
      kind,
      t: 0,
      duration: kind === 'shot' ? 0.42 : 0.32,
      strength: THREE.MathUtils.clamp(strength, 0.3, 1),
      dir: dir.clone().setY(0).normalize(),
      contact,
      contacted: false,
    };
  }

  /**
   * @param input Steuerung (nur beim gesteuerten Spieler)
   * @param lookAt Punkt, zu dem sich ein stehender Spieler langsam hindreht (z. B. der Ball)
   */
  update(dt: number, input: InputState = NO_INPUT, lookAt?: THREE.Vector3) {
    if (dt <= 0) return;
    if (this.diveState) {
      this.updateDive(dt, this.diveState);
      return;
    }
    const kick = this.kickState;

    // --- Bewegung -----------------------------------------------------------
    // Bildschirm „oben“ = vom Betrachter weg = -z
    const pace = 0.88 + 0.2 * this.skills.pace;
    const maxSpeed = (input.sprint ? PLAYER.sprintSpeed : PLAYER.jogSpeed) * pace * (kick ? 0.35 : 1);
    const desired = new THREE.Vector3(input.moveX, 0, -input.moveY).multiplyScalar(maxSpeed);
    const hasInput = desired.lengthSq() > 1e-4;
    const accel = hasInput ? 5.5 : 7;
    const prevVel = this.velocity.clone();
    this.velocity.lerp(desired, 1 - Math.exp(-accel * dt));

    this.root.position.addScaledVector(this.velocity, dt);
    this.clampToBounds();

    // --- Drehung ------------------------------------------------------------
    const speed = this.speed;
    let yawRate = 0;
    const turnTo = (target: number, rate: number, maxStep = Infinity) => {
      const delta = wrapAngle(target - this.yaw);
      const step = THREE.MathUtils.clamp(delta * (1 - Math.exp(-rate * dt)), -maxStep, maxStep);
      this.yaw += step;
      yawRate = step / dt;
    };
    if (kick) {
      turnTo(Math.atan2(kick.dir.x, kick.dir.z), 25);
    } else if (speed > 0.25) {
      turnTo(Math.atan2(this.velocity.x, this.velocity.z), 12);
    } else if (lookAt) {
      const dx = lookAt.x - this.position.x;
      const dz = lookAt.z - this.position.z;
      if (dx * dx + dz * dz > 0.25) turnTo(Math.atan2(dx, dz), 3, 1.8 * dt);
    }
    this.root.rotation.y = this.yaw;

    // --- Körperneigung: nach vorn beim Beschleunigen, zur Seite in Kurven ----
    const accelVec = this.velocity.clone().sub(prevVel).divideScalar(Math.max(dt, 1e-4));
    const forwardAccel = accelVec.dot(this.facing);
    const targetPitch = THREE.MathUtils.clamp(0.02 * forwardAccel + 0.015 * speed, -0.12, 0.22);
    const targetRoll = THREE.MathUtils.clamp(-0.0135 * yawRate * Math.min(speed, 5), -0.25, 0.25);
    this.lean.lerp(new THREE.Vector2(targetPitch, targetRoll), 1 - Math.exp(-8 * dt));
    this.body.rotation.set(this.lean.x, 0, this.lean.y);

    this.animate(dt, speed);
    if (kick) this.applyKick(dt, kick);
    else if (this.touchT !== null) this.applyTouch(dt);

    this.collider.setNextKinematicTranslation({
      x: this.position.x,
      y: BODY_HALF_HEIGHT + BODY_RADIUS,
      z: this.position.z,
    });
  }

  private updateDive(dt: number, d: { t: number; dir: THREE.Vector3 }) {
    d.t += dt;
    const u = d.t / 0.95;
    this.velocity.multiplyScalar(Math.exp(-2.2 * dt));
    this.root.position.addScaledVector(this.velocity, dt);
    this.clampToBounds();

    // Seitlich umkippen in Sprungrichtung, Arme nach oben
    const left = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const side = Math.sign(d.dir.dot(left)) || 1;
    const tilt = curve(u, [0, 0], [0.25, 78], [0.6, 82], [1, 0]);
    this.body.rotation.set(0, 0, THREE.MathUtils.degToRad(-side * tilt));
    this.animate(dt, 0);
    const arms = curve(u, [0, 0], [0.2, 140], [0.6, 140], [1, 0]);
    this.rotateInModelSpace(this.bones.leftArm, Z_AXIS, arms);
    this.rotateInModelSpace(this.bones.rightArm, Z_AXIS, -arms);

    const reach = THREE.MathUtils.clamp(tilt / 80, 0, 1);
    this.collider.setNextKinematicTranslation({
      x: this.position.x + d.dir.x * 0.6 * reach,
      y: BODY_HALF_HEIGHT + BODY_RADIUS - 0.35 * reach,
      z: this.position.z + d.dir.z * 0.6 * reach,
    });
    if (u >= 1) {
      this.diveState = null;
      this.body.rotation.set(0, 0, 0);
    }
  }

  /** Schiebt diesen Spieler aus einem anderen heraus (einfache Kreis-Kollision). */
  separateFrom(other: Player, minDist = 0.6) {
    const dx = this.position.x - other.position.x;
    const dz = this.position.z - other.position.z;
    const d = Math.hypot(dx, dz);
    if (d >= minDist || d < 1e-4) return;
    const push = (minDist - d) / d;
    this.position.x += dx * push;
    this.position.z += dz * push;
    // Geschwindigkeit in Richtung des anderen abbauen
    const nx = dx / d;
    const nz = dz / d;
    const vn = this.velocity.x * nx + this.velocity.z * nz;
    if (vn < 0) {
      this.velocity.x -= vn * nx;
      this.velocity.z -= vn * nz;
    }
  }

  private clampToBounds() {
    const b = this.opts.bounds;
    const p = this.root.position;
    if (p.x < b.min.x || p.x > b.max.x) this.velocity.x = 0;
    if (p.z < b.min.y || p.z > b.max.y) this.velocity.z = 0;
    p.x = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x);
    p.z = THREE.MathUtils.clamp(p.z, b.min.y, b.max.y);
  }

  private animate(dt: number, speed: number) {
    const { walk: vWalk, run: vRun } = this.info.naturalSpeed;
    const runBlendEnd = vRun * RUN_BLEND_END;

    // Gewichte: Stehen -> Gehen -> Laufen
    let wIdle = 0;
    let wWalk = 0;
    let wRun = 0;
    if (speed < vWalk) {
      const t = speed / vWalk;
      wIdle = 1 - t;
      wWalk = t;
    } else if (speed < runBlendEnd) {
      const t = (speed - vWalk) / (runBlendEnd - vWalk);
      wWalk = 1 - t;
      wRun = t;
    } else {
      wRun = 1;
    }
    this.idle.setEffectiveWeight(wIdle);
    this.walk.setEffectiveWeight(wWalk);
    this.run.setEffectiveWeight(wRun);

    // Schrittfrequenz passend zur Geschwindigkeit, gemischt aus beiden Zyklen
    const walkDur = this.walk.getClip().duration;
    const runDur = this.run.getClip().duration;
    const fWalk = Math.max(speed, 0.5) / vWalk / walkDur;
    const fRun = Math.min(Math.max(speed, 0.5) / vRun, MAX_CADENCE) / runDur;
    const blend = wWalk + wRun > 0 ? wRun / (wWalk + wRun) : 0;
    this.phase = (this.phase + dt * THREE.MathUtils.lerp(fWalk, fRun, blend)) % 1;
    this.walk.time = this.phase * walkDur;
    this.run.time = this.phase * runDur;

    this.mixer.update(dt);
  }

  /**
   * Schussbewegung als Überlagerung der laufenden Animation:
   * Ausholen (Hüfte gestreckt, Knie gebeugt) -> Durchschwingen -> Ausschwingen.
   */
  private applyKick(dt: number, k: KickState) {
    k.t += dt;
    const u = Math.min(1, k.t / k.duration);
    const s = k.kind === 'shot' ? k.strength : 0.55 * k.strength;

    // Winkel in Grad über den Bewegungsablauf (Stützstellen bei u).
    // Um die Querachse (+x): positiv = Bein nach hinten bzw. Oberkörper nach vorn.
    const hip = curve(u, [0, 0], [0.3, 32 * s], [CONTACT_AT, -38 - 30 * s], [0.8, -30 * s], [1, 0]);
    const knee = curve(u, [0, 0], [0.3, 85 * s + 15], [CONTACT_AT, 8], [0.8, 18], [1, 0]);
    const lean = curve(u, [0, 0], [0.3, 4], [CONTACT_AT, -10 * s], [1, 0]);
    const arms = curve(u, [0, 0], [0.35, 25 * s], [CONTACT_AT, 35 * s], [1, 0]);

    this.rotateInModelSpace(this.bones.upLeg, X_AXIS, hip);
    this.rotateInModelSpace(this.bones.leg, X_AXIS, knee);
    this.rotateInModelSpace(this.bones.spine, X_AXIS, lean);
    this.rotateInModelSpace(this.bones.leftArm, Z_AXIS, arms);
    this.rotateInModelSpace(this.bones.rightArm, Z_AXIS, -arms * 0.6);

    if (!k.contacted && u >= CONTACT_AT) {
      k.contacted = true;
      k.contact();
    }
    if (u >= 1) this.kickState = null;
  }

  private applyTouch(dt: number) {
    this.touchT = (this.touchT ?? 0) + dt;
    const u = Math.min(1, this.touchT / 0.22);
    this.rotateInModelSpace(this.bones.upLeg, X_AXIS, curve(u, [0, 0], [0.45, -22], [1, 0]));
    this.rotateInModelSpace(this.bones.leg, X_AXIS, curve(u, [0, 10], [0.45, 12], [1, 0]));
    if (u >= 1) this.touchT = null;
  }

  /** Dreht einen Knochen zusätzlich um eine Achse im Modell-Koordinatensystem (vorne = +z). */
  private rotateInModelSpace(bone: THREE.Object3D | undefined, axis: THREE.Vector3, deg: number) {
    if (!bone || !bone.parent || Math.abs(deg) < 0.01) return;
    const modelQ = this.model.getWorldQuaternion(_q1).invert();
    const parentQ = bone.parent.getWorldQuaternion(_q2).premultiply(modelQ);
    const rot = _q3.setFromAxisAngle(axis, THREE.MathUtils.degToRad(deg));
    // q_lokal = parent⁻¹ · rot · parent
    const local = parentQ.clone().invert().multiply(rot).multiply(parentQ);
    bone.quaternion.premultiply(local);
    bone.updateMatrixWorld(true);
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();

/** Weiche Interpolation zwischen Stützstellen [u, Wert]. */
function curve(u: number, ...pts: [number, number][]): number {
  for (let i = 1; i < pts.length; i++) {
    const [u0, v0] = pts[i - 1];
    const [u1, v1] = pts[i];
    if (u <= u1) {
      const t = (u - u0) / (u1 - u0);
      const sm = t * t * (3 - 2 * t);
      return v0 + (v1 - v0) * sm;
    }
  }
  return pts[pts.length - 1][1];
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
