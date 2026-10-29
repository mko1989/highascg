#!/bin/sh
# WO-779: HDMI/DP audio (NVIDIA HDA and other HDMI codecs) comes up with every "IEC958 Playback Switch" OFF. On a desktop
# PulseAudio/PipeWire turns them on; this box runs neither (Caspar owns ALSA), so PortAudio/OAL played into a muted
# output. alsa-restore brings back whatever asound.state holds, which on a fresh install / after a power cut is "off".
# Owner 29.10: turn on ONLY the switch of the audio output set in the Devices tab (config/audio_outputs.json); every
# other switch stays as the operator left it. tools/runtime/selected-hdmi-iec958.js resolves output → card + numid;
# not HDMI/DP, or not resolvable → nothing is switched (never "all on"). Best-effort; prints one summary line.
#
#   sh tools/runtime/unmute-hdmi-audio.sh [<highascg config dir>]
# Test seam: HIGHASCG_AMIXER = amixer binary (also used by the helper).

_amixer="${HIGHASCG_AMIXER:-amixer}"
_tag='[unmute-hdmi-audio]'
command -v "$_amixer" >/dev/null 2>&1 || { echo "$_tag amixer missing — skipped"; exit 0; }
command -v node >/dev/null 2>&1 || { echo "$_tag node missing — switches untouched"; exit 0; }
_here=$(dirname "$0")
_plan=$(node "$_here/selected-hdmi-iec958.js" ${1:+"$1"} 2>/dev/null)
_on=''
_fail=''
_notes=''
while read -r _k _rest; do
	case "$_k" in
	on)
		set -- $_rest # card numid index what
		if "$_amixer" -q -c "$1" cset "numid=$2" on >/dev/null 2>&1; then
			_on="$_on${_on:+, }$4 (card $1 numid $2)"
		else
			_fail="$_fail${_fail:+, }$4 (card $1 numid $2)"
		fi
		;;
	note) _notes="$_notes${_notes:+; }$_rest" ;;
	esac
done <<EOF
$_plan
EOF
echo "$_tag on: ${_on:-none}${_fail:+ — cset failed: $_fail}${_notes:+ — $_notes}"
