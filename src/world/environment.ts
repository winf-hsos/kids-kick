import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { PITCH } from '../config';
import { mulberry32 } from './pitch';

/** Sonnenstand: hinter der TV-Kamera links, damit die Spieler von vorne beleuchtet sind. */
const SUN_ELEVATION_DEG = 38;
const SUN_AZIMUTH_DEG = 145;

export interface Lighting {
  sun: THREE.DirectionalLight;
}

/** Himmel, Umgebungslicht (Image Based Lighting), Sonne mit Schatten und Dunst. */
export function setupSkyAndLight(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Lighting {
  const sunDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG),
    THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG),
  );

  const sky = new Sky();
  sky.scale.setScalar(4000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4;
  u.rayleigh.value = 1.2;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.8;
  u.sunPosition.value.copy(sunDir);
  scene.add(sky);

  // Umgebungs-Map aus dem Himmel erzeugen -> realistische Reflexionen und Aufhellung
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(4000);
  Object.assign(envSky.material.uniforms, THREE.UniformsUtils.clone(sky.material.uniforms));
  envScene.add(envSky);
  // Grüner Bodenreflex, damit Unterseiten nicht blau wirken
  const groundBounce = new THREE.Mesh(
    new THREE.CircleGeometry(1000, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x2a4a1c }),
  );
  groundBounce.position.y = -1;
  envScene.add(groundBounce);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.45;
  pmrem.dispose();

  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.copy(sunDir).multiplyScalar(60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const s = sun.shadow.camera;
  s.left = -32;
  s.right = 32;
  s.top = 32;
  s.bottom = -32;
  s.near = 1;
  s.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  scene.fog = new THREE.Fog(0xb8cbd8, 45, 380);

  return { sun };
}

/** Banden, Rasen außerhalb, Bäume am Horizont. */
export function createSurroundings(renderer: THREE.WebGLRenderer): THREE.Group {
  const group = new THREE.Group();
  group.name = 'surroundings';

  group.add(createOuterGround(renderer));
  group.add(createBoards());
  group.add(createBallFences());
  group.add(createDugouts());
  group.add(createTrees());
  return group;
}

function createOuterGround(renderer: THREE.WebGLRenderer): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#2e5a20';
  ctx.fillRect(0, 0, 512, 512);
  const rand = mulberry32(3);
  for (let i = 0; i < 400; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const r = 8 + rand() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rand() * 0.1;
    g.addColorStop(0, rand() > 0.5 ? `rgba(140,150,60,${a})` : `rgba(15,45,15,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const img = ctx.getImageData(0, 0, 512, 512);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 26;
    img.data[i] += n * 0.8;
    img.data[i + 1] += n;
    img.data[i + 2] += n * 0.5;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(80, 80);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(600, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 1, envMapIntensity: 0.5 }),
  );
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return mesh;
}

const BOARD_ADS: { bg: string; fg: string; text: string }[] = [
  { bg: '#e63946', fg: '#ffffff', text: 'KIDS KICK' },
  { bg: '#1d3557', fg: '#ffd166', text: 'FAIR PLAY' },
  { bg: '#ffd166', fg: '#1d3557', text: 'E-JUGEND' },
  { bg: '#2a9d8f', fg: '#ffffff', text: '4 + 1' },
  { bg: '#f1faee', fg: '#e63946', text: 'F-JUGEND' },
  { bg: '#264653', fg: '#e9c46a', text: 'TOR!' },
];

function createBoards(): THREE.Group {
  const group = new THREE.Group();
  const panelW = 2.5;
  const panelH = 0.8;
  const thick = 0.05;

  const materials = BOARD_ADS.map((ad) => {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 164;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = ad.bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = ad.fg;
    ctx.font = 'italic 900 92px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ad.text, c.width / 2, c.height / 2 + 4);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
  });
  const backMat = new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.7 });
  const geom = new THREE.BoxGeometry(panelW, panelH, thick);

  const bx = PITCH.length / 2 + PITCH.runoff;
  const bz = PITCH.width / 2 + PITCH.runoff;
  let k = 0;

  // Eine Bandenreihe entlang einer Strecke; die bedruckte Seite zeigt zum Feld.
  const row = (from: THREE.Vector3, to: THREE.Vector3, facing: number) => {
    const len = from.distanceTo(to);
    const n = Math.floor(len / panelW);
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    for (let i = 0; i < n; i++) {
      const mat = materials[k++ % materials.length];
      // BoxGeometry-Seiten: +x, -x, +y, -y, +z (Vorderseite), -z
      const mesh = new THREE.Mesh(geom, [backMat, backMat, backMat, backMat, mat, backMat]);
      mesh.position.copy(from).addScaledVector(dir, (i + 0.5) * (len / n));
      mesh.position.y = panelH / 2 + 0.03;
      mesh.rotation.y = facing;
      mesh.rotateX(-0.12); // leicht nach hinten geneigt
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  };

  row(new THREE.Vector3(-bx, 0, -bz), new THREE.Vector3(bx, 0, -bz), 0); // gegenüber
  // Auf der Kameraseite keine Bande, damit der Blick aufs Feld frei bleibt (wie im TV).
  row(new THREE.Vector3(-bx, 0, -bz), new THREE.Vector3(-bx, 0, bz), Math.PI / 2);
  row(new THREE.Vector3(bx, 0, -bz), new THREE.Vector3(bx, 0, bz), -Math.PI / 2);
  return group;
}

function createTrees(): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(11);
  const count = 160;
  const blobsPerTree = 6;

  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.3, 1, 8).translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 3);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5a4a3c, roughness: 1 }), count);
  const crowns = new THREE.InstancedMesh(
    crownGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.95, envMapIntensity: 0.4 }),
    count * blobsPerTree,
  );

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const ang = rand() * Math.PI * 2;
    const dist = 70 + rand() * 90;
    const x = Math.cos(ang) * dist * 1.25;
    const z = Math.sin(ang) * dist;
    const h = 8 + rand() * 10;
    const trunkH = h * 0.35;
    const crownR = h * (0.28 + rand() * 0.1);

    m.compose(pos.set(x, 0, z), q.identity(), scl.set(1 + h / 15, trunkH + crownR, 1 + h / 15));
    trunks.setMatrixAt(i, m);

    // Krone aus mehreren unregelmäßigen Kugeln
    const hue = 0.22 + rand() * 0.1;
    for (let j = 0; j < blobsPerTree; j++) {
      const r = crownR * (0.6 + rand() * 0.4);
      m.compose(
        pos.set(x + (rand() - 0.5) * crownR * 1.2, trunkH + crownR * (0.7 + rand() * 0.9), z + (rand() - 0.5) * crownR * 1.2),
        q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)),
        scl.set(r, r * (0.8 + rand() * 0.4), r),
      );
      crowns.setMatrixAt(i * blobsPerTree + j, m);
      crowns.setColorAt(i * blobsPerTree + j, color.setHSL(hue + (rand() - 0.5) * 0.03, 0.4 + rand() * 0.15, 0.13 + rand() * 0.08));
    }
  }
  group.add(trunks, crowns);
  return group;
}

/** Hohe Ballfangzäune hinter beiden Toren, wie auf Vereinsplätzen üblich. */
function createBallFences(): THREE.Group {
  const group = new THREE.Group();
  const height = 5;
  const halfWidth = PITCH.width / 2 + PITCH.runoff;
  const x = PITCH.length / 2 + PITCH.runoff + 0.6;

  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(30,60,40,0.9)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set((2 * halfWidth) / 0.12, height / 0.12);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const netMat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f4f3a, roughness: 0.5, metalness: 0.6 });
  const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, height, 10).translate(0, height / 2, 0);

  for (const side of [-1, 1]) {
    const net = new THREE.Mesh(new THREE.PlaneGeometry(2 * halfWidth, height), netMat);
    net.position.set(side * x, height / 2, 0);
    net.rotation.y = Math.PI / 2;
    group.add(net);
    for (let z = -halfWidth; z <= halfWidth + 0.01; z += (2 * halfWidth) / 6) {
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(side * x, 0, z);
      pole.castShadow = true;
      group.add(pole);
    }
  }
  return group;
}

/** Zwei überdachte Auswechselbänke hinter der gegenüberliegenden Bande. */
function createDugouts(): THREE.Group {
  const group = new THREE.Group();
  const z = -(PITCH.width / 2 + PITCH.runoff + 1.3);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.4, metalness: 0.7 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe6f2,
    transparent: true,
    opacity: 0.35,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1d3557, roughness: 0.6 });

  for (const x of [-6, 6]) {
    const dug = new THREE.Group();
    const w = 5;
    const h = 2.1;
    const d = 1.4;
    // Rückwand, Seiten und Dach aus Plexiglas
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassMat);
    back.position.set(0, h / 2, -d / 2);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(w, d), glassMat);
    roof.rotation.x = -Math.PI / 2 + 0.12;
    roof.position.set(0, h, 0);
    dug.add(back, roof);
    for (const sx of [-w / 2, w / 2]) {
      const side = new THREE.Mesh(new THREE.PlaneGeometry(d, h), glassMat);
      side.rotation.y = Math.PI / 2;
      side.position.set(sx, h / 2, 0);
      dug.add(side);
      for (const fz of [-d / 2, d / 2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), frameMat);
        post.position.set(sx, h / 2, fz);
        post.castShadow = true;
        dug.add(post);
      }
    }
    // Sitzschalen
    for (let i = 0; i < 8; i++) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.45), seatMat);
      seat.position.set(-w / 2 + 0.4 + i * 0.6, 0.25, -d / 2 + 0.35);
      seat.castShadow = true;
      dug.add(seat);
    }
    dug.position.set(x, 0, z);
    group.add(dug);
  }
  return group;
}
