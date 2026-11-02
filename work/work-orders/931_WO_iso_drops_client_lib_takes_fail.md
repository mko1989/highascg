# WO-931 — ISO installs have no client/lib: every look take through the API fails ("Cannot find module …/client/lib/lower-third-cg-data.js")

**Area:** os-iso, engine
**Status: DONE (02.11.26 — exclude-list smoke fails on the old list and passes on the new one; on .31 a take answered `Cannot find module` until client/lib + package.json were copied over, and takes ok after; ISO effect waits for the next build)**

## Investigation

- Found on .31 (02.11 ISO `2026-11-02_074103`) during the WO-929 follow-up round. A take sent to .31's API:
  `POST /api/scene/take-look` → `{"error":"Cannot find module '/home/casparcg/highascg/client/lib/lower-third-cg-data.js'
  imported from …/src/engine/scene-take-payload.js"}`. `ls ~/highascg/client` → no such directory.
- The server imports `client/lib/*.js` (ES modules) at runtime in ≈14 places:
  - `scene-take-payload.js` (WO-598: every take by id, which the Godot GUI uses);
  - take-look transition presets, new layer, look presets, preview push;
  - lower thirds, audio cross-screen, project assets / hardware checks;
  - the shader live session.
  `routes-scene-global-border.js` also reads `client/fixtures/global-border.txt`.
- WO-737 (24.10) fixed the same gap for **releases and drop-updates**:
  - `client/lib` + `client/package.json` became tarball members;
  - the apply script includes them.
  It did not touch the **eggs ISO lists**. `penguins-eggs-exclude-highascg-embed-server.list` still had
  `home/casparcg/highascg/client` + `client/*` (from `7a998b0f`, 20.05: "Vite build inputs — not served on playout").
- So every ISO built since server code started importing client/lib (October) boots without it. Takes, new layer and the
  other routes above fail on an ISO install until a drop-update brings client/lib.
- `client/package.json` (`"type": "module"`) is needed too: without it Node parses the files as CommonJS (WO-737's
  second finding on .4).
- A second, smaller defect: `loadClientHelpers()` in `scene-take-payload.js` cached the **rejected** import promise.
  After client/lib was copied onto .31, `/api/scene/layer-options` answered 200 (those routes import per call), but
  takes still failed until the node restarted.
- Not this WO: `tools/smoke/smoke-wo47-manifest.mjs` fails on HEAD as well (it wants a `…/dist-web` line in the embed
  list). It is not in the curated CI lists (`collect-offline-tests.js` skips it). It is stale since dist-web ships.

## What was done

- `tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list`:
  - the blanket `client` / `client/*` lines are replaced by the browser-only children: README, app.js, `*.html`, `*.css`,
    assets, assets-source, components, fonts, node_modules, styles, tools;
  - `client/lib`, `client/package.json` and `client/fixtures` ship. mksquashfs wildcards have no negation, so the list
    names what goes.
  - The fragment list (server from the exFAT drop-update) is unchanged: that payload carries client/lib since WO-737.
- `src/engine/scene-take-payload.js`: a failed helper import resets the cache, so the next take retries.
- `tools/smoke/smoke-eggs-exclude-lists.test.js`, on the WO-669 mksquashfs wildcard matcher:
  - every file in `client/lib`, `client/package.json` and the global-border fixture ship on the embed ISO;
  - `client/node_modules`, `assets`, `components`, `index.html`, `styles.css` and `app.js` stay off.

## What was VERIFIED

- Smoke: 43/43 with the new list. With the old list the WO-931 case fails (42 pass / 1 fail).
- On .31:
  - `client/lib` + `client/package.json` + `client/fixtures` copied over (tar over ssh, 243 lib files), node restarted;
  - the follower take then answered `ok` and logged `skip local PGM AMCP ch=2 (leader fan-out drives air)`, as designed;
  - `/api/scene/layer-options` and `/api/scene/effect-registry`: 200.
- ISO: the next build carries the change. Check it on the clone with `ls ~/highascg/client` (expect `fixtures lib
  package.json`).
