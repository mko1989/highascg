# WO-1076 — Installable, opt-in modules (external modules: install / enable / disable at runtime)

**Area:** engine, process
**Status: IN PROGRESS (14.11.26 — core infrastructure built, 13/13 new smokes + offline suite green; NOT on the running server (show on, no restart); the RC game is not moved yet; no GUI page)**

Owner, 14.11 (about the RC car game, WO-1074): "I hope the game is detachable. I'd like it to be an opt in module that
is installed when the user wants it."

Related: WO-30 (module boundary, `src/module-registry.js`), WO-32 / WO-265 (CG Studio: `apiPathPrefixes` +
`staticMounts`), WO-830b (plugin-store id validation), WO-1074 (the first consumer).

## Investigation

### What the module system could do before

- `src/module-registry.js` (WO-30) holds descriptors; `tryLoad(name)` only ever `require`s `./<name>/register` —
  i.e. a module had to live in `src/<name>/` and ship with every release (`scripts/lib/archive-common.sh:22`
  `archive_common_server_tar_members` packs all of `src`). There was no notion of "installed", only "enabled".
- Enabled state: `src/plugins/plugin-manager.js` (`PLUGIN_CATALOG`, `config.plugins.entries`) with runtime
  `enablePluginNow` / `disablePluginNow` behind `/api/plugins/<id>/enable|disable` (src/api/routes-plugins.js). Stored in
  the runtime config (`configManager.save`), i.e. config/ — the settings POST rebuilds config from a hand-listed
  `newConfig` (memory: "sections missing from newConfig silently revert"). External code could not be installed.
- Hooks: `apiPathPrefixes` + `handleApi({ method, path, body, ctx, req, query })` (src/api/router-dispatch.js:84, after
  auth, before the RouteRegistry) — already able to return Buffers with headers (http-server.js only Content-Length's
  them); `handleWs` for main-socket message namespaces; `staticMounts`, merged ONCE at boot into `vendorDirs`
  (src/bootstrap/modules.js `buildVendorDirs`, index.js:305) — so a mount could not appear on a runtime enable nor
  vanish on disable. No public-path hook, no HTTP-server / upgrade hook, no non-API static hook.

### How the RC game (WO-1074) is wired into core today — what a module must be able to replace

| Core site | What it does | Needed hook |
|-----------|--------------|-------------|
| `index.js:315` `require('./src/game/rc-ws').attachRcGameWs(httpServer, appCtx)` | own `upgrade` listener for `/api/game/rc/ws` (+ `/instance/<id>/…`), returns `{ close() }` | server handle + close on disable |
| `src/api/router.js:486` `require('./routes-rc-game').register(routes)` | 4 RouteRegistry routes; `scene.glb` returns a Buffer, gzip by `req` Accept-Encoding, cache by `query.rev` | routes with `req` / `query`, Buffer bodies |
| `src/server/auth.js:185` `require('../game/rc-public').isRcPublicPath(m, p)` | exact GET paths public (no password) only while the game runs | public-path hook |
| `src/server/http-server.js:18,347-349` `isRcStaticPath` / `serveRcStatic` | `/game/rc/*` from repo `game/rc/`, plus `/vendor/three/build/*` and `/vendor/three/examples/jsm/*` from node_modules/three | non-API static hook that can reach the core's node_modules |
| `src/system/video-feed.js` `tier: 'game'` | generic already | — (left alone) |

Game code requires ~15 core files (`../engine/project-scenes`, `../stage/mvr-store`, `../server/auth`,
`../repo-paths`, `../fixtures/*`, `../system/video-surfaces`, …) and core npm packages (`ws`). An installed copy under
`~/.highascg/modules/` cannot resolve any of those by relative path or by Node's `node_modules` walk.

### Constraints found

- Syncthing syncs the repo: server-written paths in it must be in `.stignore` or peers revert them — so installs and
  their state go under `~/.highascg`, not the repo.
- `.stignore` already ignores `dist` (tarball output dir) and `config/*.json`.
- Release excludes: `archive_common_server_tar_excludes` patterns without `./` match ANY path component; a blanket
  `--exclude=modules` would also drop every `node_modules/<pkg>/modules/` directory.
- ISO: `tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list` excludes `.highascg/test-env`,
  firefox profiles etc. but nothing for `modules`.
- `tools/smoke/smoke-984-resource-findings.test.js` loads `src/module-registry.js` in a vm with NO requires allowed —
  the registry must keep zero top-level requires.
- Router: `moduleRegistry.handleApi` runs before every core route (router-dispatch.js:84), so a module prefix like
  `/api/modules` would shadow core — prefixes need a reserved list. No `/api/modules/*` wildcard exists earlier in
  router.js, so explicit POST routes are safe there.

## What was done

Design: a module dir with `module.json`; installed = the dir exists (repo `modules/<name>/` dev checkout, or
`~/.highascg/modules/<name>/`); enabled = `~/.highascg/modules.json`; everything dispatched by the existing registry.

- `src/module-host/module-paths.js` — the three locations, env overrides, temp dirs under `node --test`.
- `src/module-host/module-manifest.js` — `module.json` validation (name = dir, version, title, description, safe
  relative `main`, `requiresCore` comparators, `defaultEnabled`), numeric version compare that handles calver
  `2026.05.20`, build stamps `2026-11-11_114936` and semver alike; core version = `readBuildStampFromDir(REPO_ROOT)`.
- `src/module-host/module-state.js` — `{ "<name>": { "enabled": bool } }`, atomic writes. Chosen over a config section:
  no settings-POST revert trap, no Syncthing fight, lives next to the installs.
- `src/module-host/module-loader.js` — discovery (repo shadows installed; bad manifest / name mismatch / in-tree name /
  incompatible core reported in `available`, never loaded), boot load of enabled modules only, runtime
  `enableModule` (load → register → onBoot; persisted only on success) / `disableModule` (onShutdown → unregister →
  require-cache purge), a promise lock serialising enable / disable / install / uninstall. `main` may export a factory
  `(host) => descriptor`; `host.requireCore('src/…' | '<pkg>')` resolves core files / core node_modules from anywhere.
  Descriptor checks: name = manifest name, `apiPathPrefixes` must be `/api/<seg>…` outside the reserved core families,
  `staticMounts` prefixes allowed.
- `src/module-registry.js` — new hooks: `registerRoutes(routes)` (private RouteRegistry, dispatched under
  `apiPathPrefixes`), `publicPaths(method, path)` (`isPublicPath`, honoured only under the module's own prefixes),
  `onHttpServer(server, ctx) → { close() }` (`setHttpServer`; attached on register, closed on unregister),
  `handleStatic({ method, path, search, req })` + live `staticMounts` for external modules (in-tree modules' mounts
  stay in the boot-time vendorDirs, unchanged). Still no top-level requires.
- `src/module-host/module-static.js` — live mount server (GET/HEAD, decode once, no `..`, realpath containment,
  MIME allow-list, reserved prefixes `/api/`, `/assets/`, `/instance/`, `/templates/`, `/`).
- `src/module-host/module-tar.js` — own tar.gz reader/writer (files + dirs only; links / devices refused; name
  checks; caps) — no new dependency, and every entry is inspected before anything is written.
- `src/module-host/module-fetch.js` + `module-install.js` — install from a local `.tgz` or `https` URL, sha256 (given or
  sidecar), layout / manifest / name / core / repo-collision checks, staging dir + rename swap, upgrade unloads first;
  uninstall unloads then removes (installed copies only).
- `src/api/routes-modules.js` — `available` in `GET /api/modules`; `POST /api/modules/{enable,disable,install,uninstall}`
  (registered from router.js:204; normal auth; raw JSON bodies via `parseBodyStrict`).
- Core wiring: `src/server/auth.js:186` (`moduleRegistry.isPublicPath`), `src/server/http-server.js:333-335,350`
  (`handleStatic` for non-API paths, after the login / intake / RC branches), `index.js:316`
  (`moduleRegistry.setHttpServer`), `src/bootstrap/modules.js` (`loadEnabledExternalModules` after the plugins).
- Packaging: `tools/release/make-module-tarball.js <name> [--out] [--src]` → `highascg-module-<name>-<version>.tgz` +
  sha256sum `.sha256` (reproducible, round-tripped through the installer's reader, symlinks refused).
  `tools/release/make-github-release-server.sh` now fails if the base tarball contains `modules/` (a guard instead of an
  exclude, see Constraints). Not wired into CI publishing.
- Fixture `tools/smoke/fixtures/modules/echo-fixture/` (every hook) and two curated smokes
  (`tools/ci/offline-test-files-3.js`). Docs: `docs/MODULES.md` "External modules".

### Security decisions (install)

Installing = future in-process code execution with the server's rights, so: POSTs keep normal API auth (no public
path); local source must be an absolute `.tgz`/`.tar.gz` regular file ≤ 64 MB; URLs https-only (redirects too), 60 s
timeout, streamed byte cap; sha256 checked when given or when a sidecar exists — missing sha256 is allowed (spec) but
reported as `sha256Verified: false`; archive entries are regular files / dirs only (every link type refused, so no
link can escape), no absolute / `..` / `.` / backslash / control-char names, ≤ 256 MB unpacked, ≤ 5000 entries,
duplicates refused (exclusive create); exactly one top-level dir = manifest name (= body name when given); in-tree
names and repo `modules/<name>` never overwritten; incompatible core refused; nothing outside
`~/.highascg/modules/` is ever written or removed.

### Moving the RC game into modules/rc-game (step list for the lead)

1. `git mv src/game modules/rc-game/server`, `git mv game/rc modules/rc-game/client`,
   `git mv src/api/routes-rc-game.js modules/rc-game/server/routes-rc-game.js`.
2. `modules/rc-game/module.json`: `{ "name": "rc-game", "version": "1.0.0", "title": "RC car game", "description": "…",
   "main": "register.js", "requiresCore": ">=<build stamp of the core that carries WO-1076>" }` (`defaultEnabled`
   omitted = opt-in).
3. `modules/rc-game/server/host.js`: `let h = null; exports.set = (x) => { h = x }; exports.core = (id) => h.requireCore(id)`.
   In every moved file replace core requires: `require('../engine/project-scenes')` → `core('src/engine/project-scenes')`,
   same for `../stage/*`, `../fixtures/*`, `../system/*`, `../server/*`, `../utils/*`, `../repo-paths`;
   `require('./response')` (routes file) → `core('src/api/response')`; `require('ws')` → `core('ws')`;
   `require('../game/rc-game')` → `require('./rc-game')`. Top-level `core(…)` calls are fine as long as register.js
   calls `host.set(h)` before it requires them.
4. `rc-static.js`: `REPO_ROOT` → `host.coreRoot` for `THREE`; default root `path.join(REPO_ROOT, 'game', 'rc')` →
   `path.join(__dirname, '..', 'client')`.
5. `modules/rc-game/register.js` must export:
   ```js
   module.exports = (h) => {
     require('./server/host').set(h)
     const { attachRcGameWs } = require('./server/rc-ws')
     const { serveRcStatic, isRcStaticPath } = require('./server/rc-static')
     return {
       name: 'rc-game',
       apiPathPrefixes: ['/api/game/rc'],
       registerRoutes: (routes) => require('./server/routes-rc-game').register(routes),
       publicPaths: (m, p) => require('./server/rc-public').isRcPublicPath(m, p),
       onHttpServer: (server, ctx) => attachRcGameWs(server, ctx), // already returns { close() }
       handleStatic: ({ method, path, search }) => (isRcStaticPath(path) ? serveRcStatic(path, { method, query: search }) : null),
       async onShutdown() { /* rc-game: disable the running room (game.disable()), stop its video client, clear rc-public */ },
     }
   }
   ```
   Note `/api/game/rc/ws` is under the prefix, but `/instance/<id>/api/game/rc/ws` is matched by rc-ws itself (fine).
6. Delete from core: `index.js:315` (the `attachRcGameWs` line), the `require('./routes-rc-game').register(routes);`
   call in `src/api/router.js:486` (keep the other two on that line), `src/server/auth.js:185` (the `rc-public` line),
   `src/server/http-server.js:18` (the `rc-static` import) and the `else if (isRcStaticPath(…)) { … }` branch at
   `:347-349`. After that `rg -n "game/rc-|routes-rc-game|src/game" src index.js` must be empty.
7. Repoint every `tools/smoke/smoke-wo1074-*` / `tools/smoke/lib/rc-*` require and `readFileSync` to
   `modules/rc-game/...` (concat pattern; never weaken assertions). Smokes that need the game registered can
   `moduleRegistry.register(require('../../modules/rc-game/register')(hostStub))` or enable it through the loader with
   `HIGHASCG_MODULES_REPO_DIR` pointing at the repo `modules/` (temp state file via `HIGHASCG_MODULES_STATE_FILE`).
8. `tools/dev/gen-api-contract.js` only scans `src/`: the `/api/game/rc/*` rows leave docs/wiki/api/contract/http.md
   (add `modules/` to its walk if they should stay). `check-unwired-exports.js` EXPORT_ROOTS does not include
   `modules/` either.
9. Enable on a box: `POST /api/modules/enable {"name":"rc-game"}` (repo checkout) — or package it
   (`node tools/release/make-module-tarball.js rc-game`) and `POST /api/modules/install {"path":"/media/…/highascg-module-rc-game-1.0.0.tgz"}`.
   The game's own host enable (`POST /api/game/rc/host {action:"enable"}`) stays the second level (session running).

## What was VERIFIED to work

Offline only (the show is on: no restart, :4200 untouched, no screens). Sandbox servers on random ports, temp module
dirs / state file / token file via env:

- `node --test tools/smoke/smoke-wo1076-modules-runtime.test.js` — 6/6: version compare + ranges; base server with no
  modules dirs (`available: []`, shape kept); discovery from repo + installed dirs, repo shadows installed, bad
  manifest / dir-name mismatch / in-tree name / missing manifest / incompatible core / a core-path prefix (`/api/modules`)
  reported and never loaded; an installed-but-disabled module is never required (global probe unset); boot loads only
  modules.json-enabled ones; runtime enable → registry route with `query`, Buffer reply with `req` header echo,
  handleApi with the raw body, public path answers with auth enforcement ON while other module routes 401, a
  `publicPaths` yes for `/api/settings` is ignored, WS echo on its own path, `handleStatic`, live staticMounts
  (302 / index.html / `..` refused / three.module.js from node_modules); second enable does not re-boot; disable →
  onShutdown + WS close, all of those 404 / 401 / unanswered, require cache purged; re-enable requires fresh code;
  POSTs 401 without the password, 400 on bad JSON / bad name.
- `node --test tools/smoke/smoke-wo1076-modules-install.test.js` — 7/7: tarball name / sha256 line / reproducible;
  install over HTTP from a local tarball (bad sha refused first, then verified + enabled + route answers); sidecar
  sha256 used (and a wrong one refused) on an upgrade over the running copy; https URL via injected fetch + sidecar; real
  downloader refuses `http://` and non-URLs; 14 hostile archives refused with the right code (`..`, absolute, symlink
  out / in, hard link, two top dirs, no manifest, name mismatch, bad JSON, `main` traversal, duplicate entry, in-tree
  name, incompatible core) + body name mismatch + packed / unpacked / entry-count caps (413) + repo collision — nothing
  written; uninstall disables first, removes only the installed copy, refuses a repo module; GNU / POSIX archives from
  the system `tar` read, a system-tar symlink refused.
- Gates, 14.11: `nice -n 19 node tools/ci/run-offline-tests.js` → 6459 tests, 6451 pass, **0 fail**, 5 skipped,
  3 todo (the known WO-983 / WO-986 ⚠). An earlier run had 1 fail in smoke-wo1058-ltc-alsa-pacing (real-time pacing,
  passes 4/4 twice alone, none of this code). `check-max-file-lines` 0 over; `check-unwired-exports` — no orphan in
  this WO's files (13 orphans, all in `src/game/`, WO-1074 work in progress by another session); `npm run lint`
  0 errors (176 warnings); `format:check` clean; `node index.js --no-http` boots; `gen-api-contract` +4 routes
  (`--check` clean); `verify:script-paths` OK; `check-wos` OK.
- The test-runner default dirs are path-only (the first suite run had left 48 empty `/tmp/highascg-test-modules-*`
  dirs from eager `mkdtemp`; fixed, removed, 0 after the second run). Real `~/.highascg/modules`,
  `~/.highascg/modules.json`, repo `modules/` and `dist/modules` were checked: never created.

NOT proven: a real https download (no network calls from tests); the running server (not restarted — WO-1076 is live
after the next restart, with no module installed nothing changes); the RC game as a module (step list above).

## Open

- Move the RC game (step list above) — lead, after WO-1074's current edits land.
- Godot / web settings page to list / install / enable modules (no on-screen tests were allowed now).
- ISO / eggs: add `home/casparcg/highascg/modules`, `…/modules/*`, `home/casparcg/.highascg/modules`, `…/modules/*` and
  `home/casparcg/.highascg/modules.json` to `tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list` (+ a
  verifier assertion) so ISOs stay base-only. Not edited here (ISO tooling out of scope).
- CI publishing of module tarballs to GitHub releases (script exists, not wired).
- Optional: answer unclaimed upgrades on a disabled module's WS path with 404 instead of leaving them hanging.

## The RC game moved into `modules/rc-game` (15.11.26)

- Done as the step list above: `src/game` → `modules/rc-game/server`, `game/rc` → `modules/rc-game/client`, the routes
  file into `server/`; `module.json` (no `defaultEnabled` → opt-in), `register.js`, `server/host.js` (`core(id)`:
  `host.requireCore` when loaded as a module, the checkout's `src/` when a smoke requires a server file directly).
- Core lines deleted: the `attachRcGameWs` line in index.js, the `routes-rc-game` call in src/api/router.js, the
  `rc-public` line in src/server/auth.js, the `rc-static` import and branch in src/server/http-server.js.
- CI tools now cover `modules/`: check-max-file-lines roots, check-unwired-exports (server half as export root, all of
  `modules/` as reference root), eslint server globs, gen-api-contract (the `/api/game/rc/*` rows stay in the docs).
- ISO: the five exclude lines are in `tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list`.
- **Verified (offline):** `tools/smoke/smoke-wo1076-rc-game-module.test.js` 3/3 on a real HTTP server —
  the core (src/, index.js) names nothing of the game; module present but not enabled → state/host 404, no page, no
  socket, nothing in the require cache; enable → public state `{enabled:false}`, page, `main.js`, three, socket `off`;
  disable → all gone, cache purged; `make-module-tarball rc-game` (97 entries) installed from the tarball into a modules
  dir outside the repo with the sidecar sha256 checked → the installed copy runs the same; uninstall removes it.
  All 192 wo1074 smokes pass against the new paths (two HTTP smokes register the module's own `register.js`); the
  never-on-a-screen pin now also requires every core file to be reached through `core()` (mutation-checked both ways).
- **Not verified:** the running server (not restarted, show on). After the next restart the game is OFF on this box
  until `POST /api/modules/enable {"name":"rc-game"}`.
