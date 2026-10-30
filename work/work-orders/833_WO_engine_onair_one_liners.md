# WO-833 — On-air engine one-liners (sweep §3e–3i, 3k–3m)

**Area:** engine
**Status: DONE (30.10, offline: 5 new smoke files, each fails on the HEAD code and passes now; no live-box probe — no AMCP/POST was sent to the running box)**
**Source:** REPORT §3. Owner 30.10: *"there are a lot of bugs to fix"*.
**Related:** WO-829 (3a–3d, 3j), WO-545, WO-787.

- 3e +Animate exit fade goes to the logical layer, not the active bank's physical layer.
- 3f Phase B PLAY batch failure still flips the bank and returns ok.
- 3g Shader Live "clear from stack" calls `ctx.amcp.send` (does not exist).
- 3h `POST /api/swap` → TypeError (AmcpClient has only `basic.swap`).
- 3i media delete/move/LOADBG resolve the ACTIVE project's copy first; stem fallback maps `B/INTRO` to `a/intro.mp4`
  (data-destructive).
- 3k web PRV look push sends dB to the linear MIXER VOLUME.
- 3l the streaming channel route ignores `channel_<N>`.
- 3m a malformed JSON body to `POST /api/clear` parses to `{}` and clears PGM; `GET /api/mixer/clear` runs the POST handler.

## 1. Investigation

All eight findings re-read against the code and reproduced by test on the HEAD copy before fixing. All real.

- **3e** `src/engine/scene-take-lbg-merge.js` `buildMergeOutgoingOpacityDeferLines`: the guard computes
  `pL = phys(ln, activeBank)` (line ~42) but the fade line used `cl = ${channel}-${ln}` (line ~45) and the PiP overlay
  fade also got `ln`. Header comment still said "no bank B / +100" (pre-WO-217 design). On bank B the layer on air is
  `ln+100`, so `MIXER ch-ln OPACITY 0` hit an empty layer and the removed layer popped at teardown. The sibling
  `scene-take-lbg-exit-fade.js` already used the physical layer.
- **3f** `scene-take-lbg-amcp-pipeline.js` Phase B `catch` only logged (WO-418 added the log). Consequences, verified by
  following the code: `fadeClockRef.start` stays null, so `runSceneTakeLbgTeardown` STOPs the outgoing look
  immediately (black PGM); the pipeline then fires `onProgramPlayCommitted` (starts the PGM->PRV exchange);
  `finalizeTakeBankState` flips `programLayerBankByChannel`; `runSceneTakeLbg` returns `{ok:true}`; and
  `routes-scene-take.js` (3 call sites) `await`s it, then `liveSceneState.setChannel(...)`. The route already turns a
  thrown take into an error response without touching scene.live (try/catch at the bottom of `handleSceneTake`).
- **3g** `routes-shader-stack.js:73,77` `ctx.amcp.send(...)` — `AmcpClient` has no `send` (only `_send`, private). Every
  Shader Live "clear from stack" was a 500 and the shader stayed on air.
- **3h** `routes-amcp.js:261` `amcp.swap(...)`: only `amcp.basic.swap` exists. WS `swap` (`ws-amcp-dispatch.js`
  `TYPE_TO_PATH`) goes to the same case, so one fix covers both (no change in `src/server`). Same defect found in
  `/api/load` (`amcp.load` — memory "no amcp.load -> basic.load"): fixed too.
- **3i** `resolveMediaFileOnDisk` is a READER (scene refs, thumbnails, LOADBG paths): it tries
  `getProjectMediaResolveCandidates` (active project's copy of a bare id) BEFORE the id as given, then falls back to
  `findFileByStemUnderDir` (first file anywhere under the media root whose NFC-lowercased stem equals the id's leaf;
  only for extension-less ids). `unlinkMediaById` (`local-media-api.js:137`), `moveMediaFile` and `copyMediaFile` used
  it, so `B/INTRO` (no such file) deleted `a/intro.mp4` (or any same-stem file), `intro.mp4` removed the project's copy
  instead of the root one, and a folder id `clips` could resolve to a same-stem FILE and delete that instead.
- **3k** `client/lib/scenes-preview-push-scene.js:253` `vol = linearGainToCasparDb(volGain)` -> `MIXER VOLUME ${vol}`
  at 289/331. Scene layers store LINEAR gain; Caspar's MIXER VOLUME is linear (1.0 = unity). The server take sends the
  authored gain as-is (`resolveTakeVolumeForSceneLayer`, `live-input-audio-policy.js:111`; Godot likewise). Unity ->
  0 dB -> `VOLUME 0` = silent PRV. (The "dB -> linear" in the brief is really "stop converting": the stored value is
  already linear.)
- **3l** `routing-map.js` `resolveStreamingChannelRouteForRole` carried its own program/preview/multiview regexes and
  did not know `channel_<N>` (the WO-378 vocabulary, which `resolveStreamingAttach...` at :174 already uses via
  `output-source-name.js`), so a stream fed by a host channel fell through to `route://<programCh(1)>`.
- **3m** `response.js` `parseBody` swallows a JSON error into `{}`; `routes-amcp.js` then defaults `channel = 1`:
  `POST /api/clear` with a garbled body -> `clearCasparChannel(1)`. `routes-mixer.js` `handleGet` forwards any
  `/api/mixer/<cmd>` to the POST handler with the query string as body, so `GET /api/mixer/clear` ran
  `MIXER 1 CLEAR` (and `commit`/`effect` mutated too).
  **Callers checked** (rg over client/, godot/client, src/, tools/, scripts/): nothing in this repo calls
  `/api/stop`, `/api/clear`, `/api/mixer/clear` or the WS `stop`/`clear` types; client uses only `POST /api/mixer/effect`
  (always with a channel). External callers (Companion module — not in this repo; `docs/api-reference.md` and
  `docs/wiki/api/playback.md` document `{"channel":1,"layer":10}` bodies) that omit `channel` on stop/clear will now get
  a 400 — intended.

## 2. What was done

- **3e** `scene-take-lbg-merge.js`: fade line and PiP overlay fade use `pL` (= `phys(ln, activeBank)`); comment fixed.
- **3f** Choice: *abort the take, keep the outgoing look on air, reject.* Alternatives rejected: (a) "log and carry on"
  is the bug; (b) "finish the transition anyway" would STOP the outgoing look on top of an incoming look that may not
  be playing = exactly the black PGM the old comment warned about; (c) returning `{ok:false}` — every caller (3 sites in
  `routes-scene-take.js`, `routes-project.js`, `mirror-apply.js`) ignores the return value and would still write
  scene.live, whereas a throw already reaches the route's existing error response (HTTP 500, message to the operator)
  and skips `setChannel`/broadcast. Implementation: pipeline catch sets `fadeClockRef.phaseBError` and returns early
  (no `onProgramPlayCommitted`, so no PGM->PRV exchange; relative-seek lead still settled);
  `runSceneTakeLbg` then calls new `scene-take-lbg-phase-b-abort.js` `abortFailedTake` BEFORE teardown/finalize:
  releases the timeline opacity-exit hold, best-effort `STOP ch-pLayer` of the incoming layers only for a real
  A/B-bank take (never for +Animate, which shares the outgoing layer, nor bankless PRV staging), and throws
  `Take failed: PLAY batch was not delivered to Caspar (...)`. Teardown never runs -> outgoing stays up; the bank
  pointer is never flipped; so neither bank is left dark. The `[scene-take-lbg] ... Phase B ... failed on ch` log line
  is kept (WO-418 pin). Known limit: for +Animate, deferred exit-fade OPACITY lines flushed by the leading COMMIT are
  not undone (authored opacity unknown); a timeline started during job build is not unwound.
- **3g** `routes-shader-stack.js`: `ctx.amcp.mixerOpacity(channel, pLayer, 0, fadeFrames)` then `ctx.amcp.clear(...)`.
  Pin in `smoke-wo379-shader-store-and-stack-clear.test.js` repointed (it grepped the old `MIXER ... OPACITY`/`CLEAR`
  template strings) and now also asserts `ctx.amcp.send(` is absent.
- **3h** `routes-amcp.js`: `/api/swap` -> `amcp.basic.swap`, `/api/load` -> `amcp.basic.load`.
- **3i** `local-media-paths.js`: new `resolveMediaFileOnDiskExact` (id as given + its `MEDIA/`-stripped form under the
  media bases only; extension probing in the SAME folder only when exactly one match; a directory id returns null so
  the caller's folder branch handles it; no project candidates, no stem walk). `local-media-api.js`: `unlinkMediaById`,
  `moveMediaFile`, `copyMediaFile` use it. Readers (`resolveMediaFileOnDisk`) are unchanged on purpose: scene refs are
  project-relative and rely on project-first. `handleLocalMedia` (read-only waveform/probe) also unchanged.
  Not touched (outside scope): LOADBG path resolution in `caspar-cls-id.js` still uses the reader, which is the
  designed behaviour for scene refs; the stem fallback there only matters for extension-less ids.
- **3k** `scenes-preview-push-scene.js`: `vol` = authored linear gain (clamped >= 0, default 1); dB import removed.
  **Web client needs `npm run build:client`** (coordinator).
- **3l** `routing-map.js`: `resolveStreamingChannelRouteForRole` now resolves through `resolveOutputSourceToChannel`
  (WO-378 vocabulary); program/preview/multiview behave as before and unknown/out-of-range still fall back to
  screen-1 PGM.
- **3m** `routes-amcp.js`: strict body parse for the whole handler (malformed / non-object -> 400, nothing sent);
  `/api/stop` and `/api/clear` need an explicit integer `channel >= 1` (400 otherwise); other routes keep the
  documented channel-1 default. `routes-mixer.js`: strict parse -> 400; `mixer/clear` needs explicit channel; GET of
  `clear`/`commit`/`effect` -> 405 (read-only GETs of the other commands still work). `response.js`: comment on
  `parseBody` pointing destructive routes to `parseBodyStrict` (no behaviour change; ~70 other callers rely on it).

## 3. Verified

New smoke files (all fail on the HEAD copy of the source, pass now; HEAD copy run from a scratch tree built with
`git show HEAD:<file>` for each changed file):
- `tools/smoke/smoke-wo833-engine-onair.test.js` (3 tests: 3e bank A/B lines; 3f failed Phase B rejects, no STOP 1-10,
  bank stays `a`, exchange hook not run, STOP 1-110 cleanup; 3f control healthy take still ok + flips bank) — old: 2 fail.
- `tools/smoke/smoke-wo833-api-routes.test.js` (6 tests, REAL `AmcpClient` with the transport stubbed so a missing
  method fails like on the box: 3g, 3h incl. WS dispatch + `/api/load`, 3m x3, 3l) — old: 6/6 fail.
- `tools/smoke/smoke-wo833-media-exact-id.test.js` (9 tests, temp media dir, persistence is test-isolated) — old: 7 of 9 fail.
- `tools/smoke/smoke-wo833-preview-push-volume.test.js` (2 tests; evaluates the real `const vol =` line) — old: 2 fail.
Related existing suites (83 files matching take/amcp/mixer/shader-stack/routing-map/local-media/preview-push):
582 tests, 581 pass, 1 fail = the WO-379 pin on the old template strings, repointed and now 7/7. eslint: 0 errors
(2 pre-existing unused-var warnings). File lengths: all <= 498.
Not done: no live probe (contract forbids AMCP/POST to :4200); client rebuild pending (3k); owner-QA none requested.
Needs curating into `tools/ci/offline-test-files.js`: the four new smoke files above.

## Coordinator review (30.10)

- **3f narrowed.** The abort now runs only when the Phase B error was raised BEFORE the payload reached Caspar
  (`e.amcpPayloadSent !== true`).
  - A COMMIT-ack timeout after the write (`amcp-batch.js:324`) means the PLAY and the DEFERred crossfade very likely
    ran. STOPping the incoming layers then would leave the faded-out outgoing look, which is black.
  - So that case keeps the previous behaviour: teardown on the assumption the take played, with the error logged.
- `smoke-caspar-cls-id.test.js` fails 7/17 at HEAD as well, without this WO's files. It is uncurated, so it is
  pre-existing and handed to the WO-836 uncurated-smoke triage.
