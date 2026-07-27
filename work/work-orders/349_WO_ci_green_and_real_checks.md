# WO-349 — CI: make `verify` green again + real contributor checks

**Status: DONE (2026-07-27)** · Source: todos27.07.26 ("each time i do git push origin main i get
mail from github that some action failed" + "implement some actual github actions that do some
real checks wheter everything works. especialy when there will be others contributing.")

## Why every push failed

The `verify` job had been red since e0e66cf (July 21). Root causes, all fixed:

1. **smoke-wo315-nodm-canvas-decision** (the original breaker): `needsNodmRestartForLayout` never
   threaded the injected `opts.xrDetailed.displays` into `plannedHeadsFromLayout`, so
   `resolveSysIdToXrandrOutput` consulted the **live box's xrandr**. On the box the mock DP-4 head
   fuzzy-collapsed into a live sibling (planned canvas 3456 ≠ 6912); on GitHub runners there is no
   X at all. Fix: `plannedHeadsFromLayout(layout, { inventory, config, displays: opts.xrDetailed?.displays })`
   in src/utils/xrandr-layout-verify.js. Production unchanged (no xrDetailed → live path).
2. **ESLint 159 errors**: the kiosk profile `.operator-firefox-profile/**` (prefs.js `user_pref`)
   was linted — added to eslint.config.js IGNORES. 0 errors now.
3. **Repo integrity false-positives**: four smokes asserted `require('./x')` strings verbatim,
   which the integrity checker greps as unresolved requires — applied the concat pattern
   (`"require(" + "'./x')"`) per repo convention (WO-222/243/160b/196 smokes).
4. **11 June `*.sync-conflict-*` JSONs** in projects/ tripped the integrity sweep — deleted.
5. **Prettier**: tools/ci/check-script-paths.js reformatted.
6. **Stale grep contracts** (broken by this week's work, repointed):
   - smoke-shape-overlay-input-dead → new adjacency contract (strip BELOW / pin ABOVE on the
     client, `stacking_gap` gap-or-inversion watchdog, raise-pair heal; commit 809a809).
   - smoke-wo326 forceStretch → predicate gained the `isShaderTpl` term and wrapped; the
     aspectLocked unlock rule is unchanged (superset match).
7. **Node 20 deprecation warning**: setup-node bumped to '24' (matches the box).

## Real checks added (.github/workflows/ci.yml)

- **File size limit**: tools/ci/check-max-file-lines.js was written but wired nowhere — now a CI
  step. Its off-by-one (counted the empty tail after the final newline) fixed; the four files
  sitting at 501–503 lines trimmed back under 500 via docblock compaction only (no code changes):
  operator-gui-channel, tile-controller, ws-server, caspar-restart.
- **build-client job**: dist-web/ is untracked, so nothing proved a contributor's client/ change
  still builds — new parallel job runs `npm run build:client` and asserts a non-trivial bundle.
- **Concurrency**: superseded PR runs auto-cancel (main never cancels).

## Verification

Local run of every CI step: integrity 0, boot 0, lint 0 (737 warnings), format 0,
test:ci 1530 tests / 0 fail (2 Xvfb-skips), max-file-lines 0, build:client 0 + 28 MB bundle.

## Left open

- 737 lint warnings — ratchet later, not a gate yet.
- config/ + template/shaders/ runtime diffs (owner's shader-library saves, deleted sh-ext/sh-ios)
  left uncommitted for owner review.
