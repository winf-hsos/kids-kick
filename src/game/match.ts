import * as THREE from 'three';
import { BALL_RADIUS, type Ball } from '../ball/ball';
import { GOAL, PITCH } from '../config';
import type { Hud } from '../hud/hud';
import { NO_INPUT, type InputState } from '../input/input';
import type { Player } from '../player/player';
import { kickoffSpot, type Team } from '../teams';

/** Bis zu diesem Abstand (m) vom Fuß kann ein Spieler den Ball annehmen. */
const CONTROL_RADIUS = 0.7;
/** Nach einem Schuss/Pass darf der Schütze den Ball kurz nicht wieder annehmen. */
const KICK_COOLDOWN = 0.45;
/** Zeit bis zur vollen Schusskraft (s) */
const CHARGE_TIME = 1.0;

type Phase =
  | { kind: 'play' }
  | { kind: 'stopped'; timer: number; restart: () => void };

/**
 * Spiellogik: Ballbesitz und Dribbeln, Pass, Schuss, Spielerwechsel,
 * Tor und Aus nach Kinderfußball-Regeln (Eindribbeln, Ecke, Abstoß).
 * Team 0 wird vom Menschen gesteuert und spielt in Richtung +x.
 */
export class Match {
  controlled: Player;
  private possessor: Player | null = null;
  private lastTouch: 0 | 1 | null = null;
  private lastKicker: Player | null = null;
  private cooldown = new Map<Player, number>();
  private charge: number | null = null;
  private phase: Phase = { kind: 'play' };
  private clock = 0;
  readonly score: [number, number] = [0, 0];

  constructor(
    private readonly players: Player[],
    private readonly ball: Ball,
    private readonly teams: readonly Team[],
    private readonly hud: Hud,
  ) {
    this.controlled = this.striker(0);
    this.kickoff(0);
  }

  /** Spieler, zu dem der Ball gerade gehört (oder null). */
  get ballOwner() {
    return this.possessor;
  }

  // -------------------------------------------------------------------------
  // Pro Bild
  // -------------------------------------------------------------------------

  update(dt: number, input: InputState) {
    this.clock += dt;
    this.hud.setClock(this.clock);
    for (const [p, t] of this.cooldown) {
      if (t - dt <= 0) this.cooldown.delete(p);
      else this.cooldown.set(p, t - dt);
    }

    if (this.phase.kind === 'stopped') {
      this.phase.timer -= dt;
      if (this.phase.timer <= 0) {
        const restart = this.phase.restart;
        this.phase = { kind: 'play' };
        restart();
      }
    }

    const me = this.controlled;
    if (input.switchPlayer && this.possessor !== me) this.switchToNearest();
    if (input.pass) this.tryPass(input);
    this.handleShot(dt, input);

    const ballPos = this.ball.position.clone();
    for (const p of this.players) p.update(dt, p === this.controlled ? input : NO_INPUT, ballPos);
    for (const p of this.players) if (p !== this.controlled) this.controlled.separateFrom(p);

    this.updatePossession();
  }

  /** Vor jedem Physikschritt: Ball am Fuß des Ballbesitzers führen. */
  preStep() {
    const p = this.possessor;
    if (!p || p.isKicking) return;
    const ball = this.ball.position;
    const moving = p.speed > 0.4;
    const dir = moving ? p.velocity.clone().setY(0).normalize() : p.facing;
    // Beim Sprint springt der Ball weiter vom Fuß
    const lead = 0.42 + 0.07 * p.speed;
    const target = p.position.clone().addScaledVector(dir, lead);
    const v = p.velocity.clone().add(target.sub(ball).setY(0).multiplyScalar(9));
    const max = p.speed + 4;
    if (v.length() > max) v.setLength(max);
    v.y = this.ball.onGround ? 0 : this.ball.velocity.y;
    this.ball.setVelocity(v);
    this.ball.matchRolling();
  }

  /** Nach dem Physikschritt: Regeln prüfen. */
  postStep() {
    if (this.phase.kind !== 'play') return;
    const b = this.ball.position;
    const goalLine = PITCH.length / 2 + BALL_RADIUS;
    const touchLine = PITCH.width / 2 + BALL_RADIUS;

    if (Math.abs(b.x) > goalLine) {
      const side = Math.sign(b.x) as -1 | 1;
      const inGoal = Math.abs(b.z) < GOAL.width / 2 && b.y < GOAL.height;
      if (inGoal) this.goal(side > 0 ? 0 : 1);
      else this.goalLineOut(side, b.z);
    } else if (Math.abs(b.z) > touchLine) {
      this.touchLineOut(b.x, Math.sign(b.z));
    }
  }

  // -------------------------------------------------------------------------
  // Ballbesitz
  // -------------------------------------------------------------------------

  private updatePossession() {
    if (this.phase.kind !== 'play') {
      this.possessor = null;
      return;
    }
    const ball = this.ball.position;
    if (this.possessor) {
      const d = horizDist(this.possessor.position, ball);
      if (d > 1.5 || ball.y > 0.8) this.possessor = null;
    }
    // Ball fliegt zu hoch oder zu schnell -> keine Annahme
    const speed = this.ball.velocity.length();
    if (ball.y > 0.45) return;

    let best: Player | null = null;
    let bestD = CONTROL_RADIUS;
    for (const p of this.players) {
      if (this.cooldown.has(p) || p.isKicking) continue;
      const foot = p.position.clone().addScaledVector(p.facing, 0.25);
      const d = horizDist(foot, ball);
      // Gesteuerter Spieler darf dem Gegner den Ball abnehmen, Gegner (noch ohne KI) nicht
      if (this.possessor && (this.possessor === p || p !== this.controlled)) continue;
      if (!this.possessor && speed > 14) continue;
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (best) this.takePossession(best);
  }

  private takePossession(p: Player) {
    this.possessor = p;
    this.lastTouch = p.team;
    if (p.team === 0 && p !== this.controlled) this.setControlled(p);
  }

  private setControlled(p: Player) {
    this.controlled = p;
    this.hud.setControlled(p.number, p.info.label);
  }

  private switchToNearest() {
    const ball = this.ball.position;
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (p.team !== 0 || p === this.controlled) continue;
      const d = horizDist(p.position, ball);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    if (best) this.setControlled(best);
  }

  // -------------------------------------------------------------------------
  // Pass und Schuss
  // -------------------------------------------------------------------------

  private canKick(p: Player) {
    if (this.phase.kind !== 'play' || p.isKicking) return false;
    if (this.possessor === p) return true;
    // Freier Ball in Reichweite: direkt spielen
    return !this.possessor && horizDist(p.position, this.ball.position) < 1.0 && this.ball.position.y < 0.6;
  }

  private inputDir(input: InputState, p: Player) {
    const d = new THREE.Vector3(input.moveX, 0, -input.moveY);
    return d.lengthSq() > 0.09 ? d.normalize() : p.facing;
  }

  private tryPass(input: InputState) {
    const p = this.controlled;
    if (!this.canKick(p)) return;
    const dir = this.inputDir(input, p);

    // Mitspieler in Passrichtung suchen (Winkel wichtiger als Entfernung)
    let receiver: Player | null = null;
    let bestScore = Infinity;
    for (const mate of this.players) {
      if (mate.team !== p.team || mate === p) continue;
      const to = mate.position.clone().sub(p.position).setY(0);
      const dist = to.length();
      if (dist < 2) continue;
      const angle = to.normalize().angleTo(dir);
      if (angle > THREE.MathUtils.degToRad(65)) continue;
      const score = angle * 3 + dist * 0.06;
      if (score < bestScore) {
        bestScore = score;
        receiver = mate;
      }
    }

    const target = receiver
      ? receiver.position.clone().addScaledVector(receiver.velocity, 0.6)
      : p.position.clone().addScaledVector(dir, 12);
    const to = target.sub(this.ball.position).setY(0);
    const dist = to.length();
    const speed = THREE.MathUtils.clamp(3.2 + dist * 0.8, 6, 17);
    const kickDir = to.normalize();

    this.kickBall(p, 'pass', kickDir, 0.7, () => kickDir.clone().multiplyScalar(speed).setY(0.4));
    if (receiver) this.setControlled(receiver);
  }

  private handleShot(dt: number, input: InputState) {
    const p = this.controlled;
    if (input.shoot) {
      if (this.charge === null && this.canKick(p)) this.charge = 0;
      if (this.charge !== null) this.charge = Math.min(1, this.charge + dt / CHARGE_TIME);
    } else if (this.charge !== null) {
      const power = Math.max(0.15, this.charge);
      this.charge = null;
      if (this.canKick(p)) this.shoot(p, power, input);
    } else if (input.shootTap && this.canKick(p)) {
      // Nur kurz angetippt (zwischen zwei Bildern gedrückt und losgelassen)
      this.shoot(p, 0.2, input);
    }
    this.hud.setPower(this.charge);
  }

  private shoot(p: Player, power: number, input: InputState) {
    // Ziel: gegnerisches Tor; mit dem Stick nach oben/unten zielt man auf eine Ecke
    const goalX = (p.team === 0 ? 1 : -1) * (PITCH.length / 2 + 0.5);
    const aimZ = THREE.MathUtils.clamp(-input.moveY * 2.1 + (Math.random() - 0.5) * 0.6, -2.3, 2.3);
    const to = new THREE.Vector3(goalX, 0, aimZ).sub(this.ball.position).setY(0);
    // Streuung: je härter, desto ungenauer
    const spread = THREE.MathUtils.degToRad((1.5 + 4 * power) * (Math.random() * 2 - 1));
    const dir = to.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), spread);
    const speed = 9 + 10 * power;
    const elevation = THREE.MathUtils.degToRad(3 + 13 * power + (Math.random() - 0.5) * 6 * power);

    this.kickBall(p, 'shot', dir, power, () =>
      dir.clone().multiplyScalar(speed * Math.cos(elevation)).setY(speed * Math.sin(elevation)),
    );
  }

  private kickBall(p: Player, kind: 'pass' | 'shot', dir: THREE.Vector3, strength: number, velocity: () => THREE.Vector3) {
    // Den Ball während des Ausholens vor dem Fuß halten
    p.kick(kind, dir, strength, () => {
      if (this.phase.kind !== 'play') return;
      if (horizDist(p.position, this.ball.position) > 1.3) return; // Ball schon weg
      this.ball.setVelocity(velocity());
      this.possessor = null;
      this.lastTouch = p.team;
      this.lastKicker = p;
      this.cooldown.set(p, KICK_COOLDOWN);
    });
  }

  // -------------------------------------------------------------------------
  // Regeln
  // -------------------------------------------------------------------------

  private stop(seconds: number, restart: () => void) {
    this.phase = { kind: 'stopped', timer: seconds, restart };
    this.possessor = null;
    this.charge = null;
  }

  private goal(scoringTeam: 0 | 1) {
    this.score[scoringTeam]++;
    this.hud.setScore(this.score[0], this.score[1]);
    const scorer = this.lastKicker;
    const own = scorer && scorer.team !== scoringTeam;
    const sub = scorer
      ? own
        ? `Eigentor ${scorer.info.label}`
        : `${scorer.number} ${scorer.info.label} · ${this.teams[scoringTeam].name}`
      : this.teams[scoringTeam].name;
    this.hud.showMessage('TOR!', sub, 3);
    this.stop(3.2, () => this.kickoff(scoringTeam === 0 ? 1 : 0));
  }

  private touchLineOut(x: number, sideZ: number) {
    const team = this.lastTouch === 0 ? 1 : 0;
    this.hud.showMessage('Aus', `Eindribbeln ${this.teams[team].name}`, 1.6);
    const bx = THREE.MathUtils.clamp(x, -PITCH.length / 2 + 0.5, PITCH.length / 2 - 0.5);
    this.stop(1.6, () => this.restartAt(bx, sideZ * (PITCH.width / 2 - 0.3), team));
  }

  private goalLineOut(side: -1 | 1, z: number) {
    // side: Tor auf der Seite +x (verteidigt von Team 1) oder -x (Team 0)
    const defending: 0 | 1 = side > 0 ? 1 : 0;
    if (this.lastTouch === defending) {
      const attacking: 0 | 1 = defending === 0 ? 1 : 0;
      this.hud.showMessage('Ecke', this.teams[attacking].name, 1.6);
      const cz = Math.sign(z || 1) * (PITCH.width / 2 - 0.3);
      this.stop(1.6, () => this.restartAt(side * (PITCH.length / 2 - 0.3), cz, attacking));
    } else {
      this.hud.showMessage('Abstoß', this.teams[defending].name, 1.6);
      this.stop(1.6, () => this.restartAt(side * (PITCH.length / 2 - 4), 0, defending));
    }
  }

  private restartAt(x: number, z: number, team: 0 | 1) {
    this.ball.placeAt(x, z);
    this.lastTouch = team;
    if (team === 0) this.switchToNearest();
  }

  private kickoff(team: 0 | 1) {
    for (const p of this.players) {
      const side = p.team === 0 ? -1 : 1;
      const spot = kickoffSpot(p.role, side);
      // Der Stürmer der anstoßenden Mannschaft steht direkt am Ball
      if (p.team === team && p.role === 'ST') spot.x = side * 0.75;
      if (p.team === team && p.role === 'ST') spot.z = 0;
      p.resetTo(spot.x, spot.z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    this.ball.placeAt(0, 0);
    this.possessor = null;
    this.lastTouch = team;
    this.lastKicker = null;
    this.setControlled(this.striker(0));
  }

  private striker(team: 0 | 1) {
    return this.players.find((p) => p.team === team && p.role === 'ST') ?? this.players.find((p) => p.team === team)!;
  }
}

function horizDist(a: THREE.Vector3, b: THREE.Vector3) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
