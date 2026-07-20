# copy_todos1 — progress tracker for work/work-orders/todos19.07.26

Working copy per the instruction at the top of `todos19.07.26`. Every item from that file appears
here with a work-order number and a status. Statuses: **DONE** (implemented, gate-green,
committed), **IN PROGRESS**, **TODO**, **USER** (needs an action only the box owner can take).

Gate baseline at time of writing: `npm run test:ci` → 707 tests, 705 pass, 0 fail.

## Batch 1 — closed 2026-07-19/20 (committed 7fc8d78, ca94da1, 6f83d3f, e5cf521, 0af86c0)

| # | Item | Status | Evidence |
|---|------|--------|----------|
| — | Bug hunt / stability / performance review | DONE | AMCP wedge family root-caused (batch-drain timeout, query-cycle bypassing the send queue); governor/zram/NVIDIA persistence covered |
| — | Prep for clean eggs produce + release | DONE | Zoom + NoMachine excluded fully; identity/login excludes (NX, .zoom, syncthing, tailscale, .mozilla, .claude, operator firefox profile) verified present in BOTH fragments |
| WO-266/268 | CG studio + shadertoy UI polish; shader under a plus button | DONE | Shader entry consolidated into the main ingest plus menu (separate templates-tab button removed per follow-up) |
| — | Stale compose preview after restart + first-look long timeout | DONE | `restagePersistedPreviewLooks` + `warmLookDeckThumbnails`; live journal after restart: `Preview re-stage: look Look 6 staged on prv 2`, `Look thumb warm: 4 already cached` |
| — | PRV inconsistent/racing, must be realtime AND exact | DONE (needs your TESTING) | Per-channel take chain (clears/nudges can no longer interleave into a mid-flight take) + `/api/preview/mixer-nudge` low-latency geometry path using server-side fill math |
| WO-272 | Operator GUI: PGM edit button + capture button | DONE | EDIT PGM / CAPTURE on each PGM tile footer; PGM edits are bank-aware and race-guarded; `POST /api/pgm/capture` → `PRINT <ch>` + toast |
| — | Route-look layers appearing sequentially | DONE | Same-channel `route://` PLAYs folded into the source's BEGIN…COMMIT batch (ordered inside, atomic on air) |
| — | Media drop-exchange must keep size/position | DONE | Refit gated on `isLayerSourceExchange` |
| — | Looks editor aspect lock from any corner; drop size/rotation dots | DONE | Border-grab resize bands; `edgeResizeDeltaToFill` with aspect lock (shift = free) |
| — | Compose preview borders outside the Caspar window, keep screen aspect | DONE | Hole-aspect from INFO-derived channel resolution; border is an `outline` outside the hole; rects re-report when the canvas moves (IntersectionObserver watcher) |
| — | Simple shadertoy guide + how audio reactivity works | DONE | `docs/wiki/guides/shader-fx.md` (512×2 FFT/waveform texture, per-path audio quality, troubleshooting) |
| — | Deferred refactors (WO-269 dedupe, mv hole geometry, launcher probes, lt-engine sharing) | DONE | Dedupe already complete (locked by 6 new assertions); geometry unified in `client/lib/hole-rect.js`; launch timing probes added; lt-engine/registry style-key sync lock + dead engine copy deleted |
| — | nvidia-595 `apt --fix-broken` / unmet firmware dependency | USER | Needs sudo: `sudo apt --fix-broken install`, then `scripts/setup/03-nvidia-open-595.sh` |
| — | NVIDIA persistence unit install | USER | `sudo cp scripts/setup/highascg-nvidia-persistence.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now highascg-nvidia-persistence.service` |

## Batch 2 — open items from todos19.07.26 (lines 23-67)

| WO | Item | Size | Status |
|----|------|------|--------|
| WO-273 | scripts/ + tools/ cleanup: move deprecated out, leave a clear runtime set, a fresh-install set, and a dev/eggs set | L | TODO |
| WO-274 | Config generator keeps stale PGM/PRV channels that are unused and invisible in the GUI | M | **DONE** — graph cable from multiview/stream/operator_gui inflated screen count via Math.max; isMainBusDestinationMode() filter |
| WO-275 | Config generator ignores a changed destination (DeckLink out 3: pgm2 → multiview still shows pgm2 after restarts) | M | **DONE** — additive DeckLink projection left screen_2_decklink_device=3 AND multiview_decklink_device=3 (both in live config); now released on claim |
| WO-276 | Screen-destination custom resolution: height reverts to 1080, inspector disagrees with the node | M | **DONE** — NOT linked to stale channels: 5s client payload cache answered the post-save reload; now forceRefresh |
| WO-277 | Loading a project doesn't actually load anything | M | **DONE** — /api/project/load persisted the slug but never rewrote ctx.sceneDeck (which the API prefers over disk); new project-activate.js adopts deck, prunes live entries, re-stages preview, surfaces restart-required |
| WO-278 | Cable render performance; allow re-grabbing a cable end and reconnecting it elsewhere | M | TODO |
| WO-279 | Operator-GUI Firefox opens on the wrong monitor (mouse lock is correct); review the xrandr/window-placement workflow | M | **DONE** — xdotool --class matched res_class not res_name so the search never matched and burned an 8s timeout; placement also never verified. Same monitor source as pointer-confine + verify/retry |
| WO-280 | Caspar JPEG compose preview: background tab causes lag; thumbnail creation for an ever-changing JPEG needs error handling/backpressure | M | **DONE** (93fa79e) — push-driven at 25Hz x clients x channels, each push a full re-read; now single-flight + etag memo server-side, visibility-aware polling and capped backoff client-side |
| WO-281 | Audit `work/work-orders/logs.19.07.26` — many errors/false calls during normal operation; check whether enabling AMCP batch caused regressions | M | **DONE** — all errors trace to one powered-off DeckLink 4; amcp_batch was never enabled. Report: 281_WO_CASPAR_LOG_AUDIT.md |
| WO-282 | Browser source: route a real audio source in; give it a virtual display shown in kiosk and relayed to Caspar; options for operator mouse/keyboard control | L (research) | TODO |
| WO-283 | Operator GUI blocks any window on top (DeckLink setup, NVIDIA settings, file browser, operator web browser) | M | TODO |
| WO-284 | Audio mixer: VU meters per input; know which input produces sound. Allow routing a layer's audio to another screen (UI currently blocks it) | L | TODO |
| WO-285 | CG studio should reuse the existing inspector; box size options missing (only weight) | M | TODO |
| WO-286 | Inverted two-finger scroll for laptop touchpads | S | **DONE** (74a7c14) — shared wheel-delta helper + Settings > Defaults preference, default off |
| WO-287 | No modal may blur the background — none | S | **DONE** (0a5a80a) — blur removed from modal shell + ingest drag overlay; regression test |
| WO-288 | Generated Caspar config should not emit a custom 1080p50 mode (built in) | S | **DONE** (487f2f3) — mode-alias normalization; also registered 23 previously-ungated config-generator tests |
| WO-289 | Looks editor canvas background should be a low-opacity alpha checkerboard, visibly distinct from the surrounding div | S | **DONE** (0a5a80a) — 6% alpha checkerboard on the looks-editor canvas only |
| WO-291 | DeckLink input does not use its captured frame as the looks thumbnail (added by owner 2026-07-20) | M | TODO |
| WO-290 | Opt-in operator-GUI monitor picker on a fresh/factory-reset system: hover + left click selects the GUI screen, then the service sleeps | M | TODO |

## Execution notes

- Small (S) items are dispatched to Haiku subagents in waves; each wave is verified against the
  gate and committed before the next starts, so an interrupted session never loses work.
- Every subagent prompt carries the hard rule: never run `git stash`/`checkout`/`reset`/`rm` on
  files it did not create (a subagent destroyed an uncommitted test this way on 2026-07-19).
- Investigation-first items (WO-281, WO-282) produce a written finding before any code changes.
