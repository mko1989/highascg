# WO-927 — ISOs ship the server's previs module again (Godot Previs tab needs /api/previs/models)

**Area:** os-iso, tracking-vr
**Status: DONE (02.11.26 — exclude lists + smokes; pruned-tree sandbox serves /api/previs/*; next eggs build ships it)**

Owner, 02.11.26, on WO-926's note that ISOs exclude `src/previs`: "yes, you should ship previs."

## Investigation

- Both eggs exclude lists dropped the server module and its web bundle, an owner directive of 19.07 ("future module,
  deliberately NOT in this release"):
  `tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list:289` and
  `…-embed-server.list:256`. Four lines each: `src/previs`, `src/previs/*`, `client/assets/modules/previs`,
  `client/assets/modules/previs/*`.
- Since then the Godot client gained a Previs tab (WO-607). It loads its model list from `/api/previs/models`
  (`src/previs/routes-models.js`). On an ISO the module was missing: `[modules] skipped "previs"`, and the tab had no models.
- `src/previs` needs only declared dependencies. The `three` vendor that once rode on optionalDependencies is not
  imported by `client/assets/modules/previs/entry.js`. So the ISO's `npm prune --omit=dev --omit=optional` does not
  break it.

## What was done

- Removed the previs block from both lists. In its place is one comment line naming this WO.

## What was verified

- The 7 smokes that read the exclude lists: 73 pass / 0 fail.
- Clean worktree of HEAD, `npm ci --omit=dev --omit=optional` (the ISO's dependency set), e2e sandbox server with
  `HIGHASCG_PREVIS=1`:
  - `/api/previs/health` → 200 `{"module":"previs","status":"phase-2",…}`;
  - `/api/previs/models` → 200 `{"models":[]}`.
- The WO-926 build gate (`verify-production-boot.js`) runs on the same tree in every eggs build. That gate runs with
  previs off, so it does not cover the previs module itself.
