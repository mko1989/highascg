# WO-943 — "APPLY 1-65535 SLICES CLEAR … 403 APPLY FAILED" logged as an error on every Caspar connect

**Area:** amcp, mapping
**Status: DONE (04.11.26 — box: 0 APPLY lines over a node restart + a Caspar RESTART, device view `casparCaps.source: not-needed`; caps smoke 14/14, offline suite 5286 pass / 2 fail (pre-existing, box-dependent) / 15 skip)**

Owner 04.11 (second dev box): *"i noticed there is a weird amcp apply 1-65535 slices clear, that obviously fails."*

Related: [WO-869](./869_WO_mapping_node_slices.md) (the caps probe, "Verified" → the reply shapes), [WO-942](./942_WO_decklink_yuv_subregion_solid_green.md) (same session, same rig).

---

## 1. Investigation

- Journal on every (re)connect, twice:
  ```
  (HACG) [debug] AMCP → APPLY 1-65535 SLICES CLEAR
  (HACG) [error] Got error PARAMETER_ILLEGAL: 403 APPLY FAILED
  [amcp-send-queue] 403 APPLY FAILED
  ```
  and in Caspar's log `output[1] No consumer found for index 65535.`
- Source: `src/engine/caspar-caps-probe.js` `probeCasparCaps` (WO-869). Step 1 reads `INFO <ch>` for a screen consumer that reports `<slices>`. Step 2, when **no** channel has a screen consumer, sends `APPLY <first ch>-65535 SLICES CLEAR` to an index that cannot exist: 400 = binary has no APPLY (rollback) → `screenSlices: false`; 403 = APPLY exists → still `null`. Harmless on air, by design.
- Why it is pure noise here: the box's rig is all DeckLink (mapping node → DeckLink 3 + 4), so no channel has a screen consumer and step 2 runs every time. On the fork it always answers 403, which WO-869 itself records as "learns nothing". And the caps only steer outputs cabled to a **GPU head** (`mapping-slices-plan.js` — slice window vs legacy head); DeckLink outputs are planned identically for true / false / null. So on any rig without a mapping→GPU cable the answer cannot change a single decision.
- Why twice: `setupAllRouting` (→ `setupMappingChannels` → the probe) runs from both the query cycle (`src/utils/query-cycle.js:340`) and the INFO-CONFIG path (`src/bootstrap/caspar-info-ready.js:15`). That is the routing bring-up's general shape, not this probe's; left alone.
- Why not silence it in the AMCP layer: the reply line is the generic `403 APPLY FAILED`; `amcp-protocol.js` cannot tell the probe from a real APPLY that failed (a refused live slice edit), and those must stay errors.

## 2. What was done

- `src/engine/caspar-caps-probe.js`: new pure `mappingFeedsGpuHead(deviceGraph)` (a `pixel_map_out → gpu_out` edge exists). Step 2 runs only when it is true; otherwise the caps are set `{ screenSlices: null, source: 'not-needed' }` without sending anything (null is what the 403 path produced anyway, so the planner behaves exactly as before). Header comment updated. Step 1 (read-only INFO) is unchanged, so a box with screen consumers is probed as before.
- `tools/smoke/smoke-wo869-caspar-caps.test.js`: the existing 400/403 case now runs on its GPU-cabled `appConfig()` fixture (assertions unchanged); new case — the same graph with the GPU sinks swapped for a DeckLink sends no APPLY and reports `not-needed`, and no graph at all behaves the same.

## 3. What was verified

- Smoke `smoke-wo869-caspar-caps.test.js` **14/14** (was 13; one new case).
- Offline suite: **5303 tests, 5286 pass, 2 fail, 15 skip** — the two failures (WO-40a multiview head shift, graph-bound 3-head layout) fail identically on clean HEAD on this box (see WO-942 §3). max-file-lines 0, unwired-exports no new orphans, eslint 0 errors (the 2 `no-useless-assignment` warnings are on untouched lines 61/69).
- **Box (highascg5867):** probe deployed into `~/highascg/src/engine/`, node restarted, then AMCP `RESTART` of Caspar: `journalctl -u highascg` since the deploy shows **0** `APPLY … SLICES` lines, Caspar's log 0 "index 65535", operator GUI re-applied normally, `GET /api/device-view` → `"casparCaps":{"screenSlices":null,"source":"not-needed",…}`.
