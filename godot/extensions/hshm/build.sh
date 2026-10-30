#!/usr/bin/env bash
# WO-596 — build the hshm GDExtension for this machine and install it into Godot projects.
#
#   godot/extensions/hshm/build.sh                       # build + install into godot/spikes/m0 (and godot/client if present)
#   godot/extensions/hshm/build.sh --release             # template_release build as well
#   GODOTCPP_SOURCE_DIR=/path/to/godot-cpp build.sh      # reuse a checkout (else CMake fetches 10.0.0-stable)
#
# The first build compiles godot-cpp's generated bindings (~5 min on a laptop, ~1 min on the box);
# later builds only rebuild hshm. Build dir: godot/extensions/hshm/build/ (git- and Syncthing-ignored).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BUILD="$HERE/build"
TARGETS=(template_debug)
[[ "${1:-}" == "--release" ]] && TARGETS+=(template_release)

for t in "${TARGETS[@]}"; do
	args=(-S "$HERE" -B "$BUILD/$t" -DCMAKE_BUILD_TYPE=Release -DGODOTCPP_TARGET="$t")
	[[ -n "${GODOTCPP_SOURCE_DIR:-}" ]] && args+=(-DGODOTCPP_SOURCE_DIR="$GODOTCPP_SOURCE_DIR")
	cmake "${args[@]}"
	cmake --build "$BUILD/$t" -j"$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"
done

for proj in "$REPO/godot/spikes/m0" "$REPO/godot/client"; do
	[[ -f "$proj/project.godot" ]] || continue
	mkdir -p "$proj/addons/hshm/bin"
	cp "$HERE/hshm.gdextension" "$proj/addons/hshm/"
	cp "$HERE"/bin/libhshm.* "$proj/addons/hshm/bin/"
	mkdir -p "$proj/.godot"  # register without an editor import (see run-spike.sh)
	grep -qs "res://addons/hshm/hshm.gdextension" "$proj/.godot/extension_list.cfg" ||
		echo "res://addons/hshm/hshm.gdextension" >> "$proj/.godot/extension_list.cfg"
	echo "[hshm] installed into ${proj#$REPO/}/addons/hshm"
done

# WO-863: the writer (HshmSink) for the client's Visuals tab. Copied beside, then renamed: a cp over a .so a running
# client has mapped crashes it (WO-743), a rename does not.
sink="$REPO/godot/client/addons/hshm_sink"
if [[ -f "$sink/hshm_sink.gdextension" ]]; then
	mkdir -p "$sink/bin"
	for so in "$HERE"/bin/libhshm_sink.*; do
		cp "$so" "$sink/bin/.$(basename "$so").new" && mv -f "$sink/bin/.$(basename "$so").new" "$sink/bin/$(basename "$so")"
	done
	grep -qs "res://addons/hshm_sink/hshm_sink.gdextension" "$REPO/godot/client/.godot/extension_list.cfg" ||
		echo "res://addons/hshm_sink/hshm_sink.gdextension" >> "$REPO/godot/client/.godot/extension_list.cfg"
	echo "[hshm] sink installed into godot/client/addons/hshm_sink"
fi
