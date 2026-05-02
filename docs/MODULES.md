# Optional modules (Previs / Tracking / Auto-follow)

HighAsCG ships with a small set of optional feature modules that can be enabled or deleted independently of the base server. The packaging rules below are the ones enforced by [WO-30](../work/30_WO_PREVIS_TRACKING_MODULE.md); everything in the Previs / Tracking / Stage Auto-follow WOs (17 / 19 / 31) is built on top of them.

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

web/
├── lib/optional-modules.js     ← core loader
└── components/
    ├── previs-*.js             ← optional (delete to remove)
    ├── tracking-*.js           ← optional (delete to remove)
    └── autofollow-*.js         ← optional (delete to remove)
```

Core code must never `require('./previs/...')`, `require('./tracking/...')`, `require('./autofollow/...')` or statically `import` from `web/components/{previs,tracking,autofollow}-*.js`. Every entry into a module goes through the registry.

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

| Package           | Purpose                          | Size on disk |
|-------------------|----------------------------------|--------------|
| `three`           | WebGL2 scene for 3D previs       | ~2 MB JS     |
| `onnxruntime-node`| Server-side YOLOv8-Pose inference| ~40–400 MB (CPU/GPU EPs) |

Two install scripts:

```bash
# Lean: skip three + onnxruntime-node (and any other optional dep that fails)
npm run install:base

# Full: include optional deps
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
  "wsNamespaces": ["previs:", "tracking:", "autofollow:"]
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
rm -f  web/components/previs-*.js web/components/tracking-*.js web/components/autofollow-*.js
rm -rf web/assets/modules
# Optional — shrink the lockfile:
npm uninstall three onnxruntime-node
```

Then boot. `GET /api/modules` returns `{ enabled: [] }`, the web client logs `loaded: [—]`, and the base app runs untouched.
