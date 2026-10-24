/**
 * Vereinheitlicht Tastatur und Gamepad zu einem Steuerzustand.
 * Richtungen sind bildschirmbezogen: x = rechts, y = „nach oben“ (vom Betrachter weg).
 */
export interface InputState {
  moveX: number;
  moveY: number;
  sprint: boolean;
  /** Pass: genau ein Frame lang true beim Drücken */
  pass: boolean;
  /** Schuss: true, solange gehalten (Kraft aufladen) */
  shoot: boolean;
  /** Schuss-Taste wurde seit dem letzten Bild gedrückt (auch bei ganz kurzem Antippen) */
  shootTap: boolean;
  /** Spielerwechsel: genau ein Frame lang true */
  switchPlayer: boolean;
  /** Kamera wechseln: genau ein Frame lang true */
  switchCamera: boolean;
  /** Pause umschalten: genau ein Frame lang true */
  pause: boolean;
}

export const NO_INPUT: InputState = {
  moveX: 0,
  moveY: 0,
  sprint: false,
  pass: false,
  shoot: false,
  shootTap: false,
  switchPlayer: false,
  switchCamera: false,
  pause: false,
};

const DEADZONE = 0.18;

// Gamepad-Standardbelegung (PlayStation / Xbox)
const PAD = { pass: 0, shoot: 1, camera: 3, switchPlayer: 4, sprintR1: 5, sprintR2: 7, start: 9 } as const;

type EdgeAction = 'pass' | 'shootTap' | 'switchPlayer' | 'switchCamera' | 'pause';

const KEY_EDGES: Record<string, EdgeAction> = {
  KeyE: 'pass',
  Space: 'shootTap',
  KeyK: 'shootTap',
  KeyJ: 'pass',
  KeyQ: 'switchPlayer',
  KeyL: 'switchPlayer',
  KeyC: 'switchCamera',
  KeyP: 'pause',
};

export class Input {
  private keys = new Set<string>();
  private pressed = new Set<EdgeAction>();
  private padPrev = new Map<number, boolean>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const edge = KEY_EDGES[e.code];
      if (edge && !e.repeat) this.pressed.add(edge);
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
    let shoot = k('Space', 'KeyK');
    const edges = new Set(this.pressed);
    this.pressed.clear();

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
      if (isDown(pad, PAD.sprintR2) || isDown(pad, PAD.sprintR1)) sprint = true;
      if (isDown(pad, PAD.shoot)) shoot = true;
      const edge = (button: number, action: EdgeAction) => {
        const down = isDown(pad, button);
        if (down && !this.padPrev.get(button)) edges.add(action);
        this.padPrev.set(button, down);
      };
      edge(PAD.pass, 'pass');
      edge(PAD.shoot, 'shootTap');
      edge(PAD.switchPlayer, 'switchPlayer');
      edge(PAD.camera, 'switchCamera');
      edge(PAD.start, 'pause');
    }

    // Diagonalen auf Länge 1 begrenzen (Tastatur)
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return {
      moveX: x,
      moveY: y,
      sprint,
      shoot,
      pass: edges.has('pass'),
      shootTap: edges.has('shootTap'),
      switchPlayer: edges.has('switchPlayer'),
      switchCamera: edges.has('switchCamera'),
      pause: edges.has('pause'),
    };
  }
}

function firstGamepad(): Gamepad | null {
  if (!navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) if (p && p.connected) return p;
  return null;
}

function isDown(pad: Gamepad, i: number): boolean {
  const b = pad.buttons[i];
  return !!b && (b.pressed || b.value > 0.3);
}
