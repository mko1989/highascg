# WO-394 — Companion module is a HighAsCG module: drop direct-AMCP surface

**Status: IMPLEMENTED (2026-07-30 — module tests 40/40, lint clean on touched files, committed 501763d in the module repo; owner A394.1: restart Companion, select the 1.0.8 dev module, re-save the connection config — the AMCP port/bridge fields disappear)**
**Source:** `work/work-orders/todos30.07.26` §1: "the straight amcp commands can be removed. just leave the custom raw amcp send action. this should be treated as a highascg module, not as highascg and casparcg module. so remove the mentions of + casparcg (its already implied) remove the amcp port and bridge enable from config."
**Module repo:** `/home/casparcg/companion-module-dev/companion-module-highpass-highascg`
**Related:** WO-170 (parity review — called raw-AMCP passthrough "intentional"; this WO reverses that framing per owner), WO-372/384/386 (recent module work; pre-existing uncommitted packaging residue committed separately first), WO-395 (configured-output streaming actions, same batch).

---

## 1. Investigation (2026-07-30)

Direct-AMCP surface in the module (all via `src/tcp.js`, a `TCPHelper` to `config.port` 5250):
- `src/actions/basic-actions.js` — `play` / `stop` / `clear` / `raw`, all `instance.tcp.sendCommand(...)`.
- `src/config-fields.js` — "AMCP Port" field (`port`), "Use HighAsCG Bridge" checkbox
  (`highascg_enabled`, default true) gating three pollers + bridge init + config `isVisible`s.
- `src/instance.js` — `initTcp()` lifecycle; `configUpdated` watches `port`/`highascg_enabled`.
- `src/connection-router.js` — failover probe falls back to `legacy_tcp` when the bridge is off.
- `src/feedbacks.js` `caspar_connected` — checks `instance.tcp?.connected` (the direct socket).
- `src/presets.js` — "Playout" section ships a `play_clip` preset wired to the removed `play`.

Load-bearing findings:
- The HighAsCG server exposes `POST /api/amcp/raw` (`src/api/routes-amcp.js:304`, body `{cmd}`)
  with line normalization + playback tracking — a strictly better path for the surviving raw
  action (goes through the app's coalescing/teardown guards, works over the existing bridge,
  follows hot-backup failover for free).
- The app itself reports its Caspar connection as bridge variable `caspar_connected`
  (`state-sync.js:88` prettifier) — the feedback can keep its id and meaning without a socket.
- Module tests (`test/presets-and-config.test.js`) pin config regex behavior (WO-384) but not
  the AMCP fields or the play preset.

## 2. What was done

Module (companion repo, one commit):
- `basic-actions.js`: only `raw` survives, rewired to `instance.bridge.api.amcpRaw(cmd)`
  (new api-client method → `POST /api/amcp/raw`). `play`/`stop`/`clear` deleted.
- `config-fields.js`: `port` + `highascg_enabled` fields deleted; info text reworded to
  HighAsCG-only; `isVisible` gates on the deleted checkbox dropped (bridge is the module).
- `tcp.js` deleted; `host-target.js` loses `getAmcpPort`; `instance.js` loses the TCP
  lifecycle; `connection-router.js` loses the `legacy_tcp` probe branch and the bridge-off gate;
  the three pollers lose their `highascg_enabled` checks (always on).
- `feedbacks.js` `caspar_connected`: same id, now reads the app-reported bridge variable.
- `presets.js`: `play_clip` preset + "Playout" section removed (replaced by WO-395's
  Streaming & Record section).
- `companion/manifest.json` / `package.json` / README: "+ CasparCG" framing removed
  (description, products, keywords) — HighAsCG module, Caspar implied.

## 3. What was VERIFIED

- Module suite **40 pass / 0 fail** (incl. new `test/streaming-outputs.test.js` guards:
  play/stop/clear gone + raw framed via-HighAsCG; `port`/`highascg_enabled` config fields gone).
- `npx eslint` clean on every touched file (repo has pre-existing prettier debt elsewhere).
- Module repo committed: `95080f1` (pre-existing WO-372-era packaging residue, committed as
  found) then `501763d` (this WO + WO-395).
- NOT yet live-proven: Companion itself hasn't been restarted (same owner-owed step as
  WO-372's picker check). **Owner A394.1:** restart Companion, pick the dev module, confirm
  config saves without the removed fields and a Raw AMCP button still fires (check
  `journalctl -u highascg` for the `/api/amcp/raw` line).
