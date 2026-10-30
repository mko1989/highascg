# client/tools — sweep 29.10.2026 (batch 020)

Files: 57 · lines: 6504 · findings: 1 BUG-HIGH, 8 BUG, 23 DEAD, 11 RISK, 27 QUALITY

Context: `client/tools/` holds the Electron launcher (`npm run launcher` = `npx electron --no-sandbox client/tools/electron-launcher`,
package.json:36), the stick/release helpers and a legacy "to-server" hand-off kit from the old client/server split (WO-52). The
launcher is a dev/prep tool, not on the playout path, so severities are relative to that tool: `BUG-HIGH` = the tool does not work on
its normal path.

## client/tools/electron-launcher/index.html
- `BUG-HIGH` client/tools/electron-launcher/index.html:107 — the Partitioning tab section uses typographic quotes: `<section class=”tab-pane” id=”tab-partition” data-partial=”partials/tab-partition.html”>` (bytes `e2 80 9d` = U+201D, confirmed with `xxd`). HTML does not treat U+201D as a quote, so the values become unquoted tokens that include the curly quotes: `id` = `”tab-partition”`, `class` = `”tab-pane”`, `data-partial` = `”partials/tab-partition.html”`. Failing case: start the launcher → renderer.js:35 `injectLauncherPartials()` iterates `[data-partial]`; the first (`tab-flash`) loads, the second runs `fs.readFileSync(path.join(__dirname, '”partials/tab-partition.html”'))` (renderer-partials.js:11) → ENOENT thrown, uncaught, so renderer.js stops before `initRendererNav/Stick/Sim/OptionalModules/Guides` (renderer.js:36-40). Result: no tab switching, Start/Stop Simulation and Open Web UI buttons are dead, no module list. Even without the throw the section would never get `.tab-pane` or the id `tab-partition` that renderer-nav.js:29 matches. Fix: replace the three `”` pairs with ASCII `"`.
- `QUALITY` client/tools/electron-launcher/index.html:8-10 — the launcher is advertised for offline/shop use but pulls Google Fonts (JetBrains Mono, Outfit) at start; `Outfit` is never referenced (font stack is `Rewir`/system-ui, launcher-00-base.css:49) and `JetBrains Mono` only applies while online. Drop the `<link>` lines or ship the fonts.

## client/tools/electron-launcher/launcher-modules-prefs.js
- `BUG` client/tools/electron-launcher/launcher-modules-prefs.js:5 — `REGISTRY_PATH = path.join(__dirname, '../../lib/optional-modules-registry.json')` resolves to `client/lib/…` only in the repo. In a packaged launcher (`build-launcher-packages.sh`) `__dirname` is the app folder and `../../lib/…` is outside it; `sync-launcher-bundle.sh:14-27` copies only `webui-port.cjs/.json` and the two sim `.cjs` files into the bundle, never the registry (`rg -n "optional-modules-registry" client/tools scripts` → only this file). Failing case: packaged app → `loadRegistry()` logs "Could not read registry" and returns `[]` → `get-optional-modules` yields an empty registry, `/api/modules` (main-static-server.js:43-48) returns no modules, and `open-cg-studio` (main-cg-studio.js:51) answers "Enable CG Overlay Studio in the Modules tab first" forever because `cg-studio` can never be enabled. Fix: copy the JSON in sync-launcher-bundle.sh and look for `lib/optional-modules-registry.json` first (same bundled-then-dev lookup main.js:18-24 uses for webui-port).

## client/tools/electron-launcher/lib-paths.js
- `DEAD` client/tools/electron-launcher/lib-paths.js:1-34 — whole file. grep: `rg -n "lib-paths" --glob '!work/**' --glob '!node_modules' --glob '!docs/**' .` → no hit; `getRepoRoot`/`resolveDistWeb`/`LAUNCHER_DIR`/`REPO_ROOT` are re-derived in main.js:16,34,49 instead. Not in any html/package.json `main`, no string-built require.

## client/tools/electron-launcher/main-cg-studio.js
- `OK`

## client/tools/electron-launcher/main-sim.js
- `BUG` client/tools/electron-launcher/main-sim.js:30-38 — the SIGKILL escalation can never fire, and can hit the wrong process. `cleanupSimulation()` sends SIGINT, schedules `setTimeout(() => { if (simProcess) simProcess.kill('SIGKILL') }, 1000)` and then sets `simProcess = null` on line 38, synchronously. Failing case A: the wrapper ignores/lingers on SIGINT → one second later `simProcess` is `null`, nothing is killed, the process stays alive. Failing case B: Stop, then Start within one second → the timer sees the NEW `simProcess` and SIGKILLs the freshly started simulator. Fix: capture `const p = simProcess` before nulling and kill `p`.
- `BUG` client/tools/electron-launcher/main-sim.js:99-108 — the `exit` handler of an old child unconditionally runs `simProcess = null` and sends `sim-status {running:false}`. Failing case: Stop (sets `simProcess = null`, UI re-enables Start at once, renderer-sim.js:249) → Start immediately (new child tracked) → the old child's `exit` event arrives (the sim shuts down gracefully, takes seconds) → `simProcess = null` for the new child: it is no longer tracked (Stop does nothing, `cleanupSimulation` on window close skips it, a second Start spawns a duplicate), and the UI is told it stopped. Fix: compare `if (simProcess === child) simProcess = null` and only message for the current child.
- `QUALITY` client/tools/electron-launcher/main-sim.js:42 — `getMainWindow()` is read once per `start-sim`; after the window is closed and re-created (macOS `activate`) stdout/exit callbacks of a running sim keep writing to the old destroyed window object (`mainWindow.webContents.send` on a destroyed window throws). Call `getMainWindow()` inside each callback and check `isDestroyed()`.

## client/tools/electron-launcher/main-static-server.js
- `RISK` client/tools/electron-launcher/main-static-server.js:221 — `server.listen(port, '0.0.0.0')` plus an unauthenticated reverse proxy for `/api`, `/vendor`, `/template(s)` and the `/api/ws` upgrade (:50-92,161-209) to `webuiApiOrigin`. Any machine on the LAN can use the launcher PC as a proxy to the target, including a simulator or server that is deliberately bound to 127.0.0.1. Bind to 127.0.0.1 unless a LAN-open UI is intended.
- `RISK` client/tools/electron-launcher/main-static-server.js:97-102 — containment check `filePath.startsWith(distWebPath)` has no trailing separator: with `distWebPath=/x/dist-web`, request `/../dist-web-old/index.html` → `path.join` gives `/x/dist-web-old/index.html`, passes the check and is served. Needs a sibling folder with that prefix to exist; use `path.relative` or `distWebPath + path.sep`. Also `url.parse(req.url).pathname` is not percent-decoded, so files with encoded characters fall through to index.html.
- `QUALITY` client/tools/electron-launcher/main-static-server.js:56-63,172-177 — an https `getApiOrigin()` is silently handled as plain http (`http.request`/`net.connect`, `targetUrl.port || 80`), and an IPv6 origin keeps its brackets in `hostname`. Also `enabledIds = getEnabledModuleIds()` (:41) is computed for every request including proxied ones.

## client/tools/electron-launcher/main-usb.js
- `DEAD` client/tools/electron-launcher/main-usb.js:146 — export `execFileAsync` is unused outside the file (`rg -n "execFileAsync" client/tools` → only this file; main.js imports `createUsbProbe` only).
- `QUALITY` client/tools/electron-launcher/main-usb.js:16-45 — on Windows every probe spawns 24 `cmd.exe /c vol X:` processes with a 400 ms timeout; the renderer polls every 8 s (renderer-stick.js:94) while the Flash/Partition tabs are open. A slow disk (spun-down USB, network drive) times out and reports "not mounted". Use `wmic`/PowerShell `Get-Volume` once.

## client/tools/electron-launcher/main-window.js
- `RISK` client/tools/electron-launcher/main-window.js:22-26 — `nodeIntegration: true, contextIsolation: false` for the launcher window. Any HTML injected into the page runs with full Node. Today the content is local, but renderer-optional-modules.js:26-35 writes registry fields through `innerHTML` and renderer-sim.js shows child-process output; keep those on `textContent` or switch to a preload bridge.

## client/tools/electron-launcher/main.js
- `BUG` client/tools/electron-launcher/main.js:109-115 — `window-all-closed` always runs `server.close()`, but on macOS the app stays alive (`darwin` skips `app.quit()`). Failing case (owner works on a Mac): close the launcher window, click the dock icon → `activate` (:102-106) opens a new window, but the static server/proxy on `WEBUI_PORT` is closed, so "Open Web UI" and the Modules API are dead until the app is quit and restarted. Fix: close the server only inside the non-darwin branch (or on `before-quit`).
- `RISK` client/tools/electron-launcher/main.js:44-47,88-90 — `update-api-origin` stores whatever string the renderer sends as the proxy target, and `open-external-url` passes any string to `shell.openExternal` (no `http(s):` allowlist). Combined with main-window.js's nodeIntegration this is only reachable by compromised renderer code, so low, but a two-line scheme check is cheap.
- `QUALITY` client/tools/electron-launcher/main.js:92-97,109-112 — `cleanupSimulation()` / `closeCgStudioWindow()` run both from the window `closed` hook and `window-all-closed`; harmless but redundant.

## client/tools/electron-launcher/partials/tab-flash.html
- `QUALITY` client/tools/electron-launcher/partials/tab-flash.html:3,11-65 — teaches flashing the ISO with Balena Etcher. WO-466 (DONE) moved the stick procedure to Ventoy + a reserved HIGHASCGEXF partition and states "no live instruction to use Etcher … survives in the operator path"; this launcher partial was not in its survey. Following it writes the ISO over the whole stick and destroys a Ventoy layout. Update or point to docs/STICK_QUICK_START.md.

## client/tools/electron-launcher/partials/tab-partition.html
- `QUALITY` client/tools/electron-launcher/partials/tab-partition.html:5-14,143-171 — documents the retired layout: "~5 GiB hybrid ISO + 2 GiB ext4 persistence + exFAT", a fixed 6 GiB start (`START_SECTOR 12582912`, `EXFAT_START_MIB 6144`) and fdisk MBR editing. WO-466 replaced this with Ventoy's "preserve space at the end" and removed the 6 GiB rule; the macOS steps here, if followed on a Ventoy stick, add an MBR entry over the ISO area. Same stale content is behind client/tools/live-usb/macos/*.sh.
- `QUALITY` client/tools/electron-launcher/partials/tab-partition.html:292 — stray closing `</section>` (this file is injected into the existing `<section id="tab-partition">`; the end tag has no opener). Browsers ignore it; remove.

## client/tools/electron-launcher/preload-app.js
- `DEAD` client/tools/electron-launcher/preload-app.js:1-20 — whole file. grep: `rg -n "preload" client/tools/electron-launcher` (excluding this file) → none (main-window.js and main-cg-studio.js set no `preload`); `rg -n "preload-app" --glob '!work/**' .` → none. Leftover from the embedded-UI window (`highascg://app/`, still described in README.md:25 but no longer created). The `__HIGHASCG_API_ORIGIN__` consumers in client/lib/api-origin.js:73,114 also read the meta tag the static server injects.

## client/tools/electron-launcher/renderer-guides.js
- `OK`

## client/tools/electron-launcher/renderer-nav.js
- `OK`

## client/tools/electron-launcher/renderer-optional-modules.js
- `DEAD` client/tools/electron-launcher/renderer-optional-modules.js:7,43,61 — `localStorage['highascg.launcher.enabledModules']` is written twice and never read (`rg -rn "highascg.launcher.enabledModules" client` → only these lines); the authoritative store is the main-process prefs file.
- `QUALITY` client/tools/electron-launcher/renderer-optional-modules.js:26-35 — `mod.id`, `mod.label`, `mod.description` interpolated into `innerHTML` without escaping (see the nodeIntegration note in main-window.js). Values come from the repo's own registry JSON today.

## client/tools/electron-launcher/renderer-partials.js
- `QUALITY` client/tools/electron-launcher/renderer-partials.js:6-13 — `readFileSync` inside `forEach` with no try/catch: one bad `data-partial` path aborts the whole renderer bootstrap (this is what turns the index.html:107 typo into a dead launcher). Catch per partial and render an error note in that pane.

## client/tools/electron-launcher/renderer-port.js
- `QUALITY` client/tools/electron-launcher/renderer-port.js:6-17 — re-implements the "bundled `lib/` first, then `../../lib`" lookup that main.js:18-26 (`requireLauncherModule`) already has; the two can drift. Fetch the port over IPC from main instead.

## client/tools/electron-launcher/renderer-sim.js
- `QUALITY` client/tools/electron-launcher/renderer-sim.js:98-129 — the connection dot polls `GET /api/settings` every 3 s for the lifetime of the window. `/api/settings` is a large payload and is auth-gated when `security.enforceAuth` is on, whereas `GET /api/ping` is explicitly auth-exempt (src/server/auth.js:173). With auth enforced the dot shows "Disconnected" for a healthy server. Use `/api/ping`.
- `QUALITY` client/tools/electron-launcher/renderer-sim.js:134-154 — `appendLog` appends to a single text node forever (`terminalOutput.textContent += text`), no cap. A chatty simulator (HTTP/OSC log lines) grows the DOM text without bound and every append re-copies it. Keep the last N KB.
- `QUALITY` client/tools/electron-launcher/renderer-sim.js:285-291 — `document.getElementById('btn-open-github').addEventListener(…)` and `btn-open-logs` have no null guard while every other element in the file does; a markup change would throw and skip the rest of the init chain. Also `btn-open-logs` says "Open logs directory" but opens the GitHub commits page.
- `DEAD` client/tools/electron-launcher/renderer-sim.js:242 — `ctx.isSimRunning` is written here and declared in renderer.js:30 but never read (`rg -n isSimRunning client/tools` → those two places).

## client/tools/electron-launcher/renderer-stick.js
- `DEAD` client/tools/electron-launcher/renderer-stick.js:10-13,23-50,56-72 — the whole "checklist" branch targets `#check-usb`, `#check-usb-details`, `#check-payload`, `#check-payload-details`, which exist in no html/partial (`rg -n "check-usb|check-payload" client/tools/electron-launcher --glob '*.html'` → none; index.html/partials checked). Every `if (checkUsb)` is false, so only the sidebar label code (:19-21,52-54) does anything. The matching CSS is dead too (launcher-04).

## client/tools/electron-launcher/renderer.js
- `QUALITY` client/tools/electron-launcher/renderer.js:28-33 — `ctx.isSimRunning` and `ctx.switchTab` (renderer-nav.js:46) are never consumed; `ctx` is documented as the module contract (:16-17) but two of its members are dead. See renderer-sim.js.

## client/tools/electron-launcher/style.css
- `OK`

## client/tools/electron-launcher/styles/launcher-00-base.css
- `BUG` client/tools/electron-launcher/styles/launcher-00-base.css:6-7 — `@font-face` URLs `fonts/Rewir-Light.woff|ttf` are relative to THIS stylesheet, i.e. `styles/fonts/…`, which does not exist (`ls client/tools/electron-launcher/styles/fonts` → no such directory; the fonts are in `electron-launcher/fonts/`). Broke when the CSS was split into `styles/` (style.css:2). The Rewir face therefore never loads and the whole launcher falls back to system-ui. Fix: `../fonts/Rewir-Light.woff`.

## client/tools/electron-launcher/styles/launcher-01-header.css
- `OK`

## client/tools/electron-launcher/styles/launcher-02-layout-sidebar.css
- `DEAD` client/tools/electron-launcher/styles/launcher-02-layout-sidebar.css:21-32 `.sidebar-header` / `.logo-text`, :110-112 `.status-danger` — no markup or JS string uses them (`rg -n "sidebar-header|logo-text|status-danger" client/tools/electron-launcher --glob '!*.css'` → none).

## client/tools/electron-launcher/styles/launcher-03-main-cards-buttons.css
- `OK`

## client/tools/electron-launcher/styles/launcher-04-tabs-dashboard.css
- `DEAD` client/tools/electron-launcher/styles/launcher-04-tabs-dashboard.css:27-158 — `.dashboard-grid`, `.checklist-items`, `.check-item*`, `.check-box`, `.check-details`, `.shortcut-buttons/-btn/-number/-text`, `.splash-card/-content`, `.btn-group` (~130 lines, the old dashboard tab). grep over the launcher's html, partials and js: no element carries them (`.check-box` is only queried by the dead renderer-stick.js branch). Keep `.tab-pane` (1-25).

## client/tools/electron-launcher/styles/launcher-05-flash-partition-guides.css
- `DEAD` client/tools/electron-launcher/styles/launcher-05-flash-partition-guides.css:33-36 `.guide-step-card--warning` — no user (`--info` and `--secondary` are used in tab-partition.html).

## client/tools/electron-launcher/styles/launcher-06-simulation.css
- `DEAD` client/tools/electron-launcher/styles/launcher-06-simulation.css:105-109 `.toggle-label` — no user (the sim-offline toggle markup was removed from index.html, renderer-sim.js:8 still looks up `#sim-offline`, which does not exist, so `simOfflineToggle` is always null and `offlineMode` is always `true`, renderer-sim.js:160).

## client/tools/electron-launcher/styles/launcher-07-scrollbars.css
- `OK`

## client/tools/electron-launcher/styles/launcher-08-modules.css
- `OK`

## client/tools/electron-launcher/sync-dist-web.sh
- `OK`

## client/tools/electron-launcher/sync-launcher-bundle.sh
- `QUALITY` client/tools/electron-launcher/sync-launcher-bundle.sh:14-27 — does not copy `client/lib/optional-modules-registry.json`, which launcher-modules-prefs.js:5 needs in a packaged app (this is where the BUG there is fixed). Also nothing in the repo creates `sim-server/` (build-launcher-packages.sh:42 only checks for it), so the "bundled sim" path in sim-app-root.cjs is manual-only.

## client/tools/live-usb/macos/add-highascg-exfat-mbr.sh
- `RISK` client/tools/live-usb/macos/add-highascg-exfat-mbr.sh:25-32,85-107 — the only guards are "starts with disk" and "not a slice"; there is no check that the disk is external/removable, no partition-scheme check, and no overlap check with existing MBR entries. Failing case: `sudo … disk0` (internal GPT Mac) → the 0x55AA test passes on the protective MBR, slot 1 is type 0xEE, slot 2 is free → a type-07 entry at 6144 MiB is written into the internal disk's protective MBR, then `newfs_exfat` is run on whatever slice appears (:117-134). Add `diskutil info -plist` checks (`Internal == false`, `RemovableMedia`/`Ejectable`), refuse GPT, and refuse when the new range overlaps an existing entry.
- `QUALITY` client/tools/live-usb/macos/add-highascg-exfat-mbr.sh:12,57 — default start `6144` MiB is the retired 6 GiB offset (WO-466). :127 prints `/dev/r${SLICE}` inside the branch where `SLICE` is empty, i.e. the hint is `/dev/r`.

## client/tools/live-usb/macos/calc-exfat-mbr-sectors.sh
- `QUALITY` client/tools/live-usb/macos/calc-exfat-mbr-sectors.sh:18 — default `EXFAT_START_MIB=6144` (retired 6 GiB offset, WO-466); otherwise correct (end = total/512-1).

## client/tools/live-usb/macos/make-highascg-stick.sh
- `RISK` client/tools/live-usb/macos/make-highascg-stick.sh:92-135 — destructive `dd` onto any `diskN` the user types; `disk0`/`disk1` (internal) are accepted. The three YES prompts are the only protection. Add an `Internal == false` check from `diskutil info -plist` before the first prompt.
- `QUALITY` client/tools/live-usb/macos/make-highascg-stick.sh:5-6 — usage text names `tools/eggs/live-usb/macos/make-highascg-stick.sh`, which does not exist (`ls tools/eggs/live-usb/macos` → no such directory); the script lives here. Also :134-136 teaches the plain `dd`+addPartition flow that WO-466 says destroys a Ventoy stick and its data partition; no Ventoy warning.

## client/tools/operator-desktop/highascg-operator.js
- `BUG` client/tools/operator-desktop/highascg-operator.js:17-19 — `repoRoot()` is `path.resolve(__dirname, '../..')`, which from `client/tools/operator-desktop/` is `<repo>/client`, not the repo root (the script moved from `tools/operator-desktop/`, header :7). Verified: root resolves to `/home/casparcg/highascg/client`, and the three lookups `client/tools/portable-desktop/launch-sim-from-exfat.cjs`, `client/tools/live-usb/macos/make-highascg-stick.sh`, `client/tools/live-usb/windows/make-highascg-stick.ps1` (:102,116,154) become `<repo>/client/client/tools/…`, none of which exist (`fs.existsSync` false for all three). Failing case: `node client/tools/operator-desktop/highascg-operator.js sim` → child `node` exits 1 "Cannot find module"; `prepare-stick` → `bash: …/client/client/tools/live-usb/macos/make-highascg-stick.sh: No such file`. Fix: `'../../..'`.
- `QUALITY` client/tools/operator-desktop/highascg-operator.js:36-37 — usage advertises `npm run operator-kit …`; package.json has no `operator-kit` script (`grep -n operator-kit package.json` → none).

## client/tools/optimize-brand-assets.sh
- `OK`

## client/tools/portable-desktop/launch-sim-from-exfat.cjs
- `BUG` client/tools/portable-desktop/launch-sim-from-exfat.cjs:267-285 — wrapper can hang after the child died by signal. `child.on('exit')` re-raises with `process.kill(process.pid, signal)`, but `process.on('SIGINT'|'SIGTERM')` handlers are installed (:277-285), so the re-raised signal is caught and swallowed (the handler just calls `child.kill` on a dead child). Failing case: the Electron launcher stops the sim (`simProcess.kill('SIGINT')`, main-sim.js:30) or the user sends SIGTERM while `index.js` is still loading (its SIGINT/SIGTERM handlers are installed at the very end of `main()`, index.js:424) → child dies by signal → exit event with `signal='SIGTERM'` → wrapper stays alive forever with no child and no log. In the launcher this is the process main-sim tracks, and the SIGKILL fallback there is broken (main-sim.js:30-38). Fix: `process.removeAllListeners(sig)` (or `process.exit(128+n)`) before re-raising.
- `QUALITY` client/tools/portable-desktop/launch-sim-from-exfat.cjs:26,157 — `spawn` is imported at the top and shadowed by a second `const { spawn } = require('child_process')` inside `openBrowser`.

## client/tools/portable-desktop/sim-app-root.cjs
- `DEAD` client/tools/portable-desktop/sim-app-root.cjs:392-397 — exports `DEFAULT_LABEL`, `SIM_SERVER_DIRNAME`, `bundledSimServerDir`, `resolveExfatVolumeRoot` are never imported elsewhere (`rg -n "bundledSimServerDir|resolveExfatVolumeRoot|DEFAULT_LABEL|SIM_SERVER_DIRNAME" --glob '!work/**' --glob '!docs/**' .` → only this file). Internal use only; trim the export list.
- `QUALITY` client/tools/portable-desktop/sim-app-root.cjs:377 vs :203-218 — help text says the tree needs "index.js + node_modules" but `isServerAppRoot` checks only `index.js`; the node_modules check happens later in launch-sim-from-exfat.cjs:195 and main-sim.js:133. Also the volume lookup duplicates main-usb.js:47-118.

## client/tools/release/build-launcher-packages.sh
- `QUALITY` client/tools/release/build-launcher-packages.sh:25-31 — the REQUIRED list does not include the optional-modules registry, so a launcher zip without a working Modules tab passes the check (see launcher-modules-prefs.js:5). Add it once sync-launcher-bundle.sh copies it.

## client/tools/release/make-github-release-client.sh
- `QUALITY` client/tools/release/make-github-release-client.sh:5-6 — usage advertises `npm run release:github-client[:dry]`; package.json has only the `release:github-server*` scripts (`grep -n "release:github" package.json`), so the documented entry points fail. `usage()` (:23) also uses `head -n -1`, GNU only, on a script meant for macOS too.

## client/tools/release/make-github-release-launcher.sh
- `QUALITY` client/tools/release/make-github-release-launcher.sh:124 — notes table prints `${bn#HighAsCG-Launcher-}` where `bn` is `HighAsCG-Launcher-darwin-arm64_2026-…Z.zip`, so the "Platform" column reads `darwin-arm64_2026-10-29T130000Z.zip`. Also :5 advertises `npm run release:github-launcher`, which does not exist.

## client/tools/release/release-lib.sh
- `OK`

## client/tools/stick-tools/stick-studio-priv.sh
- `RISK` client/tools/stick-tools/stick-studio-priv.sh:3-7,16-17 — run through `pkexec` from a user-writable repo path (stick_studio.py:22,34) and it `source`s `tools/eggs/live-usb/flash-stick-common.sh` and runs `add-exfat-data-partition.sh` from the same tree. Anyone who can write the repo (or a Syncthing peer) gets root on the next Stick Studio run. Acceptable on a single-owner box; do not install a polkit rule for this path.

## client/tools/stick-tools/stick_studio.py
- `RISK` client/tools/stick-tools/stick_studio.py:38-52,126-135 — `list_usb_disks()` delegates to `list_flash_candidates`, which falls back to ALL whole disks when no USB/removable drive exists (tools/eggs/live-usb/flash-stick-common.sh:51-59; the warning goes to stderr, which this GUI does not show). The combobox pre-selects index 0 (`current(0)`). Failing case: no stick plugged in → the box's system disk is the first entry; ticking "Erase stick" and confirming runs `dd` on it (`run_dd_flash` has no root/mounted-disk guard, flash-stick-common.sh:336-361). Filter to `TRAN=usb|RM=1` and exclude the disk holding `/`.
- `RISK` client/tools/stick-tools/stick_studio.py:258-273 — the exFAT step repartitions the selected disk (`--fill-disk` allowed) without any confirmation dialog; only the `dd` step asks.
- `QUALITY` client/tools/stick-tools/stick_studio.py:45 — `f"source {common_sh.as_posix()} …"` interpolates the path unquoted into `bash -lc`; a repo path with spaces breaks the disk list silently. Line 120 duplicates `self.filedialog = filedialog` (already set at :101).

## client/tools/to-server/apply-to-server.sh
- `DEAD` client/tools/to-server/apply-to-server.sh:1-43 — the whole `client/tools/to-server/` directory (this script, prepare-to-server.sh, push-dist-web.sh, README/MANIFEST/WO52 docs, `server-patches/`) is the WO-52 client→server hand-off kit from the split-repo era; docs/PLAN_SERVER_CLIENT_SPLIT.md marks that model superseded by the unified repo. grep: `rg -n "to-server|to_server|server-patches|push-dist-web|sync-dist-web-from-client" --glob '!work/**' --glob '!docs/**' --glob '!client/tools/to-server/**' .` → only `eslint.config.js:133` (a globs entry) and doc comments in client/lib (`@see to_server/…`); package.json has no `to-server:prepare|apply` or `deploy:client` script although MANIFEST.txt and the headers cite them. The live deploy tooling is `scripts/deploy/dev-push.sh` and `scripts/lib/archive-common.sh`.
- `RISK` client/tools/to-server/apply-to-server.sh:31-36 — `rsync -a --delete dist-web/` then `rsync -a server/ "$SERVER_ROOT/"`: pointed at THIS repo it would overwrite live files with the stale copies in `server-patches/` (they differ from the live ones: `src/repo-paths.js`, `src/server/headless-mode.js`, `scripts/write-highascg-systemd-unit.sh`, `tools/release/make-github-release-server.sh`), including the pre-WO-687 release script. :15 also defaults to a directory `../not-needed` that does not exist (leftover of a bulk rename of "server" to "not-needed", same in push-dist-web.sh:12,34-36 and client/tools/README.md:14).

## client/tools/to-server/prepare-to-server.sh
- `BUG` client/tools/to-server/prepare-to-server.sh:48 — `date -u +%Y-%m-%dT%H%M:%SZ` has the colon misplaced (`%H%M:%S`), producing `2026-10-29T1330:45Z`, an invalid ISO timestamp written to `build-stamp.json` (the other scripts use `%H%M%SZ`).
- `DEAD` client/tools/to-server/prepare-to-server.sh:1-76 — part of the unreachable to-server kit (see apply-to-server.sh); copies `README.md`, `WO52_SERVER_HANDOFF.md`, `AGENT_SERVER_CLIENT_MERGE.md`, `RESTORE_AFTER_BAD_DEPLOY.md`, `MANIFEST.txt` into a gitignored `to_server/`.

## client/tools/to-server/push-dist-web.sh
- `DEAD` client/tools/to-server/push-dist-web.sh:1-47 — advertises `npm run deploy:client` (no such script). The `not-needed/client-scripts/dev-push.sh` branch (:34-41) can never run (`ls not-needed` → no such directory), leaving the plain rsync to the hard-coded default host `192.168.0.2`.

## client/tools/to-server/server-patches/client-scripts/dev-push-full-server.sh
- `DEAD` client/tools/to-server/server-patches/client-scripts/dev-push-full-server.sh:1-131 — a "wipe the remote tree" deploy template meant to be copied to a server repo's `client-scripts/`; unreachable here (it is a template to be copied into a server repo's `client-scripts/`; `ROOT` would be `server-patches/` itself). Supported replacement: scripts/deploy/dev-push.sh. It also takes `DEPLOY_SSH_PASSWORD`/`DEPLOY_SUDO_PASSWORD` from env and puts them on command lines (`sshpass -p`, :70; `printf '%s\n' '<pw>' | sudo -S` over ssh, :103).

## client/tools/to-server/server-patches/client-scripts/dev-push.sh
- `DEAD` client/tools/to-server/server-patches/client-scripts/dev-push.sh:1-90 — same unreachable template (superseded by scripts/deploy/dev-push.sh).
- `QUALITY` client/tools/to-server/server-patches/client-scripts/dev-push.sh:71 — `RSYNC_SSH="sshpass -p ${DEPLOY_SSH_PASSWORD} ssh"` splits on whitespace (a password with a space breaks) and exposes the password in `ps`; `sshpass -e` with `SSHPASS` is the safe form.

## client/tools/to-server/server-patches/client-scripts/sync-dist-web-from-client.sh
- `DEAD` client/tools/to-server/server-patches/client-scripts/sync-dist-web-from-client.sh:1-75 — syncs dist-web from a sibling `highascg-client` checkout; in the unified repo there is no sibling and `${SERVER_ROOT}/..` is not a client root (:39-44 mention `not-needed/`).

## client/tools/to-server/server-patches/scripts/archive-common.sh
- `DEAD` client/tools/to-server/server-patches/scripts/archive-common.sh:1-158 — stale copy of what became `scripts/lib/archive-common.sh`.
- `RISK` client/tools/to-server/server-patches/scripts/archive-common.sh:28-31,38-68 — its member list ships `config` with only `./casparcg.config` and `./highascg.config.json` excluded; the live `scripts/lib/archive-common.sh:114-128` adds the WO-687 excludes for `config/certs`, `device-identity.json`, `replication-local-identity.json`, `tailscale.json`, `audio_capture.json`, etc. (the 10.2026 public releases leaked an ed25519 device key and TLS key). If this file were ever dropped back over the live one, releases leak again.

## client/tools/to-server/server-patches/scripts/highascg-exfat-server-update.sh
- `DEAD` client/tools/to-server/server-patches/scripts/highascg-exfat-server-update.sh:1-181 — superseded by `scripts/exfat/highascg-exfat-server-update.sh` (live) and `scripts/deprecated/highascg-exfat-server-update.sh`. Not referenced by any unit file here.

## client/tools/to-server/server-patches/scripts/write-highascg-systemd-unit.sh
- `DEAD` client/tools/to-server/server-patches/scripts/write-highascg-systemd-unit.sh:1-101 — differs from the live `scripts/write-highascg-systemd-unit.sh` (diff is the whole file); applying it would rewrite the service unit with an older template.

## client/tools/to-server/server-patches/src/repo-paths.js
- `DEAD` client/tools/to-server/server-patches/src/repo-paths.js:1-27 — behaviourally identical copy of `src/repo-paths.js` (only comments/indent differ). Nothing requires it (`rg -n "server-patches" --glob '*.js' .` → none).

## client/tools/to-server/server-patches/src/server/headless-mode.js
- `DEAD` client/tools/to-server/server-patches/src/server/headless-mode.js:1-15 — behaviourally identical copy of `src/server/headless-mode.js`; unreferenced.

## client/tools/to-server/server-patches/tools/release/make-github-release-server.sh
- `DEAD` client/tools/to-server/server-patches/tools/release/make-github-release-server.sh:1-142 — stale copy of `tools/release/make-github-release-server.sh`, which since gained `--no-bump-package`, `--latest`, starter zips, Godot clients and BUILD_STAMP. The stale copy's tarball members include the whole `config/` tree (via its archive-common.sh) — see the RISK note above.
