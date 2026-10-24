import type * as THREE from 'three';

/** Abstand, den der Gegner bei Anstoß und Eindribbeln halten muss (m) */
export const RESTART_DISTANCE = 3;

/** Abstand in der Ebene (Höhe wird ignoriert) */
export function horizDist(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
