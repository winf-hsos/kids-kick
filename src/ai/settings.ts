export type Difficulty = 'bambini' | 'kreisliga' | 'profi';

export interface AiProfile {
  label: string;
  /** Zeit zwischen zwei Entscheidungen (s) – zugleich die Reaktionszeit */
  reaction: number;
  /** Streuung bei Pässen und Schüssen (Grad) */
  passError: number;
  shotError: number;
  /** Wie oft pro Sekunde ein Zweikampf am Ballführer gewonnen wird */
  tackleRate: number;
  /** Laufgeschwindigkeit relativ zum Menschen */
  speed: number;
  /** Wahrscheinlichkeit, dass der Torwart einen erreichbaren Ball hält */
  keeperCatch: number;
  /** Zufall in den Entscheidungen (0 = immer die beste Wahl) */
  noise: number;
  /** Neigung zum Zusammenspiel: höher = mehr Pässe, weniger Alleingänge */
  passPreference: number;
}

export const DIFFICULTIES: Record<Difficulty, AiProfile> = {
  bambini: { label: 'Bambini', reaction: 0.45, passError: 9, shotError: 8, tackleRate: 0.45, speed: 0.82, keeperCatch: 0.3, noise: 0.35, passPreference: -0.05 },
  kreisliga: { label: 'Kreisliga', reaction: 0.3, passError: 5, shotError: 5, tackleRate: 0.8, speed: 0.93, keeperCatch: 0.5, noise: 0.18, passPreference: 0.15 },
  profi: { label: 'Profi', reaction: 0.17, passError: 2.5, shotError: 3, tackleRate: 1.4, speed: 1, keeperCatch: 0.7, noise: 0.07, passPreference: 0.3 },
};

export interface GameSettings {
  difficulty: Difficulty;
  /** 0 = diszipliniert wie Profis, 1 = alle rennen zum Ball („Bienenschwarm“) */
  swarm: number;
  /** false = Zuschauen (KI gegen KI) */
  humanPlays: boolean;
}

const KEY = 'kids-kick-settings';

export function loadSettings(): GameSettings {
  const fallback: GameSettings = { difficulty: 'kreisliga', swarm: 0.35, humanPlays: true };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const s = JSON.parse(raw) as Partial<GameSettings>;
    return {
      difficulty: s.difficulty && s.difficulty in DIFFICULTIES ? s.difficulty : fallback.difficulty,
      swarm: typeof s.swarm === 'number' ? Math.min(1, Math.max(0, s.swarm)) : fallback.swarm,
      humanPlays: typeof s.humanPlays === 'boolean' ? s.humanPlays : fallback.humanPlays,
    };
  } catch {
    return fallback;
  }
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Speichern ist nur Komfort
  }
}
