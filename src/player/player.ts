import * as THREE from 'three';
import { PLAYER } from '../config';
import type { InputState } from '../input/input';
import type { CharacterInstance } from './character';

/** Ab welcher Geschwindigkeit nur noch die Laufanimation zu sehen ist (relativ zur Laufgeschwindigkeit). */
const RUN_BLEND_END = 0.85;

/** Beim Sprint wird die Schrittfrequenz höchstens so stark erhöht; den Rest macht die Schrittlänge. */
const MAX_CADENCE = 1.45;

const NO_INPUT: InputState = { moveX: 0, moveY: 0, sprint: false, switchCamera: false };

export interface PlayerOptions {
  /** Bewegungsgrenzen (Weltkoordinaten x/z) */
  bounds: THREE.Box2;
  /** Blickrichtung beim Start (Radiant, 0 = +z) */
  yaw?: number;
}

/**
 * Eine Spielerfigur mit Bewegung, Drehung, Körperneigung und
 * Animationsüberblendung (Stehen -> Gehen -> Laufen).
 */
export class Player {
  readonly root = new THREE.Group();
  readonly velocity = new THREE.Vector3();
  readonly info: CharacterInstance['info'];

  private readonly body = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;
  private phase = 0;
  private yaw: number;
  private lean = new THREE.Vector2();

  constructor(character: CharacterInstance, private opts: PlayerOptions) {
    this.info = character.info;
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
  }

  get position() {
    return this.root.position;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(dt: number, input: InputState = NO_INPUT) {
    // --- Bewegung -----------------------------------------------------------
    // Bildschirm „oben“ = vom Betrachter weg = -z
    const maxSpeed = input.sprint ? PLAYER.sprintSpeed : PLAYER.jogSpeed;
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
    if (speed > 0.25) {
      const target = Math.atan2(this.velocity.x, this.velocity.z);
      const delta = wrapAngle(target - this.yaw);
      const step = delta * (1 - Math.exp(-12 * dt));
      this.yaw += step;
      yawRate = step / dt;
    }
    this.root.rotation.y = this.yaw;

    // --- Körperneigung: nach vorn beim Beschleunigen, zur Seite in Kurven ----
    const accelVec = this.velocity.clone().sub(prevVel).divideScalar(Math.max(dt, 1e-4));
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const forwardAccel = accelVec.dot(fwd);
    const targetPitch = THREE.MathUtils.clamp(0.02 * forwardAccel + 0.015 * speed, -0.12, 0.22);
    const targetRoll = THREE.MathUtils.clamp(-0.0135 * yawRate * Math.min(speed, 5), -0.25, 0.25);
    this.lean.lerp(new THREE.Vector2(targetPitch, targetRoll), 1 - Math.exp(-8 * dt));
    this.body.rotation.set(this.lean.x, 0, this.lean.y);

    this.animate(dt, speed);
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
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
