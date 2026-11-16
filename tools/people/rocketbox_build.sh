#!/usr/bin/env bash
# WO-1103 — rebuild the shipped human puppet bodies (godot/client/assets/people) from the Microsoft Rocketbox library
# (MIT) at a pinned commit. Build-time only; nothing here is shipped. No root needed.
#   tools/people/rocketbox_build.sh <work dir>        # fetch + bake + textures into <work dir>/out
#   tools/people/rocketbox_build.sh <work dir> --install   # … and copy the results into godot/client/assets/people
# Needs: curl, python3 + Pillow, Godot 4.7 ($GODOT, default ~/.local/opt/godot/godot).
set -euo pipefail
WORK=${1:?work dir}
INSTALL=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
GODOT=${GODOT:-$HOME/.local/opt/godot/godot}
COMMIT=0943055db6ec570bcef9f2c8b41c9e5467c808f9
RAW=https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/$COMMIT/Assets
# body → avatar, texture prefix, clip gender
declare -A AV=([woman]=Business_Female_04 [man]=Business_Male_02)
declare -A PRE=([woman]=f020 [man]=m008)
declare -A G=([woman]=f [man]=m)
# clip → set/file stem (the gender letter is prefixed)
CLIPS="walk_slow:xy/walk_slow_01 walk:xy/walk_neutral_01 walk_fast:xy/walk_fast_01 idle:static/idle_neutral_01
turn_left_60:xyz/turn_left_60 turn_right_60:xyz/turn_right_60 turn_left_90:xyz/turn_left_90 turn_right_90:xyz/turn_right_90"
mkdir -p "$WORK"/{src,out,gp}
WORK=$(cd "$WORK" && pwd)
get() { [ -s "$2" ] || curl -fsSL -m 300 -o "$2" "$1"; }
spec="{\"bodies\":{"
sep=""
for b in woman man; do
	a=${AV[$b]}
	mkdir -p "$WORK/src/$a/Textures"
	get "$RAW/Avatars/Professions/$a/Export/$a.fbx" "$WORK/src/$a/$a.fbx"
	for m in body_color body_normal body_specular head_color head_normal head_specular opacity_color; do
		get "$RAW/Avatars/Professions/$a/Textures/${PRE[$b]}_$m.tga" "$WORK/src/$a/Textures/${PRE[$b]}_$m.tga"
	done
	clips=""
	csep=""
	for c in $CLIPS; do
		name=${c%%:*}
		set_=${c#*:}
		set_=${set_%%/*}
		stem=${G[$b]}_${c##*/}
		get "$RAW/Animations/all_animations_max_motextr_$set_/$stem.max.fbx" "$WORK/src/$stem.fbx"
		kind=walk
		case $name in idle) kind=idle ;; turn_*) kind=turn ;; esac
		clips="$clips$csep\"$name\":{\"file\":\"$WORK/src/$stem.fbx\",\"kind\":\"$kind\"}"
		csep=","
	done
	spec="$spec$sep\"$b\":{\"fbx\":\"$WORK/src/$a/$a.fbx\",\"prefix\":\"${PRE[$b]}\",\"clips\":{$clips}}"
	sep=","
done
echo "$spec}}" > "$WORK/spec.json"
printf 'config_version=5\n[application]\nconfig/name="rocketbox-bake"\n' > "$WORK/gp/project.godot"
"$GODOT" --headless --path "$WORK/gp" --script "$HERE/rocketbox_bake.gd" -- "$WORK/spec.json" "$WORK/out"
for b in woman man; do
	python3 -I "$HERE/rocketbox_tex.py" "$WORK/src/${AV[$b]}/Textures" "${PRE[$b]}" "$WORK/out" "$b"
done
ls -la "$WORK/out"
if [ "$INSTALL" = "--install" ]; then
	DEST="$ROOT/godot/client/assets/people"
	for b in woman man; do
		cp "$WORK/out/$b.scn" "$WORK/out/${b}_moves.res" "$WORK/out/${b}"_*.webp "$DEST/"
	done
	echo "installed into $DEST — check LICENSES.json still lists every file (the WO-1103 smoke does)"
fi
