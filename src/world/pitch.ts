import * as THREE from 'three';
import { PITCH } from '../config';

/** Auflösung der Rasentextur in Pixeln pro Meter. */
const PX_PER_M = 64;

/** Breite der Mähstreifen in Metern. */
const STRIPE_WIDTH = 4;

/**
 * Erzeugt den Rasen inklusive Auslaufzone mit Mähstreifen, Farbvariationen
 * und den Spielfeldlinien. Die Linien sind direkt in die Textur gemalt,
 * so bekommen sie dieselbe Rasenstruktur wie der Rest des Platzes.
 */
export function createPitch(renderer: THREE.WebGLRenderer): THREE.Mesh {
  const sizeX = PITCH.length + 2 * PITCH.runoff;
  const sizeZ = PITCH.width + 2 * PITCH.runoff;

  const map = new THREE.CanvasTexture(paintPitch(sizeX, sizeZ));
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // Feine Grasstruktur als gekachelte Bump-Map.
  const detail = new THREE.CanvasTexture(paintGrassDetail(256));
  detail.wrapS = detail.wrapT = THREE.RepeatWrapping;
  detail.repeat.set(sizeX / 1.2, sizeZ / 1.2);
  detail.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 1,
    bumpMap: detail,
    bumpScale: 1.5,
    envMapIntensity: 0.6,
  });

  const geometry = new THREE.PlaneGeometry(sizeX, sizeZ);
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'pitch';
  return mesh;
}

function paintPitch(sizeX: number, sizeZ: number): HTMLCanvasElement {
  const w = Math.round(sizeX * PX_PER_M);
  const h = Math.round(sizeZ * PX_PER_M);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Weltkoordinaten (Meter, Feldmitte = 0) -> Canvas-Pixel
  ctx.setTransform(PX_PER_M, 0, 0, PX_PER_M, w / 2, h / 2);

  // Grundfarbe
  ctx.fillStyle = '#2f6a22';
  ctx.fillRect(-sizeX / 2, -sizeZ / 2, sizeX, sizeZ);

  // Großflächige Farbvariationen (abgenutzte / sattere Stellen)
  const rand = mulberry32(7);
  for (let i = 0; i < 160; i++) {
    const x = (rand() - 0.5) * sizeX;
    const z = (rand() - 0.5) * sizeZ;
    const r = 1 + rand() * 4;
    const g = ctx.createRadialGradient(x, z, 0, x, z, r);
    const light = rand() > 0.5;
    const a = 0.04 + rand() * 0.06;
    g.addColorStop(0, light ? `rgba(150,170,60,${a})` : `rgba(20,60,20,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, z - r, 2 * r, 2 * r);
  }

  // Abnutzung im Torraum und am Mittelpunkt
  for (const x of [-PITCH.length / 2 + 2, PITCH.length / 2 - 2, 0]) {
    const r = x === 0 ? 2.5 : 3.5;
    const g = ctx.createRadialGradient(x, 0, 0, x, 0, r);
    g.addColorStop(0, 'rgba(120,115,60,0.22)');
    g.addColorStop(1, 'rgba(120,115,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, -r, 2 * r, 2 * r);
  }

  // Mähstreifen quer zur Spielrichtung, symmetrisch zur Mittellinie
  const stripes = Math.ceil(sizeX / 2 / STRIPE_WIDTH) + 1;
  for (let i = -stripes; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(220,240,160,0.08)' : 'rgba(0,25,0,0.10)';
    ctx.fillRect(i * STRIPE_WIDTH, -sizeZ / 2, STRIPE_WIDTH, sizeZ);
  }

  paintLines(ctx);

  // Pixelrauschen für eine lebendige Oberfläche
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 22;
    d[i] = clamp255(d[i] + n * 0.8);
    d[i + 1] = clamp255(d[i + 1] + n);
    d[i + 2] = clamp255(d[i + 2] + n * 0.5);
  }
  ctx.putImageData(img, 0, 0);

  return canvas;
}

function paintLines(ctx: CanvasRenderingContext2D) {
  const L = PITCH.length / 2;
  const W = PITCH.width / 2;
  const lw = PITCH.lineWidth;

  ctx.strokeStyle = 'rgba(245,245,238,0.9)';
  ctx.fillStyle = 'rgba(245,245,238,0.9)';
  ctx.lineWidth = lw;

  // Linien liegen innerhalb der Spielfläche (Außenkante = Spielfeldgrenze)
  ctx.strokeRect(-L + lw / 2, -W + lw / 2, 2 * L - lw, 2 * W - lw);

  // Mittellinie, Mittelkreis, Anstoßpunkt
  ctx.beginPath();
  ctx.moveTo(0, -W);
  ctx.lineTo(0, W);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, PITCH.centerCircleRadius - lw / 2, 0, Math.PI * 2);
  ctx.stroke();
  dot(ctx, 0, 0, 0.12);

  // Strafräume und Strafstoßpunkte
  const pd = PITCH.penaltyAreaDepth;
  const pw = PITCH.penaltyAreaWidth / 2;
  for (const side of [-1, 1]) {
    const gx = side * L;
    ctx.beginPath();
    ctx.moveTo(gx, -pw + lw / 2);
    ctx.lineTo(gx - side * (pd - lw / 2), -pw + lw / 2);
    ctx.lineTo(gx - side * (pd - lw / 2), pw - lw / 2);
    ctx.lineTo(gx, pw - lw / 2);
    ctx.stroke();
    dot(ctx, gx - side * PITCH.penaltySpotDistance, 0, 0.1);
  }
}

function dot(ctx: CanvasRenderingContext2D, x: number, z: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, z, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Graustufen-Rauschen mit länglichen „Halmen“ für die Bump-Map. */
function paintGrassDetail(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(200,200,200)';
  ctx.fillRect(0, 0, size, size);

  const rand = mulberry32(42);
  ctx.lineCap = 'round';
  for (let i = 0; i < 5000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 2 + rand() * 5;
    const ang = rand() * Math.PI * 2;
    const v = Math.round(150 + rand() * 105);
    ctx.strokeStyle = `rgb(${v},${v},${v})`;
    ctx.lineWidth = 0.6 + rand();
    // Kacheln nahtlos: an den Rändern versetzt wiederholen
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.lineTo(x + ox + Math.cos(ang) * len, y + oy + Math.sin(ang) * len);
        ctx.stroke();
      }
    }
  }
  return canvas;
}

function clamp255(v: number) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/** Kleiner deterministischer Zufallsgenerator, damit der Platz immer gleich aussieht. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
