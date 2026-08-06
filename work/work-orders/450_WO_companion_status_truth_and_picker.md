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

## 5. Round 3 (06.08 later): "still Cannot reach Companion Satellite … even though it is always on"

Owner enabled Button Subscriptions (live handshake now `CAPS SUBSCRIPTIONS=1`) but the flag
inspector still showed "Cannot reach Companion Satellite at 127.0.0.1:16622". Two defects:

1. **One-shot reconnect chain**: `_onClose` arms exactly one retry; toggling the setting
   restarted Companion's satellite listener, the single retry landed while it was still
   down, and the client stayed disconnected FOREVER while holding 61 subscription refs
   (observed live: `satelliteConnected:false, subscriptions:61`). `_ensureConnected` now
   re-arms the retry while refs are held.
2. **`/api/companion/button-preview/status` echoed the passive client** (the same lie class
   as round 1's other endpoint): it now live-probes the handshake when the passive client
   claims not-connected, reports the probe's truth, and nudges a real reconnect
   (`ensureReconnected`).

Verified LIVE end-to-end after restart: status `satelliteConnected:true,
subscriptionsSupported:true`; page-1 subscribe → `ok:true, 64 cells`; **64/64 previews
ready**, button jpg served (1180 B); `previewAvailable:true, subs:64`. Smoke extended (r3
stuck-refs reconnect test), 5/5. Note for the record (owner): button PRESSES never needed
the Subscriptions API — only previews do; the picker also works blind without it.

## 6. Round 4 (06.08 later): "the displayed companion button does not update once set"

The flag inspector's bound-button preview: `refreshPreviewImg` re-derived coords from
`timelineState.getActive()` + a fallback to the STALE closure flag (wrong timeline → old
coords → old image), the `--missing` dim class was added on error but never removed on a
successful load (no onload), and a 404 (first frame missing its 1.5 s window right after a
rebind) had no retry. Now: applyCoords passes the new coords straight through, onload clears
the dim class, and a single 1.2 s retry re-requests after a miss. Built + deployed.
Owner QA: choose a different button → the 72px preview swaps within ~a second.

## 7. Round 5 (06.08 later): "the companion button on the timeline and in the inspector only updates after a web UI page refresh. I need it to update live."

Three gaps, one existing pipeline: the server already broadcasts `companion.buttonPreview`
over WS on every SUB-STATE (and the picker modal already listened) — but:
1. The **inspector's bound preview** listened to nothing. It now follows the same WS event
   (matching bound coords, mtime cache-buster, self-removing listener).
2. The **canvas thumb cache** re-fetched the SAME URL after invalidation, so the browser
   HTTP cache (max-age=2) could serve the stale jpg. The WS handler now records each
   button's latest mtime (`noteCompanionButtonPreviewUpdate`) and the thumb loader uses it
   as cache-buster.
3. **Rebinding** never repainted the canvas — `applyCoords` now calls
   `invalidateCompanionFlagThumbs()` (which schedules a canvas redraw via the registered
   hook).

Built + deployed; suite 1882/0/2. Owner QA: change a button's look in Companion — the flag
thumb on the timeline and the inspector preview follow within ~a second, no reload.

