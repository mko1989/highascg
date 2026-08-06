# WO-450 — Companion status tells the truth; button picker works without previews

**Status: DONE (06.08.26 — probed live against Companion 5.0.2 on the box; client build + service restart in the day's batch tail). OWNER ACTION: enable "Button Subscriptions API" in Companion → Settings for previews.**

Owner (todos06.08 line 15): *"the companion connection gives false connected flag in the
settings and doesnt actually let me pick a button after i started companion."*

## 1. Investigation (live probe, this box)

Netcat to the real satellite port during the session:

```
BEGIN CompanionVersion="5.0.2+9665-stable-5eb89669c6" ApiVersion="1.12.0"
CAPS SUBSCRIPTIONS=0 NONSQUARE=1 BITMAP_FORMATS="rgb,png,webp"
```

- Companion IS running and reachable (HTTP :8000 answers, satellite :16622 accepts TCP) —
  so "Connected" was not wrong. **`SUBSCRIPTIONS=0`: the Button Subscriptions API is
  disabled in Companion's settings** — previews genuinely cannot work until the owner
  enables it (Companion → Settings). That is the root of "can't pick a button".
- Three real code defects compounded it:
  1. `companion-connection-status.js` reported `subscriptionsSupported` from the PASSIVE
     preview client — which is disconnected whenever no picker is open, so the settings
     modal could claim "Button Subscriptions API is not enabled" (or stale opposite) with
     zero relation to reality: the false-flag feel.
  2. `companion-button-picker-modal.js` hard-blocked on a failed preview subscribe
     (`return` with an EMPTY grid) — but a binding is just page/row/column; previews are
     cosmetic. With subscriptions off, the owner literally could not pick anything.
  3. `satellite-preview-client.js` judged `_subscriptionsSupported` immediately after the
     BEGIN handshake resolved the connect wait — CAPS arrives as a separate line, so a
     split packet mis-reported `subscriptions_disabled` on a healthy connection.

## 2. What was done

- `probeCompanionTcp` now reads the handshake (1.2 s window after connect) and parses
  `CAPS SUBSCRIPTIONS` + `CompanionVersion`; the status endpoint prefers this live value
  and only falls back to the passive client when the probe saw no CAPS. Reason/hint are set
  from the live value.
- Picker: on failed subscribe the grid renders anyway (blank cells, row/col labels,
  clickable) with the warning line on top ("You can still click a cell to bind it").
- Preview client: CAPS emits an event; `ensureSubscribed` waits up to 1.2 s for it before
  declaring `subscriptions_disabled`.

## 3. What was VERIFIED

- New `tools/smoke/smoke-wo450-companion-status-probe.test.js` 4/4 against a mock satellite
  server (CAPS=0 parse, delayed CAPS=1, silent server → null, late-CAPS ensureSubscribed +
  ADD-SUB observed); registered in FILES. Test hygiene note: cleanup runs in `finally` —
  a failed assertion previously left the ping interval alive and hung the runner.
- `buildCompanionConnectionStatus` run against the LIVE Companion: `connected:true`,
  `satellite.connected:true`, `subscriptionsSupported:false`,
  `reason:"subscriptions_disabled"` + actionable hint — matches the netcat ground truth.
- Owner QA after enabling Button Subscriptions API in Companion: settings shows previews
  available; picker fills with button images. Until then: blank-but-clickable grid.

## 4. Round 2 (06.08 later): "the companion button chooser modal does not open at all now"

Owner follow-up (todos06.08 lines 29-31). Two compounding finds:
1. `inspector-panel-timeline-flag.js` DISABLED the "Choose button…" button whenever
   `/api/companion/button-preview/status` said `subscriptions_disabled` — and round 1 made
   that status truthful (the preview client now lingers connected with the real CAPS bit),
   so the disable started firing. Button no longer disables; tooltip explains previews.
2. The round-1 "blind grid" branch was UNREACHABLE in production: the subscribe route
   answers **503** and `api.post` THROWS on non-2xx, so `!sub.ok` never ran — the catch
   branch showed the old dead-end. The catch now renders the blind grid too (reason-aware
   message via `err.reason`).

Verified: eslint clean, suite green, built + deployed. Owner QA: "Choose button…" in the
companion_press flag inspector opens a clickable 8×8 grid with the warning line.

