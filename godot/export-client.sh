#!/usr/bin/env bash
# WO-686 — export the Godot operator client for Linux / Windows / macOS into godot/export/<platform>/.
#   godot/export-client.sh                    # every preset in godot/client/export_presets.cfg
#   godot/export-client.sh Windows macOS      # just these presets
#   godot/export-client.sh --fetch-templates  # download this Godot version's export templates first (~1 GB)
# GODOT=/path/to/godot overrides the binary (default ~/.local/opt/godot/godot, then godot on PATH).
# macOS builds are ad-hoc signed, not notarized: on the Mac, right-click → Open the first time
# (or `xattr -cr "HighAsCG Operator.app"`).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT="$HERE/client"
VERSION="$(tr -d '[:space:]' <"$HERE/GODOT_VERSION")"
GODOT="${GODOT:-}"
if [[ -z "$GODOT" ]]; then
	for c in "$HOME/.local/opt/godot/godot" "$(command -v godot 2>/dev/null || true)"; do
		if [[ -n "$c" && -x "$c" ]]; then GODOT="$c"; break; fi
	done
fi
[[ -n "$GODOT" ]] || { echo "Godot not found — set GODOT=/path/to/godot" >&2; exit 1; }
have="$("$GODOT" --version | cut -d. -f1-3)"
[[ "$have" == "$VERSION" ]] || echo "WARN: $GODOT is $have, godot/GODOT_VERSION pins $VERSION" >&2

case "$(uname -s)" in
	Darwin) TPL="$HOME/Library/Application Support/Godot/export_templates/$VERSION.stable" ;;
	*) TPL="${XDG_DATA_HOME:-$HOME/.local/share}/godot/export_templates/$VERSION.stable" ;;
esac

if [[ "${1:-}" == "--fetch-templates" ]]; then
	shift
	url="https://github.com/godotengine/godot/releases/download/$VERSION-stable/Godot_v$VERSION-stable_export_templates.tpz"
	tmp="$(mktemp -d)"
	echo "==> $url"
	curl -fL --progress-bar -o "$tmp/templates.tpz" "$url"
	(cd "$tmp" && unzip -q templates.tpz)
	mkdir -p "$TPL"
	cp -r "$tmp/templates/." "$TPL/"
	rm -r -- "$tmp"
	echo "==> templates in $TPL"
	[[ $# -gt 0 ]] || exit 0
fi

if [[ ! -f "$TPL/version.txt" ]]; then
	echo "No export templates for $VERSION in $TPL — run: $0 --fetch-templates" >&2
	exit 1
fi

presets=("$@")
if [[ ${#presets[@]} -eq 0 ]]; then
	mapfile -t presets < <(sed -n 's/^name="\(.*\)"$/\1/p' "$CLIENT/export_presets.cfg")
fi

fail=0
for p in "${presets[@]}"; do
	out="$(sed -n "/^name=\"$p\"\$/,/^export_path=/s/^export_path=\"\(.*\)\"\$/\1/p" "$CLIENT/export_presets.cfg")"
	[[ -n "$out" ]] || { echo "No preset \"$p\"" >&2; fail=1; continue; }
	mkdir -p "$(dirname "$CLIENT/$out")"
	echo "==> $p → godot/client/$out"
	rm -f -- "$CLIENT/$out"
	log="$("$GODOT" --headless --path "$CLIENT" --export-release "$p" "$CLIENT/$out" 2>&1)" && rc=0 || rc=$?
	# The configuration errors follow the ERROR line unprefixed; print from the first ERROR on.
	grep -A20 -E "ERROR|WARNING" <<<"$log" | grep -vE "^\s*at: |^--$" >&2 || true
	if [[ $rc -eq 0 && -s "$CLIENT/$out" ]] && ! grep -q "export for preset .* failed" <<<"$log"; then
		(cd "$(dirname "$CLIENT/$out")" && sha256sum "$(basename "$out")" >"$(basename "$out").sha256")
		ls -lh "$CLIENT/$out"
	else
		echo "FAILED: $p" >&2
		fail=1
	fi
done
exit "$fail"
