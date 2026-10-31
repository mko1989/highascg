#!/usr/bin/env bash
# WO-906 — install / remove the HighAsCG two-screen X layout (operator heads on :0.0, playout heads on :0.1).
# Runs as root through sudoers (scripts/runtime/install-xorg-screens-apply.sh); the server writes the generated file as
# the service user, this helper only validates and copies it. X picks it up on the next nodm restart (the caller's job).
# Usage:
#   highascg-xorg-screens-apply.sh check <file>     validate only (no root needed)
#   highascg-xorg-screens-apply.sh install <file>   validate, keep the current one as .prev, install
#   highascg-xorg-screens-apply.sh off              remove it (kept as .prev) → the single screen of today
#   highascg-xorg-screens-apply.sh restore          put .prev back (undo the last install / off)
#   highascg-xorg-screens-apply.sh status           print the installed file (or "off")
# The file may hold only Device / Monitor / Screen / ServerLayout sections (+ Display subsections) with a short list of
# keywords and NVIDIA options — no Files, Module, ModulePath, InputClass or anything that loads code or reads paths.
set -euo pipefail

XORG_DIR=/etc/X11/xorg.conf.d
if [[ $EUID -ne 0 && -n "${HIGHASCG_XORG_DIR:-}" ]]; then
	XORG_DIR="$HIGHASCG_XORG_DIR" # tests only: root ignores it (sudo resets the environment anyway)
fi
DST="$XORG_DIR/98-highascg-screens.conf"
PREV="$DST.prev" # not *.conf: X never loads it
MAX_BYTES=16384

SECTIONS='^(Device|Monitor|Screen|ServerLayout)$'
KEYWORDS='^(Identifier|Driver|BusID|Screen|Device|Monitor|DefaultDepth|Depth|Modes|Option|SubSection|EndSubSection|EndSection|Section)$'
OPTIONS='^(metamodes|MetaModes|ForceCompositionPipeline|ForceFullCompositionPipeline|Xinerama|AllowEmptyInitialConfiguration|ConnectedMonitor|UseDisplayDevice|nvidiaXineramaInfoOrder|ModeValidation|UseEdidDpi|DPI|Primary|TripleBuffer|AllowIndirectGLXProtocol|Coolbits|SLI|BaseMosaic|DPMS)$'

die() {
	echo "$*" >&2
	exit 2
}

validate() {
	local f="$1" n=0 depth=0 section="" line kw rest opt
	[[ -f "$f" && ! -L "$f" ]] || die "Not a regular file: $f"
	(($(stat -c %s "$f") <= MAX_BYTES)) || die "Too large (> $MAX_BYTES bytes): $f"
	LC_ALL=C grep -q '[^[:print:][:space:]]' "$f" && die "Binary or control characters in $f"
	while IFS= read -r line || [[ -n "$line" ]]; do
		n=$((n + 1))
		line="${line%%#*}"
		line="${line#"${line%%[![:space:]]*}"}"
		[[ -z "$line" ]] && continue
		kw="${line%%[[:space:]]*}"
		rest="${line#"$kw"}"
		[[ "$kw" =~ $KEYWORDS ]] || die "line $n: keyword '$kw' not allowed"
		case "$kw" in
		Section)
			((depth == 0)) || die "line $n: nested Section"
			section="$(sed -E 's/^[[:space:]]*"([^"]*)".*/\1/' <<<"$rest")"
			[[ "$section" =~ $SECTIONS ]] || die "line $n: Section \"$section\" not allowed"
			depth=1
			;;
		EndSection)
			((depth == 1)) || die "line $n: EndSection without Section"
			depth=0
			;;
		SubSection)
			((depth == 1)) && [[ "$section" == Screen ]] || die "line $n: SubSection only inside Screen"
			[[ "$rest" =~ ^[[:space:]]*\"Display\"[[:space:]]*$ ]] || die "line $n: only SubSection \"Display\""
			depth=2
			;;
		EndSubSection)
			((depth == 2)) || die "line $n: EndSubSection without SubSection"
			depth=1
			;;
		*)
			((depth >= 1)) || die "line $n: '$kw' outside a Section"
			[[ "$rest" =~ ^([[:space:]]+(\"[^\"\\]*\"|-?[0-9]+|RightOf|LeftOf|Above|Below|Absolute|Relative))+[[:space:]]*$ ]] ||
				die "line $n: values must be quoted strings, numbers or a screen position word"
			if [[ "$kw" == Option ]]; then
				opt="$(sed -E 's/^[[:space:]]*"([^"]*)".*/\1/' <<<"$rest")"
				[[ "$opt" =~ $OPTIONS ]] || die "line $n: Option \"$opt\" not allowed"
			fi
			if [[ "$kw" == Driver ]]; then
				[[ "$rest" =~ ^[[:space:]]*\"nvidia\"[[:space:]]*$ ]] || die "line $n: only Driver \"nvidia\""
			fi
			if [[ "$kw" == BusID ]]; then
				[[ "$rest" =~ ^[[:space:]]*\"PCI:[0-9]+:[0-9]+:[0-9]+\"[[:space:]]*$ ]] || die "line $n: BusID must be \"PCI:b:d:f\""
			fi
			if [[ "$kw" == Identifier && "$rest" =~ \"NVIDIA\ Default\ Device\" ]]; then
				die "line $n: \"NVIDIA Default Device\" is 99-highascg-force-composition.conf's — use another Identifier"
			fi
			;;
		esac
	done <"$f"
	((depth == 0)) || die "Unclosed Section at end of $f"
	grep -Eq '^[[:space:]]*Section[[:space:]]+"ServerLayout"' "$f" || die "No ServerLayout section in $f"
}

MODE="${1:-}"
TMP=""
trap '[[ -n "$TMP" ]] && rm -f "$TMP"' EXIT
case "$MODE" in
check)
	validate "${2:-}"
	echo "OK: ${2}"
	;;
install)
	SRC="${2:-}"
	validate "$SRC"
	mkdir -p "$XORG_DIR"
	TMP="$(mktemp "$XORG_DIR/.98-highascg-screens.XXXXXX")"
	cat -- "$SRC" >"$TMP" # copy the content, never the caller's file object (no link / owner / mode carried over)
	validate "$TMP"
	chmod 644 "$TMP"
	[[ -f "$DST" ]] && cp -f "$DST" "$PREV"
	mv -f "$TMP" "$DST"
	TMP=""
	echo "Installed $DST — restart nodm (then Caspar) to apply"
	;;
off)
	if [[ -f "$DST" ]]; then
		mv -f "$DST" "$PREV"
		echo "Removed $DST (kept as $PREV) — restart nodm to apply"
	else
		echo "Already off"
	fi
	;;
restore)
	[[ -f "$PREV" ]] || die "No $PREV to restore"
	TMP="$(mktemp "$XORG_DIR/.98-highascg-screens.XXXXXX")"
	cp -f "$PREV" "$TMP"
	if [[ -f "$DST" ]]; then mv -f "$DST" "$PREV"; else rm -f "$PREV"; fi
	mv -f "$TMP" "$DST"
	TMP=""
	chmod 644 "$DST"
	echo "Restored $DST — restart nodm to apply"
	;;
status)
	if [[ -f "$DST" ]]; then cat "$DST"; else echo "off"; fi
	;;
*)
	echo "Usage: $0 check <file> | install <file> | off | restore | status" >&2
	exit 2
	;;
esac
