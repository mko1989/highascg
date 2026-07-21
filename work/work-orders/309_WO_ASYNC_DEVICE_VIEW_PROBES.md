# WO-309 — Device View hardware probes must stop blocking the event loop

**Status: OPEN** (bounded in 4ab0c2d; the real fix deliberately deferred pre-release)

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
