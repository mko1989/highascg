#!/usr/bin/env bash
# Put every CasparCG screen-consumer window where Caspar asked for it, and report whether it stayed.
#
#   bash tools/startup/place-screen-consumers.sh          # report only
#   bash tools/startup/place-screen-consumers.sh --apply  # move, then re-check after 2s
#
# Why this exists: Openbox's rc.xml ships `<placement><policy>Smart</policy><center>yes</center>`
# with no `<applications>` rule for casparcg, so it PLACES new consumer windows by its own policy
# and ignores the position Caspar asked for. On a 9984x1536 canvas both 1920x1080 consumers landed
# at (4032,228) — dead centre, stacked on each other — while their monitors sat empty.
#
# The intended position is read from Caspar's own log ("Window positioned at: (X, Y)") rather than
# from config, so this cannot disagree with what the server actually tried to do. Windows are found
# by title, so it survives a Caspar restart (window ids do not).
set -uo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

USER_CASPAR="${HIGHASCG_USER:-casparcg}"
HOME_CASPAR="/home/${USER_CASPAR}"
LOG="${HIGHASCG_CASPAR_LOG:-${HOME_CASPAR}/highascg/log/caspar_$(date +%F).log}"
export DISPLAY="${DISPLAY:-:0}"
export XAUTHORITY="${XAUTHORITY:-${HOME_CASPAR}/.Xauthority}"

command -v xdotool >/dev/null 2>&1 || { echo "ERROR: xdotool not installed" >&2; exit 1; }

# `xdotool search --name` takes a REGEX. The consumer titles contain `[` and `|`, and an unescaped
# `|` turns the pattern into an alternation that matches EVERY window — the script then measured
# the root window and cheerfully reported the consumer as correctly placed. Both are escaped below.
[[ -f "$LOG" ]] || { echo "ERROR: no Caspar log at $LOG" >&2; exit 1; }

# Intended position per channel, from the LAST server start only.
INTENT="$(awk '
	/Starting CasparCG Video and Graphics/ { delete pos }
	/Screen consumer \[[0-9]+\|.*Window positioned at:/ {
		ch = $0; sub(/.*Screen consumer \[/, "", ch); sub(/\|.*/, "", ch)
		xy = $0; sub(/.*Window positioned at: \(/, "", xy); sub(/\).*/, "", xy); gsub(/[ ,]+/, " ", xy)
		pos[ch] = xy
	}
	END { for (c in pos) print c, pos[c] }
' "$LOG" | sort -n)"

[[ -n "$INTENT" ]] || { echo "No 'Window positioned at' lines in the last start — is this build logging them?" >&2; exit 1; }

geom() { xdotool getwindowgeometry --shell "$1" 2>/dev/null | awk -F= '/^X=|^Y=/{printf "%s ", $2} END{print ""}'; }

moved=0 already=0 missing=0
while read -r ch wantx wanty; do
	[[ -n "$ch" ]] || continue
	wid="$(xdotool search --name "Screen consumer \[${ch}\|" 2>/dev/null | head -1)"
	if [[ -z "$wid" ]]; then
		printf 'ch %-3s want (%s,%s)  -- NO WINDOW\n' "$ch" "$wantx" "$wanty"
		missing=$((missing + 1))
		continue
	fi
	before="$(geom "$wid")"
	if [[ "$before" == "$wantx $wanty " ]]; then
		printf 'ch %-3s want (%s,%s)  at (%s) OK\n' "$ch" "$wantx" "$wanty" "${before% }"
		already=$((already + 1))
		continue
	fi
	if [[ "$APPLY" -eq 1 ]]; then
		xdotool windowmove "$wid" "$wantx" "$wanty" 2>/dev/null
		sleep 2
		after="$(geom "$wid")"
		verdict="STAYED"
		[[ "$after" == "$wantx $wanty " ]] || verdict="SNAPPED BACK — the WM is re-asserting, an rc.xml rule is needed"
		printf 'ch %-3s want (%s,%s)  was (%s) now (%s) %s\n' "$ch" "$wantx" "$wanty" "${before% }" "${after% }" "$verdict"
		moved=$((moved + 1))
	else
		printf 'ch %-3s want (%s,%s)  at (%s) MISPLACED (run with --apply)\n' "$ch" "$wantx" "$wanty" "${before% }"
	fi
done <<<"$INTENT"

# A window can be in exactly the right place and still show nothing, because another window sits
# over it — which is invisible in Caspar's log and the reason "it initialized" and "it is on the
# output" are different claims. Report, per consumer, every top-level window that overlaps its rect
# AND sits above it in _NET_CLIENT_LIST_STACKING (that list is bottom-to-top).
echo
echo "== what is stacked over each consumer =="
STACK="$(xprop -root _NET_CLIENT_LIST_STACKING 2>/dev/null | sed 's/.*# //; s/,//g')"
TREE="$(xwininfo -root -children 2>/dev/null)"

stack_index() { # $1 = 0x… id
	local i=0 w
	for w in $STACK; do
		[[ "$(printf '%d' "$w" 2>/dev/null)" == "$(printf '%d' "$1" 2>/dev/null)" ]] && { echo "$i"; return; }
		i=$((i + 1))
	done
	echo -1
}

# id|name|x|y|w|h for every child of root that xwininfo reports with geometry
mapfile -t WINS < <(echo "$TREE" | grep -oE '0x[0-9a-f]+ [^:]*: \([^)]*\)[^0-9]*[0-9]+x[0-9]+\+[-0-9]+\+[-0-9]+  \+[-0-9]+\+[-0-9]+' 2>/dev/null || true)

while read -r ch wantx wanty; do
	[[ -n "$ch" ]] || continue
	wid="$(xdotool search --name "Screen consumer \[${ch}\|" 2>/dev/null | head -1)"
	[[ -n "$wid" ]] || continue
	hexid="$(printf '0x%x' "$wid")"
	eval "$(xdotool getwindowgeometry --shell "$wid" 2>/dev/null)"
	cx=${X:-0}; cy=${Y:-0}; cw=${WIDTH:-0}; chh=${HEIGHT:-0}
	mine="$(stack_index "$hexid")"
	printf 'ch %-3s %s at (%s,%s) %sx%s stack#%s\n' "$ch" "$hexid" "$cx" "$cy" "$cw" "$chh" "$mine"
	for line in "${WINS[@]}"; do
		oid="${line%% *}"
		[[ "$(printf '%d' "$oid" 2>/dev/null)" == "$wid" ]] && continue
		abs="${line##*  +}"; ox="${abs%%+*}"; oy="${abs##*+}"
		wh="${line##* }"; wh="${line%%+*}"; wh="${wh##* }"
		ow="${wh%%x*}"; oh="${wh##*x}"
		[[ "$ox" =~ ^-?[0-9]+$ && "$oy" =~ ^-?[0-9]+$ && "$ow" =~ ^[0-9]+$ && "$oh" =~ ^[0-9]+$ ]] || continue
		(( ox < cx + cw && ox + ow > cx && oy < cy + chh && oy + oh > cy )) || continue
		theirs="$(stack_index "$oid")"
		(( theirs > mine )) || continue
		name="${line#* }"; name="${name%%:*}"
		printf '      COVERED BY %s %s at (%s,%s) %sx%s stack#%s\n' "$oid" "$name" "$ox" "$oy" "$ow" "$oh" "$theirs"
	done
done <<<"$INTENT"

printf '\nwindow ids are per Caspar run — re-run after any restart. moved=%d already-correct=%d missing=%d\n' \
	"$moved" "$already" "$missing"
