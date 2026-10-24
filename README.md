# kids-kick ⚽

Ein web-basiertes Fußballspiel im FIFA-Style (à la Nintendo / PlayStation), in dem Kinder- und Jugendmannschaften gegeneinander antreten.

## Fokus (Phase 1)

- **F- und E-Jugend**
- Spielmodus **4+1** (vier Feldspieler + Torwart)
- Spielfeld **40 × 25 m**, Jugendtore **5 × 2 m**

## Stand

- 3D-Spielfeld mit Rasen (Mähstreifen), Linien, Strafräumen, Jugendtoren mit Netz
- Umgebung: Himmel, Sonnenlicht mit Schatten, Banden, Ballfangzäune, Auswechselbänke, Bäume
- Ein Spieler, steuerbar per Tastatur oder Gamepad, mit Steh-/Geh-/Lauf-Animationen und Körperneigung
- TV-Kamera an der Seitenlinie, die dem Spieler folgt, plus Totale

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
  player/player.ts          Spielfigur, Bewegung, Animationen
  camera/broadcastCamera.ts TV-Kamera
  input/input.ts            Tastatur und Gamepad
public/models/              3D-Modelle
```

## Hinweise

- Strafraumgröße (8 × 14 m) und Mittelkreis (r = 3 m) sind Annahmen und in `src/config.ts` anpassbar.
- Die Spielfigur ist ein Platzhalter („X Bot“ von Mixamo, aus den three.js-Beispielen), auf Kindergröße (1,38 m) skaliert. Eigene Kindermodelle folgen.
