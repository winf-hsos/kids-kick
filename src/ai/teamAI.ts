import * as THREE from 'three';
import { PITCH } from '../config';
import type { Match } from '../game/match';
import { RESTART_DISTANCE, horizDist } from '../game/util';
import type { InputState } from '../input/input';
import type { Player } from '../player/player';
import type { Position } from '../teams';

/**
 * KI für eine Mannschaft.
 *
 * 1. Mannschaft: Jede Position hat einen Grundplatz, der mit dem Ball mitwandert
 *    (aufrücken im Angriff, zurückziehen in der Abwehr).
 * 2. Spieler: Wer den Ball hat, bewertet Dribbeln, Passen und Schießen und nimmt
 *    die beste Möglichkeit. Ohne Ball: anbieten, pressen, decken oder dem freien
 *    Ball nachlaufen.
 * 3. Bewegung: KI-Spieler „drücken“ dieselben virtuellen Knöpfe wie der Mensch.
 *
 * Der „Bienenschwarm“-Regler (settings.swarm) zieht die Spieler von ihren
 * Plätzen zum Ball, wie im echten Kinderfußball.
 *
 * Koordinaten im Mannschafts-System: x' > 0 = Richtung gegnerisches Tor.
 * Für Team 1 ist das Feld punktgespiegelt (x' = -x, z' = -z).
 */

/** Grundplätze im 4+1 (Mannschafts-System, links = -z') */
const BASE: Record<Position, [number, number]> = {
  TW: [-19.2, 0],
  AB: [-11, 0],
  LM: [-4, -7],
  RM: [-4, 7],
  ST: [4, 0],
};

/** Wie stark eine Position zum Ball gezogen wird (Bienenschwarm) */
const EAGERNESS: Record<Position, number> = { TW: 0.15, AB: 0.6, LM: 0.85, RM: 0.85, ST: 1 };

interface Brain {
  /** Nächste Entscheidung fällig in (s) */
  think: number;
  /** Zielpunkt der Bewegung (Welt) */
  target: THREE.Vector3;
  sprint: boolean;
  /** Ballführer: aktuelle Dribbelrichtung */
  dribble: THREE.Vector3 | null;
  /** Persönlichkeit: Vorliebe fürs Dribbeln (-) oder Passen (+) */
  passBias: number;
  /** Zufälliger Versatz, damit sich Spieler nicht stapeln */
  jitter: THREE.Vector3;
  /** Torwart: Ball hält er seit (s) */
  holding: number;
  /** Torwart: erkannter Schuss, Reaktion fällig in (s) */
  shotReact: number | null;
}

export class TeamAI {
  private readonly brains = new Map<Player, Brain>();
  private readonly dir: 1 | -1;

  constructor(
    private readonly match: Match,
    readonly team: 0 | 1,
  ) {
    this.dir = team === 0 ? 1 : -1;
    for (const p of match.players) {
      if (p.team !== team) continue;
      const seed = hash(p.info.id);
      this.brains.set(p, {
        think: Math.random() * 0.3,
        target: p.position.clone(),
        sprint: false,
        dribble: null,
        passBias: ((seed % 100) / 100 - 0.5) * 0.2,
        jitter: new THREE.Vector3(Math.cos(seed), 0, Math.sin(seed)).multiplyScalar(0.9),
        holding: 0,
        shotReact: null,
      });
    }
  }

  /** Füllt inputs für alle KI-gesteuerten Spieler dieses Teams. */
  update(dt: number, inputs: Map<Player, InputState>) {
    const m = this.match;
    const mates = m.players.filter((p) => p.team === this.team);
    const ball = m.ball.position.clone().setY(0);
    const owner = m.possessor;
    const attacking = owner ? owner.team === this.team : m.lastTouch === this.team;
    const stopped = m.phase.kind !== 'play';

    // Wer geht zum Ball? Beim Bienenschwarm mehrere.
    const chasers = this.pickChasers(mates, ball, owner);

    for (const p of mates) {
      if (m.isHuman(p) || p.isKicking) continue;
      const b = this.brains.get(p)!;
      b.think -= dt;

      if (stopped) {
        b.target.copy(this.anchor(p, ball, attacking));
        b.sprint = false;
      } else if (owner === p) {
        this.onBall(p, b, dt);
      } else if (p.role === 'TW') {
        this.keeper(p, b, dt, ball);
      } else if (b.think <= 0) {
        b.think = m.profile.reaction * (0.8 + Math.random() * 0.4);
        this.offBall(p, b, ball, owner, attacking, chasers.includes(p));
      }

      // Abstand bei Anstoß/Eindribbeln
      const guard = m.restartGuard;
      if (guard && guard.team !== this.team) {
        const g = new THREE.Vector3(guard.x, 0, guard.z);
        const away = b.target.clone().sub(g);
        if (away.length() < RESTART_DISTANCE + 0.3) {
          if (away.lengthSq() < 1e-4) away.set(-this.dir, 0, 0);
          b.target.copy(g).addScaledVector(away.normalize(), RESTART_DISTANCE + 0.3);
        }
      }

      inputs.set(p, this.steer(p, b));
    }
  }

  // -------------------------------------------------------------------------
  // Positionen
  // -------------------------------------------------------------------------

  /** Welt -> Mannschafts-System und zurück (Punktspiegelung für Team 1) */
  private toTeam(v: THREE.Vector3) {
    return new THREE.Vector3(v.x * this.dir, 0, v.z * this.dir);
  }

  private toWorld(x: number, z: number) {
    return new THREE.Vector3(x * this.dir, 0, z * this.dir);
  }

  /** Grundplatz einer Position, verschoben mit dem Ball */
  private anchor(p: Player, ball: THREE.Vector3, attacking: boolean) {
    const [bx, bz] = BASE[p.role];
    const b = this.toTeam(ball);
    let x = bx + (attacking ? 0.5 * b.x + 3 : 0.45 * b.x - 2);
    let z = bz * (attacking ? 1 : 0.8) + 0.35 * b.z;
    if (p.role === 'AB' && !attacking) x = Math.min(x, b.x - 2.5); // Abwehr bleibt hinter dem Ball
    if (p.role === 'ST' && attacking) x = Math.max(x, b.x - 1);
    x = THREE.MathUtils.clamp(x, -17.5, 17);
    z = THREE.MathUtils.clamp(z, -PITCH.width / 2 + 1, PITCH.width / 2 - 1);
    return this.toWorld(x, z);
  }

  private pickChasers(mates: Player[], ball: THREE.Vector3, owner: Player | null) {
    if (owner && owner.team === this.team) return [];
    const swarm = this.match.settings.swarm;
    const n = 1 + Math.floor(swarm * 3.6);
    return mates
      .filter((p) => p.role !== 'TW' || swarm > 0.9)
      .sort((a, b) => horizDist(a.position, ball) - horizDist(b.position, ball))
      .slice(0, n);
  }

  private offBall(p: Player, b: Brain, ball: THREE.Vector3, owner: Player | null, attacking: boolean, chaser: boolean) {
    const m = this.match;
    const swarm = m.settings.swarm;
    const anchor = this.anchor(p, ball, attacking);

    if (chaser) {
      // Zum Ball: freien Ball abfangen, Ballführer attackieren
      const lead = owner ? owner.velocity.clone().multiplyScalar(0.25) : m.ball.velocity.setY(0).multiplyScalar(0.35);
      b.target.copy(ball).add(lead);
      if (owner) {
        // von der Torseite her angreifen
        const ownGoal = this.toWorld(-PITCH.length / 2, 0);
        b.target.addScaledVector(ownGoal.sub(ball).normalize(), 0.35);
      }
      b.sprint = horizDist(p.position, b.target) > 2.5;
      return;
    }

    let target = anchor;
    if (attacking) {
      target = this.freeSpot(anchor, owner);
    } else if (owner) {
      target = this.markTarget(anchor) ?? anchor;
    }
    // Bienenschwarm: zum Ball gezogen
    const pull = swarm * EAGERNESS[p.role];
    const near = ball.clone().add(b.jitter);
    b.target.copy(target).lerp(near, pull * 0.85);
    b.sprint = horizDist(p.position, b.target) > 6;
  }

  /** Freie Stelle in der Nähe des Grundplatzes suchen (anbieten). */
  private freeSpot(anchor: THREE.Vector3, owner: Player | null) {
    const m = this.match;
    const opponents = m.players.filter((o) => o.team !== this.team);
    let best = anchor;
    let bestScore = -Infinity;
    for (let i = 0; i < 8; i++) {
      const c = i === 0 ? anchor.clone() : anchor.clone().add(new THREE.Vector3(Math.cos(i), 0, Math.sin(i)).multiplyScalar(2.5));
      if (Math.abs(c.z) > PITCH.width / 2 - 0.8 || Math.abs(c.x) > PITCH.length / 2 - 1) continue;
      const space = Math.min(4, Math.min(...opponents.map((o) => horizDist(o.position, c)))) / 4;
      const lane = owner ? Math.min(2, laneClearance(owner.position, c, opponents)) / 2 : 1;
      const score = space + 0.8 * lane - horizDist(c, anchor) / 6 + (i === 0 ? 0.1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Gegenspieler in der eigenen Zone decken: zwischen Gegner und eigenes Tor. */
  private markTarget(anchor: THREE.Vector3) {
    const m = this.match;
    const ownGoal = this.toWorld(-PITCH.length / 2, 0);
    let best: Player | null = null;
    let bestD = 6;
    for (const o of m.players) {
      if (o.team === this.team || o.role === 'TW' || o === m.possessor) continue;
      const d = horizDist(o.position, anchor);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    if (!best) return null;
    return best.position.clone().setY(0).add(ownGoal.sub(best.position).setY(0).normalize().multiplyScalar(1.3));
  }

  // -------------------------------------------------------------------------
  // Ballführer
  // -------------------------------------------------------------------------

  private onBall(p: Player, b: Brain, dt: number) {
    const m = this.match;
    if (p.role === 'TW') {
      // Torwart hält den Ball kurz und spielt dann ab
      b.holding += dt;
      b.target.copy(p.position);
      b.sprint = false;
      if (b.holding > 1.0 && b.think <= 0) {
        b.think = m.profile.reaction;
        // Freien Mitspieler suchen; nach 2,5 s notfalls zum nächsten Mitspieler
        const best = this.bestPass(p, true) ?? (b.holding > 2.5 ? this.nearestMate(p) : null);
        if (best) {
          m.passTo(p, best.mate, best.mate.position.clone().sub(p.position), m.profile.passError);
          b.holding = 0;
        }
      }
      return;
    }
    b.holding = 0;

    if (b.think > 0) {
      if (b.dribble) b.target.copy(p.position).addScaledVector(b.dribble, 3);
      return;
    }
    b.think = m.profile.reaction * (0.8 + Math.random() * 0.4);
    const noise = () => (Math.random() - 0.5) * 2 * m.profile.noise;
    const opponents = m.players.filter((o) => o.team !== this.team);
    const pressure = Math.min(...opponents.map((o) => horizDist(o.position, p.position)));
    const me = this.toTeam(p.position);

    // Schießen
    const goal = this.toWorld(PITCH.length / 2, 0);
    const dGoal = horizDist(p.position, goal);
    let shootScore = -Infinity;
    if (dGoal < 14 && me.x > 5) {
      const blockers = opponents.filter((o) => o.role !== 'TW' && laneDistance(p.position, goal, o.position) < 0.8).length;
      // Kinder schießen gern – lieber ein Schuss als der fünfte Querpass
      shootScore = 0.2 + 1.35 * (1 - dGoal / 14) + (dGoal < 8 ? 0.5 : 0) + (p.role === 'ST' ? 0.15 : 0) - 0.3 * blockers + noise();
    }

    // Passen
    const pass = this.bestPass(p, false);
    // Kinder im Bienenschwarm dribbeln lieber selbst
    const teamPlay = m.profile.passPreference - 0.2 * m.settings.swarm;
    const passScore = pass ? pass.score + b.passBias + teamPlay + (pressure < 1.6 ? 0.3 : 0) + noise() : -Infinity;

    // Dribbeln: Richtungen zum Tor hin und schräg
    const toGoal = goal.clone().sub(p.position).setY(0).normalize();
    let dribbleScore = -Infinity;
    let dribbleDir = toGoal;
    for (const a of [0, 35, -35, 70, -70]) {
      const d = toGoal.clone().applyAxisAngle(UP, THREE.MathUtils.degToRad(a));
      const ahead = p.position.clone().addScaledVector(d, 3);
      if (Math.abs(ahead.z) > PITCH.width / 2 - 0.6 || Math.abs(ahead.x) > PITCH.length / 2 - 0.4) continue;
      const space = Math.min(4, Math.min(...opponents.map((o) => horizDist(o.position, ahead)))) / 4;
      const score = 0.3 + 0.5 * Math.cos(THREE.MathUtils.degToRad(a)) * space + 0.35 * space + noise();
      if (score > dribbleScore) {
        dribbleScore = score;
        dribbleDir = d;
      }
    }

    if (shootScore >= passScore && shootScore >= dribbleScore && shootScore > 0.2) {
      const keeper = opponents.find((o) => o.role === 'TW');
      // in die Ecke, die der Torwart nicht abdeckt
      const side = keeper && keeper.position.z > 0 ? -1 : 1;
      const power = THREE.MathUtils.clamp(0.35 + dGoal / 16, 0.35, 1);
      m.shootAt(p, power, side * (1.4 + Math.random() * 0.7), m.profile.shotError);
      b.dribble = null;
    } else if (pass && passScore >= dribbleScore) {
      m.passTo(p, pass.mate, pass.mate.position.clone().sub(p.position), m.profile.passError);
      b.dribble = null;
    } else {
      b.dribble = dribbleDir;
      b.target.copy(p.position).addScaledVector(dribbleDir, 3);
      b.sprint = dribbleScore > 0.75 && pressure > 2;
    }
  }

  private nearestMate(p: Player) {
    let best: { mate: Player; score: number } | null = null;
    for (const mate of this.match.players) {
      if (mate.team !== this.team || mate === p || mate.role === 'TW') continue;
      const score = -horizDist(p.position, mate.position);
      if (!best || score > best.score) best = { mate, score };
    }
    return best;
  }

  private bestPass(p: Player, long: boolean) {
    const m = this.match;
    const opponents = m.players.filter((o) => o.team !== this.team);
    const me = this.toTeam(p.position);
    let best: { mate: Player; score: number } | null = null;
    for (const mate of m.players) {
      if (mate.team !== this.team || mate === p || mate.role === 'TW') continue;
      const d = horizDist(p.position, mate.position);
      if (d < 3 || (!long && d > 22)) continue;
      const lane = laneClearance(p.position, mate.position, opponents);
      if (lane < 0.9) continue;
      const progress = (this.toTeam(mate.position).x - me.x) / 12;
      const space = Math.min(5, Math.min(...opponents.map((o) => horizDist(o.position, mate.position)))) / 5;
      const score = 0.35 + 0.6 * progress + 0.45 * space + 0.2 * Math.min(lane, 3) / 3 - (d > 16 ? (d - 16) * 0.08 : 0);
      if (!best || score > best.score) best = { mate, score };
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Torwart
  // -------------------------------------------------------------------------

  private keeper(p: Player, b: Brain, dt: number, ball: THREE.Vector3) {
    const m = this.match;
    const goalX = -PITCH.length / 2; // im Mannschafts-System
    const bt = this.toTeam(ball);
    const dBall = Math.hypot(bt.x - goalX, bt.z);
    const swarm = m.settings.swarm;

    // Grundstellung: auf der Linie Ball – Tormitte, je nach Entfernung vor dem Tor
    let x = goalX + 0.6 + THREE.MathUtils.clamp((dBall - 5) * 0.1, 0, 1.6) + swarm * 2.5 * Math.min(1, dBall / 25);
    let z = THREE.MathUtils.clamp(bt.z * (2.4 / Math.max(dBall, 2.4)), -2.2, 2.2);

    // Freier Ball im Strafraum: rauslaufen
    if (!m.possessor && bt.x < goalX + PITCH.penaltyAreaDepth - 1 && Math.abs(bt.z) < PITCH.penaltyAreaWidth / 2 && m.ball.velocity.length() < 6) {
      x = bt.x;
      z = bt.z;
    }

    // Schuss aufs Tor erkennen und reagieren
    const v = this.toTeam(m.ball.velocity);
    if (v.x < -5 && bt.x > goalX && !m.possessor) {
      const t = (bt.x - (goalX + 0.6)) / -v.x;
      const zAt = bt.z + v.z * t;
      if (t < 1.4 && Math.abs(zAt) < 3.2) {
        if (b.shotReact === null) b.shotReact = m.profile.reaction * 0.8;
        b.shotReact -= dt;
        if (b.shotReact <= 0) {
          const me = this.toTeam(p.position);
          const lateral = zAt - me.z;
          z = THREE.MathUtils.clamp(zAt, -2.6, 2.6);
          if (Math.abs(lateral) > 0.7 && t < 0.55) p.dive(this.toWorld(0, Math.sign(lateral)));
        }
      }
    } else {
      b.shotReact = null;
    }

    b.target.copy(this.toWorld(x, z));
    b.sprint = horizDist(p.position, b.target) > 1.5;
  }

  // -------------------------------------------------------------------------
  // Bewegung
  // -------------------------------------------------------------------------

  /** Virtuelle Stick-Eingabe zum Zielpunkt (mit Abbremsen und Ausweichen) */
  private steer(p: Player, b: Brain): InputState {
    const to = b.target.clone().sub(p.position).setY(0);
    const d = to.length();
    const profile = this.match.profile;
    if (d < 0.25) return { ...IDLE };

    // Mitspielern ausweichen, damit sich niemand stapelt
    for (const o of this.match.players) {
      if (o === p || o.team !== p.team) continue;
      const away = p.position.clone().sub(o.position).setY(0);
      const dist = away.length();
      if (dist > 0.01 && dist < 1.4) to.addScaledVector(away.normalize(), (1.4 - dist) * 1.5);
    }
    to.normalize().multiplyScalar(Math.min(1, d / 1.2) * profile.speed);
    // Bildschirm-Koordinaten: moveY = -z
    return { ...IDLE, moveX: to.x, moveY: -to.z, sprint: b.sprint };
  }
}

const UP = new THREE.Vector3(0, 1, 0);

const IDLE: InputState = {
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

/** Kleinster Abstand eines Punkts zur Strecke a–b */
function laneDistance(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz || 1;
  const t = THREE.MathUtils.clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2, 0, 1);
  return Math.hypot(a.x + abx * t - p.x, a.z + abz * t - p.z);
}

/** Wie frei ist der Passweg a–b? (kleinster Abstand eines Gegners zur Strecke) */
function laneClearance(a: THREE.Vector3, b: THREE.Vector3, opponents: Player[]) {
  let min = Infinity;
  for (const o of opponents) min = Math.min(min, laneDistance(a, b, o.position));
  return min;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
