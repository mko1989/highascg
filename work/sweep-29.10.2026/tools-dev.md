# tools/dev — sweep 29.10.2026 (batch 112)

Files: 6 · lines: 982 · findings: 0 BUG-HIGH, 1 BUG, 0 DEAD, 1 RISK, 2 QUALITY

## tools/dev/fake-cluster-peer.js
- `RISK` tools/dev/fake-cluster-peer.js:111 — drifted from the WO-732 mutual-link contract (static comparison, not run: it needs the live API). The real server asks the peer to link back with `POST /api/cluster/peers {link_back:false}` (src/cluster/cluster-peers.js:266) and heals via the peer's ping `clusterLinked` (cluster-peers.js:189). The stub answers every other route with 404 `{"error":"fake peer"}` (:128) and its ping is a copy of the real server's (`...ping`, :114), so `clusterLinked` is the real server's own list. After "Devices → Servers → + → 127.0.0.1:4301" the link-back can never succeed. `GET /api/cluster/identity` (:117) also lacks the `fingerprint` field the real route returns (src/api/routes-cluster.js:308-311). All five routes the stub calls on the real server exist (`/api/replication/ping`, `/api/device-view`, `/api/cluster/identity`, `/api/cluster/master`, `/api/cluster/ssh-key`).
- `QUALITY` tools/dev/fake-cluster-peer.js:51 — `get()` has no status or auth check: with `security.enforceAuth` on the real server the error JSON parses fine and `.device_key.trim()` (:86) dies with "Cannot read properties of undefined (reading 'trim')". Documented use: work/work-orders/670_WO_server_network_and_remote_godot.md only.

## tools/dev/gen-api-contract.js
- `OK` — `node tools/dev/gen-api-contract.js --check` exits 0 (docs/wiki/api/contract/http.md and ws.md are current). Wired: tools/smoke/smoke-wo598-api-contract.test.js (curated list, offline-test-files.js:102) and a reference in src/api/router.js.

## tools/dev/gen-godot-golden-multiview.mjs
- `BUG` tools/dev/gen-godot-golden-multiview.mjs:14 — imports `resolveMvCellSourceChannel` from `client/lib/input-channels.js`, which commit 61de9bf2 ("WO-646 follow-up: drop orphaned web resolveMvCellSourceChannel") deleted. `node tools/dev/gen-godot-golden-multiview.mjs` therefore dies at import with `SyntaxError: … does not provide an export named 'resolveMvCellSourceChannel'` (verified on a scratch copy with absolute imports and a scratch output path; the real script was not run because it writes godot/client/tests/golden/multiview_editor.json). With only that symbol stubbed, the scratch run reproduces the committed golden exactly except the `channel` section, so everything else is still in sync. `godot/client/tests/test_multiview_model.gd:58-60` still asserts the `channel` section, so the golden is frozen and cannot be regenerated. Fix: inline the old function body (like the move/resize/drop blocks) or drop the section from both generator and test.

## tools/dev/measure-playback-rate.js
- `QUALITY` tools/dev/measure-playback-rate.js:194 — hard-codes consumer index `720` (`<port_720>`); the value is `METER_NULL_CONSUMER_INDEX` in src/audio/meter-null-consumer.js:36. Change one and the tick-rate readout silently disappears. Everything else checks out: `/api/state`, `/api/host-stats` (src/api/router.js:111) and `POST /api/amcp/raw {cmd}` (src/api/routes-amcp.js:320) exist; documented in docs/reference/measuring-playback-rate.md and WO-500/502/715; the INFO commands it sends are recorded by the playback tracker (routes-amcp.js:329) but are read-only.

## tools/dev/patch-rewir-middot.py
- `OK` — run against godot/client/assets/fonts/Rewir-Light.ttf and client/fonts/Rewir-Light.ttf into scratch: `patched: nothing (already outlined)`, i.e. the shipped fonts carry the patch and the script is idempotent. Referenced: THIRD_PARTY_NOTICES, WO-620, client/fonts/README.txt.

## tools/dev/subset-dejavu-ui-symbols.sh
- `OK` — re-run into scratch reproduces godot/client/assets/fonts/DejaVuSans-ui-symbols.ttf byte for byte (`cmp`). Referenced: WO-826, godot/client/assets/fonts/README.txt, THIRD_PARTY_NOTICES.
