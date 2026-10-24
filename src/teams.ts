export interface Kit {
  shirt: string;
  /** Kragen, Schrift-Umrandung, Brust-Logo */
  accent: string;
  number: string;
  shorts: string;
  socks: string;
  boots: string;
}

export type Position = 'TW' | 'AB' | 'LM' | 'RM' | 'ST';

export interface LineupEntry {
  /** Spielertyp aus public/models/players/players.json */
  character: string;
  number: number;
  position: Position;
}

export interface Team {
  name: string;
  kit: Kit;
  keeperKit: Kit;
  lineup: LineupEntry[];
}

/**
 * Anstoß-Position in Metern für das Team, das auf der Seite `side` verteidigt
 * (-1 = linkes Tor bei x = -20, +1 = rechtes Tor).
 */
export function kickoffSpot(position: Position, side: -1 | 1): { x: number; z: number } {
  const spots: Record<Position, [number, number]> = {
    TW: [-19, 0],
    AB: [-12.5, 0.5],
    LM: [-6.5, -7],
    RM: [-6.5, 7],
    ST: [-3.6, -0.6],
  };
  // Werte gelten für das linke Team (spielt Richtung +x, links = -z); das rechte wird punktgespiegelt.
  const [x, z] = spots[position];
  return side < 0 ? { x, z } : { x: -x, z: -z };
}

/** Aufstellung im 4+1: Torwart, Abwehr, zwei Außen, Sturm. */
export const TEAMS: [Team, Team] = [
  {
    name: 'FC Rot',
    kit: { shirt: '#c8102e', accent: '#ffffff', number: '#ffffff', shorts: '#ffffff', socks: '#c8102e', boots: '#1a1a1a' },
    keeperKit: { shirt: '#f2c14e', accent: '#1d1d1d', number: '#1d1d1d', shorts: '#1d1d1d', socks: '#f2c14e', boots: '#1a1a1a' },
    lineup: [
      { character: 'kid05', number: 1, position: 'TW' },
      { character: 'kid09', number: 4, position: 'AB' },
      { character: 'kid03', number: 7, position: 'LM' },
      { character: 'kid04', number: 8, position: 'RM' },
      { character: 'kid01', number: 10, position: 'ST' },
    ],
  },
  {
    name: 'SV Blau',
    kit: { shirt: '#1f4e9c', accent: '#ffd23f', number: '#ffffff', shorts: '#1f4e9c', socks: '#ffffff', boots: '#f2f2f2' },
    keeperKit: { shirt: '#2bb673', accent: '#0b3d2c', number: '#0b3d2c', shorts: '#0b3d2c', socks: '#2bb673', boots: '#1a1a1a' },
    lineup: [
      { character: 'kid10', number: 1, position: 'TW' },
      { character: 'kid02', number: 5, position: 'AB' },
      { character: 'kid06', number: 6, position: 'LM' },
      { character: 'kid08', number: 11, position: 'RM' },
      { character: 'kid07', number: 9, position: 'ST' },
    ],
  },
];
