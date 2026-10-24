import * as THREE from 'three';
import { PITCH } from '../config';

type Mode = 'tv' | 'overview';

/**
 * Kamera im Stil einer Fernsehübertragung: steht erhöht an der Seitenlinie,
 * schwenkt weich mit dem Spieler mit. Alternativ eine Totale über das ganze Feld.
 */
export class BroadcastCamera {
  readonly camera: THREE.PerspectiveCamera;
  private mode: Mode = 'tv';
  /** Abstand der Kamera hinter der Seitenlinie (per Mausrad änderbar) */
  private distance = 10;
  private readonly focus = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();

  constructor(aspect: number, dom: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(34, aspect, 0.1, 2000);
    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(e.deltaY * 0.001), 6, 40);
      },
      { passive: false },
    );
  }

  toggleMode() {
    this.mode = this.mode === 'tv' ? 'overview' : 'tv';
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Sofort auf das Ziel springen (z. B. beim Start). */
  snap(target: THREE.Vector3) {
    this.update(target, 1000);
  }

  update(target: THREE.Vector3, dt: number) {
    const k = 1 - Math.exp(-3 * dt);

    if (this.mode === 'tv') {
      // Kamera folgt in x, bleibt aber innerhalb des Feldes; Blick leicht in Richtung Feldmitte.
      const maxX = PITCH.length / 2 - 2;
      const fx = THREE.MathUtils.clamp(target.x, -maxX, maxX);
      this.focus.lerp(new THREE.Vector3(fx, 0.6, target.z * 0.55 - 1), k);
      this.desiredPos.set(this.focus.x * 0.9, this.distance * 0.55, PITCH.width / 2 + this.distance);
    } else {
      this.focus.lerp(new THREE.Vector3(target.x * 0.15, 0, 0), k);
      this.desiredPos.set(this.focus.x * 0.5, 30, PITCH.width / 2 + 22);
    }

    this.camera.position.lerp(this.desiredPos, k);
    this.lookAt.lerp(this.focus, Math.min(1, k * 1.5));
    this.camera.lookAt(this.lookAt);
  }
}
