# WO-958 — Devices tab shows every server as "2026.05.20": the cluster read package.json's frozen version, not the build stamp

**Area:** devices-config, godot-client
**Status: DONE (03.11.26 — new smoke 3/3, offline suite 5296/0, Godot suite 25772/0; live: this box's ping and /api/cluster self answer 2026-11-03_093850. Other servers show their stamp once they run this release, until then the 2026.05.20 fallback)**

Owner, 03.11.26: "i noticed that servers in the devices tab are reporting some old version from may (2026.05.20)".

## Investigation

- `package.json` `"version": "2026.05.20"` has not been bumped since May. The real version of a release is its
  build stamp (`BUILD_STAMP`, `src/system/build-stamp.js readBuildStampFromDir`), which is what the updater compares
  and what `/api/system/version` reports as `buildStamp`.
- `/api/replication/ping` (`src/api/routes-replication-get.js`) only sent `appVersion: pkg.version`.
  `src/cluster/cluster-peers.js` used it as `version` in four places: a peer's live state (`liveFrom`), this
  server's own row (`snapshot().self`), link invites, and the subnet scan. Godot `cluster_panel.gd` (self line, scan
  results) and `cluster_model.gd` show that `version`. The replication inspector's "App version" row (Godot
  `replication_format.gd`, web `device-view-inspector-replication-shared.js`) showed the peer's `appVersion`.
- Measured: .35 answers `/api/system/version` → `buildStamp 2026-11-03_093850`, and the scan from here listed it as
  `"version":"2026.05.20"`.
- `appVersion` cannot just be swapped for the stamp. `replication-handshake.js verifyRegisterFollowerRequest` gates
  on `semverGte(appVersion, minAppVersion())` (default `2026.05.20`, `HIGHASCG_REPL_MIN_APP_VERSION`). That compare
  splits on dots, and a stamp like `2026-11-03_093850` would no longer compare reliably against older peers.

## What was done

- The ping adds `buildStamp: readBuildStampFromDir(REPO_ROOT) || pkg.version`. It is read on every ping (a tiny
  file), so it is right right after an update. `appVersion` is unchanged, for the handshake gate.
- `cluster-peers.js`: `versionOf(ping) = buildStamp || appVersion`, exported. All four `version` fields use it, so a
  peer still on older code falls back to its `appVersion` instead of showing blank.
- `replication-service-status.js buildPeerBox` passes `buildStamp`. Both inspectors' "App version" row shows
  `buildStamp || appVersion`. The label stays, because `godot/client/tests/golden/devices_server_page.json` pins
  web↔Godot parity on it.

## What was VERIFIED

- `tools/smoke/smoke-wo958-build-stamp-version.test.js` (curated, 3/3) checks:
  - the `versionOf` order;
  - the real ping handler answers `buildStamp` equal to the repo's stamp, with `appVersion` unchanged;
  - all four cluster fields and both inspectors read the stamp, and the handshake gate still reads `appVersion`.
- Offline suite 5296 pass / 0 fail; lint 0 errors; format and line-limit clean. Godot suite 25772 / 0.
- Live, after the restart and `npm run build:client`:
  - `/api/replication/ping` → `appVersion 2026.05.20`, `buildStamp 2026-11-03_093850`.
  - `/api/cluster` self `version` → `2026-11-03_093850`.
- Still showing 2026.05.20 (expected): the scan lists .35 as `2026.05.20`, because .35 runs the release built
  before this fix and its ping has no `buildStamp`. It shows its stamp once it is updated to a release containing
  this commit.
