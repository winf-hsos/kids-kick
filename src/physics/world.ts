import RAPIER from '@dimforge/rapier3d-compat';
import { GOAL, PITCH } from '../config';

export type Rapier = typeof RAPIER;

/** Physik-Takt: fest 120 Hz, damit auch scharfe Schüsse nicht durch Pfosten tunneln. */
export const PHYSICS_DT = 1 / 120;

export interface Physics {
  R: Rapier;
  world: RAPIER.World;
  /** Rückt die Simulation um dt Sekunden vor (in festen Schritten). */
  step(dt: number, beforeStep: (h: number) => void): void;
}

export async function createPhysics(): Promise<Physics> {
  await RAPIER.init();
  const R = RAPIER;
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = PHYSICS_DT;

  addGround(R, world);
  addGoals(R, world);
  addBoards(R, world);

  let acc = 0;
  return {
    R,
    world,
    step(dt, beforeStep) {
      acc += dt;
      let n = 0;
      while (acc >= PHYSICS_DT && n < 12) {
        beforeStep(PHYSICS_DT);
        world.step();
        acc -= PHYSICS_DT;
        n++;
      }
    },
  };
}

function addGround(R: Rapier, world: RAPIER.World) {
  const body = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(R.ColliderDesc.cuboid(200, 0.5, 200).setRestitution(0.55).setFriction(0.7), body);
}

/** Pfosten, Latte und Netz beider Tore (passend zu world/goal.ts). */
function addGoals(R: Rapier, world: RAPIER.World) {
  const r = GOAL.postRadius;
  const halfW = GOAL.width / 2 + r;
  const top = GOAL.height + r;
  for (const side of [-1, 1]) {
    const gx = side * (PITCH.length / 2 + r);
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    const frame = (desc: RAPIER.ColliderDesc) => world.createCollider(desc.setRestitution(0.6).setFriction(0.3), body);

    // Pfosten
    for (const z of [-halfW, halfW]) {
      frame(R.ColliderDesc.cylinder(top / 2, r).setTranslation(gx, top / 2, z));
    }
    // Latte (Zylinder liegt in z-Richtung)
    frame(
      R.ColliderDesc.cylinder(halfW + r, r)
        .setTranslation(gx, top, 0)
        .setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }),
    );

    // Netz: weich, fängt den Ball (wenig Rücksprung)
    const net = (points: number[]) => {
      const desc = R.ColliderDesc.convexHull(new Float32Array(points));
      // MIN: der Rücksprung des Balls (0.7) darf das weiche Netz nicht „aufladen“
      if (desc) {
        world.createCollider(
          desc
            .setRestitution(0.02)
            .setRestitutionCombineRule(R.CoefficientCombineRule.Min)
            .setFriction(0.9),
          body,
        );
      }
    };
    const x0 = gx + side * r;
    const xt = gx + side * GOAL.depthTop;
    const xb = gx + side * GOAL.depthBottom;
    const t = 0.03 * side; // Stärke der Netz-Kollider
    // Dach
    net([x0, top, -halfW, xt, top, -halfW, xt, top, halfW, x0, top, halfW,
      x0, top + 0.03, -halfW, xt, top + 0.03, -halfW, xt, top + 0.03, halfW, x0, top + 0.03, halfW]);
    // Rückwand
    net([xt, top, -halfW, xb, 0, -halfW, xb, 0, halfW, xt, top, halfW,
      xt + t, top, -halfW, xb + t, 0, -halfW, xb + t, 0, halfW, xt + t, top, halfW]);
    // Seiten
    for (const z of [-halfW, halfW]) {
      const dz = Math.sign(z) * 0.03;
      net([x0, 0, z, x0, top, z, xt, top, z, xb, 0, z,
        x0, 0, z + dz, x0, top, z + dz, xt, top, z + dz, xb, 0, z + dz]);
    }
  }
}

/** Banden an drei Seiten, auf der Kameraseite eine unsichtbare Wand. */
function addBoards(R: Rapier, world: RAPIER.World) {
  const bx = PITCH.length / 2 + PITCH.runoff;
  const bz = PITCH.width / 2 + PITCH.runoff;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const wall = (x: number, z: number, hx: number, hz: number, h: number) =>
    world.createCollider(
      R.ColliderDesc.cuboid(hx, h / 2, hz).setTranslation(x, h / 2, z).setRestitution(0.5).setFriction(0.4),
      body,
    );
  wall(0, -bz - 0.05, bx, 0.05, 0.9);
  wall(-bx - 0.05, 0, 0.05, bz, 5);
  wall(bx + 0.05, 0, 0.05, bz, 5);
  wall(0, bz + 0.05, bx, 0.05, 3);
}
