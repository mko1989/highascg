# WO-744 — shm rings as Live-tab sources: a look layer `shm://<name>` plays a ring another process writes (WO-738 step 3)

**Area:** engine, video-io
**Status: DONE (24.10.26) as future development, detachable (see "How to remove"). Proven on the operator path by
`tools/e2e/shm-source-take.js` (PASS): a ring writer, then `/api/shm/sources`, then a look TAKE on a sandbox server
driving a throwaway real Caspar, then the writer's exact pixels on the channel. Smoke 3/3, Godot 21587/0, clean-export
`test:ci` green. 25.10: the WO-742 binary is deployed and this box's server restarted; the live
`GET /api/shm/sources` answers `{"ok":true,"sources":[]}` (no writer running). Owner QA: a real ring on a look.**

Parent: [WO-738 §7](./738_WO_godot_vj_engine_relayed_to_caspar.md) build order step 3. Producer:
[WO-742](./742_WO_caspar_shm_producer.md). Writer: [WO-743](./743_WO_godot_shm_writer.md). Owner, 24.10 (/loop):
*"include the future development but try to make those easily detachable if they fail and need to be removed"*.

## Investigation

- **Where a source becomes AMCP.** Live-tab rows drag `{type, value, label, …}` onto a look
  (`live_sources_panel.gd` → `look_editor.gd:399` → `POST /api/scene/new-layer`, which builds the layer). The take
  then sends `layer.source.value` as the clip.
  - `src/caspar/amcp-command-plan.js` `serializeClipCommandPlan` already passes `ndi://` raw.
  - `amcp-basic.js` `_isComplexClip` sends such clips raw instead of through the typed path, which would quote them.
  - So `shm://<name>` → `SHM NAME <name>` fits in the same two places.
- **Bug found: the media resolver mangles schemes.** `src/media/caspar-cls-id.js` `normalizeCasparMediaPath`
  collapses `//`, so `shm://vj` became `SHM:/VJ` (measured). The same happens to `ndi://X` → `NDI:/X`, because the
  passthrough check runs on the already-normalised string.
  - That NDI case affects only legacy *direct* NDI layers. The production NDI-host path sends raw PLAY
    (`smoke-host-live-ndi`) and never goes through this resolver.
  - Left for the owner (see below). I fixed it only for `shm://`, in separate marked lines.
- **A stray CINF.** The first real-Caspar run showed `CINF SHM:/WO744-IN-…` from `scene-native-fill.js`
  `fetchCinfResolutionFromAmcp`, which uses yet another resolver. A ring is not a media file, so it is skipped like
  `route://`.
- **Router.** `src/api/router.js` is at the 500-line limit. The route is served from `router-dispatch.js`, the way
  WO-734's show timers are.
- **Which rings are sources.** Every ring in `/dev/shm/highascg-*` has `producer_pid` in its header
  (`hshm_abi.h`). Caspar's own WO-594 consumer outputs (opgui, …) have Caspar as the writer, so they are excluded by
  `/proc/<pid>/comm`. On this box today the list is empty: `highascg-opgui` and `highascg-in2` are Caspar's.
- **Test isolation.** The sandbox server enumerates the media library through Caspar on connect. Caspar 2.5 answers
  CLS/CINF from its media-scanner service, which defaults to `localhost:8000`, the **box's own scanner**. That was
  read-only, but the e2e now points the throwaway Caspar's `media-server` at a dead port: 0 CINF afterwards.

## What was done

- `src/api/routes-shm-sources.js` (new): `GET /api/shm/sources` → `{ok, sources: [{name, value: 'shm://<name>',
  width, height, fps, pid, writer, signal}]}`.
  - A source is a valid v1 header whose writer is alive and not `casparcg*`, with a plain name.
  - `signal` = a publish within 500 ms (the ABI's rule).
  - Hooked in `src/api/router-dispatch.js` (2 marked lines).
- `src/caspar/amcp-command-plan.js`: `shm://<plain name>` → ` SHM NAME <name>`. Anything else stays quoted, so Caspar
  refuses it as a missing file.
- `src/caspar/amcp-basic.js` `_isComplexClip`: `shm://` is sent raw.
- `src/media/caspar-cls-id.js`: `shm://` keeps its `//` and passes through.
- `src/engine/scene-native-fill.js`: no CINF for `shm://`.
- `godot/client/features/live/shm_sources_model.gd` (new):
  - `rows(api)` gives Live rows `{type: "shm", value, label, resolution, fps, routeType: "shm"}`;
  - `meta_suffix` names the writer process on the meta line;
  - `warning` shows "No frames from the writer" when it stops.
  - `live_sources_panel.gd`: 5 marked lines fetch it on `reload()` (tab shown / ↻) and append the rows.
- `tools/e2e/sandbox-server.js`: an optional `caspar: {host, port}` drives a throwaway real Caspar instead of the
  simulated one (it drops `--no-caspar` and sets `offline_mode: false`). Default behaviour is unchanged.
- `tools/e2e/shm-source-take.js` (new): the end-to-end test described below.
- Tests:
  - `tools/smoke/smoke-wo744-shm-sources.test.js` (new, in FILES): listing (live / stale / Caspar-written / dead /
    junk / bad-name rings), the route, serialization, the resolver, raw send, dispatch and the CINF skip;
  - `godot/client/tests/test_shm_sources.gd` (new): rows, payload, meta and warning, panel wiring.

**Not built: lease and teardown.** When the writer stops, the ring is unlinked. The row then shows "No frames" and
disappears on the next reload, and a layer playing it holds the last frame (WO-742). Clearing the layer stays the
operator's call. A lease, where the server starts or stops the writer process, only matters once there is a writer the
server launches, such as the Godot VJ app. That belongs with that app's WO, not here.

## How to remove (owner decision at the end)

- Delete `src/api/routes-shm-sources.js`, `godot/client/features/live/shm_sources_model.gd`,
  `godot/client/tests/test_shm_sources.gd`, `tools/smoke/smoke-wo744-shm-sources.test.js` (and its FILES line in
  `tools/ci/offline-test-files.js`) and `tools/e2e/shm-source-take.js`.
- Remove the lines marked `WO-744` in:
  - `src/api/router-dispatch.js` (3);
  - `src/caspar/amcp-command-plan.js` (2);
  - `src/caspar/amcp-basic.js` (1);
  - `src/media/caspar-cls-id.js` (2);
  - `src/engine/scene-native-fill.js` (1);
  - `godot/client/features/live/live_sources_panel.gd` (5, with `Shm.` in them).
- The `caspar` option in `tools/e2e/sandbox-server.js` can stay; it is unused without the e2e.

## What was VERIFIED

- `node tools/e2e/shm-source-take.js ~/caspar-build/build-v2/shell/casparcg` → **PASS** (run 4×; the last after the
  scanner isolation):
  - `/api/shm/sources` → `{"name":"wo744-in-…","value":"shm://wo744-in-…","width":640,"height":360,"fps":50,
    "writer":"hshm_pattern","signal":true}`;
  - `POST /api/scene/take` (look with one `shm://` layer, channel 1) → 200;
  - Caspar received `LOADBG 1-110 SHM NAME wo744-in-… IN 0 SEEK 0` → `shm_producer[…] reading 640x360` → 202, then
    `PLAY 1-110` → 202. Caspar ignores the `IN 0 SEEK 0` that the take appends to every clip;
  - channel output (1280×720): (320,360) = `10 80 f0 ff`, the writer's orange; (960,360) = `00 00 00 00`;
  - 0 CINF after the fix and the scanner isolation;
  - the box's own Caspar (PID 1527509) and server untouched; no `wo744` segment left.
- Smoke 3/3. Mutation check: without the native-fill skip it fails.
- Godot `--test` 21587 / 0 (+10). `run-client.sh --check` boot OK.
- Clean export: repo-integrity OK, max-lines 0 over, unwired-exports no new, boot OK, format OK, `test:ci` 3197 tests
  3193 pass, 3 skipped, 1 fail (WO-498, export-only). Lint 214 (cap 216). API contract unchanged.
- Not done:
  - no kiosk screenshot of the row: this box's server runs the old code until the owner restarts it, and .4 gets it
    with the next release;
  - no on-air test: that needs the WO-742 Caspar binary.

## Owner decisions

- Deploying the WO-742 Caspar binary (a Caspar restart) is what makes this usable on air.
- Legacy *direct* `ndi://` layers are mangled to `NDI:/…` by the same resolver bug. Fixing it is one line (keep `//`
  for `ndi:` like `shm:`), but it changes a legacy on-air path. It was not done here.
