#!/usr/bin/env bash
# WO-876 — libretro cores for the Visuals' Game scene (godot/client/features/visuals/game_launcher.gd) and WO-745's window.
# Takes the cores from Ubuntu's own libretro packages (signed archive), unpacked into ~/.highascg/retro/cores: no root, and
# no RetroArch (the packages depend on it; we only want the .so).
#   godot/retro/get-cores.sh                      NES (Nestopia, GPL-2), SNES (bsnes-mercury, GPL-3), GB/GBC/GBA (mGBA, MPL-2)
#   godot/retro/get-cores.sh --with-noncommercial + Genesis/Master System (Genesis Plus GX) and Snes9x — their licences
#                                                 forbid commercial use: not for paid shows.
# ROMs are your own files: put them (unzipped) in ~/.highascg/retro/games.
set -euo pipefail

DEST="${HIGHASCG_RETRO_CORES:-$HOME/.highascg/retro/cores}"
PKGS=(libretro-nestopia libretro-bsnes-mercury-balanced libretro-mgba)
[[ ${1:-} == --with-noncommercial ]] && PKGS+=(libretro-genesisplusgx libretro-snes9x)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
apt-get download "${PKGS[@]}"
for deb in ./*.deb; do dpkg-deb -x "$deb" root; done
mkdir -p "$DEST" "$HOME/.highascg/retro/games"
find root -name '*_libretro.so' -exec install -m 0644 {} "$DEST/" \;
echo "cores in $DEST:"
ls -1 "$DEST"
echo "ROMs go in $HOME/.highascg/retro/games"
