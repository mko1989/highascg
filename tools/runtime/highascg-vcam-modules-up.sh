#!/usr/bin/env bash
# Load v4l2loopback + snd-aloop for HighAsCG virtual camera (WO-137 / WO-109).
# Reads validated keys from /run/highascg/vcam-modules.conf (written by Node).
# NOPASSWD entry in /etc/sudoers.d/highascg — see docs/HIGHASCG_PASSWORDLESS_SUDO.md
set -euo pipefail

CONF=/run/highascg/vcam-modules.conf
[[ -r "$CONF" ]] || {
	echo "missing $CONF" >&2
	exit 1
}

# WO-830b: this runs as root and the file is written by the (unprivileged) node process, so it is
# DATA, never code: no `source`. Each line must be exactly KEY=VALUE (VALUE optionally in "..."),
# KEY from a fixed list; the value charset is checked per key below. Anything else aborts.
VIDEO_NR=10
CARD_LABEL="CasparCG Out"
ALSA_INDEX=20
ALSA_ID=HighAsCG_VCam
ALSA_PCM=2
AUDIO_ENABLED=1

line_re='^([A-Z_]+)=(.*)$'
quoted_re='^"([A-Za-z0-9 ._-]*)"$'
while IFS= read -r line || [[ -n "$line" ]]; do
	[[ -z "$line" ]] && continue
	if ! [[ "$line" =~ $line_re ]]; then
		echo "invalid line in $CONF" >&2
		exit 1
	fi
	key="${BASH_REMATCH[1]}"
	val="${BASH_REMATCH[2]}"
	if [[ "$val" =~ $quoted_re ]]; then
		val="${BASH_REMATCH[1]}"
	fi
	case "$key" in
		VIDEO_NR | ALSA_INDEX | ALSA_PCM)
			[[ "$val" =~ ^[0-9]{1,3}$ ]] || {
				echo "invalid $key" >&2
				exit 1
			}
			printf -v "$key" '%s' "$val"
			;;
		CARD_LABEL)
			[[ "$val" =~ ^[A-Za-z0-9\ ._-]{1,64}$ ]] || {
				echo "invalid CARD_LABEL" >&2
				exit 1
			}
			CARD_LABEL="$val"
			;;
		ALSA_ID)
			[[ "$val" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || {
				echo "invalid ALSA_ID" >&2
				exit 1
			}
			ALSA_ID="$val"
			;;
		AUDIO_ENABLED)
			[[ "$val" =~ ^(0|1|true|false|yes|no)$ ]] || {
				echo "invalid AUDIO_ENABLED" >&2
				exit 1
			}
			AUDIO_ENABLED="$val"
			;;
		*)
			echo "unknown key $key" >&2
			exit 1
			;;
	esac
done <"$CONF"

if ! [[ "$VIDEO_NR" =~ ^[0-9]+$ ]] || (( VIDEO_NR < 0 || VIDEO_NR > 63 )); then
	echo "invalid VIDEO_NR" >&2
	exit 1
fi
if ! [[ "$ALSA_INDEX" =~ ^[0-9]+$ ]] || (( ALSA_INDEX < 0 || ALSA_INDEX > 31 )); then
	echo "invalid ALSA_INDEX" >&2
	exit 1
fi
if ! [[ "$ALSA_PCM" =~ ^[0-9]+$ ]] || (( ALSA_PCM < 1 || ALSA_PCM > 8 )); then
	echo "invalid ALSA_PCM" >&2
	exit 1
fi
if ! [[ "$ALSA_ID" =~ ^[A-Za-z0-9_-]+$ ]]; then
	echo "invalid ALSA_ID" >&2
	exit 1
fi

alsa_card_present() {
	local id="$1"
	local stripped="${id//_/}"
	if grep -qE "^[[:space:]]*[0-9]+[[:space:]]+\\[${stripped}[[:space:]]*\\]" /proc/asound/cards 2>/dev/null; then
		return 0
	fi
	if grep -qE "^[[:space:]]*[0-9]+[[:space:]]+\\[${id}[[:space:]]*\\]" /proc/asound/cards 2>/dev/null; then
		return 0
	fi
	return 1
}

# v4l2loopback (skip if device already present)
if [[ ! -e "/dev/video${VIDEO_NR}" ]]; then
	modprobe v4l2loopback devices=1 "video_nr=${VIDEO_NR}" "card_label=${CARD_LABEL}" exclusive_caps=0 2>/dev/null || \
		modprobe v4l2loopback devices=1 "video_nr=${VIDEO_NR}" "card_label=${CARD_LABEL}" || {
		echo "v4l2loopback modprobe failed" >&2
		exit 1
	}
fi

if [[ "$AUDIO_ENABLED" == "1" || "$AUDIO_ENABLED" == "true" || "$AUDIO_ENABLED" == "yes" ]]; then
	if ! alsa_card_present "$ALSA_ID"; then
		modprobe snd-aloop enable=1 "index=${ALSA_INDEX}" "id=${ALSA_ID}" "pcm=${ALSA_PCM}" || {
			echo "snd-aloop modprobe failed" >&2
			exit 1
		}
	fi
fi

echo "ok video${VIDEO_NR} alsa=${ALSA_ID}"
