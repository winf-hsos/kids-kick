import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { Kit } from '../teams';

/** Eintrag aus public/models/players/players.json (erzeugt von tools/characters). */
export interface CharacterInfo {
  id: string;
  label: string;
  gender: 'm' | 'f';
  heightM: number;
  /** Bodengeschwindigkeit (m/s), bei der die Animationen ohne Fußrutschen laufen */
  naturalSpeed: { walk: number; run: number };
  file: string;
}

export interface CharacterInstance {
  info: CharacterInfo;
  root: THREE.Object3D;
  clips: THREE.AnimationClip[];
}

const BASE = `${import.meta.env.BASE_URL}models/players/`;

/** Lädt Spielertypen einmalig und erzeugt eingekleidete Instanzen davon. */
export class CharacterLibrary {
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private readonly cache = new Map<string, Promise<GLTF>>();
  private constructor(readonly roster: Map<string, CharacterInfo>) {}

  static async load(): Promise<CharacterLibrary> {
    const res = await fetch(`${BASE}players.json`);
    if (!res.ok) throw new Error(`players.json nicht gefunden (${res.status})`);
    const data = (await res.json()) as { players: CharacterInfo[] };
    return new CharacterLibrary(new Map(data.players.map((p) => [p.id, p])));
  }

  async create(id: string, kit: Kit, number: number, renderer: THREE.WebGLRenderer): Promise<CharacterInstance> {
    const info = this.roster.get(id);
    if (!info) throw new Error(`Unbekannter Spielertyp „${id}“`);
    let gltf = this.cache.get(id);
    if (!gltf) {
      gltf = this.loader.loadAsync(BASE + info.file);
      this.cache.set(id, gltf);
    }
    const { scene, animations } = await gltf;
    const root = SkeletonUtils.clone(scene);
    dressUp(root, kit, number, info.label, renderer);
    return { info, root, clips: animations };
  }
}

function dressUp(root: THREE.Object3D, kit: Kit, number: number, name: string, renderer: THREE.WebGLRenderer) {
  const jerseyMap = createJerseyTexture(kit, number, name);
  jerseyMap.anisotropy = renderer.capabilities.getMaxAnisotropy();

  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Animierte Figuren haben unzuverlässige Bounding-Boxen
    mesh.frustumCulled = false;

    const src = mesh.material as THREE.MeshStandardMaterial;
    let mat: THREE.MeshStandardMaterial;
    switch (src.name) {
      case 'Jersey':
        mat = new THREE.MeshStandardMaterial({ name: 'Jersey', map: jerseyMap, roughness: 0.78, side: THREE.DoubleSide });
        break;
      case 'Shorts':
        mat = new THREE.MeshStandardMaterial({ name: 'Shorts', color: kit.shorts, roughness: 0.7, side: THREE.DoubleSide });
        break;
      case 'Socks':
        mat = new THREE.MeshStandardMaterial({ name: 'Socks', color: kit.socks, roughness: 0.9 });
        break;
      case 'Boots':
        mat = src.clone();
        mat.color.set(kit.boots);
        break;
      case 'Hair':
      case 'Brows':
        mat = src.clone();
        mat.transparent = false;
        mat.alphaTest = 0.45;
        mat.alphaToCoverage = true;
        mat.side = THREE.DoubleSide;
        break;
      default:
        mat = src.clone();
    }
    mesh.material = mat;
  });
}

/**
 * Trikot-Textur. Die UVs kommen aus einer Zylinderprojektion um den Rumpf:
 * u = 0.25 Rückenmitte, 0.75 Brustmitte; oben im Bild = Halsansatz.
 */
function createJerseyTexture(kit: Kit, number: number, name: string): THREE.CanvasTexture {
  const W = 1024;
  const H = 512;
  // Der Rumpf ist breiter als hoch; Schrift horizontal strecken, damit sie nicht gestaucht wirkt.
  const stretch = 1.2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = kit.shirt;
  ctx.fillRect(0, 0, W, H);

  // Leichte Stoffstruktur und Schattierung
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(0,0,0,0.10)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let x = 0; x < W; x += 6) ctx.fillRect(x, 0, 2, H);

  const text = (str: string, x: number, y: number, size: number, fill: string, outline: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(stretch, 1);
    ctx.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.08;
    ctx.strokeStyle = outline;
    ctx.strokeText(str, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillText(str, 0, 0);
    ctx.restore();
  };

  // Rücken: Name und große Nummer
  text(name.toUpperCase(), W * 0.25, H * 0.17, 58, kit.number, kit.accent);
  text(String(number), W * 0.25, H * 0.5, 210, kit.number, kit.accent);

  // Brust: kleine Nummer rechts, Vereinswappen links (vom Betrachter aus gesehen umgekehrt)
  text(String(number), W * 0.69, H * 0.27, 64, kit.number, kit.accent);
  ctx.save();
  ctx.translate(W * 0.81, H * 0.27);
  ctx.scale(stretch, 1);
  ctx.beginPath();
  ctx.moveTo(-24, -28);
  ctx.lineTo(24, -28);
  ctx.lineTo(24, 4);
  ctx.quadraticCurveTo(24, 26, 0, 34);
  ctx.quadraticCurveTo(-24, 26, -24, 4);
  ctx.closePath();
  ctx.fillStyle = kit.accent;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = kit.shirt;
  ctx.stroke();
  ctx.restore();

  // Brustsponsor
  text('KIDS KICK', W * 0.75, H * 0.5, 40, kit.accent, kit.shirt);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  // glTF-UVs: Ursprung oben links
  tex.flipY = false;
  return tex;
}
