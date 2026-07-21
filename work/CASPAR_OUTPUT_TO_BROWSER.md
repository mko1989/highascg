# CASPAR_OUTPUT_TO_BROWSER — getting CasparCG output into the browser GUI

**Source:** todos21.07.26 follow-up — "best approaches to get casparcg output (for the gui usage)
into the browser. least performance hit and lowest latency."

Written 2026-07-21, grounded on this box:
- GPU: **NVIDIA RTX PRO 4000 Blackwell** — dedicated NVENC silicon; system ffmpeg has
  `h264_nvenc`, `hevc_nvenc`, `av1_nvenc` (verified `ffmpeg -encoders`).
- Kiosk: **Firefox 140.12 ESR** — has **WebCodecs** (`VideoDecoder`), full WebRTC, MSE.
- Today's pipeline: Caspar `ADD <ch>-701 FILE <path>.jpg` ffmpeg consumer overwrites a JPEG
  at 1–30 fps (default 2, quality 10, half-res); Node polls the file and broadcasts over the
  existing WS (`src/preview/compose-preview-*`, WO-58/WO-144/WO-198/WO-280).
- The full-motion on-monitor "preview" is NOT in the browser at all: the X SHAPE hole-punch
  shows the actual screen-consumer window through the kiosk (WO-255/263).

The two questions — "least performance hit" and "lowest latency" — have different winners
depending on whether the pixels must be *inside* the browser's compositing (scaled, layered,
tiled in the GUI) or just *visible on the operator monitor*.

---

## 0. The bar to beat: X SHAPE hole-punch (current, keep it)

Zero copy, zero encode, zero latency — the browser shows the real output pixels because they
never enter the browser. Nothing below comes close on either metric. Its limits are why the
question exists at all: rectangular holes only, local monitor only, no scaling/effects/alpha in
the GUI, and the window-stacking constraints (WO-317). **Everything below is for the cases the
hole-punch cannot do** (in-GUI tiles, compose editing surfaces, remote browsers, thumbnails).

## 1. Current JPEG file consumer — fine for thumbs, wrong tool for motion

Caspar's in-process ffmpeg encodes mjpeg (CPU) → disk write → Node stat/poll → WS → `<img>`
decode. Effective latency ~0.5–1.5 s at the default 2 fps; capped at 30 fps, and pushing the cap
multiplies CPU encode + disk churn + per-frame HTTP/WS overhead on every open GUI. Keep it for
what it is good at: look-deck thumbs, Companion button previews, low-rate compose refresh.
Not the path to "live".

## 2. MJPEG push (multipart / WS binary) — small upgrade, wrong ceiling

Same encode as #1 but streamed instead of polled (Caspar `STREAM udp://127.0.0.1:<port>` mjpeg →
Node relays frames over WS/multipart). Latency drops to ~100–200 ms and the disk hop disappears,
but the fundamental costs stay: CPU intra-frame encode and huge bandwidth per stream (a 1080p50
mjpeg preview is tens of Mbit/s *per tile*). Only worth doing as a low-effort stopgap if #4 is
blocked.

## 3. NVENC H.264 → MSE (`<video>` + fMP4 over WS) — middle of the road

Hardware encode is right, but MSE playback buffers by design: realistic 200–500 ms in Firefox,
and tuning it lower trades into stall/rebuffer fragility. Audio comes free and the client code
is simple, but for a local operator GUI it is strictly worse latency than #4 with the same
server side. Skip unless WebCodecs hits a wall.

## 4. RECOMMENDED for in-GUI live motion: NVENC H.264 → WebSocket → WebCodecs → canvas

The sweet spot on this box for both criteria:

- **Encode:** `h264_nvenc` low-latency preset (`-preset p1 -tune ull -bf 0 -g 50
  -forced-idr 1`), all-intra-free GOP, CBR a few Mbit/s per tile. Runs on the dedicated NVENC
  block — it does not compete with Caspar's GL compositing or the desktop; CPU cost is the
  packaging, near-zero. Blackwell NVENC handles many concurrent sessions (one per monitored
  channel is trivial).
- **Transport:** Annex-B NAL units, length-prefixed, over the EXISTING authenticated WS. No new
  ports, no new server, no ICE/DTLS. Server keeps only the latest GOP per channel; a client
  joining/lagging gets IDR-first delivery and stale frames are dropped server-side (same
  philosophy as the WO-280 backpressure work).
- **Decode:** Firefox 140 `VideoDecoder` (hardware-backed H.264) → `VideoFrame` →
  canvas/`ImageBitmap`. No jitter buffer exists unless you build one — decode-and-display
  latest, drop the rest. This is the whole reason WebCodecs beats every player-shaped approach:
  **you control the queue, so local glass-to-glass is 2–4 frames (~40–80 ms @ 50p).**
- **Latency budget (local, 1080p50):** NVENC encode ~5–10 ms + mux/WS loopback ~1–2 ms +
  decode ~5–10 ms + next-vsync present ≈ **under 100 ms worst case, ~2 frames typical.**

Integration notes for this repo:
- **VERIFIED 2026-07-21, live on this box:** Caspar's in-process ffmpeg consumer DOES link
  NVENC. Working command (tested on the on-air 2160p50 operator channel, added and removed with
  zero disturbance; see WO-319 for full results — 1 hardware NVENC session, keyframes exactly
  every 1 s, valid h264+AAC mpegts): `ADD 4-702 STREAM udp://127.0.0.1:52300?localport=52301
  -filter:v format=yuv420p -codec:v h264_nvenc -preset:v p1 -tune:v ull -b:v 8000k -g:v 50
  -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k -format
  mpegts`. Trap: the audio downmix args are MANDATORY (`-an` is ignored; the default mp2 audio
  path cannot take the 16-channel bus and the whole consumer fails init, retry-spamming the
  log). Single-encode path confirmed; no transcode fallback needed.
- Reuse the compose-preview lifecycle: per-channel on-demand attach, idle detach, dirty/activity
  tracking — the consumer management problem is already solved there; only the payload changes.
- Client: one `VideoDecoder` per visible tile, feed from WS, paint to the existing canvas
  surfaces. Falls back to path #1 automatically where WebCodecs is unavailable (remote
  non-Firefox viewers, old browsers).
- Audio, if ever wanted in-GUI: WebCodecs `AudioDecoder` (Opus) on the same WS, or don't — the
  mixer VU path already covers monitoring.

## 4b. CHOSEN SHAPE (owner, 2026-07-21): one composed preview channel, not N streams

Owner's call on top of #4: **do not stream several channels — add ONE dedicated Caspar channel
that composites everything the GUI needs, and grab that single channel into the compose
preview.** This is the multiview pattern this codebase already runs (route:// cells + MIXER
FILL, `setupMultiview`, the WO-256 compose tiles), pointed at an encoder instead of a monitor.

Why it beats per-channel streaming:
- **Flat cost.** One channel, one NVENC session, one WS stream, one browser `VideoDecoder` —
  regardless of tile count. The per-channel design scales cost with open tiles; this doesn't.
- **Composition is Caspar's job, on GPU, with existing machinery.** No new video math; the
  layout is MIXER FILL on route:// layers, driven the same way multiview layouts already are.
- **Trivial client.** Decode one frame, `drawImage` sub-rects into each tile canvas. The server
  owns the layout, so it broadcasts a small `rect → source channel` map over the existing WS on
  every layout change — the cell-rect protocol's mirror image.
- **Remote parity for free.** Remote browsers can't see the X SHAPE holes; painting this one
  composed stream under the GUI where the holes would be gives a remote operator the kiosk
  experience. (Local kiosk keeps the real holes — zero latency beats any stream.)

Accepted tradeoffs (fine for a one-operator product):
- **One shared layout at a time.** Wanting a channel near-fullscreen (compose editing) means
  re-laying-out the shared channel, preview-monitor style; two browsers demanding different
  full-frame views simultaneously conflict. Single operator: acceptable; note it in the UI.
- **Tiles share one frame's pixels.** Quarter-area tile of a 1080p channel = 960x540 — plenty.
  Make the channel 1080p50; do not go lower.
- **route:// adds ~1 frame** — glass-to-glass ~3–5 frames (~60–100 ms) instead of 2–4. Still
  ~10x better than the JPEG path.

Repo guard rails that apply: WO-156 self-route check (the compose channel must never route
itself), a fresh consumer index (see the consumer-index-collision fix — do not reuse 96–98/700s),
WO-271 route heal when the added channel shifts the channel map. The #4 "verify NVENC inside
Caspar's ffmpeg consumer" gate is unchanged and still step one.

## 5. WebRTC (WHEP gateway, e.g. mediamtx) — only when remote or A/V-sync matters

Caspar/ffmpeg → RTP/SRT → a WHEP gateway → browser `RTCPeerConnection`. Latency ~100–250 ms
(Firefox's jitter buffer cannot be fully disabled), plus a new long-running gateway process,
ICE/DTLS/SRTP, and its own auth story. What it buys over #4: congestion control and A/V sync
over REAL networks, and `<video>`-tag simplicity. For the local kiosk it is more moving parts
for more latency. **Choose it only if low-latency preview for REMOTE operators (other machines,
WAN) becomes a requirement — then run it alongside #4, same NVENC feed.**

## 6. Named for completeness, not recommended

- **NDI:** Caspar has an NDI consumer, but browsers can't play NDI — it lands back at a gateway
  (#4/#5) with an extra hop. Only if an NDI ecosystem shows up anyway.
- **`getDisplayMedia` window capture:** the GUI captures Caspar's X window itself — zero server
  pipeline, ~1–2 frame latency. Rejected as primary: per-session permission UX in a kiosk,
  Firefox's X11 window-capture copy path is CPU-heavy at 4K, and capturing a window the kiosk
  itself covers is exactly the fragile compositor edge the hole-punch already avoids.
- **Raw frames over WS:** uncompressed 1080p50 is ~300 MB/s — non-starter beyond postage-stamp
  sizes. (Tiny raw thumbs are effectively what #1 already is.)
- **Reparenting Caspar's window into the GUI:** not a browser transport at all, but noted in
  `NODEGUI_PORT_INVESTIGATION.md` §3 — a one-day X11 spike, orthogonal to this doc.

## Summary table

| Approach | Glass-to-glass (local) | Perf hit | Complexity | Remote-capable | Verdict |
|---|---|---|---|---|---|
| 0. Hole-punch (current) | ~0 | none | shipped | no | keep for on-monitor |
| 1. JPEG file poll (current) | 0.5–1.5 s | CPU mjpeg + disk | shipped | yes | keep for thumbs |
| 2. MJPEG push | 100–200 ms | CPU mjpeg, huge bw | low | yes | stopgap only |
| 3. NVENC → MSE | 200–500 ms | ~free (NVENC) | medium | yes | skip |
| **4. NVENC → WS → WebCodecs (per-channel)** | 40–100 ms | ~free × N tiles | medium | yes (FF/Chromium) | superseded by 4b |
| **4b. ONE composed channel → NVENC → WS → WebCodecs** | **60–100 ms** | **~free, flat** | medium | yes (FF/Chromium) | **do this** |
| 5. NVENC → WebRTC/WHEP | 100–250 ms | ~free + gateway | high | yes, best | only for remote |
| 6. getDisplayMedia | 20–40 ms | browser CPU copy | low | no | kiosk UX kills it |

## Bottom line

Keep the hole-punch as the on-monitor truth. For live motion **inside** the GUI (compose tiles,
PRV/PGM strips, live-input preview in the compose editor — the todos21 wishlist), build the
**owner-chosen hybrid (§4b): one dedicated compose channel laid out by Caspar's own mixer,
encoded once with NVENC, carried over the existing WebSocket, decoded once with WebCodecs, and
sub-rect-blitted into every tile.** Flat cost at any tile count, ~3–5 frames of latency, remote
GUI parity as a side effect. First step is unchanged: the 10-minute check whether Caspar's own
ffmpeg consumer can emit `h264_nvenc`; everything else reuses lifecycle machinery this repo
already has.
