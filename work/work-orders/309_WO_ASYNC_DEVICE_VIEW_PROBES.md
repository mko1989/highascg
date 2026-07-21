# WO-309 — Device View hardware probes must stop blocking the event loop

**Status: DONE — 2026-07-21.**

Delivered with a DELIBERATELY NARROWER scope than "ripple through ALL callers":
async siblings (`getDisplaysXrandrDetailedAsync`, `getDisplaysXrandrVerboseRawAsync`,
`getGpuConnectorInventoryAsync`, `getDisplayDetailsAsync`) share the exact same cache
and boot-snapshot fallback as the sync versions (proven byte-identical output), and
ONLY `device-view-snapshot.js`'s `buildLiveSnapshot` — the actual measured GET
/api/device-view hot path — was switched to await them.

Every other caller enumerated (20+ across bootstrap/, utils/, api/, capture/, support/,
system/ — os-layout-watchdog, gpu-topology-drm-merge, system-inventory-file,
x-display-session-layout's calculateLayoutPositions and everything built on it,
os-config.js, operator-monitor-resolve, the WO-290 monitor picker, etc.) was
LEFT ON THE SYNC PATH on purpose. Reasoning: most of these are called from deep
inside synchronous config-generation/layout-math call chains where "just make it
async" would cascade into a much larger, riskier refactor of code that was never
part of the measured problem (only the live per-request devices-tab GET was slow
enough to matter — WO-278/this WO's own measurements were both taken against that
path specifically). Converting them would be scope creep with no measured benefit
and real risk to code more sensitive than a display probe.

One exception audited and deliberately NOT converted: `system-hardware-gpu-layout.js`
(GET /api/system/gpu-layout) — the file's own header already calls it "legacy
(deprecated WO-108)"; not the hot path, single low-traffic diagnostic endpoint.

Verified LIVE on this box: a cold-cache /api/device-view GET took 366ms, and SIX
AMCP VERSION round-trips fired concurrently during that window all stayed at 0-1ms
— identical to the idle baseline (also 0-1ms). Directly satisfies the acceptance
criterion below. Also proved directly: the sync call blocks a 5ms-interval timer
completely (0 ticks over ~170ms); the async call lets it tick freely (28 ticks over
155ms) — same input, same output, only the blocking differs.

Gate: 1214 tests, 0 fail.

---

## Context — measured, not guessed
GET /api/device-view runs `xrandr --query` AND `xrandr --verbose` via execSync on the request
path (hardware-info.js). Measured on the tower 2026-07-21: ~90ms + ~72ms per cache miss
(3s TTL), freezing the WHOLE single-threaded server — AMCP, WS clients, every route.
4ab0c2d added timeout:3000 so a wedged X server can no longer hang the process forever, but the
blocking itself remains. Prior art: WO-278 measured cold snapshot median 274ms / max 1770ms.

## Task
- Convert getDisplaysXrandrDetailed / getDisplaysXrandrVerboseRaw (and their EDID-catalog
  consumers in gpu-edid-probe.js) to async execFile with the same caching; ripple through
  buildLiveSnapshot and its call sites (device-view-snapshot.js, routes-device-view.js,
  routes-system-hardware.js — enumerate ALL callers first, several are sync-by-signature).
- Keep a sync fallback ONLY for boot-time callers that genuinely cannot await (audit; likely none).
- While there: the stale-cache path already fetches in background (device-view-render.js T202.2)
  — server-side async makes that path truly non-blocking end to end.

## Acceptance
- Under a devices-tab refresh loop, AMCP round-trip (VERSION) stays <10ms (baseline script in
  todos21 runbook §3) — today it degrades by the xrandr cost on every cache miss.
- No execSync of xrandr remains (extend smoke-hardware-info-xrandr-timeout to assert async).
