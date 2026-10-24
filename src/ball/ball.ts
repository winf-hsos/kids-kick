import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GOAL, PITCH } from '../config';
import type { Physics } from '../physics/world';

/** Jugendball Größe 4: Durchmesser ca. 20,5 cm, Leichtball ca. 320 g. */
export const BALL_RADIUS = 0.1025;
const BALL_MASS = 0.32;

/** Rollwiderstand auf Rasen: geschwindigkeitsabhängig (1/s) und konstant (m/s²). */
const ROLL_DRAG = 0.5;
const ROLL_FRICTION = 0.45;

/**
 * Der Ball: Rapier-Körper für Physik und Kollisionen, Three.js-Mesh für die Darstellung.
 */
export class Ball {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  private readonly tmpV = new THREE.Vector3();

  constructor(physics: Physics) {
    const { R, world } = physics;
    this.body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(0, BALL_RADIUS, 0)
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.3)
        .setCanSleep(false),
    );
    world.createCollider(
      R.ColliderDesc.ball(BALL_RADIUS).setMass(BALL_MASS).setRestitution(0.7).setFriction(0.6),
      this.body,
    );

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 48, 32),
      new THREE.MeshStandardMaterial({ map: createBallTexture(), roughness: 0.45 }),
    );
    this.mesh.castShadow = true;
    this.mesh.name = 'ball';
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return this.tmpV.set(t.x, t.y, t.z);
  }

  get velocity(): THREE.Vector3 {
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  get onGround(): boolean {
    return this.body.translation().y < BALL_RADIUS + 0.02;
  }

  /** Setzt den Ball ruhend an eine Stelle (z. B. Anstoß, Eindribbeln). */
  placeAt(x: number, z: number) {
    this.body.setTranslation({ x, y: BALL_RADIUS, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  setVelocity(v: THREE.Vector3) {
    this.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
  }

  /** Lässt den Ball passend zur Geschwindigkeit rollen (ohne Rutschen). */
  matchRolling() {
    const v = this.body.linvel();
    this.body.setAngvel({ x: v.z / BALL_RADIUS, y: 0, z: -v.x / BALL_RADIUS }, true);
  }

  /** Wird vor jedem Physikschritt aufgerufen. */
  preStep(h: number) {
    // Im Tor bremst das Netz den Ball stark ab
    const p = this.body.translation();
    if (Math.abs(p.x) > PITCH.length / 2 + BALL_RADIUS && Math.abs(p.z) < GOAL.width / 2 + 0.1 && p.y < GOAL.height + 0.1) {
      const v = this.body.linvel();
      const k = Math.exp(-4 * h);
      this.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
    }
    if (!this.onGround) return;
    const v = this.body.linvel();
    const speed = Math.hypot(v.x, v.z);
    if (speed < 1e-3) return;
    const next = Math.max(0, speed * Math.exp(-ROLL_DRAG * h) - ROLL_FRICTION * h);
    const k = next / speed;
    this.body.setLinvel({ x: v.x * k, y: v.y, z: v.z * k }, true);
  }

  /** Mesh an den Physik-Körper angleichen. */
  sync() {
    const t = this.body.translation();
    const q = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(q.x, q.y, q.z, q.w);
  }
}

/**
 * Klassisches Fußballmuster (abgestumpftes Ikosaeder): 12 dunkle Fünfecke, 20 weiße Sechsecke.
 * Berechnet als Voronoi-Zellen um 32 Punkte auf der Kugel, mit Nähten an den Zellgrenzen.
 */
function createBallTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const pos = ico.getAttribute('position');
  const pent: THREE.Vector3[] = [];
  const hex: THREE.Vector3[] = [];
  const key = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(3)).join(',');
  const seen = new Set<string>();
  for (let i = 0; i < pos.count; i += 3) {
    const tri = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, i + j));
    hex.push(tri[0].clone().add(tri[1]).add(tri[2]).normalize());
    for (const v of tri) {
      const k = key(v);
      if (!seen.has(k)) {
        seen.add(k);
        pent.push(v.clone().normalize());
      }
    }
  }
  const centers = [...pent, ...hex];
  const isPent = centers.map((_, i) => i < pent.length);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const d = new THREE.Vector3();
  const dark = [22, 40, 92];
  const light = [246, 246, 242];
  const seam = [150, 150, 150];
  for (let y = 0; y < H; y++) {
    const phi = ((y + 0.5) / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const theta = ((x + 0.5) / W) * Math.PI * 2;
      // Gleiche Abbildung wie THREE.SphereGeometry (u -> theta, v -> phi)
      d.set(-Math.cos(theta) * Math.sin(phi), Math.cos(phi), Math.sin(theta) * Math.sin(phi));
      let b1 = -2;
      let b2 = -2;
      let i1 = 0;
      for (let i = 0; i < centers.length; i++) {
        const dot = d.dot(centers[i]);
        if (dot > b1) {
          b2 = b1;
          b1 = dot;
          i1 = i;
        } else if (dot > b2) {
          b2 = dot;
        }
      }
      const col = b1 - b2 < 0.012 ? seam : isPent[i1] ? dark : light;
      const o = (y * W + x) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
