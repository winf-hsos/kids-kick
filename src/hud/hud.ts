import type { Team } from '../teams';

/** Bildschirmanzeigen: Spielstand, Uhr, gesteuerter Spieler, Schusskraft, Meldungen. */
export class Hud {
  private readonly score: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly controlled: HTMLElement;
  private readonly powerWrap: HTMLElement;
  private readonly power: HTMLElement;
  private readonly message: HTMLElement;
  private readonly messageSub: HTMLElement;
  private messageTimer = 0;

  constructor(teams: readonly Team[]) {
    const root = document.getElementById('hud')!;
    const el = (cls: string, parent: HTMLElement = root, tag = 'div') => {
      const e = document.createElement(tag);
      e.className = cls;
      parent.appendChild(e);
      return e;
    };

    const board = el('scoreboard');
    const team = (t: Team) => {
      const box = el('team', board);
      const chip = el('chip', box, 'span');
      chip.style.background = t.kit.shirt;
      chip.style.borderColor = t.kit.accent;
      el('name', box, 'span').textContent = t.name;
    };
    team(teams[0]);
    this.score = el('score', board);
    team(teams[1]);
    this.clock = el('clock', board);

    this.controlled = el('controlled');
    this.powerWrap = el('power');
    this.power = el('fill', this.powerWrap);
    const msg = el('message');
    this.message = el('title', msg);
    this.messageSub = el('sub', msg);
    this.setScore(0, 0);
  }

  setScore(a: number, b: number) {
    this.score.textContent = `${a} : ${b}`;
  }

  setClock(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    this.clock.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  setControlled(number: number | null, name: string) {
    this.controlled.textContent = number === null ? name : `▶ ${number}  ${name}`;
  }

  /** Schusskraft bzw. Passhärte 0..1, null blendet den Balken aus */
  setPower(p: number | null, kind: 'pass' | 'shot' = 'shot') {
    this.powerWrap.classList.toggle('visible', p !== null);
    this.powerWrap.classList.toggle('pass', kind === 'pass');
    if (p !== null) this.power.style.width = `${Math.round(p * 100)}%`;
  }

  showMessage(title: string, sub = '', seconds = 2.5) {
    this.message.textContent = title;
    this.messageSub.textContent = sub;
    this.message.parentElement!.classList.add('visible');
    this.messageTimer = seconds;
  }

  update(dt: number) {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message.parentElement!.classList.remove('visible');
    }
  }
}
