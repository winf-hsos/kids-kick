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
- TV-Kamera an der Seitenlinie, die dem Spieler folgt, plus Totale

## Testen

Die aktuelle Version von `main` wird automatisch veröffentlicht: **https://winf-hsos.github.io/kids-kick/**

## Steuerung

| Aktion | Tastatur | Controller |
|---|---|---|
| Laufen | WASD / Pfeiltasten | linker Stick |
| Sprinten | Shift | R2 / RT (oder R1 / RB) |
| Kamera wechseln | C | △ / Y |
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
- Später: [Rapier](https://rapier.rs/) für Ballphysik

## Projektstruktur

```
src/
  config.ts                 Maße von Feld, Tor und Spieler
  main.ts                   Einstieg, Renderer, Spielschleife
  world/pitch.ts            Rasen und Linien
  world/goal.ts             Jugendtore mit Netz
  world/environment.ts      Himmel, Licht, Banden, Umgebung
  teams.ts                  Teams, Trikots, Aufstellung im 4+1
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
