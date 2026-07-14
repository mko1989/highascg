# WO-165 — Status eyes hover: per-process usage; remove settings/logs modal backdrop dim+blur

**Status:** Planned
**Priority:** Low (operator quality-of-life)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): status-eye hover should show casparcg (and optionally highascg) process usage; settings/logs modals must not dim or blur the main UI behind them.
**Related:** WO-59 (device view inspector FPS), WO-67 (logs modal).

---

## 1. Investigation findings (2026-07-13)

### A. Status eyes hover

- Component: `client/components/connection-eye.js` — tooltip built in `buildTooltipText()` (:35-82), populated from `GET /api/host-stats` on hover (`loadHostStats()` :253-273, mouseenter :280-285).
- Server: `src/api/routes-host-stats.js:226-258` currently returns **system-wide** stats only (loadavg, total/free mem, GPU via nvidia-smi cached 5 s, caspar GL info, media disk). **No per-process CPU/RSS.**
- No pidusage-style dependency; per-process stats need `/proc/<pid>/stat` + `/proc/<pid>/status` reading (Linux-only is fine — this is a Linux appliance). Node's own PID is `process.pid`; the CasparCG PID needs discovery (systemd `MainPID` of the caspar unit, or /proc scan for the casparcg-server binary name — prefer systemd query with /proc-scan fallback; cache the PID, re-discover on miss).

### B. Modal backdrop

- Base overlay: `client/styles/07b-audio-mixer-modal-shell.css:427-439` — `.modal-overlay` has `background: rgba(0,0,0,0.7)` (:433, the dim) + `backdrop-filter: blur(4px)` (:434, the blur).
- Settings modal already overrides blur only: `client/styles/08b-modals-settings.css:1-3` (`backdrop-filter: none`) — dim remains.
- Logs modal has **no override** — inherits dim + blur (`client/styles/08a-modals-logs.css`).
- Close behavior is button-only for both (`settings-modal.js:120`, `logs-modal.js:467`) — no click-outside-to-close depends on the backdrop, so making it transparent is safe.

## 2. Tasks

- [x] T165.1 **Per-process stats in /api/host-stats:** add `processes: { caspar: { pid, cpuPct, rssBytes }, highascg: { pid, cpuPct, rssBytes } }` — CPU% computed from two `/proc/<pid>/stat` samples (keep last sample in memory per request cycle or compute over the endpoint's own poll interval; document the window), RSS from `/proc/<pid>/status` VmRSS. Caspar PID via `systemctl show --property MainPID <caspar unit>` (find the unit name used on this rig — check scripts/systemd/) with /proc cmdline-scan fallback; cache + invalidate on miss. Null-safe when caspar isn't running.
- [x] T165.2 **Tooltip:** extend `buildTooltipText()` to show `CasparCG: <cpu>% / <rss>` and `HighAsCG: <cpu>% / <rss>` lines when present.
- [x] T165.3 **Backdrop:** settings modal — add `background: transparent` (blur already off); logs modal — add `#logs-modal.modal-overlay { background: transparent; backdrop-filter: none; }`. Verify no other modal relies on `.modal-overlay` dim for readability regressions we care about (only these two were requested — do NOT change the base class; scope overrides to these two modals). Check the modals' own panels still have opaque backgrounds so their content stays readable.
- [x] T165.4 Smoke for the /proc parsing helpers (feed fixture stat/status strings); CSS is manual QA.

## 3. Acceptance criteria

- [ ] A165.1 Hovering a connection eye shows caspar + highascg CPU%/RSS alongside existing system stats (operator check).
- [ ] A165.2 Settings and logs modals open over a fully visible, undimmed, unblurred main UI; both still close via their buttons (operator check).
- [ ] A165.3 Gates green (`lint`, `test:ci`).

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`; eyes tooltip + host-stats endpoint mapped (system-wide only today); dim/blur traced to `.modal-overlay` base with settings overriding blur only; backdrop is not click-sensitive so transparency is safe.
- 2026-07-13 — Implemented T165.1–T165.4.
  - New `src/system/proc-stats.js`: `/proc/<pid>/stat` + `/proc/<pid>/status` parsing (comm may
    contain spaces/parens — split on the *last* `)` per proc(5)), CPU% via delta-since-last-call
    (module-level `Map` cache keyed by pid) with a one-time ~200ms two-sample bootstrap on first
    observation of a pid (documented in the file header — this is the "pick one" from the WO).
    Caspar PID discovery: `systemctl show --property=MainPID --value casparcg-server.service`
    (confirmed unit name on this rig via `systemctl list-units | grep -i caspar` — read-only) then
    verified against `/proc/<pid>/comm` + cmdline, because **MainPID on this rig is the `run.sh`
    supervisor, not the casparcg binary** (confirmed live: MainPID 1324984 = `run.sh`; the real
    binary was PID 3545917, a child of it) — falls back to a `/proc` scan for a process with
    `comm === 'casparcg'` and no `--type=` flag (excludes CEF zygote/gpu-process/utility helper
    children, which share the same comm), preferring a direct child of MainPID. PID cached with a
    5s TTL (mirrors the endpoint's existing `_gpuCache`/`GPU_TTL_MS` pattern) and re-discovered
    immediately if `/proc/<pid>` vanishes. Verified live on this box (read-only, no service
    restarts): resolves to PID 3545917 (`/home/casparcg/highascg/bin/casparcg ...`), reports
    plausible CPU%/RSS (~1100% across the box's 28 cores, ~11–12GB RSS).
  - `src/api/routes-host-stats.js`: added `gatherProcessStats()` and wired `processes: { caspar,
    highascg }` into the `/api/host-stats` response (null in preshow stub; null-safe when caspar
    isn't running).
  - `client/components/connection-eye.js`: `buildTooltipText()` now appends `CasparCG: <cpu>% CPU
    · <rss> RSS` / `HighAsCG: <cpu>% CPU · <rss> RSS` lines when `data.processes.*` is present,
    reusing the existing `formatBytes()` helper.
  - CSS: confirmed both `#settings-modal` and `#logs-modal` elements carry `class="modal-overlay"`
    on the same node as the id (checked `settings-modal.js`/`settings-modal-templates.js` and
    `logs-modal.js`), and that both modal panels use `.modal-content` (opaque
    `background: var(--bg-panel)`, `07b-audio-mixer-modal-shell.css:441-451`) so removing the
    overlay dim/blur does not affect content readability. Added `background: transparent` to
    `#settings-modal.modal-overlay` (`08b-modals-settings.css`) and a new
    `#logs-modal.modal-overlay { background: transparent; backdrop-filter: none; }` rule
    (`08a-modals-logs.css`). Base `.modal-overlay` in `07b-audio-mixer-modal-shell.css` left
    untouched. Confirmed both modals close via button only (`#settings-close`/`#settings-cancel`,
    `#logs-modal-close`) — no click-outside-to-close depends on the backdrop.
  - New `tools/smoke/smoke-proc-stats.test.js` (`node --test`, 11 assertions): `parseStatFields`
    against a real sampled stat line and a synthetic comm-with-spaces-and-parens fixture, plus
    garbage input; `parseVmRssKb` happy path + missing-field; `computeCpuPct` for 100%/50%/0%,
    zero/negative elapsed time, backwards tick counter (pid reuse), and >100% multi-core case.
  - Verification: `node --check` clean on all 4 touched/added JS files; ESLint (installed to
    scratchpad, run via `NODE_PATH` — not added to repo `node_modules`) clean, 0
    errors/warnings after removing two `no-useless-assignment` warnings via small refactors; `node
    --test tools/smoke/smoke-proc-stats.test.js` — 11/11 pass. A165.1/A165.2 need an operator's
    visual hover/modal check (not run — no service restarts per box constraints); did not run the
    full `test:ci`/`lint` gates (new smoke file is not registered in
    `tools/ci/run-offline-tests.js`'s curated list — out of this WO's touch scope) so A165.3 is
    left unchecked pending that registration + a full gate run.
