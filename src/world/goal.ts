import * as THREE from 'three';
import { GOAL, PITCH } from '../config';

/** Maschenweite des Tornetzes in Metern. */
const MESH_SIZE = 0.1;

/**
 * Baut ein mobiles Jugendtor (5 × 2 m) mit Rahmen, Stützrohren und Netz.
 * Lokales System: Torlinie bei x = 0, das Tor öffnet sich nach -x (zum Feld),
 * das Netz liegt bei +x.
 */
export function createGoal(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'goal';

  const r = GOAL.postRadius;
  const halfW = GOAL.width / 2 + r;
  const top = GOAL.height + r;
  const dTop = GOAL.depthTop;
  const dBot = GOAL.depthBottom;

  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.35, metalness: 0.1 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.8 });

  // Pfosten stehen mit ihrer Hinterkante auf der Torlinie.
  const frontX = r;
  for (const z of [-halfW, halfW]) {
    group.add(tube(new THREE.Vector3(frontX, 0, z), new THREE.Vector3(frontX, top, z), r, white));
  }
  group.add(tube(new THREE.Vector3(frontX, top, -halfW - r), new THREE.Vector3(frontX, top, halfW + r), r, white));

  // Dach- und Bodenrahmen, schräge Rückstreben
  const sr = 0.018;
  for (const z of [-halfW, halfW]) {
    group.add(tube(new THREE.Vector3(frontX, top, z), new THREE.Vector3(dTop, top, z), sr, metal));
    group.add(tube(new THREE.Vector3(dTop, top, z), new THREE.Vector3(dBot, sr, z), sr, metal));
    group.add(tube(new THREE.Vector3(frontX, sr, z), new THREE.Vector3(dBot, sr, z), sr, metal));
  }
  group.add(tube(new THREE.Vector3(dTop, top, -halfW), new THREE.Vector3(dTop, top, halfW), sr, metal));
  group.add(tube(new THREE.Vector3(dBot, sr, -halfW), new THREE.Vector3(dBot, sr, halfW), sr, metal));

  group.add(createNet(frontX + r, halfW, top, dTop, dBot));

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.name !== 'net') {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return group;
}

/** Stellt beide Tore an die Torlinien. */
export function createGoals(): THREE.Group {
  const goals = new THREE.Group();
  for (const side of [-1, 1]) {
    const g = createGoal();
    g.position.x = side * (PITCH.length / 2);
    g.rotation.y = side > 0 ? 0 : Math.PI;
    goals.add(g);
  }
  return goals;
}

function tube(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const geom = new THREE.CylinderGeometry(radius, radius, dir.length(), 16);
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return mesh;
}

function createNet(x0: number, halfW: number, top: number, dTop: number, dBot: number): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];

  // Fügt ein Viereck hinzu; UVs in Metern, damit die Maschen überall gleich groß sind.
  const quad = (p: THREE.Vector3[], uv: [number, number][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(p[i].x, p[i].y, p[i].z);
      uvs.push(uv[i][0] / MESH_SIZE, uv[i][1] / MESH_SIZE);
    }
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const back = Math.hypot(dBot - dTop, top);
  const W = 2 * halfW;

  // Dach
  quad([V(x0, top, -halfW), V(dTop, top, -halfW), V(dTop, top, halfW), V(x0, top, halfW)],
    [[0, 0], [dTop - x0, 0], [dTop - x0, W], [0, W]]);
  // Rückwand (schräg)
  quad([V(dTop, top, -halfW), V(dBot, 0, -halfW), V(dBot, 0, halfW), V(dTop, top, halfW)],
    [[0, 0], [back, 0], [back, W], [0, W]]);
  // Seitenteile (Trapez als zwei Vierecke: vorne Rechteck + hinten Dreieck)
  for (const z of [-halfW, halfW]) {
    quad([V(x0, 0, z), V(x0, top, z), V(dTop, top, z), V(dTop, 0, z)],
      [[x0, 0], [x0, top], [dTop, top], [dTop, 0]]);
    quad([V(dTop, 0, z), V(dTop, top, z), V(dBot, 0, z), V(dBot, 0, z)],
      [[dTop, 0], [dTop, top], [dBot, 0], [dBot, 0]]);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.computeVertexNormals();

  const tex = new THREE.CanvasTexture(paintNetCell(64));
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.9,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'net';
  mesh.renderOrder = 1;
  return mesh;
}

/** Eine Netzmasche: helle Schnur am Rand, sonst durchsichtig. */
function paintNetCell(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(240,240,240,0.95)';
  ctx.lineWidth = size * 0.09;
  ctx.strokeRect(0, 0, size, size);
  // Knoten
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (const [x, y] of [[0, 0], [size, 0], [0, size], [size, size]]) {
    ctx.beginPath();
    ctx.arc(x, y, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}
