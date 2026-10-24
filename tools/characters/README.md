# Spielerfiguren

Die Kinderfiguren werden per Skript erzeugt, nicht von Hand modelliert. So lassen sich
neue Spielertypen, Animationen oder Änderungen an der Kleidung jederzeit neu bauen.

## Pipeline

1. **Körper** – [MPFB](https://extensions.blender.org/add-ons/mpfb/) (MakeHuman für Blender)
   erzeugt Kinder mit echten Proportionen (Alter 9–11, Größe 1,30–1,46 m, Geschlecht, Statur, Herkunft).
2. **Skelett** – MPFB-Skelett „mixamo“, kompatibel zu Mixamo-Animationen.
3. **Haare, Augen, Augenbrauen, Schuhe** – aus den MakeHuman-System-Assets (CC0).
   Haarfarben werden beim Erzeugen eingefärbt.
4. **Trikot, Hose, Stutzen** – werden als Hüllen direkt aus dem Körper abgeleitet
   (gleiche Gewichte wie die Haut, daher keine Verformungsprobleme). Die Trikot-UVs sind
   eine Zylinderprojektion, damit das Spiel Nummer und Namen aufs Trikot malen kann.
5. **Animationen** – Stehen, Gehen und Laufen werden vom Mixamo-Modell `source/Xbot.glb`
   auf das Kinderskelett übertragen (`retarget.py`). Dabei wird auch die Geschwindigkeit
   gemessen, bei der die Füße nicht rutschen (`naturalSpeed` in `players.json`).
6. **Export und Kompression** – GLB aus Blender, danach Meshopt + WebP mit glTF-Transform.

Die Teamfarben, Nummern und Namen kommen erst im Spiel dazu (`src/player/character.ts`),
jede Figur kann also in jedem Team spielen.

## Neu erzeugen

```bash
tools/characters/setup.sh            # einmalig: Blender (bpy), MPFB, Assets
MH_ASSETS=~/.kids-kick-tools/mhassets/data \
  ~/.kids-kick-tools/bpyenv/bin/python tools/characters/generate.py --out tools/characters/out
npm run characters:optimize          # -> public/models/players/
```

Einzelne Typen: `--only kid03 kid07`. Die Spielertypen stehen in `VARIANTS` in `generate.py`.

Zum Anschauen gibt es im Dev-Server `viewer.html`, z. B.
`http://localhost:5173/viewer.html?ids=kid01,kid03,kid06&team=1&anim=run`.

## Lizenzen

- MakeHuman-Basismodell und System-Assets: CC0 (mit MakeHuman erzeugte Modelle sind frei nutzbar)
- MPFB: GPL-3.0 (nur Werkzeug, nicht Teil des Spiels)
- Animationen: Mixamo (Adobe), lizenzfrei in Projekten nutzbar; Quelle ist das „X Bot“-Modell aus den three.js-Beispielen
