/**
 * Vereinheitlicht Tastatur und Gamepad zu einem Steuerzustand.
 * Richtungen sind bildschirmbezogen: x = rechts, y = „nach oben“ (vom Betrachter weg).
 */
export interface InputState {
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** Wird genau ein Frame lang true, wenn die Kamera gewechselt werden soll. */
  switchCamera: boolean;
}

const DEADZONE = 0.18;

export class Input {
  private keys = new Set<string>();
  private cameraPressed = false;
  private padCameraWasDown = false;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && !e.repeat) this.cameraPressed = true;
      this.keys.add(e.code);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.keys.delete(e.code));
    target.addEventListener('blur', () => this.keys.clear());
  }

  read(): InputState {
    const k = (...codes: string[]) => codes.some((c) => this.keys.has(c));
    let x = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    let y = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
    let sprint = k('ShiftLeft', 'ShiftRight');
    let switchCamera = this.cameraPressed;
    this.cameraPressed = false;

    const pad = firstGamepad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const ay = -(pad.axes[1] ?? 0);
      const mag = Math.hypot(ax, ay);
      if (mag > DEADZONE) {
        // Deadzone herausrechnen, damit der Stick weich ab 0 anläuft
        const scale = Math.min(1, (mag - DEADZONE) / (1 - DEADZONE)) / mag;
        x = ax * scale;
        y = ay * scale;
      }
      // Standard-Mapping: 5 = R1/RB, 7 = R2/RT, 3 = Dreieck/Y
      if (pressed(pad, 7) || pressed(pad, 5)) sprint = true;
      const camDown = pressed(pad, 3);
      if (camDown && !this.padCameraWasDown) switchCamera = true;
      this.padCameraWasDown = camDown;
    }

    // Diagonalen auf Länge 1 begrenzen (Tastatur)
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { moveX: x, moveY: y, sprint, switchCamera };
  }
}

function firstGamepad(): Gamepad | null {
  if (!navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) if (p && p.connected) return p;
  return null;
}

function pressed(pad: Gamepad, i: number): boolean {
  const b = pad.buttons[i];
  return !!b && (b.pressed || b.value > 0.3);
}
