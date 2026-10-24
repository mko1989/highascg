#!/usr/bin/env bash
# WO-745 — build RetroHost + HshmSink (godot/extensions/hshm, their own libraries: the kiosk's libhshm is not touched)
# and install them into this project only (godot/retro/addons/, git- and Syncthing-ignored).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT="$(cd "$HERE/../extensions/hshm" && pwd)"
cmake -S "$EXT" -B "$EXT/build/template_debug" -DCMAKE_BUILD_TYPE=Release -DGODOTCPP_TARGET=template_debug >/dev/null
cmake --build "$EXT/build/template_debug" --target hshm_sink retrohost -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
mkdir -p "$HERE/.godot"
: >"$HERE/.godot/extension_list.cfg"
for lib in hshm_sink:sink retrohost:retro; do
	name=${lib%%:*} src=${lib##*:}
	mkdir -p "$HERE/addons/$name/bin"
	cp "$EXT/src/$src/$name.gdextension" "$HERE/addons/$name/"
	cp "$EXT"/bin/lib"$name".* "$HERE/addons/$name/bin/"
	echo "res://addons/$name/$name.gdextension" >>"$HERE/.godot/extension_list.cfg"
done
echo "[retro] installed RetroHost + HshmSink into godot/retro/addons"
