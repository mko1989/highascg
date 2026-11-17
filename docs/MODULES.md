# Optional modules (Previs / Tracking / Auto-follow / CG Studio)

HighAsCG ships with a small set of optional feature modules that can be enabled or deleted independently of the base server. The packaging rules below are the ones enforced by [WO-30](../work/30_WO_PREVIS_TRACKING_MODULE.md); everything in the Previs / Tracking / Stage Auto-follow WOs (17 / 19 / 31) is built on top of them.

**CG Studio** (WO-32) is served **in-process by the playout server** through the module registry — UI at `/cg-studio/`, API under `/api/cg-studio`, enabled by default — see [src/cg-studio/README.md](../src/cg-studio/README.md) and the section below.

Acceptance test for the "lean build": delete the module directories listed below and the base server must still boot normally.

## Directory layout

```
src/
├── module-registry.js          ← core
├── api/
│   └── routes-modules.js       ← core (GET /api/modules)
├── previs/                     ← optional module (delete to remove)
│   └── register.js
├── tracking/                   ← optional module (delete to remove)
│   └── register.js
└── autofollow/                 ← optional module (delete to remove)
    └── register.js
└── cg-studio/                  ← optional module (delete to remove)
    └── register.js

web/
├── lib/optional-modules.js     ← core loader
└── components/
    ├── previs-*.js             ← optional (delete to remove)
    ├── tracking-*.js           ← optional (delete to remove)
    └── autofollow-*.js         ← optional (delete to remove)
```

Core code must never `require('./previs/...')`, `require('./tracking/...')`, `require('./autofollow/...')` or statically `import` from `client/components/{previs,tracking,autofollow}-*.js`. Every entry into a module goes through the registry.

## Enabling the module

Either set the environment variable:

```bash
HIGHASCG_PREVIS=1 node index.js
```

…or flip the runtime config:

```json
{
  "features": {
    "previs3d": true
  }
}
```

When the flag is off, `index.js` logs a single "Previs/tracking module disabled" line and skips the `tryLoad` calls entirely. Nothing from `src/previs/`, `src/tracking/`, or `src/autofollow/` is touched.

When the flag is on, `index.js` calls `moduleRegistry.tryLoad('previs' | 'tracking' | 'autofollow')`. Each `tryLoad` swallows `MODULE_NOT_FOUND` and descriptor-level errors, so an incomplete or half-deleted install degrades gracefully: the other modules still load.

## Installing optional dependencies

The heavy native/runtime deps are marked `optionalDependencies` so a base install never pays for them:

| Package     | Purpose                    | Size on disk |
|-------------|----------------------------|--------------|
| `three`     | WebGL2 scene for 3D previs | ~2 MB JS     |
| `naudiodon` | PortAudio device capture   | native addon |

Browser-only deps for Previs (`three`) live in optionalDependencies. CG Studio ships as vanilla static files under `src/cg-studio/public/` (no GrapesJS, no client build). `onnxruntime-node` (WO-19 person tracking) will be added when that module ships — not in the base server install.

Two install scripts:

```bash
# Lean: skip optional deps (recommended for playout servers)
npm run install:base

# Full: include optional deps (three, naudiodon)
npm run install:previs
```

`npm install --include=optional` is also fine; `install:previs` is a thin alias that keeps the intent visible in shell history / CI logs.

## Registration API

Each module exports a descriptor from `src/<name>/register.js`. All fields except `name` are optional.

```js
// src/previs/register.js  (example)
module.exports = {
  name: 'previs',

  // Called once after the WebSocket server is up and appCtx._wsBroadcast is wired.
  onBoot(ctx) { /* start workers, subscribe to WS, seed state, … */ },

  // Called on SIGINT / SIGTERM before HTTP close.
  async onShutdown() { /* stop workers, release GPU handles, … */ },

  // Any incoming HTTP path matching one of these prefixes is dispatched to handleApi.
  apiPathPrefixes: ['/api/previs'],

  // Signature: ({ method, path, body, ctx, req, query }) => response | null
  handleApi: async ({ method, path, body, ctx }) => { /* … */ },

  // WebSocket event name prefixes this module broadcasts on. Purely informational
  // (exposed through GET /api/modules). The registry does not enforce them.
  wsNamespaces: ['previs:'],

  // URLs served by the core web server. The web client dynamically imports each
  // bundle and, if it has a default export, awaits default(sharedContext).
  webBundles: ['/assets/modules/previs/entry.js'],
  webStyles:  ['/assets/modules/previs/previs.css'],
}
```

The web client fetches `GET /api/modules` during `init()` and forwards a shared context (`{ stateStore, ws, api, sceneState, settingsState, streamState }`) to each module's default export. A module that only extends the server-side API does not need a web bundle at all.

## `GET /api/modules`

```jsonc
{
  "enabled":      ["previs", "tracking", "autofollow"],
  "bundles":      ["/assets/modules/previs/entry.js", "…"],
  "styles":       ["/assets/modules/previs/previs.css"],
  "wsNamespaces": ["previs:", "tracking:", "autofollow:"],
  // WO-1076: every installed external module (see "External modules" below)
  "available": [
    { "name": "rc-game", "title": "RC car game", "version": "1.0.0", "description": "…",
      "source": "installed",            // "repo" (modules/<name>, dev checkout) | "installed" (~/.highascg/modules)
      "enabled": true, "loaded": true, "requiresCore": ">=2026.11.01", "compatible": true, "error": null }
  ]
}
```

Always returns `200` — empty arrays when no modules are registered.

## WebSocket namespaces

Reserved event prefixes (see individual WOs for payload shapes):

| Prefix        | Owner       | Example events                         |
|---------------|-------------|----------------------------------------|
| `previs:`     | WO-17       | `previs:scene`, `previs:camera`        |
| `tracking:`   | WO-19       | `tracking:persons`, `tracking:stats`   |
| `autofollow:` | WO-31       | `autofollow:device`, `autofollow:state`|

Core code never broadcasts on these prefixes. If a module is deleted, the prefix simply goes silent.

## Stage coordinate system

Shared reference frame used by all three modules so data can flow between them (tracking → auto-follow; previs floor plane; device calibration) without per-module conversions.

- Units: metres.
- Handedness: right-handed.
- Axes, relative to the operator standing in the audience looking at the stage:
  - `+X` → **stage right** (audience-left; positive to the operator's left when facing the stage is a common pitfall — we mirror this once at the UI level and never in the data).
  - `+Y` → **upstage** (away from the audience).
  - `+Z` → **up** (vertical, gravity-opposite).
- Origin: user-defined during calibration. The calibration wizard picks a visible mark (centre of downstage edge is the recommended default) and fits the transform from there.
- Z = 0 is the stage floor. Ceiling-mounted devices have positive Z; traps / pit lifts have negative Z.

Positions emitted on the wire (`tracking:persons[].stagePosition`, `autofollow:device[].position`, etc.) all obey this frame. The Previs 3D scene renders with the same axes so no conversion is needed when aiming a tracked person at a modelled device.

## Deletion checklist

To remove the entire optional-module stack:

```bash
rm -rf src/previs src/tracking src/autofollow
rm -f  client/components/previs-*.js client/components/tracking-*.js client/components/autofollow-*.js
rm -rf web/assets/modules
# Optional — shrink the lockfile:
npm uninstall three onnxruntime-node
```

Then boot. `GET /api/modules` returns `{ enabled: [] }`, the web client logs `loaded: [—]`, and the base app runs untouched.

## CG Studio (server-hosted module)

CG Studio runs **in-process on the playout server**. `src/cg-studio/register.js` mounts it through the module registry: static UI at `/cg-studio/index.html` (+ `/studio-assets/`), API under `/api/cg-studio`, and a workspace tab in the operator UI. It is **enabled by default** (WO-265); opt out with `features.cgStudio: false` in config or `HIGHASCG_CG_STUDIO=0` in the environment. The simulator (`node index.js --no-caspar`) serves the same module, so simulation gets CG Studio for free.

**Standalone dev mode** for module development still exists: `npm run cg-studio` (`scripts/cg-studio-run.js`) runs the studio on its own HTTP server, port **4300** (`cgStudio.httpPort`).


The **operator UI** (dashboard, scenes, device view) is always **`client/`** in this repo → `dist-web/` on playout `:4200`.

Exported templates land in `template/studio/` on the server and appear in `GET /api/lower-thirds/templates` after playout picks up the files.

## External modules — opt-in, installed separately (WO-1076)

The in-tree modules above ship inside every server release. An **external module** is a feature that is *not* part of
the base release: the box gets it only when the operator installs it, and it runs only while enabled. First consumer:
the RC car game (WO-1074) as `modules/rc-game`. Code: `src/module-host/` (loader, manifest, state, installer, tar
reader, live static mounts); every hook is dispatched by `src/module-registry.js`, so core never `require`s module code.

### Where modules live

| Kind | Directory | Written by |
|------|-----------|------------|
| `repo` (dev checkout) | `<repo>/modules/<name>/` | you (git / Syncthing); the server never writes here |
| `installed` | `~/.highascg/modules/<name>/` | `POST /api/modules/install` |

A module is **installed** when its directory holds a valid `module.json`. When both kinds hold the same name, the repo
copy wins (`shadowsInstalled: true` in `available`). It is **enabled** when `~/.highascg/modules.json` says so:

```json
{ "rc-game": { "enabled": true } }
```

No entry → the manifest's `defaultEnabled` (false unless set: opt-in). The flag lives next to the installs on purpose:
not in `config/` (the settings POST rebuilds config from a hand-listed `newConfig`, and a section missing there silently
reverts) and not in the synced repo (Syncthing peers would revert server writes). Installed-but-disabled modules are
never `require`d. Overrides (tests, sandboxes): `HIGHASCG_MODULES_REPO_DIR`, `HIGHASCG_MODULES_DIR`,
`HIGHASCG_MODULES_STATE_FILE`; under `node --test` all three default to a private temp dir.

### `module.json`

```jsonc
{
  "name": "rc-game",               // required; [a-z0-9][a-z0-9_-]*; must equal the directory name; not an in-tree name
  "version": "1.0.0",              // required
  "title": "RC car game",          // optional (default: name)
  "description": "…",              // optional
  "main": "register.js",           // optional; relative .js path inside the module
  "requiresCore": ">=2026.11.01",  // optional; space-separated comparators (>= > <= < =), all must hold; bare = minimum
  "defaultEnabled": false          // optional
}
```

Versions compare as dotted numbers (every digit run is a component), so the core's `package.json` version
(`2026.05.20`) and release `BUILD_STAMP` (`2026-11-11_114936`) both work. An incompatible module is listed with an
`error` and never loaded or installed.

### `main`: descriptor or factory

`main` exports a descriptor (the same shape as the in-tree ones) or a **factory** `(host) => descriptor`. Use the
factory: an installed copy lives outside the repo and cannot reach core files or core npm packages by relative
`require`. `host` is frozen:

| Field | |
|-------|-|
| `host.requireCore('src/api/response')` | a core file (only under `src/`) |
| `host.requireCore('ws')` | a package from the core's `node_modules` (`ws`, `three`, …) |
| `host.coreRoot`, `host.moduleDir`, `host.name`, `host.version`, `host.coreVersion` | paths / versions |
| `host.log(level, msg)` | prefixed `[module:<name>]` |

Module files that need core deep inside should take `requireCore` from a small module-local holder set by the factory
(e.g. `lib/host.js`), never `require('../../src/…')`.

### Descriptor hooks (all optional except `name`)

```js
module.exports = (host) => ({
  name: 'rc-game',                                    // = module.json name
  apiPathPrefixes: ['/api/game/rc'],                  // REQUIRED for any API hook; /api/<seg>…; core families refused
  registerRoutes(routes) {                            // a private RouteRegistry (same API as src/api/route-registry.js)
    routes.get('/api/game/rc/scene.glb', ({ req, query, ctx }) => ({ status: 200, headers: { 'Content-Type': 'model/gltf-binary' }, body: buffer }), { requireCaspar: false })
  },
  handleApi: async ({ method, path, body, ctx, req, query }) => null, // catch-all after registerRoutes
  publicPaths: (method, path) => method === 'GET' && path === '/api/game/rc/state', // no API password
  onHttpServer(httpServer, ctx) {                     // own `upgrade` listener = a WS path of its own
    httpServer.on('upgrade', onUpgrade)               // ignore paths that are not yours (others are listening too)
    return { close() { httpServer.removeListener('upgrade', onUpgrade) } }
  },
  handleStatic: async ({ method, path, search, req }) => null,        // non-API paths, before the operator UI
  staticMounts: { '/game/rc/': path.join(host.moduleDir, 'client'),   // served live (enable/disable)
                  '/vendor/three/build/': path.join(host.coreRoot, 'node_modules', 'three', 'build') },
  wsNamespaces: ['rc:'], handleWs(msg, { ws, ctx }) {},               // as for in-tree modules (main /api/ws socket)
  onBoot(ctx) {}, async onShutdown() {},
})
```

Rules the registry / loader enforce:

- API: requests reach `registerRoutes` / `handleApi` only under `apiPathPrefixes`, after auth, before core routes.
  Prefixes under `/api/modules`, `/api/plugins`, `/api/auth`, `/api/settings`, `/api/config`, `/api/system`, `/api/ws`,
  `/api/ping`, `/api/cluster`, `/api/replication` are refused (the module does not load). Bodies arrive as the raw
  string; responses may be Buffers with any headers (gzip: set `Content-Encoding` yourself).
- `publicPaths` is consulted by `src/server/auth.js` only for paths under the module's own `apiPathPrefixes` — a
  module cannot open a core route.
- `onHttpServer` runs when the module registers (or when index.js hands the server over, for modules loaded at boot);
  `close()` runs when it unregisters. An upgrade nobody claims is left unanswered (as for any unknown path).
- `staticMounts` of external modules are served per request (GET/HEAD, no `..`, real path must stay inside the mount,
  listed file types only, `/prefix` → 302 `/prefix/`, `/prefix/` → `index.html`); prefixes under `/api/`, `/assets/`,
  `/instance/`, `/templates/` and `/` itself are refused. `handleStatic` is unconstrained code: keep it to your paths.
- Enable at runtime = require + register (+ `onHttpServer`) + `onBoot`; disable = `onShutdown` + unregister (+ `close()`)
  + the module's files dropped from the require cache. Routes, public paths, the WS path and static files stop
  answering at once; no server restart. A browser already showing the module's page keeps it until reloaded.

### API (bodies are JSON; every POST needs the password or the box itself — see below)

| Call | Body | Effect |
|------|------|--------|
| `GET /api/modules` | | as above, `available` lists installed modules |
| `POST /api/modules/enable` | `{ "name" }` | load + boot now, remember enabled; 404 not installed, 409 load/boot failed (not remembered) |
| `POST /api/modules/disable` | `{ "name" }` | shutdown + unregister now, remember disabled |
| `POST /api/modules/install` | `{ "path" \| "url", "sha256"?, "name"?, "enable"? }` | unpack to `~/.highascg/modules/<name>/`, enable unless `enable: false` |
| `POST /api/modules/uninstall` | `{ "name" }` | disable, then remove the installed copy (never a repo `modules/<name>`) |

Every reply carries `ok`, `error` / `code` on failure and the fresh `available` list.

**Install is code execution.** An enabled module runs in-process with the server's rights, so `install` is as
powerful as `/api/system/update/apply`. The four POSTs (and `POST /api/tracking/runtime/install` / `import`, which put
the person-detection runtime on the box) therefore answer only when (WO-1106 B1, `src/module-host/code-change-gate.js`):

- API auth is enforced and the request carries the password, or
- the request comes from the box itself: a loopback socket with no proxy header and a loopback `Host` / `Origin`
  (`src/api/box-local-request.js`; the on-box Godot client qualifies, a page rendered by Caspar's CEF does not).

Anything else gets **403** "Turn on API auth in Settings ▸ System, or do this on the box itself." With auth off (the
factory default) a phone or laptop on the network can list modules but not install, enable, disable or remove one.

What the installer checks before writing a byte (`src/module-host/module-install.js`):

- source: an absolute path to a `.tgz` / `.tar.gz` regular file (USB stick), or an `https://` URL (redirects only to
  https, 60 s idle timeout, 10 min for the whole download); packed ≤ 64 MB
- `sha256` (hex, or a `sha256sum` line): **required for a URL** (a `.sha256` next to the download comes from the same
  server, so it vouches for nothing — copy the hash from the release page; refused with `SHA256_REQUIRED` otherwise).
  A local file is checked against the body `sha256`, else against a `<package>.sha256` sidecar next to it when there is
  one; a mismatch refuses. The reply says `sha256Source` (`caller` / `sidecar` / `none`) and `sha256Verified`, which is
  true only for `caller` (WO-1106 B8).
- archive: regular files and directories only (symlinks, hard links, devices refused), no absolute / `..` / `.` /
  backslash / control-character names, ≤ 256 MB unpacked (gzip bomb), ≤ 5000 entries, duplicate entries refused
- layout: exactly one top-level directory `<name>/` holding a valid `module.json` whose `name` is that directory (and
  the body's `name`, when given); not an in-tree module name; compatible with this core; no repo `modules/<name>`
- unpacked into `~/.highascg/modules/.staging-*` with exclusive creates, swapped in by rename; an upgrade unloads the
  running copy first and keeps it as `.old-*` until the new version is enabled. When the new version does not start
  (or the swap fails) the previous copy is put back and started again, and the reply is `ok: false`, `code: ENABLE`,
  `rolledBack: true` (WO-1106 B7).

### Packaging

```bash
node tools/release/make-module-tarball.js rc-game          # → dist/modules/highascg-module-rc-game-<version>.tgz + .sha256
node tools/release/make-module-tarball.js rc-game --out /media/stick
```

The tarball is exactly what the installer accepts (it round-trips through the installer's reader), reproducible (fixed
owner and mtime), and refuses symlinks in the module tree (`node_modules/.bin` is skipped). The base server release
(`tools/release/make-github-release-server.sh`) never carries `modules/`: it is not a release member, and the script
fails if a tarball contains one. Publishing module tarballs to GitHub releases is not wired into CI.

ISO / eggs note (not changed by WO-1076): `tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list` would
need `home/casparcg/highascg/modules(/*)`, `home/casparcg/.highascg/modules(/*)` and `home/casparcg/.highascg/modules.json`
for an ISO to stay base-only.

### Tests

`tools/smoke/smoke-wo1076-modules-runtime.test.js` and `…-install.test.js` (curated) drive the fixture module
`tools/smoke/fixtures/modules/echo-fixture/` — one of every hook — against a sandbox HTTP server.
