/**
 * Fähigkeiten der Spielertypen (0 = schwach, 1 = stark), ähnlich den FIFA-Werten.
 * Sie wirken für Mensch und KI gleichermaßen: Wer schlecht dribbelt, dem
 * verspringt der Ball öfter – egal wer ihn steuert.
 */
export interface Skills {
  /** Laufgeschwindigkeit */
  pace: number;
  /** Ballkontrolle beim Dribbeln: wie genau und wie nah der Ball vorgelegt wird */
  dribbling: number;
  /** Ballannahme: wie sicher scharfe Pässe und Schüsse kontrolliert werden */
  firstTouch: number;
  /** Genauigkeit und Gefühl beim Passen */
  passing: number;
  /** Genauigkeit und Härte beim Schießen */
  shooting: number;
  /** Zweikampf: wie oft der Ball erobert wird */
  tackling: number;
  /** Torwartspiel: Fangen und Abwehren */
  keeping: number;
}

const DEFAULT: Skills = { pace: 0.65, dribbling: 0.6, firstTouch: 0.6, passing: 0.6, shooting: 0.6, tackling: 0.6, keeping: 0.3 };

export const SKILLS: Record<string, Skills> = {
  kid01: { pace: 0.75, dribbling: 0.8, firstTouch: 0.7, passing: 0.6, shooting: 0.8, tackling: 0.4, keeping: 0.2 }, // Ben
  kid02: { pace: 0.8, dribbling: 0.5, firstTouch: 0.6, passing: 0.65, shooting: 0.55, tackling: 0.85, keeping: 0.3 }, // Malik
  kid03: { pace: 0.7, dribbling: 0.75, firstTouch: 0.8, passing: 0.85, shooting: 0.55, tackling: 0.5, keeping: 0.25 }, // Lena
  kid04: { pace: 0.9, dribbling: 0.7, firstTouch: 0.55, passing: 0.55, shooting: 0.5, tackling: 0.5, keeping: 0.2 }, // Kenji
  kid05: { pace: 0.5, dribbling: 0.35, firstTouch: 0.55, passing: 0.5, shooting: 0.4, tackling: 0.4, keeping: 0.75 }, // Paul (TW)
  kid06: { pace: 0.95, dribbling: 0.6, firstTouch: 0.5, passing: 0.5, shooting: 0.65, tackling: 0.65, keeping: 0.2 }, // Amara
  kid07: { pace: 0.7, dribbling: 0.6, firstTouch: 0.65, passing: 0.5, shooting: 0.9, tackling: 0.45, keeping: 0.2 }, // Finn
  kid08: { pace: 0.6, dribbling: 0.9, firstTouch: 0.85, passing: 0.75, shooting: 0.45, tackling: 0.35, keeping: 0.2 }, // Mei
  kid09: { pace: 0.6, dribbling: 0.45, firstTouch: 0.6, passing: 0.7, shooting: 0.45, tackling: 0.8, keeping: 0.3 }, // Jonas
  kid10: { pace: 0.55, dribbling: 0.4, firstTouch: 0.6, passing: 0.55, shooting: 0.45, tackling: 0.45, keeping: 0.7 }, // Emre (TW)
};

export function skillsFor(characterId: string): Skills {
  return SKILLS[characterId] ?? DEFAULT;
}
