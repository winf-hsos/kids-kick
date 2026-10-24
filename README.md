# kids-kick ⚽

Ein web-basiertes Fußballspiel im FIFA-Style (à la Nintendo / PlayStation), in dem Kinder- und Jugendmannschaften gegeneinander antreten.

## Fokus (Phase 1)

- **F- und E-Jugend**
- Spielmodus **4+1** (vier Feldspieler + Torwart)
- Spielfeld **40 × 25 m**, Jugendtore **5 × 2 m**

## Stand

- 3D-Spielfeld mit Rasen (Mähstreifen), Linien, Strafräumen, Jugendtoren mit Netz
- Umgebung: Himmel, Sonnenlicht mit Schatten, Banden, Ballfangzäune, Auswechselbänke, Bäume
- Zehn realistische Kinderfiguren (9–11 Jahre, 1,30–1,46 m) mit Haaren, Trikot, Hose, Stutzen und Schuhen
- Zwei Teams im 4+1 (FC Rot, SV Blau) mit Trikotfarben, Rückennummer und Namen, eigene Torwart-Trikots
- Ein Spieler (gelber Ring) steuerbar per Tastatur oder Gamepad, mit Steh-/Geh-/Lauf-Animationen und Körperneigung
- TV-Kamera an der Seitenlinie, die dem Ball folgt, plus Totale
- Ball (Größe 4) mit Physik (Rapier): Rollen, Springen, Pfosten, Latte, Netz, Banden, Spieler
- Dribbeln, Pass zum Mitspieler in Laufrichtung (mit automatischem Spielerwechsel), Schuss mit Aufladen, Spielerwechsel
- Regeln: Tor, Anstoß, Seitenaus mit Eindribbeln, Ecke, Abstoß; Anzeigetafel mit Spielstand und Uhr
- KI für Mit- und Gegenspieler: Formation, die mit dem Ball wandert, Anbieten in freie Räume, Pressing,
  Decken, Ballführung mit Entscheidung zwischen Dribbeln, Passen und Schießen; Torwart mit Stellungsspiel,
  Rauslaufen und Hechtsprung
- Einstellungen (oben rechts): Gegnerstärke Bambini / Kreisliga / Profi, Regler „Kinder-Realismus“
  (diszipliniert bis Bienenschwarm), Modus „Ich spiele“ oder „Zuschauen“ (KI gegen KI), Pause

## Testen

Die aktuelle Version von `main` wird automatisch veröffentlicht: **https://winf-hsos.github.io/kids-kick/**

## Steuerung

| Aktion | Tastatur | Controller |
|---|---|---|
| Laufen | WASD / Pfeiltasten | linker Stick |
| Sprinten | Shift | R2 / RT (oder R1 / RB) |
| Pass | E (oder J) | ✕ / A |
| Schuss (halten = mehr Kraft) | Leertaste (oder K) | ○ / B |
| Zielen beim Schuss | W / S (oben / unten) | Stick hoch / runter |
| Spieler wechseln | Q (oder L) | L1 / LB |
| Kamera wechseln | C | △ / Y |
| Pause | P | Start / Options |
| Zoom | Mausrad | – |

## Entwicklung

Voraussetzung: Node.js 20+

```bash
npm install
npm run dev      # Dev-Server mit Hot Reload
npm run build    # Typprüfung + Produktions-Build nach dist/
```

## Technik

- [Three.js](https://threejs.org/) (WebGL) mit TypeScript
- [Vite](https://vite.dev/) als Build-Tool
- [Rapier](https://rapier.rs/) für die Ballphysik

## Projektstruktur

```
src/
  config.ts                 Maße von Feld, Tor und Spieler
  main.ts                   Einstieg, Renderer, Spielschleife
  world/pitch.ts            Rasen und Linien
  world/goal.ts             Jugendtore mit Netz
  world/environment.ts      Himmel, Licht, Banden, Umgebung
  teams.ts                  Teams, Trikots, Aufstellung im 4+1
  game/match.ts             Spiellogik: Ballbesitz, Pass, Schuss, Regeln
  ai/teamAI.ts              KI: Formation, Entscheidungen, Torwart
  ai/settings.ts            Schwierigkeitsstufen und Einstellungen
  ui/settingsPanel.ts       Einstellungs-Menü
  ball/ball.ts              Ball (Physik, Rollwiderstand, Muster)
  physics/world.ts          Physikwelt: Boden, Tore, Netz, Banden
  hud/hud.ts                Anzeigetafel, Kraftbalken, Meldungen
  player/character.ts       Spielerfiguren laden und einkleiden
  player/player.ts          Bewegung, Animationen
  camera/broadcastCamera.ts TV-Kamera
  input/input.ts            Tastatur und Gamepad
public/models/players/      Spielerfiguren (erzeugt)
tools/characters/           Generator für die Spielerfiguren (Blender + MakeHuman)
viewer.html                 Figuren-Viewer (nur im Dev-Server)
```

## Hinweise

- Strafraumgröße (8 × 14 m) und Mittelkreis (r = 3 m) sind Annahmen und in `src/config.ts` anpassbar.
- Die Spielerfiguren werden mit `tools/characters` erzeugt, siehe [tools/characters/README.md](tools/characters/README.md).
