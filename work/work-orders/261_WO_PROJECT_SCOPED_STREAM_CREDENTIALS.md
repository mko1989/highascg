# WO-261 — Stream credentials live in the PROJECT and only there

**Status:** IMPLEMENTED (all T-tasks done; owner acceptance A261.1 (rotated key) on `work/checklist06.08.26_close_all_wos.md`)
**Priority:** HIGH (owner: "youtube key should be saved in project and in it only")
**Owner check:** A261.1

## Owner decision (verbatim)
"youtube key should be saved in project and in it only."

## Context
- `projects/` is gitignored (verified) — project-held keys can never reach git. Projects travel via USB/exFAT sync + replication, which is the point: the key belongs to the show.
- Today creds live in TWO config stores: `streamingChannel.rtmpServerUrl/streamKey` (config/streaming_channel.json; WO-244 added preserve-on-empty + never-sent-to-clients masking with `hasStreamKey`) and per-output `streamOutputs[].rtmpServerUrl/streamKey` (config/stream_outputs.json era; edited in the Device View stream inspector, sent to clients UNMASKED — a noted follow-up). The 2026-07-15 incident wiped the config-held key once already.
- Consumers at stream time: `src/api/routes-streaming-channel-rtmp.js` (start flow), `src/api/routes-streaming-channel-shared.js` (record/shared), reading config. The old key also sits in git HISTORY of config/streaming_channel.json (rotation was recommended to the owner regardless).

## Design

**T261.1 — project model** (`src/engine/project-store.js` + wherever the project JSON schema/normalize lives — investigate)
Project gains `streaming: { credentials: { [outputId or 'streamingChannel']: { rtmpServerUrl, streamKey } } }`. Saved/loaded with the project like any other section; include in autosave. NEVER included in any client-bound state except masked (`hasStreamKey`-style booleans) — mirror WO-244's masking discipline.

**T261.2 — resolution at stream time (server)**
`routes-streaming-channel-rtmp.js` + `routes-streaming-channel-shared.js`: resolve creds from the ACTIVE project first; the config values become fallback-only during migration (see T261.4) and are never written anymore.

**T261.3 — writes go to the project (server + client)**
- The Device View stream inspector's save path (`Actions.saveSettingsPatch({ streamOutputs })` for per-output url/key, and the settings-modal streamingChannel section which no longer has cred fields since 2215473): per-output `rtmpServerUrl`/`streamKey` edits now write into the active project's `streaming.credentials[outputId]` via a new/extended API (design it — maybe `PATCH /api/project/streaming-credentials`; register any new route in router.js + grep-assert in smoke). Non-credential stream output fields stay in config as today.
- settings-post: strip `rtmpServerUrl`/`streamKey` handling from the `streamingChannel` rebuild (keep ignoring incoming values; WO-244's preserve logic becomes moot for config — keep reads working for migration fallback only).
- settings-get: keep masking; additionally report whether the ACTIVE PROJECT holds a key (per output + streamingChannel) so the UI placeholder logic keeps working.

**T261.4 — migration + purge**
On project save (first save after upgrade): if config still holds non-empty creds and the project has none, MOVE them into the project (log it), then blank the config copies (both streamingChannel and streamOutputs[]) and persist config — "in project and in it only". Loading a DIFFERENT project with no creds → no creds (config fallback only applies before any project has claimed them; make the precedence rules explicit in code comments).

**T261.5 — client masking for per-output keys** (closes the WO-244 follow-up)
The stream inspector no longer prefills the real key (config no longer has it; project-held keys are never sent raw): placeholder "saved in project — leave blank to keep", empty-keeps semantics server-side, explicit clear affordance. The start-stream flow must resolve creds SERVER-side (client stops passing streamKey in `startStreamingChannelRtmp` — check `client/components/device-view-inspector-stream.js:140` and the server handler; server pulls from project).

**T261.6 — smokes** (curated gate): project save/load round-trips credentials; stream-time resolution prefers project over config; migration moves+blanks exactly once; masked API responses carry no raw key anywhere (grep the snapshot/settings payload builders); client no longer sends streamKey on start.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, no npm, no vite build (orchestrator runs it), curated gate ONLY, NEVER stage config/*.json. node --check + eslint --quiet; exact counts; <500 lines/file; honest checkboxes. The persistence/test isolation rules apply: tests write only under tmpdir (NODE_TEST_CONTEXT redirects exist for state; project-store tests must use a tmp projects dir — check how existing project smokes isolate).

- [x] T261.1 project model + autosave + masking discipline
- [x] T261.2 stream-time resolution (project first)
- [x] T261.3 writes to project (API + inspector save path + settings strip)
- [x] T261.4 one-shot migration + config purge
- [x] T261.5 per-output masking + server-side cred resolution on start
- [x] T261.6 smokes in gate
- [ ] A261.1 (owner) set the (rotated!) key in the stream inspector → saved into the project; stream starts; key absent from config/*.json and from every API response
