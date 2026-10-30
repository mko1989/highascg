# WO-845 — Sweep: AMCP client, Art-Net/sACN, audio and media bugs

**Status: OPEN (30.10)**
**Source:** code sweep 29.10 (REPORT §4m, §5 AMCP client / Art-Net-sACN / Audio / Media and thumbnails).

Items: AMCP — single-command timeout resets the send queue (later commands overtake), 500 FAILED swallows the next
reply, PING always times out, stop() doesn't stop auto-reconnect. Art-Net/sACN — ArtDmx Length read little-endian,
sACN 0–100 % treated as 0–255, project disk parse on every changed DMX frame, follow self-loop guard never
re-evaluated. Audio — setDefaultAlsaDevice overwrites ~/.asoundrc, volume controls without a switch parse as OFF,
removed live-audio slot keeps its PGM routes. Media — custom thumbnail upload writes 0 bytes, PRINT capture matches
the newest PNG across channels, inode relink after delete rewrites project references, ffprobe cache never
invalidated. 4m confine-pointer barrier constants (NegX/PosY).
