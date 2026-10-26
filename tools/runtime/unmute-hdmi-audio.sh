#!/bin/sh
# WO-779: HDMI/DP audio (NVIDIA HDA and other HDMI codecs) comes up with every "IEC958 Playback Switch" OFF. On a desktop
# PulseAudio/PipeWire turns them on; this box runs neither (Caspar owns ALSA), so PortAudio/OAL played into a muted
# output. alsa-restore brings back whatever asound.state holds, which on a fresh install / after a power cut is "off".
# Turns the switches on for HDMI/DP cards only (onboard S/PDIF untouched). Best-effort; prints one summary line.

command -v amixer >/dev/null 2>&1 || { echo "[unmute-hdmi-audio] amixer missing — skipped"; exit 0; }
_on=0
_cards=''
# /proc/asound/cards: " 1 [NVidia         ]: HDA-Intel - HDA NVidia"
for _c in $(grep -iE '^ *[0-9]+ \[.*(nvidia|hdmi)' /proc/asound/cards 2>/dev/null | awk '{print $1}'); do
	for _id in $(amixer -c "$_c" controls 2>/dev/null | grep "name='IEC958 Playback Switch'" | sed -n 's/^numid=\([0-9]*\),.*/\1/p'); do
		amixer -q -c "$_c" cset "numid=$_id" on 2>/dev/null && _on=$((_on + 1))
	done
	_cards="$_cards$_c "
done
echo "[unmute-hdmi-audio] cards: ${_cards:-none} — $_on IEC958 switch(es) on"
