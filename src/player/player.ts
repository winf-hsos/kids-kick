import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PLAYER } from '../config';
import type { InputState } from '../input/input';

/** Geschwindigkeiten (m/s), bei denen die Lauf-Animationen ohne Rutschen aussehen. */
const WALK_NATURAL_SPEED = 1.2;
const RUN_NATURAL_SPEED = 3.4;

/** Ab welcher Geschwindigkeit nur noch die Laufanimation zu sehen ist. */
const WALK_TO_RUN_END = 2.6;

export interface PlayerOptions {
  /** Trikotfarbe */
  shirtColor: THREE.ColorRepresentation;
  /** Bewegungsgrenzen (Weltkoordinaten) */
  bounds: THREE.Box2;
}

/**
 * Ein steuerbarer Spieler. Platzhaltermodell (Mixamo „X Bot“), skaliert auf
 * Kindergröße, mit Idle/Gehen/Laufen-Überblendung und Körperneigung.
 */
export class Player {
  readonly root = new THREE.Group();
  readonly velocity = new THREE.Vector3();

  private readonly body = new THREE.Group();
  private readonly mixer: THREE.AnimationMixer;
  private readonly idle: THREE.AnimationAction;
  private readonly walk: THREE.AnimationAction;
  private readonly run: THREE.AnimationAction;
  private phase = 0;
  private yaw = 0;
  private lean = new THREE.Vector2();

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[], private opts: PlayerOptions) {
    const bbox = new THREE.Box3().setFromObject(model);
    model.scale.setScalar(PLAYER.height / (bbox.max.y - bbox.min.y));

    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (mat.name.includes('Joints')) {
        mat.color.set(0x1c1c22);
        mat.roughness = 0.6;
      } else {
        mat.color.set(opts.shirtColor);
        mat.roughness = 0.75;
        mat.metalness = 0;
      }
      mesh.material = mat;
    });

    this.body.add(model);
    this.root.add(this.body);
    this.root.name = 'player';

    this.mixer = new THREE.AnimationMixer(model);
    const clip = (name: string) => {
      const c = clips.find((c) => c.name === name);
      if (!c) throw new Error(`Animation „${name}“ fehlt im Modell`);
      return c;
    };
    this.idle = this.mixer.clipAction(clip('idle'));
    this.walk = this.mixer.clipAction(clip('walk'));
    this.run = this.mixer.clipAction(clip('run'));
    for (const a of [this.idle, this.walk, this.run]) a.play();
    // Gehen und Laufen werden über eine gemeinsame Schrittphase gesteuert (kein Fußrutschen beim Überblenden).
    this.walk.timeScale = 0;
    this.run.timeScale = 0;
  }

  static async load(url: string, opts: PlayerOptions): Promise<Player> {
    const gltf = await new GLTFLoader().loadAsync(url);
    return new Player(gltf.scene, gltf.animations, opts);
  }

  get position() {
    return this.root.position;
  }

  get speed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  update(dt: number, input: InputState) {
    // --- Bewegung -----------------------------------------------------------
    // Bildschirm „oben“ = vom Betrachter weg = -z
    const maxSpeed = input.sprint ? PLAYER.sprintSpeed : PLAYER.jogSpeed;
    const desired = new THREE.Vector3(input.moveX, 0, -input.moveY).multiplyScalar(maxSpeed);
    const hasInput = desired.lengthSq() > 1e-4;
    const accel = hasInput ? 5.5 : 7;
    const prevVel = this.velocity.clone();
    this.velocity.lerp(desired, 1 - Math.exp(-accel * dt));

    this.root.position.addScaledVector(this.velocity, dt);
    const b = this.opts.bounds;
    const p = this.root.position;
    if (p.x < b.min.x || p.x > b.max.x) this.velocity.x = 0;
    if (p.z < b.min.y || p.z > b.max.y) this.velocity.z = 0;
    p.x = THREE.MathUtils.clamp(p.x, b.min.x, b.max.x);
    p.z = THREE.MathUtils.clamp(p.z, b.min.y, b.max.y);

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
    const targetPitch = THREE.MathUtils.clamp(0.025 * forwardAccel + 0.02 * speed, -0.15, 0.28);
    const targetRoll = THREE.MathUtils.clamp(-0.045 * yawRate * Math.min(speed, 5) * 0.3, -0.3, 0.3);
    this.lean.lerp(new THREE.Vector2(targetPitch, targetRoll), 1 - Math.exp(-8 * dt));
    this.body.rotation.set(this.lean.x, 0, this.lean.y);

    this.animate(dt, speed);
  }

  private animate(dt: number, speed: number) {
    // Gewichte: Stehen -> Gehen -> Laufen
    let wIdle = 0;
    let wWalk = 0;
    let wRun = 0;
    if (speed < WALK_NATURAL_SPEED) {
      const t = speed / WALK_NATURAL_SPEED;
      wIdle = 1 - t;
      wWalk = t;
    } else if (speed < WALK_TO_RUN_END) {
      const t = (speed - WALK_NATURAL_SPEED) / (WALK_TO_RUN_END - WALK_NATURAL_SPEED);
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
    const fWalk = (Math.max(speed, 0.6) / WALK_NATURAL_SPEED) / walkDur;
    // Beim Sprint wird der Schritt länger, nicht nur schneller
    const runRate = speed <= RUN_NATURAL_SPEED ? speed / RUN_NATURAL_SPEED : 1 + (speed - RUN_NATURAL_SPEED) / RUN_NATURAL_SPEED * 0.55;
    const fRun = runRate / runDur;
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
