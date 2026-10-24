import * as THREE from 'three';
import { TeamAI } from '../ai/teamAI';
import { DIFFICULTIES, type AiProfile, type GameSettings } from '../ai/settings';
import { BALL_RADIUS, rollingDecel, type Ball } from '../ball/ball';
import { GOAL, PITCH, PLAYER } from '../config';
import type { Hud } from '../hud/hud';
import { NO_INPUT, type InputState } from '../input/input';
import type { Player } from '../player/player';
import { kickoffSpot, type Team } from '../teams';
import { horizDist } from './util';

/** Bis zu diesem Abstand (m) vom Fuß kann ein Spieler den Ball annehmen. */
const CONTROL_RADIUS = 0.7;
/** Reichweite des Torwarts: stehend und im Hechtsprung */
const KEEPER_REACH = 0.85;
const KEEPER_DIVE_REACH = 1.5;
/** Nach einem Schuss/Pass darf der Schütze den Ball kurz nicht wieder annehmen. */
const KICK_COOLDOWN = 0.45;
/** Nach einer Balleroberung kann der Ball kurz nicht zurückerobert werden. */
const STEAL_IMMUNITY = 1.0;
/** Zeit bis zur vollen Schusskraft bzw. Passhärte (s) */
const SHOT_CHARGE_TIME = 1.0;
const PASS_CHARGE_TIME = 0.8;
/** Ab diesem Abstand zum Ballführer gilt der Ball als frei */
const DRIBBLE_LOST = 4.5;
/** Abstand Fuß–Ball, bei dem der nächste Dribbelkontakt erfolgt */
const TOUCH_RADIUS = 0.55;

type Phase =
  | { kind: 'play' }
  | { kind: 'stopped'; timer: number; restart: () => void };

/**
 * Spiellogik: Ballbesitz und Dribbeln, Pass, Schuss, Spielerwechsel,
 * Tor und Aus nach Kinderfußball-Regeln (Eindribbeln, Ecke, Abstoß).
 * Team 0 spielt in Richtung +x. Der Mensch steuert einen Spieler von Team 0
 * (oder niemanden im Zuschauen-Modus); alle anderen steuert die KI.
 *
 * Dribbeln besteht aus einzelnen Ballkontakten: Der Spieler legt sich den Ball
 * vor (je schneller, desto weiter) und läuft hinterher. Jeder Kontakt streut,
 * und ab und zu verspringt der Ball – abhängig von Tempo und Ballkontrolle.
 */
export class Match {
  controlled: Player | null = null;
  possessor: Player | null = null;
  lastTouch: 0 | 1 | null = null;
  phase: Phase = { kind: 'play' };
  clock = 0;
  /** Team, das gerade einen Anstoß/Eindribbeln ausführt; der Gegner hält Abstand */
  restartGuard: { team: 0 | 1; x: number; z: number } | null = null;
  profile: AiProfile;
  readonly score: [number, number] = [0, 0];

  private lastKicker: Player | null = null;
  private cooldown = new Map<Player, number>();
  private immuneUntil = 0;
  /** Torwart, der einen Ball schon verpasst hat (kein zweiter Versuch) */
  private keeperBeaten = new Map<Player, number>();
  private shotCharge: number | null = null;
  private passCharge: number | null = null;
  private touchTimer = 0;
  private lastInput: InputState = NO_INPUT;
  /** Pass/Schuss, der mit dem nächsten Ballkontakt gespielt wird (Ball war gerade vorgelegt) */
  private pending: { p: Player; kind: 'pass' | 'shot'; power: number; input: InputState; until: number } | null = null;
  private readonly ai: TeamAI[];

  constructor(
    readonly players: Player[],
    readonly ball: Ball,
    private readonly teams: readonly Team[],
    private readonly hud: Hud,
    public settings: GameSettings,
  ) {
    this.profile = DIFFICULTIES[settings.difficulty];
    this.ai = [new TeamAI(this, 0), new TeamAI(this, 1)];
    this.kickoff(0);
  }

  get ballOwner() {
    return this.possessor;
  }

  setSettings(s: GameSettings) {
    const modeChanged = s.humanPlays !== this.settings.humanPlays;
    this.settings = s;
    this.profile = DIFFICULTIES[s.difficulty];
    if (modeChanged) this.setControlled(s.humanPlays ? this.nearestTeammate(0, null) : null);
  }

  isHuman(p: Player) {
    return p === this.controlled;
  }

  // -------------------------------------------------------------------------
  // Pro Bild
  // -------------------------------------------------------------------------

  update(dt: number, input: InputState) {
    if (this.phase.kind === 'play') this.clock += dt;
    this.hud.setClock(this.clock);
    for (const [p, t] of this.cooldown) {
      if (t - dt <= 0) this.cooldown.delete(p);
      else this.cooldown.set(p, t - dt);
    }
    for (const [p, t] of this.keeperBeaten) if (t < this.clock) this.keeperBeaten.delete(p);

    if (this.phase.kind === 'stopped') {
      this.phase.timer -= dt;
      if (this.phase.timer <= 0) {
        const restart = this.phase.restart;
        this.phase = { kind: 'play' };
        restart();
      }
    }
    // Abstandsregel endet, sobald der Ball gespielt wurde
    const guard = this.restartGuard;
    if (guard && Math.hypot(this.ball.position.x - guard.x, this.ball.position.z - guard.z) > 1.2) {
      this.restartGuard = null;
    }

    const me = this.controlled;
    this.lastInput = input;
    if (me) {
      if (input.switchPlayer && this.possessor !== me) this.setControlled(this.nearestTeammate(0, me));
      this.handlePassButton(me, dt, input);
      this.handleShotButton(me, dt, input);
    } else {
      this.passCharge = null;
      this.shotCharge = null;
    }
    this.hud.setPower(this.shotCharge ?? this.passCharge, this.shotCharge !== null ? 'shot' : 'pass');

    const inputs = new Map<Player, InputState>();
    for (const ai of this.ai) ai.update(dt, inputs);

    const ballPos = this.ball.position.clone();
    const human = this.controlled;
    for (const p of this.players) {
      p.update(dt, p === human ? input : inputs.get(p) ?? NO_INPUT, ballPos);
    }
    for (let i = 0; i < this.players.length; i++) {
      for (let j = i + 1; j < this.players.length; j++) {
        this.players[i].separateFrom(this.players[j], 0.55);
        this.players[j].separateFrom(this.players[i], 0.55);
      }
    }

    this.updatePossession(dt);
    this.runPending();
  }

  private runPending() {
    const q = this.pending;
    if (!q) return;
    if (this.possessor !== q.p || this.clock > q.until || this.controlled !== q.p) {
      this.pending = null;
    } else if (this.canKick(q.p)) {
      this.pending = null;
      if (q.kind === 'pass') this.humanPass(q.p, q.power, q.input);
      else this.humanShot(q.p, q.power, q.input);
    }
  }

  /** Mensch will passen/schießen: sofort, oder beim nächsten Ballkontakt, falls der Ball gerade vorgelegt ist */
  private humanKick(p: Player, kind: 'pass' | 'shot', power: number, input: InputState) {
    if (this.canKick(p)) {
      if (kind === 'pass') this.humanPass(p, power, input);
      else this.humanShot(p, power, input);
    } else if (this.possessor === p) {
      this.pending = { p, kind, power, input: { ...input }, until: this.clock + 1.0 };
    }
  }

  /** Vor jedem Physikschritt: Ballkontakte des Ballführers. */
  preStep(h: number) {
    const p = this.possessor;
    if (!p || p.isKicking) return;
    this.touchTimer -= h;
    const ball = this.ball.position.clone();
    const rel = ball.clone().sub(p.position).setY(0);
    const dist = rel.length();

    if (p.speed < 0.6) {
      // Stehend: Ball abschirmen und sanft vor den Fuß holen
      if (dist < 1.2 && this.ball.onGround) {
        const target = p.position.clone().addScaledVector(p.facing, 0.4);
        const v = target.sub(ball).setY(0).multiplyScalar(4);
        if (v.length() > 1.5) v.setLength(1.5);
        this.ball.setVelocity(v);
        this.ball.matchRolling();
      }
      return;
    }

    const dir = p.velocity.clone().setY(0).normalize();
    const ballVel = this.ball.velocity;
    const away = ballVel.clone().sub(p.velocity).dot(dir);
    if (this.touchTimer > 0 || dist > TOUCH_RADIUS || away > 0.8 || !this.ball.onGround) return;

    // --- Ballkontakt ---------------------------------------------------------
    const s = THREE.MathUtils.clamp((p.speed - 1.5) / (PLAYER.sprintSpeed - 1.5), 0, 1); // 0 = gehen, 1 = Sprint
    const control = p.skills.dribbling;
    // Wie weit der Ball vorgelegt wird (m): gehen ~0,6, laufen ~1,2, Sprint ~3
    const lead = (0.55 + 0.5 * s + 2.2 * s * s) * (1.25 - 0.5 * control);
    const speed = p.speed + Math.sqrt(2 * rollingDecel(p.speed) * lead);
    let angle = gauss() * (2 + 9 * s) * (1.4 - control);
    let factor = 1 + gauss() * (0.06 + 0.18 * s) * (1.3 - control);
    // Ball verspringt
    if (Math.random() < (0.015 + 0.1 * s) * (1.25 - control)) {
      angle += (Math.random() < 0.5 ? -1 : 1) * (25 + Math.random() * 25);
      factor *= 1.25 + Math.random() * 0.45;
    }
    const v = dir.applyAxisAngle(UP, THREE.MathUtils.degToRad(angle)).multiplyScalar(speed * factor);
    v.y = s > 0.6 ? Math.random() * 0.8 * s : 0;
    this.ball.setVelocity(v);
    this.ball.matchRolling();
    p.touch();
    this.touchTimer = 0.18;
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

  private updatePossession(dt: number) {
    if (this.phase.kind !== 'play') {
      this.possessor = null;
      return;
    }
    const ball = this.ball.position;
    const ballVel = this.ball.velocity;
    if (this.possessor) {
      const d = horizDist(this.possessor.position, ball);
      if (d > DRIBBLE_LOST || ball.y > 1.2) this.possessor = null;
    }

    // Torhüter: Bälle in Reichweite fangen (auch hohe und scharfe)
    if (!this.possessor) {
      for (const k of this.players) {
        if (k.role !== 'TW' || this.cooldown.has(k) || this.keeperBeaten.has(k)) continue;
        if (this.restartGuard && this.restartGuard.team !== k.team) continue;
        if (!this.inOwnPenaltyArea(k, ball)) continue;
        const reach = k.isDiving ? KEEPER_DIVE_REACH : KEEPER_REACH;
        const chest = k.position.clone().setY(Math.min(ball.y, 1.6));
        if (ball.y > 2.0 || chest.distanceTo(ball) > reach) continue;
        const fast = ballVel.length() > 6;
        const base = this.isHuman(k) ? 0.65 : this.profile.keeperCatch;
        const chance = Math.min(0.95, base * (0.6 + 0.6 * k.skills.keeping));
        if (!fast || Math.random() < chance) {
          this.ball.setVelocity(new THREE.Vector3());
          this.takePossession(k);
          // Ball in Torwarthand: Gegner halten Abstand, bis er abgespielt ist
          this.restartGuard = { team: k.team, x: ball.x, z: ball.z };
        } else {
          // Abgewehrt: Ball verliert Tempo und springt zurück
          this.ball.setVelocity(ballVel.multiplyScalar(-0.35).setY(Math.abs(ballVel.y) * 0.3 + 1));
          this.keeperBeaten.set(k, this.clock + 0.8);
          this.lastTouch = k.team;
        }
        return;
      }
    }

    if (ball.y > 0.45) return;
    const speed = ballVel.length();
    const owner = this.possessor;
    const ownerDist = owner ? horizDist(owner.position, ball) : 0;

    let best: Player | null = null;
    let bestD = CONTROL_RADIUS;
    for (const p of this.players) {
      if (this.cooldown.has(p) || p.isKicking || p.isDiving) continue;
      if (this.restartGuard && this.restartGuard.team !== p.team) continue;
      const foot = p.position.clone().addScaledVector(p.facing, 0.25);
      const d = horizDist(foot, ball);
      if (d >= bestD) continue;
      if (owner) {
        if (owner === p || owner.team === p.team || this.clock < this.immuneUntil) continue;
        // Ball weit vorgelegt: Gegner läuft einfach dazwischen.
        // Ball am Fuß: Zweikampf, gewonnen mit einer Rate je nach Zweikampfstärke.
        if (ownerDist < 1.0) {
          const rate = (this.isHuman(p) ? 3 : this.profile.tackleRate) * (0.5 + p.skills.tackling);
          if (Math.random() > rate * dt) continue;
        }
      } else if (speed > 16) {
        continue;
      }
      best = p;
      bestD = d;
    }
    if (!best) return;
    if (owner) {
      this.immuneUntil = this.clock + STEAL_IMMUNITY;
      this.takePossession(best);
      this.settleBall(best);
      return;
    }
    this.receive(best, speed);
  }

  /** Ballannahme eines freien Balls: Direktspiel, saubere Annahme oder Verspringen. */
  private receive(p: Player, ballSpeed: number) {
    // Direktpass / Direktschuss: Taste wurde schon vor der Ankunft gehalten
    if (this.isHuman(p) && this.passCharge !== null) {
      const power = Math.max(0.3, this.passCharge);
      this.passCharge = null;
      this.humanPass(p, power, this.lastInput, true);
      return;
    }
    if (this.isHuman(p) && this.shotCharge !== null) {
      const power = Math.max(0.3, this.shotCharge);
      this.shotCharge = null;
      this.humanShot(p, power, this.lastInput, true);
      return;
    }

    const rel = this.ball.velocity.sub(p.velocity).setY(0).length();
    const high = this.ball.position.y > 0.25 ? 0.15 : 0;
    const miss = THREE.MathUtils.clamp((rel - 3.5) / 12 + high, 0, 0.75) * (1.35 - p.skills.firstTouch);
    if (ballSpeed > 2 && Math.random() < miss) {
      // Ball springt vom Fuß weg
      const v = this.ball.velocity.setY(0);
      const out = v.clone().normalize().applyAxisAngle(UP, THREE.MathUtils.degToRad((Math.random() - 0.5) * 140));
      this.ball.setVelocity(out.multiplyScalar(v.length() * (0.35 + Math.random() * 0.25)).setY(0.6));
      this.cooldown.set(p, 0.35);
      this.lastTouch = p.team;
      return;
    }
    this.takePossession(p);
    this.settleBall(p);
  }

  /** Ball nach Annahme/Eroberung beruhigen: rollt mit dem Spieler vor dessen Füßen. */
  private settleBall(p: Player) {
    this.ball.setVelocity(p.velocity.clone().multiplyScalar(0.9).setY(0));
    this.ball.matchRolling();
    this.touchTimer = 0.15;
  }

  private inOwnPenaltyArea(k: Player, ball: THREE.Vector3) {
    const goalX = (k.team === 0 ? -1 : 1) * (PITCH.length / 2);
    return Math.abs(ball.x - goalX) < PITCH.penaltyAreaDepth + 0.5 && Math.abs(ball.z) < PITCH.penaltyAreaWidth / 2 + 0.5;
  }

  private takePossession(p: Player) {
    this.possessor = p;
    this.lastTouch = p.team;
    // Der Mensch übernimmt automatisch den Mitspieler am Ball (außer dem Torwart)
    if (this.controlled && p.team === this.controlled.team && p !== this.controlled && p.role !== 'TW') {
      this.setControlled(p);
    }
  }

  setControlled(p: Player | null) {
    this.controlled = p;
    if (p) this.hud.setControlled(p.number, p.info.label);
    else this.hud.setControlled(null, 'Zuschauen');
  }

  /** Feldspieler des Teams, der dem Ball am nächsten ist (ohne Torwart). */
  private nearestTeammate(team: 0 | 1, exclude: Player | null) {
    const ball = this.ball.position;
    let best: Player | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (p.team !== team || p === exclude || p.role === 'TW') continue;
      const d = horizDist(p.position, ball);
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Pass und Schuss (für Mensch und KI)
  // -------------------------------------------------------------------------

  canKick(p: Player) {
    if (this.phase.kind !== 'play' || p.isKicking || p.isDiving) return false;
    if (this.possessor === p) return horizDist(p.position, this.ball.position) < 1.3;
    // Freier Ball in Reichweite: direkt spielen
    return !this.possessor && horizDist(p.position, this.ball.position) < 1.0 && this.ball.position.y < 0.6;
  }

  /**
   * Flacher Pass zu einem Mitspieler (oder ohne Empfänger in Richtung dir).
   * speed = Ballgeschwindigkeit (m/s); immediate = Direktpass ohne Ausholen.
   */
  passTo(p: Player, receiver: Player | null, dir: THREE.Vector3, opts: { speed?: number; errorDeg: number; immediate?: boolean }) {
    if (!this.canKick(p)) return;
    const from = this.ball.position;
    let target: THREE.Vector3;
    let speed: number;
    if (receiver) {
      const dist = horizDist(from, receiver.position);
      speed = opts.speed ?? THREE.MathUtils.clamp(3.2 + dist * 0.8, 6, 17);
      // In den Lauf des Mitspielers spielen
      target = receiver.position.clone().addScaledVector(receiver.velocity, Math.min(1.5, dist / speed));
    } else {
      speed = opts.speed ?? 10;
      target = p.position.clone().addScaledVector(dir, 12);
    }
    const kickDir = target.sub(from).setY(0).normalize().applyAxisAngle(UP, deg(opts.errorDeg * gauss()));
    this.kickBall(p, 'pass', kickDir, 0.7, kickDir.clone().multiplyScalar(speed).setY(0.4), opts.immediate);
    if (receiver && this.controlled && receiver.team === this.controlled.team && receiver.role !== 'TW') {
      this.setControlled(receiver);
    }
  }

  /** Schuss aufs gegnerische Tor; aimZ = Zielpunkt quer zum Tor (m), power 0..1. */
  shootAt(p: Player, power: number, aimZ: number, errorDeg: number, immediate = false) {
    if (!this.canKick(p)) return;
    const goalX = (p.team === 0 ? 1 : -1) * (PITCH.length / 2 + 0.5);
    const z = THREE.MathUtils.clamp(aimZ, -2.3, 2.3);
    const to = new THREE.Vector3(goalX, 0, z).sub(this.ball.position).setY(0);
    const dir = to.normalize().applyAxisAngle(UP, deg(errorDeg * gauss()));
    const speed = (9 + 10 * power) * (0.85 + 0.25 * p.skills.shooting);
    const elevation = deg(3 + 13 * power + (Math.random() - 0.5) * 6 * power);
    const v = dir.clone().multiplyScalar(speed * Math.cos(elevation)).setY(speed * Math.sin(elevation));
    this.kickBall(p, 'shot', dir, power, v, immediate);
  }

  // --- Mensch --------------------------------------------------------------

  /** Pass-Taste: halten = härter; schon gehalten, wenn der Ball kommt = Direktpass */
  private handlePassButton(p: Player, dt: number, input: InputState) {
    if (input.pass) {
      if (this.passCharge === null) this.passCharge = 0;
      this.passCharge = Math.min(1, this.passCharge + dt / PASS_CHARGE_TIME);
    } else if (this.passCharge !== null) {
      const power = Math.max(0.15, this.passCharge);
      this.passCharge = null;
      this.humanKick(p, 'pass', power, input);
    } else if (input.passTap) {
      this.humanKick(p, 'pass', 0.2, input);
    }
  }

  private handleShotButton(p: Player, dt: number, input: InputState) {
    if (input.shoot) {
      if (this.shotCharge === null) this.shotCharge = 0;
      this.shotCharge = Math.min(1, this.shotCharge + dt / SHOT_CHARGE_TIME);
    } else if (this.shotCharge !== null) {
      const power = Math.max(0.15, this.shotCharge);
      this.shotCharge = null;
      this.humanKick(p, 'shot', power, input);
    } else if (input.shootTap) {
      this.humanKick(p, 'shot', 0.2, input);
    }
  }

  private humanPass(p: Player, power: number, input: InputState, immediate = false) {
    const dir = inputDir(input, p);
    // Mitspieler in Passrichtung suchen (Winkel wichtiger als Entfernung)
    let receiver: Player | null = null;
    let bestScore = Infinity;
    for (const mate of this.players) {
      if (mate.team !== p.team || mate === p) continue;
      const to = mate.position.clone().sub(p.position).setY(0);
      const dist = to.length();
      if (dist < 2) continue;
      const angle = to.normalize().angleTo(dir);
      if (angle > deg(65)) continue;
      const score = angle * 3 + dist * 0.06;
      if (score < bestScore) {
        bestScore = score;
        receiver = mate;
      }
    }
    const speed = 4.5 + 13 * power;
    const errorDeg = (1 + 5 * (1 - p.skills.passing) + 3 * power) * (immediate ? 1.5 : 1);
    this.passTo(p, receiver, dir, { speed, errorDeg, immediate });
  }

  private humanShot(p: Player, power: number, input: InputState, immediate = false) {
    // Mit dem Stick nach oben/unten zielt man auf eine Ecke
    const aimZ = -input.moveY * 2.1 + (Math.random() - 0.5) * 0.6;
    const errorDeg = (1.5 + 4 * power) * (1.4 - p.skills.shooting) * (immediate ? 1.5 : 1);
    this.shootAt(p, power, aimZ, errorDeg, immediate);
  }

  private kickBall(p: Player, kind: 'pass' | 'shot', dir: THREE.Vector3, strength: number, velocity: THREE.Vector3, immediate = false) {
    const release = () => {
      if (this.phase.kind !== 'play') return;
      if (horizDist(p.position, this.ball.position) > 1.6) return; // Ball schon weg
      this.ball.setVelocity(velocity);
      this.possessor = null;
      this.lastTouch = p.team;
      this.lastKicker = p;
      this.cooldown.set(p, KICK_COOLDOWN);
    };
    if (immediate) {
      // Direktspiel: Ball sofort weiter, die Beinbewegung läuft nur noch zur Optik
      release();
      p.kick(kind, dir, strength * 0.6, () => {});
    } else {
      // Während des Ausholens bleibt der Ball vor dem Fuß (der Spieler bremst ab)
      if (this.possessor === p) {
        this.ball.setVelocity(p.velocity.clone().multiplyScalar(0.35).setY(0));
        this.ball.matchRolling();
      }
      p.kick(kind, dir, strength, release);
    }
  }

  // -------------------------------------------------------------------------
  // Regeln
  // -------------------------------------------------------------------------

  private stop(seconds: number, restart: () => void) {
    this.phase = { kind: 'stopped', timer: seconds, restart };
    this.possessor = null;
    this.shotCharge = null;
    this.passCharge = null;
    this.pending = null;
    this.restartGuard = null;
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
    this.restartGuard = { team, x, z };
    if (this.controlled && team === this.controlled.team) this.setControlled(this.nearestTeammate(team, null));
  }

  private kickoff(team: 0 | 1) {
    for (const p of this.players) {
      const side = p.team === 0 ? -1 : 1;
      const spot = kickoffSpot(p.role, side);
      // Der Stürmer der anstoßenden Mannschaft steht direkt am Ball
      if (p.team === team && p.role === 'ST') {
        spot.x = side * 0.75;
        spot.z = 0;
      }
      p.resetTo(spot.x, spot.z, side < 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    this.ball.placeAt(0, 0);
    this.possessor = null;
    this.lastTouch = team;
    this.lastKicker = null;
    this.restartGuard = { team, x: 0, z: 0 };
    if (this.settings.humanPlays) {
      this.setControlled(this.players.find((p) => p.team === 0 && p.role === 'ST') ?? null);
    } else {
      this.setControlled(null);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);

function deg(d: number) {
  return THREE.MathUtils.degToRad(d);
}

/** Normalverteilte Zufallszahl (Mittel 0, Standardabweichung 1) */
function gauss() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function inputDir(input: InputState, p: Player) {
  const d = new THREE.Vector3(input.moveX, 0, -input.moveY);
  return d.lengthSq() > 0.09 ? d.normalize() : p.facing;
}
