# WO-446 — Duplicate-code consolidations (WO-445 §2b follow-ups)

**Status: DONE for items 2.1–2.2 (06.08.26, suite green, service restarted); §2.9 items deferred — owner todos (WO-447..451) took priority mid-session**

Owner "continue" on WO-445. Each item lands as its own commit, verified before the next.
Ordering: safest → riskiest; the Caspar config generators go last (load-bearing XML) and
only with a before/after XML diff as proof.

## 1. Investigation

Duplicate groups verified live-on-both-sides in WO-445 §1.3. This WO consolidates them.
Constraint from the WO-367 gate: keep export names referenced; constraint from the smoke
discipline: re-point any `readFileSync` assertions that pin moved lines.

## 2. What was done

### 2.1 `which.js` reimplementation (~47 lines) — DONE

`src/utils/x-display-session-runtime-env.js` carried the ORIGINAL WO-283 in-process
`lookupCommandPath` + `FALLBACK_PATH`; `src/utils/which.js` is the later extracted shared
home with an identical copy. The runtime-env module now `require('./which')` and re-exports
the same names (importers `x-display-session-runtime.js`, `x-display-session-gui-windows.js`
untouched). 130 → 87 lines. The WO-283 root-cause story stays in `which.js`; a pointer
comment remains at the old site.

Verified: `smoke-command-lookup.test.js` 3/3 (includes the no-/usr/bin/command source scan),
`smoke-os-layout-w40.js` 9/9, eslint clean, exports probed by hand
(`commandExists('sh') → true`, `FALLBACK_PATH` intact).

### 2.2 Art-Net ↔ sACN receivers (~250 shared lines) — DONE, and it wired a lost feature

The two classes were line-for-line copies apart from the transport. Extracted
`src/artnet/dmx-border-receiver-base.js` (shared state, stats, slot/patch resolution,
handleData, WS/Caspar flush scheduling, stop); `artnet-receiver.js` (357→52) and
`sacn-receiver.js` (397→97) keep only transport + protocol hooks. Fixes two latent sACN
bugs the duplication had hidden: `applyPatch` calls `receiver._artnetScreenIndex()` which
SacnReceiver never defined (TypeError on any patch without screenIndex), and
`getInputStatus` reads `_socket`/`_artnetListenEnabled` by name (sACN stored its transport
in `_sacnReceiver` → status permanently "not listening").

**Bigger find: `SacnReceiver` was never instantiated anywhere.** WO-179 T179.4 shipped the
class, the UI protocol select, and `slotLightingProtocol()` — but index.js constructed
ArtnetReceiver unconditionally. Choosing sACN in the inspector did nothing (fifth WO-367
lost-wiring find; pre-gate, baselined). New `src/artnet/lighting-input-receiver.js` facade
owns whichever receiver the slot asks for and swaps on reconfigure; it exposes the exact
surface all call sites already use, so `appCtx.artnetReceiver` keeps its name and only
index.js changed (2 lines). Fresh-instance init honors the DMX master switch the same way
boot does.

Verified: new `smoke-wo446-lighting-protocol-dispatch.test.js` 4/4 (dispatch follows the
slot, no instance churn on same protocol, sACN field contract, shared handleData) —
registered in FILES; WO-179 smokes 9+5 still green; eslint clean; no new orphan exports.
Server restart pending at batch end (src change).

### 2.9 Deferred (each needs its own WO before touching)

Owner todos landed mid-session (vsync WO-447, timeline WO-448/449, companion WO-450, GPU
layout WO-451) and took priority. Still open from WO-445 §2b:
- Audio mixer console ↔ panel shared helpers (~100 lines, both UIs live).
- Template pairs: multiview_master ↔ multiview_overlay (~84), lower-thirds engine ↔ styles
  (~44) — CEF standalone, sharing needs <script> includes, judge per template.
- Caspar config generators (~220 lines) — riskiest; requires before/after XML diff harness.
- Lint pass 6 (216 warnings vs 218 cap).
- `projects/*.sync-conflict-*` cleanup — owner call.

## 3. What was VERIFIED

Per-item, recorded inline above. Suite + gates re-run at the end of the batch.
