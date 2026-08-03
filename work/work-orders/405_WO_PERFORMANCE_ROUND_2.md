# WO-405 — Performance round 2 (todos03.08.26 item 1)

**Status: IN PROGRESS (2026-08-03 — WO-401 deploy leg completed and verified; round-2 research not yet run)**
**Priority:** High (owner: "thorough review of the code base… anything beneficial to get the most performance out of the machine")
**Source:** `work/work-orders/todos03.08.26` item 1
**Related:** WO-401 (round 1, 2026-07-30 — 15 ranked findings, F1–F9/F12 implemented), WO-398 (run.sh fork loop), WO-399 (v4l2 jpg branch), WO-407 (screen-consumer stutter — the on-glass symptom is tracked there, but candidate causes overlap with caspar-process load)

## 1. Investigation

### Prior art — WO-401 covered exactly this ask 4 days ago

Round 1 measured the box live (caspar 431 % CPU, node 18,656 OSC msg/s, WS 335 KB/s/client)
and implemented F1, F2, F3-revised (value-aware dirty marking + `HIGHASCG_OSC_WS_DELTA=1`),
F4, F5-revised, F6–F9, F12 + todos30.07 item 6. A fresh "thorough review" that ignores this
would mostly re-find the same list. What round 1 left on the table:

- **The deploy.** Client tranche (F12, thumbnails item 6) plus WO-403/404 client fixes sat
  unbuilt — `dist-web/` was last built 30.07 16:59, client commits landed 01.08 21:57.
  Server side became live with today's 09:55 restart. **Deploy executed this session — see §2.**
- **Deferred findings**, with WO-401 §2 reasons still standing:
  - F10 (decode-before-filter) / F11 (O(C²) channel lookup) — marginal after F1/F2.
  - F13 (lsblk fork every 2 s) — owner-visible USB-latency tradeoff, owner call.
  - F14 (compose-preview mtime watch) — feature off on this box.
  - F15 (live-audio bridge GOP=1 encode + double resample) — DM3 path, hard-won, quiet-day job.
- **The caspar process itself** — 431 % CPU is by far the biggest consumer on the box and
  round 1 only measured it. Round 2 should look inside: consumer/producer load per channel,
  the two vsync'd screen consumers (see WO-407), mixer costs, whether the 1080p5000 live-input
  channels (4, 5) burn full render loops while idle.
- **Post-deploy verification of round 1** — the delta-WS flag and dirty-marking are live only
  as of today; nobody has measured the new baseline.

### What round 2 should do (in order)

1. Fresh live baseline with everything from round 1 actually deployed (same metric table as
   WO-401 §1 for comparability: caspar CPU/GPU, OSC msg/s, WS B/s/client, node CPU/RSS,
   `/api/state` latency).
2. Verify F3-revised delta path is actually delivering deltas to the kiosk (journal +
   `/api/osc/diagnostics`), rollback plan in WO-401 §3 if not.
3. Caspar-internal pass (per-channel `INFO`, GPU profiling, idle-channel cost) — ties into
   WO-407's stutter diagnosis.
4. Revisit F10/F11/F13/F15 only if the fresh baseline says they now matter.

## 2. What was done (this session, 2026-08-03)

The owed WO-401/403/404 **post-show deploy**:

- Server tranche: already live — `highascg` service and casparcg restarted 09:55 UTC today
  (before this session; casparcg uptime 16 min at check).
- Client tranche: `npm run build:client` run 10:13 (clean build, 295 ms) — `dist-web/` had
  been stale since 30.07 16:59 while client fixes committed 01.08 (WO-403 `511f09f`,
  WO-404 `20fdca4`, WO-401 client tranche) waited. Kiosk reloaded via XTEST
  (`DISPLAY=:0 xdotool key F5`).

## 3. What was VERIFIED to work

- Build completed without errors; `dist-web/assets/*.js` timestamps now 03.08 10:13.
- Kiosk F5 injected successfully (xdotool exit 0). **Not** verified: on-glass owner QA of
  WO-401 client items (thumbnail refresh), WO-403 (Shader Live follows playlist), WO-404
  (drag no longer blanks compose preview) — the QA lists live in those WOs.
- Round-2 research (§1 steps 1–4) NOT started — that is the remaining body of this WO.
