# src/autofollow — sweep 29.10.2026 (batch 069)

Files: 1 · lines: 60 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 0 RISK, 2 QUALITY

## src/autofollow/register.js
- `QUALITY` src/autofollow/register.js:30 — the `see` pointer in the skeleton response is `work/31_WO_STAGE_AUTOFOLLOW_PTZ.md`, which does not exist; the file is `work/work-orders/deprecated/31_WO_STAGE_AUTOFOLLOW_PTZ.md` (verified: `ls work/31*` fails). The same wrong path is in client/assets/modules/autofollow/entry.js:15.
- `QUALITY` src/autofollow/register.js:1-60 — the whole module is a never-implemented skeleton. WO-31 carries a 2026-10-17 note that tracking/DMX follow moved to WO-616 / WO-615. It is opt-in (src/plugins/plugin-manager.js:32-38: `HIGHASCG_AUTOFOLLOW` or `features.autofollow`), and on this box `GET /api/autofollow/devices` returns 404 (not loaded). It registers an API prefix, a WS namespace and a web bundle that all do nothing (`onShutdown` is an empty TODO). Decision for the owner: remove it with its plugin-catalogue entry and client/assets/modules/autofollow, or keep it as a documented stub. Nothing here is wrong at runtime.
