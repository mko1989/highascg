# WO-319 — GUI live stream: one composed channel → NVENC → WebSocket → WebCodecs

**Status (2026-07-26 audit): DONE-BUT-NOT-MARKED — shipped across e3bb16a/4e0a998/7faee72 (+WO-323/325 follow-ons); operator live canvas + shared layout sync are in production use.**

**Source:** todos21.07.26 follow-ups — design chosen by the owner in
`work/CASPAR_OUTPUT_TO_BROWSER.md` §4b: do NOT stream N channels; add ONE dedicated Caspar
channel that composites everything the GUI needs (route:// cells + MIXER FILL, the multiview
pattern), hardware-encode that single channel once, and blit sub-rects into every GUI tile.

## Feasibility: VERIFIED LIVE 2026-07-21 (owner-authorized test on the operator channel)

Run against Caspar **2.6.0 253c16c Dev** on this box, channel 4 (2160p5000, on air), consumer
index 702, added/removed cleanly with zero disturbance to the channel:

```
ADD 4-702 STREAM udp://127.0.0.1:52300?localport=52301 -filter:v format=yuv420p -codec:v h264_nvenc -preset:v p1 -tune:v ull -b:v 8000k -g:v 50 -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k -format mpegts
```

Measured results:
- Valid MPEG-TS: **h264 Main 3840x2160 @ 50fps** (yuv420p) + AAC-LC stereo, ~11.6 Mbit/s at
  `-b:v 8000k`.
- Keyframes at exactly 1.000 s spacing → `-g:v 50` honored (join latency ≤ 1 GOP).
- `nvidia-smi encoder.stats`: **1 session @ 49 fps while attached, 0 after REMOVE** — the encode
  is on the RTX PRO 4000's NVENC silicon, not CPU.
- 2160p50 encodes fine; the production channel should still be 1080p50 (bitrate/decode budget).

Traps hit during verification — these are REQUIREMENTS for the implementation:
1. **Audio args are mandatory.** The consumer's default audio path is mp2, which cannot take
   this box's 16-channel bus (`Specified channel layout 'hexadecagonal' is not supported`) —
   the WHOLE consumer then fails init and retries every 2 s, spamming
   "Connection lost. Attempting reconnection" into the Caspar log. **`-an` is silently
   ignored.** Always send `-filter:a aformat=channel_layouts=stereo,aresample=48000
   -codec:a aac`.
2. **Arg grammar:** only `-name:stream` options are forwarded (`-codec:v`, `-filter:v`,
   `-g:v`, `-preset:v`, `-tune:v`); `-f`, `-vf`, `-g`, `-ac`, `-an` are ignored;
   `-format mpegts` (not `-f`) is required. All already documented in
   `src/streaming/caspar-ffmpeg-setup.js:79-96` — REUSE that builder, don't reinvent.
3. `?localport=` distinct bind so sender and any local listener don't collide (same file).

## Scope

### 1. The GUI compose channel
- New dedicated channel appended to the channel map (like the multiview channel), **1080p5000**,
  cells = `route://` layers laid out with MIXER FILL. Route heal (WO-271) must cover the map
  shift; WO-156 self-route guard applies (this channel must never route itself); collision-safe
  consumer index constant (701 = jpeg file preview, 720 = meter, 721 = DMX are taken — extend
  `tools/smoke/smoke-consumer-index-collisions.test.js` with the new one).
- Layout driven by the server: a small layout state (`cells: [{rect01, srcCh, role}]`) settable
  via API/WS from the GUI (compose tiles, PRV/PGM strips, "focus this channel near-fullscreen"
  for compose editing). Every change → MIXER FILL batch + broadcast of the `rect → source`
  map over WS so clients know which sub-rect is which channel. One shared layout at a time —
  single-operator tradeoff accepted in §4b.

### 2. Server: consumer + ingest + relay
- NVENC STREAM consumer attach/detach with the verified arg line (1080p variant), managed like
  `compose-preview-consumer.js`: signature-diff so an unchanged channel is never recycled,
  idle-detach off the WO-280 activity tracking (no GUI clients watching → REMOVE consumer,
  encoder session released — proven clean above).
- Node ingest: UDP listener on the loopback port; demux TS → H.264 Annex-B access units via a
  copy-only system-ffmpeg subprocess (`-i udp://… -map 0:v -c copy -f h264 pipe:1`) — near-zero
  CPU, no new npm deps, and the system ffmpeg is NOT the Caspar binary so no coupling. Tag
  keyframes, keep the latest GOP buffered, drop stale frames server-side.
- Relay over the EXISTING authenticated WS as binary messages (new message type), IDR-first
  delivery to joining/lagging clients. No new ports beyond the loopback UDP.

### 3. Client: decode + blit
- One `VideoDecoder` (`avc`, `optimizeForLatency: true`, Annex-B) fed from the WS; decode →
  latest-frame-wins; per-tile canvas blit of the sub-rect from the layout map. Firefox 140 ESR
  verified to have WebCodecs.
- Fallback: when WebCodecs is unavailable or the stream is disabled, tiles keep using the
  existing JPEG path — it stays fully functional (thumbnails/Companion keep it regardless).
- dist-web rule: `npm run build:client` + kiosk reload for the client half.

### 4. Settings
- Enable toggle + bitrate + fps cap + GOP in the composePreview settings section (defaults:
  on, 8000k, native 50, g=50). Redact nothing — no secrets in this path.

## Acceptance
- With the GUI open: NVENC session count 1, Caspar log free of consumer retry spam, CPU for the
  whole relay path near-idle (`node` delta < a few %).
- Glass-to-glass latency on the kiosk measured < 150 ms (put a Caspar timer template on a
  routed channel, photograph GUI tile vs output monitor — same method as earlier timer work).
- Tile shows correct source per layout map after layout changes and after channel-map shifts.
- Join/reconnect: first frame within 1 GOP (~1 s worst case), no gray/corrupt frames (IDR-first
  delivery — the mid-GOP PPS garbage seen in verification is exactly what this prevents).
- Idle: closing all GUI clients releases the consumer and the NVENC session (0 in nvidia-smi).
- Offline tests, non-vacuous per house rules: nvenc arg-builder (shares grammar with
  `caspar-ffmpeg-setup.js` — the mandatory audio-downmix args MUST have a dedicated test citing
  trap #1), TS→Annex-B chunker on a fixture capture, layout-map protocol, GOP buffer
  (IDR-first, stale-drop), consumer-index collision, wiring guards. `npm run test:ci` → 0 fail.

## Constraints
- LIVE box. Consumer add/remove on live channels is verified safe (this WO's own test), but
  coordinate the channel-map change (new channel = Caspar config rewrite + restart) with the
  owner — that part is NOT hot-applyable.
- Commit only when the owner asks, per repo convention.
