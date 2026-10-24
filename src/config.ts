// Maße in Metern. Koordinaten: x = Spielfeldlänge, z = Spielfeldbreite, y = oben.
// Die TV-Kamera steht auf der Seite +z und schaut in Richtung -z.

export const PITCH = {
  length: 40,
  width: 25,
  /** Linienbreite */
  lineWidth: 0.08,
  /** Auslaufzone zwischen Seiten-/Torlinie und Bande */
  runoff: 3,
  centerCircleRadius: 3,
  /** Strafraum (Annahme für 4+1, anpassbar) */
  penaltyAreaDepth: 8,
  penaltyAreaWidth: 14,
  penaltySpotDistance: 7,
} as const;

export const GOAL = {
  /** lichte Breite */
  width: 5,
  /** lichte Höhe */
  height: 2,
  postRadius: 0.04,
  /** Tiefe oben (Dachrahmen) und unten (Bodenrahmen) */
  depthTop: 0.8,
  depthBottom: 1.5,
} as const;

export const PLAYER = {
  /** Körpergröße eines E-Jugend-Spielers (ca. 9–10 Jahre) */
  height: 1.38,
  jogSpeed: 3.6,
  sprintSpeed: 6.2,
} as const;
