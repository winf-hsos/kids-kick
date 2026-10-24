#!/usr/bin/env bash
# Richtet die Werkzeuge für den Figuren-Generator ein (Linux/macOS, Python 3.13).
# - Blender als Python-Modul (bpy) + Pillow in einer eigenen venv
# - MPFB (MakeHuman-Erweiterung für Blender)
# - MakeHuman-System-Assets (CC0): Haare, Haut, Augen, Schuhe
set -euo pipefail

TOOLS="${KIDS_KICK_TOOLS:-$HOME/.kids-kick-tools}"
mkdir -p "$TOOLS"

python3 -m venv "$TOOLS/bpyenv"
"$TOOLS/bpyenv/bin/pip" install --quiet bpy==5.2.3 pillow

MPFB_URL="https://extensions.blender.org/download/sha256:c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad/add-on-mpfb-v2.0.18.zip"
curl -sSfL -o "$TOOLS/mpfb.zip" "$MPFB_URL"
echo "c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad  $TOOLS/mpfb.zip" | sha256sum -c -
"$TOOLS/bpyenv/bin/python" -c "
import bpy
bpy.ops.extensions.package_install_files(filepath='$TOOLS/mpfb.zip', repo='user_default', enable_on_install=True)
"

if [ ! -d "$TOOLS/mhassets/data/hair" ]; then
  mkdir -p "$TOOLS/mhassets"
  curl -sSfL -o "$TOOLS/mhassets/sys.zip" \
    https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip
  unzip -q -o "$TOOLS/mhassets/sys.zip" -d "$TOOLS/mhassets/data"
fi

echo
echo "Fertig. Figuren erzeugen mit:"
echo "  MH_ASSETS=$TOOLS/mhassets/data $TOOLS/bpyenv/bin/python tools/characters/generate.py --out tools/characters/out"
echo "  npm run characters:optimize"
