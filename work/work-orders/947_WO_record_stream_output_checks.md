# WO-947 — Record and stream outputs checked end to end; a stream that cannot reach its receiver now says so

**Area:** video-io, godot-client
**Status: DONE (05.11.26 — live on the second dev box: record GUI start/stop, RTMP, SRT, record + stream at once, receiver loss + recovery; smoke 6/6, existing streaming smokes 16/16, Godot suite 25837/0) — two items left for the Caspar fork / later (§4)**

Owner 05.11 (second dev box): *"i need you to do checks of record outputs and stream outputs."*

Related: [WO-395](./395_WO_COMPANION_CONFIGURED_OUTPUT_ACTIONS.md) (configured outputs), [WO-393](./393_WO_ALLOW_ZERO_STREAM_RECORD_OUTPUTS.md), [WO-307](./307_WO_SRT_PASSPHRASE_PROJECT_CREDENTIALS.md) (stream secrets), [WO-81](./81_WO_STREAM_RECORD_LOGS_AND_NO_RESTART_DIRTY.md) (logs in the inspector), [WO-613](./613_WO_next_caspar_build_on_v2_5_1.md) (the fork: STREAM auto-reconnect, PR #1727).

---

## 1. Investigation — what was run on the box (Caspar `2.5.1 deac375bb`, PGM ch2 6144×1024@50, solid #2060A0 on 2-900)

| Check | How | Result |
|---|---|---|
| Add outputs | Devices rear panel RECORD + / STREAM + (GUI) | `rec_1` "Rec1", `str_1` "Str1" in settings, header badges S1 / R1 |
| Record | Inspector Start record → 6 s → Stop record (GUI) | `ADD 2-96 FILE Rec1_….mp4 -codec:v libx264 … -b:v 4500k …`; file 6.5 s, h264 6144×1024 50p yuv420p + aac 48 k stereo; pixel (31,96,160) = #2060A0 ✓ |
| RTMP | Inspector URL `rtmp://127.0.0.1:1935/live`, key, Save, Start (GUI); `ffmpeg -listen 1` receiver | 8.0 s h264 6144×1024 50p + aac stereo received, colour ✓; key masked in HighAsCG's own logs ✓ |
| Receiver lost | the receiver exits after 8 s | Caspar retries every ~1 s ("Connection lost. Attempting reconnection in 1000ms" / "Connection refused") — **status kept `active: true, lastError: null`, badge red / "is streaming"** ✗ |
| Receiver back | listener restarted | Caspar reconnected by itself, 4.0 s received ✓ |
| Header S1 / R1 | click | open Devices (by design, `header_badges.gd` → `devices_requested`), not start / stop — not a defect |
| Stop | Inspector Stop stream | `RTMP stopped`, consumer 2-97 gone from INFO ✓ |
| SRT | type srt, `srt://127.0.0.1:9000` caller → `ffmpeg … mode=listener` | h264 + aac received ✓, stop → `202 REMOVE OK` ✓ |
| Record + stream together | API start both, 8 s | stream 5.0 s ✓; MP4 **"moov atom not found" right after Stop**, valid 8.04 s ~2 s later — Caspar finalises after `REMOVE OK` (log: REMOVE 08:58:52.4, `Uninitialized` 08:58:54.66) |

**Defects found**

1. **A failing stream looked healthy.** Nothing after `202 ADD OK` ever reached HighAsCG; Caspar's reconnect loop is only in its log.
2. **Record / stream inspector fields had no labels.** `stream_record_model.gd` items carry only placeholders, which vanish once a value is in — and new outputs arrive filled, so the page was a column of bare numbers (26, h264, 4500, veryfast, aac, 128).
3. **CRF looked like a setting but was dead.** `recordFfmpegArgs` (`routes-streaming-channel-shared.js:104`) uses CRF only when the video bitrate is < 200; every new record output has bitrate 4500, so the "26" did nothing. Likewise the stream's quality preset only fills defaults (`streaming-channel-ffmpeg.js:68-83`) and the GUI always sends bitrate + speed.
4. **The stream key is in Caspar's log** (`ffmpeg[rtmp://127.0.0.1:1935/live/test] …` on every line of the consumer) — HighAsCG's own logs mask it (WO-307), Caspar's file does not.
5. **Stop record answers before the file is usable** (~2 s).

## 2. What was done

- `src/streaming/stream-link-health.js` (new): `streamLinkState(url, lines, now)` — the last Caspar log line naming this consumer (`ffmpeg[<url>]`, matched in full, never returned): "Connection lost" / "Attempting reconnect" newer than 8 s → `reconnecting` (since the first failure of that run, attempts counted), else `connected`. 8 s because an SRT caller's cycle is 1 s wait + 3 s connect timeout (measured: failures ~3 s apart), RTMP's ~1 s. `runningStreamLink` reads the tail through `routes-logs.js` `tailFileLines` (600 lines / 256 KB, cached 1 s). `watchStreamLink` (every 2 s while a stream runs) calls back once per flip.
- `streaming-channel-status.js`: `rtmp.link` ('connected' | 'reconnecting' | null) and, when reconnecting with no start error, `lastError` = "Receiver not reachable — Caspar keeps retrying since HH:MM:SS (n attempts)". A failing log read never breaks the status.
- `routes-streaming-channel-rtmp.js`: start / stop the watcher with the existing status-poll helpers; a flip writes a stream-log line (warn "Receiver not reachable …" / info "Receiver reached again — streaming"), which already broadcasts `streaming_channel` — so the header, the Inspector's stream log and Companion follow.
- `godot/client/app/header_badges_model.gd`: a live stream whose link is reconnecting is **amber** ("pending"), its tip the reason.
- `godot/client/features/devices/stream_record_model.gd` `FIELD_LABELS` + `output_port_controls.gd`: a caption above every stream / record field, stating the rules as they are ("Video bitrate (kbps) — 0 = use the CRF above", "Quality — CRF 18–51 (used only when the video bitrate is 0)", "Quality preset (defaults only — the bitrate and speed below win)"). In the renderer, not the items: the item lists are golden-replayed against the web inspector.
- Not changed: the encoding behaviour (bitrate wins over CRF) — the page now says it; the owner can decide if a rate-control choice is wanted.

## 3. What was verified

- **Box, live:** stream to a dead SRT receiver → `link: reconnecting`, S1 badge pixel (133,77,14) = amber, log "Receiver not reachable — Caspar keeps retrying since 09:06:14 (1 attempt)"; receiver up → `connected`, badge (155,28,28) = live, log "Receiver reached again — streaming"; Stop → `link: null`. Record Inspector screenshot: every field captioned.
- `tools/smoke/smoke-wo947-stream-link-health.test.js` (curated) **6/6**: reconnecting since the first failure, attempt count, the text; connected once stale / on a clean run; another consumer's failures and a new `Initialized` reset; SRT spacing does not flicker; the payload carries `link` + reason and never the unredacted URL; the tail is read through the helper. Existing `smoke-streaming-channel-status`, `smoke-stream-key-redaction`, `smoke-wo395-streaming-status-outputs` **16/16**.
- Godot suite **25837 passed, 0 failed**: `test_header_badges_model` (amber + reason, live when through), `test_devices_output_ports.test_every_stream_record_field_is_labelled` (every input / select of the record page and the stream page for rtmp, srt and udp has a caption).
- Box state restored: the test outputs, their graph connectors, the saved test RTMP URL / key and the two test recordings removed.

## 4. Left open

- **Stream key in Caspar's log** — Caspar names the consumer by its full URL; masking needs the fork (redact userinfo / last path segment in `ffmpeg_consumer` `print()`), or keys passed out of band. Owner call.
- **Stop record before the MP4 is final** (~2 s) — anything that grabs the file immediately (Companion, a copy) sees an unplayable file; a server-side wait for the consumer's `Uninitialized` (or the file's moov) before answering would close it.
