# WO-1045 — Audio mixer VU meters not real time: a web client's Media tab polled the project list ~7×/s

**Area:** audio, engine, web-client
**Status: DONE (12.11 — on the box: WS meter feed 13.7 → 21 Hz, gap p90 105 → 51 ms, max 269 → 62 ms with the old poller still running; smoke 4/4 + related 27/27)**

Owner, 12.11: *"the audio mixer isnt really working real time showing the values in the vu meters"*.

## Investigation

- Meter path: Caspar OSC → node UDP :6251 (`osc-state`, emits `change` every `emitIntervalMs` = 50 ms) → WS `osc`
  message (`osc-lifecycle.js`) → Godot `OscMirror` → `audio_tab.gd` meter tick (`AM.TICK_S` 0.05).
- Caspar was not the bottleneck: a sniff of the full OSC copy on :6250 showed ~47 audio changes/s on ch 6.
- What reached clients was not 20 Hz: WS `osc` frames at **13.7 Hz**, inter-frame gaps p50 53 / p90 105 / **max
  269 ms**. So the meters stalled for a quarter second at a time.
- Node's main thread was about 60% CPU. An inspector CPU profile (SIGUSR1 → CDP Profiler) showed 54% busy, dominated by
  `scanProjectsDir` (`src/engine/project-volume-sync.js`): it ran `JSON.parse(fs.readFileSync())` synchronously on
  **every** show file, 65 local (9.4 MB) plus 65 in the bridge copy (15 MB), on each `/api/project/list`.
- Request counting (wrapping `http.Server.prototype.emit` via CDP) found the caller: the owner's MacBook Firefox
  (192.168.50.163, web UI) sent `GET /api/project/list` **7.3/s** and `GET /api/settings` **7.2/s**.
- Trigger in the web client: `client/components/sources-panel-render.js` `render()` called
  `void refreshProjectMediaBar()` on every redraw while the Media tab is showing. `refreshProjectMediaBar`
  (`sources-panel-project-gather.js`) always called `refreshProjectMediaContext()`
  (`client/lib/project-media-context.js:83`), which GETs the list and then settings. Redraws happen on every state
  change, so the poll rate followed the box's activity.
- Side note, not fixed: Caspar keeps sending frozen volume values for layers that are no longer playing (ch 2 layers 10,
  111, 112 while only 2-110 [shm] played). These are stale levels, not lag.

## What was done

- `src/engine/project-head-cache.js` (new): `readProjectHead(path, stat)` returns `{name, savedAt}` of a show file and
  caches it by file identity (`mtimeMs:size:ino`). It re-parses only when the file changes, has no cache without a stat,
  is capped at 2000 entries, and lets corrupt files throw.
- `src/engine/project-volume-sync.js` `scanProjectsDir`: keeps the `statSync` result it already took for the size and
  reads heads through the cache. Quarantining corrupt files is unchanged. This is the server-side guard: no client can
  make a list call cost a full parse of every show again.
- Web client: `refreshProjectMediaBar({ fetch: false })` repaints from the cached `getProjectMediaContext()`, and
  `render()` uses it. The fetch still happens on the initial call and on `project-loaded` and
  `highascg-settings-applied` (`sources-panel.js`), the only times the context can change.

Why both halves: the client fix removes the pointless traffic, but an old tab (or any other client) could still poll.
With the server cache, a poll costs a few ms whatever the client does.

## What was verified

- `tools/smoke/smoke-wo1045-project-list-load.test.js` (curated, `offline-test-files-3.js`), 4 tests:
  - an unchanged file is parsed once;
  - a changed file is re-parsed;
  - a call without a stat does not cache;
  - a corrupt file throws;
  - `scanProjectsDir` reads through the cache;
  - `render()` no longer fetches.
  Related smokes (project-volume-sync, pipeline-hardening, WO-980 hot paths, WO-697 stick): 27/27.
  `format:check` and `check-max-file-lines` are clean.
- On the box, after `npm run build:client` and a node restart:
  - `/api/project/list` takes 52 ms cold, then 2–4 ms.
  - The WS `osc` feed over 15 s: **21 Hz, gaps p50 50 / p90 51 / max 62 ms** (before: 13.7 Hz, 105 / 269 ms).
  - Node CPU is about 40% (was about 60%).
  - The Mac's Firefox was **still on the old bundle and still polling 8.5/s** during this measurement, so the server
    cache alone restores the meters. The client fix takes effect when that tab is reloaded.
