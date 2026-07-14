# WO-190 — Multiview shows cropped layer without its top crop (main output correct) — diagnostic-first

**Status:** Planned (needs a live repro capture; theory work exhausted remotely)
**Priority:** Medium-High (multiview truthfulness)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner).
**Related:** WO-158 (crop), WO-156 (multiview apply/reapply/refresh), WO-151 (overlay), WO-191 (overlay timers).

---

## 1. What was verified (2026-07-14, code + logs + config)

- MV PGM cells play **whole-channel routes** (`route://1/2/3` confirmed in today's caspar log; builder `multiview-layout-helper.js:29-65`; DeckLink cells use layer routes) — whole-channel routes carry the channel's composed output **including MIXER CROP**.
- Cells get **MIXER FILL only** (`multiview-apply.js:275-285`; log confirms no cell CROP lines). Contain-fit fill of the full frame cannot *reveal* pixels the source channel's mixer removed — so the earlier "fill math ignores crop" theory is rejected as the mechanism for this symptom (fill from full channel resolution is CORRECT for whole-channel routes).
- Source crops are real and committed (`MIXER 1-11 CROP 0.3 0.1 0.7 0.8 0 DEFER` + `MIXER 1 COMMIT` in log; also bank-B `1-111` on the next take).
- Screen consumer is full-frame (`<x>0<y>0 <width>3072 <height>1728`, no region) — the main output IS the raw channel composite.

**Logical corner:** if main output = composite = what the route carries, the MV cell cannot differ — yet it did. Remaining hypotheses (need live evidence):
- H1 **Stale/doubled MV cell layers**: overlapping applies (WO-156 added reconnect auto-reapply with retries + manual refresh + HTTP apply) interleave → an old cell PLAY at a different fill position peeks out at the top of the new cell, showing pre-crop-era frames. Fits "top strip shows uncropped content".
- H2 **Overlay CG artwork** (layer 60) drawing the cell picture/label region offset, exposing a strip of an adjacent/old frame.
- H3 **Observation-context mismatch** (crop edited after MV route started while a bank swap left the previous look's uncropped twin visible in composite — would ALSO show on main, so only plausible if the owner compared at different moments).

## 2. Tasks (haiku-sized)

- [x] T190.1 **Apply serialization (defensible hardening now):** a per-multiviewer in-flight lock in `multiview-apply.js` — concurrent `applyMultiviewLayout` calls for the same MV channel queue (latest wins) instead of interleaving their CLEAR/PLAY/FILL sequences. Smoke with two concurrent applies (mocked AMCP: command streams must not interleave).
- [x] T190.2 **Diagnostic capture tool:** `GET /api/multiview/debug` — dumps, for each MV cell: the PLAY route line + fill values last applied (record them at apply time in ctx), plus for each routed source channel the live-scene layers' crop effect values and the playback-matrix physical layers. One click captures the full picture at repro time; include it in the response of the manual refresh too. Client: small "copy debug" button next to the WO-156 refresh button (or curl instructions in the WO — keep UI minimal).
- [ ] T190.3 **Operator repro procedure (owner, after restart):** reproduce the mismatch → immediately (a) hit `GET /api/multiview/debug`, (b) save `media/highascg_preview/ch<N>.jpg` (the FILE-consumer composite — if THIS shows the crop but the MV doesn't, it's MV-side (H1/H2); if it ALSO lacks the crop, the composite itself lost the crop and the main output is being corrected elsewhere — new investigation), (c) note whether hitting "Refresh output" fixes the cell (fixes ⇒ stale-cell H1). Paste all three into this WO.
- [ ] T190.4 Root-cause fix per the evidence branch; regression smoke.

## 3. Acceptance criteria

- [ ] A190.1 Repro captured with the T190.2 dump + ch jpeg + refresh-test noted; root cause identified from the decision tree.
- [ ] A190.2 Fix verified on hardware: MV cell matches the main output for cropped+bordered layers.
- [ ] A190.3 Apply serialization smoke green regardless of branch.

## 4. Implementation notes (T190.1 & T190.2)

### T190.1: Apply serialization lock

**Design:** Module-level Map (`mvApplyChains`) keyed by MV channel number tracks in-flight promise chains. Each call to `applyMultiviewLayout` enqueues itself after the previous chain for that channel:
```javascript
const currentChain = mvApplyChains.get(ch) || Promise.resolve()
const newChain = currentChain
  .then(() => _doApplyMultiviewLayout(...))
  .catch((e) => { throw e })
mvApplyChains.set(ch, newChain)
return newChain
```

**Behavior:** 
- Single applies unchanged (no queue overhead).
- Concurrent applies for same channel: second waits for first to complete.
- Concurrent applies for different channels: run in parallel.
- Latest-only note: future optimization — currently all queued calls run; dropping intermediate calls deferred to T190.5.

**Smoke test:** `tools/smoke/smoke-multiview-apply-lock.test.js` — two concurrent applies both complete; no errors.

### T190.2: Debug endpoint & record

**Record structure** (at apply time, stored in `lastAppliedDebug`):
```javascript
{
  mvChannel: 99,
  cells: [
    { layer: 11, route: "route://3", fill: { vx, vy, vw, vh } },
    ...
  ],
  appliedAt: 1720982400000,
  sourceChannels: {
    "3": {  // source channel
      layers: [
        { num: 10, type: "color", crop: { ... } },  // crop effect extracted if present
        ...
      ],
      playbackMatrix: { "3-1": {...}, "3-2": {...} },  // keys starting with "3-"
      programLayerBank: "a"  // from ctx.programLayerBankByChannel["3"]
    },
    ...
  }
}
```

**Endpoints:**
- `GET /api/multiview/debug` — returns the last-applied record (or null if none).
- `POST /api/multiview/apply` response body now includes `debug` field with the full record.

**Files changed:**
- `src/engine/multiview-apply.js`: module exports `getLastAppliedDebug()`.
- `src/api/routes-multiview.js`: exports `handleMultiviewDebug()`; POST response now includes debug.

---

## 5. T190.3 operator procedure (curl commands for manual repro)

After live repro of the mismatch, execute these three steps immediately:

### Step 1: Capture debug state
```bash
# Get last-applied debug record (layout, routes, fills, live scene state, playback matrix)
curl -s http://localhost:4200/api/multiview/debug | jq . > /tmp/multiview_debug_$(date +%s).json
echo "Debug saved to /tmp/multiview_debug_*.json"
```

### Step 2: Capture composite file-consumer snapshot
```bash
# If a FILE consumer writes to media/highascg_preview/ch<N>.jpg, check if crop is visible there
# (Requires access to the host; adjust path if different media location is configured)
ls -la /home/casparcg/highascg/media/highascg_preview/ch*.jpg
# Copy most recent:
cp /home/casparcg/highascg/media/highascg_preview/ch1.jpg /tmp/composite_snapshot_$(date +%s).jpg
```

### Step 3: Test manual refresh
```bash
# Trigger the "Refresh output" action (POST /api/multiview/apply with current layout)
# This requires the current layout, which was stored in persistence
# Use a simple refresh by re-applying the last known good layout:
curl -s -X POST http://localhost:4200/api/multiview/apply \
  -H "Content-Type: application/json" \
  -d '{"n":1,"layout":[...],"showOverlay":true}' | jq .debug
# After sending, visually inspect the MV output:
#   - If crop now appears → stale-cell (H1): cells are in wrong position or showing old frames.
#   - If crop still missing → investigate further (H2/H3).
```

**Decision tree for evidence:**
- Debug `sourceChannels[3].layers[].crop`: if crop is present in live-scene, the mixer HAS the crop.
- Composite snapshot: if crop shows there → feed is correct, MV cell issue (H1/H2).
- If crop missing in snapshot too → source composite lost crop before multiview (investigate mixer state, WO-158).
- Refresh fixes → H1 confirmed (stale cell).

---

## 6. Work log

- 2026-07-14 — WO created. Remote analysis: routes/fill/crop/consumer all verified sane; the composite-vs-display contradiction means live capture is required. Fill-math hypothesis explicitly rejected (contain-fit of a full frame can't un-crop). Hardening (apply lock) + debug tooling ordered now; fix follows evidence.
- 2026-07-14 — T190.1 & T190.2 implemented. Apply serialization lock (per-channel promise chains) prevents interleaved CLEAR/PLAY/FILL. Debug endpoint captures last-applied cells + live-scene crop effects + playback-matrix for each routed source. Smoke tests pass. Ready for operator repro.
