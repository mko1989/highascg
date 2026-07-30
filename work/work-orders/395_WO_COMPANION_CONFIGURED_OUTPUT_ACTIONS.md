# WO-395 — Companion: start/stop the CONFIGURED stream/record outputs, with feedbacks + presets

**Status: IMPLEMENTED (2026-07-30 — server half live-verified on the box; module half tested 40/40, committed 501763d; owner A395.1: Companion restart + desk QA of the Stream & Record presets)**
**Source:** `work/work-orders/todos30.07.26` §2: "i need simple actions to start and stop (as well as indicate status with feedbacks) recordings and stream. all the actually set ones, no placeholders. with preset buttons"
**Module repo:** `/home/casparcg/companion-module-dev/companion-module-highpass-highascg`
**Related:** WO-170 (added rtmp/record actions with free-text placeholder options — the thing this replaces), WO-244/261/307 (credentials resolve SERVER-side from outputId — exactly what makes placeholder-free actions possible), WO-393 (0 outputs now valid — dropdowns must tolerate an empty catalog), WO-394 (same batch).

---

## 1. Investigation (2026-07-30)

- WO-170's actions (`src/actions/streaming-actions.js`) take free-text `rtmp_server_url`,
  `stream_key`, `output_id`, codec/bitrate fields — placeholders the owner explicitly doesn't
  want. Server-side, `POST /api/streaming-channel/rtmp {action:'start', outputId}` already
  resolves URL/key/quality/codecs/audio-pair from the configured output + active project
  (`routes-streaming-channel-rtmp.js:67-110`), so an outputId dropdown is sufficient.
- The status payload (`buildStreamingChannelStatusPayload`) did NOT include the configured
  output catalog — the module had nothing to build dropdowns from. Extended server-side
  (ids/labels/enabled/type only, no URLs/keys).
- **Stale-feedback hole found:** the module's streaming poller only polls while WS is DOWN
  (`streaming-channel-poller.js:44` early-return), but `ws-client.js` never handled the
  server's `streaming_channel` broadcast — so with WS up (the normal state), streaming/record
  feedbacks and variables never updated after init. Fixed here.

## 2. What was done

Server (highascg repo):
- `src/streaming/streaming-channel-status.js`: payload gains
  `outputs: { stream: [{id,label,enabled,type}], record: [{id,label,enabled}] }` — safe
  summaries of `config.streamOutputs`/`recordOutputs` (never URLs/keys/passphrases).
- Smoke test `tools/smoke/smoke-wo395-streaming-status-outputs.test.js` (payload shape,
  no-secret guard), added to the curated CI list.

Module (companion repo):
- `src/bridge/streaming-channel-poller.js`: stores the raw status on
  `instance._streamingChannelStatus`, the output catalog on `instance._streamingOutputs`;
  rebuilds actions/feedbacks/presets when the catalog signature changes; `applyStatus()` public.
- `src/bridge/ws-client.js`: handles `streaming_channel` broadcasts → `applyStatus()` (fixes
  the stale-feedback hole; poller stays as WS-down fallback).
- `src/actions/streaming-actions.js`: rewritten — `rtmp_start`/`rtmp_stop`/`record_start`/
  `record_stop` keep their ids (existing buttons survive) but options are a single dropdown of
  the actually-configured outputs (record_stop offers "All active"). No free-text placeholders.
- `src/feedbacks.js`: `streaming_active`/`recording_active` gain an "Output" dropdown
  ("Any" default — old buttons keep working); callbacks read the raw status object
  (rtmp.outputId / record.activeOutputs) with the old variable fallback.
- `src/presets/streaming-presets.js` (new): "HighAsCG · Stream & Record" section — per
  configured stream output a Start (with active feedback) and Stop button; same per record
  output; presets regenerate when the catalog changes.

## 3. What was VERIFIED

- Server: suite **1740 pass / 0 fail / 2 skip** (incl. new
  `smoke-wo395-streaming-status-outputs.test.js`: catalog shape + no-secret guard + WO-393
  empty-catalog case). Live after restart: `GET /api/streaming-channel` on this box returns
  `outputs: { stream: [], record: [{ id: "rec_1", label: "Rec1", enabled: true }] }` —
  matches the real config, no credentials.
- Module: suite **40 pass / 0 fail** — dropdown choices from the catalog (disabled outputs
  labeled), empty-catalog dropdown stays renderable, per-output feedback matching
  (rtmp.outputId / record.activeOutputs), presets = start+stop per configured output,
  play_clip gone.
- NOT yet live-proven: actual button presses from a restarted Companion. **Owner A395.1:**
  restart Companion → drag "HighAsCG · Stream & Record" presets → REC on rec_1 should start/
  stop and tally red; a stream preset appears only after a stream output is configured
  (currently none — WO-393 makes that a valid state).
