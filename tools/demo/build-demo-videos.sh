#!/usr/bin/env bash
# WO-865 — the demo's two playable placeholder videos (godot/client/demo/placeholder_loop.ogv, placeholder_clip.ogv)
# and their data-set entries. Everything is synthetic (ffmpeg lavfi geq patterns + a neutral label); nothing is
# copied from a real file. Godot plays Ogg Theora in-engine, so .ogv; no audio track; 640x360, 25 fps, low bitrate.
#
#   placeholder_loop.ogv  10 s, seamless: every moving part is a function of sin/cos(2*pi*t/10), so the frame after
#                         the last one is frame 0 (a colour plasma with an orbiting dot).
#   placeholder_clip.ogv  30 s, different start and end: the colour drifts cold (blue) -> warm (orange), a big
#                         countdown 30 -> 0 and a progress bar that fills.
#
#   tools/demo/build-demo-videos.sh [out dir = godot/client/demo]
# Then it runs add-demo-videos.py (the media list in state.json, the stills in thumbs.json).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUT="${1:-$REPO/godot/client/demo}"
FONT="${DEMO_FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"
ENC=(-an -c:v libtheora -q:v 4 -pix_fmt yuv420p -r 25 -f ogg)

# 10 s loop: phase = 2*pi*(t/10 + x/W): the colour bands travel exactly one width per loop.
LOOP_GEQ="r='128+127*sin(2*PI*(T/10+X/W)+2*sin(2*PI*(Y/H+T/10)))':g='128+127*sin(2*PI*(T/10+X/W)+2.094+2*sin(2*PI*(Y/H+T/10)))':b='128+127*sin(2*PI*(T/10+X/W)+4.189+2*sin(2*PI*(Y/H+T/10)))'"
ffmpeg -nostdin -v error -y -f lavfi -i "color=c=black:s=640x360:r=25:d=10,format=gbrp,geq=${LOOP_GEQ},format=yuv420p,\
drawtext=fontfile=${FONT}:text='PLACEHOLDER LOOP':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=8:x=(w-text_w)/2:y=40,\
drawtext=fontfile=${FONT}:text='10 s loop  %{eif\\:t\\:d}.%{eif\\:mod(t*10\\,10)\\:d} s':fontsize=22:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=6:x=(w-text_w)/2:y=h-50,\
drawtext=fontfile=${FONT}:text='●':fontsize=64:fontcolor=white:x='(w-text_w)/2+190*cos(2*PI*t/10)':y='(h-text_h)/2+90*sin(2*PI*t/10)'" \
	"${ENC[@]}" "$OUT/placeholder_loop.ogv"

# 30 s clip: q = t/30 (0 -> 1): blue -> orange, a diagonal stripe pattern drifting across, a progress bar along the bottom
# (drawn inside geq: drawbox's `t` is its border thickness, not the time).
BAR="between(Y,H-34,H-20)*between(X,20,W-20)"  # the progress bar's track
FILL="between(X,20,20+(W-40)*T/30)"             # ...and what is filled by now
CLIP_R="clip(30+215*T/30+30*sin((X+Y)/18-T*2),0,255)"
CLIP_G="clip(90+30*T/30+25*sin((X-Y)/22+T*1.5),0,255)"
CLIP_B="clip(235-215*T/30+30*sin((X+Y)/18-T*2),0,255)"
CLIP_GEQ="r='if(${BAR},if(${FILL},255,0.35*${CLIP_R}),${CLIP_R})':g='if(${BAR},if(${FILL},255,0.35*${CLIP_G}),${CLIP_G})':b='if(${BAR},if(${FILL},255,0.35*${CLIP_B}),${CLIP_B})'"
ffmpeg -nostdin -v error -y -f lavfi -i "color=c=black:s=640x360:r=25:d=30,format=gbrp,geq=${CLIP_GEQ},format=yuv420p,\
drawtext=fontfile=${FONT}:text='PLACEHOLDER CLIP':fontsize=34:fontcolor=white:box=1:boxcolor=black@0.45:boxborderw=8:x=(w-text_w)/2:y=30,\
drawtext=fontfile=${FONT}:text='%{eif\\:30-t\\:d}':fontsize=150:fontcolor=white:box=1:boxcolor=black@0.35:boxborderw=10:x=(w-text_w)/2:y=(h-text_h)/2" \
	"${ENC[@]}" "$OUT/placeholder_clip.ogv"

ls -l "$OUT"/placeholder_*.ogv
# one still per clip (the look cards' thumbnails, the placement aspect): the middle of the loop, the start of the clip
ffmpeg -nostdin -v error -y -ss 2.5 -i "$OUT/placeholder_loop.ogv" -frames:v 1 -vf scale=640:360 -q:v 4 "$TMP/placeholder_loop.jpg"
ffmpeg -nostdin -v error -y -ss 1 -i "$OUT/placeholder_clip.ogv" -frames:v 1 -vf scale=640:360 -q:v 4 "$TMP/placeholder_clip.jpg"
python3 "$HERE/add-demo-videos.py" --out "$OUT" --stills "$TMP"
