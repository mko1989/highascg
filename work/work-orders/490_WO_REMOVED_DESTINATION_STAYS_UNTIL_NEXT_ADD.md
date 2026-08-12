# WO-490 — Removing a screen destination leaves it on screen until the next add

**Status: DONE (12.08, code + build verified; suite 1982/1980/0, eslint clean) — owner QA owed on the live delete**

Owner 12.08: *"removing a screen destination in devices view, doesnt make the screen dest go away,
until a new one is made."*

## 1. Investigation

### 1.1 Root cause — the post-mutation reload is answered from a cache written before the mutation

Both destination-remove callbacks reloaded the view with a plain `ctx.load()`:

`client/components/device-view-render.js` (the destination body) and
`client/components/device-view-selection.js` (behind the inspector's "Remove destination" button,
`device-view-destinations-inspector-form.js:323`):

```js
removeDestination: (id) =>
    Actions.removeDestination(id).then(() => {
        state.selectedDestinationId = null
        ctx.setCasparRestartDirty(true)
        return ctx.load()          // ← no forceRefresh
    }),
```

`ctx.load()` is served from a 5 s module-level payload cache and on a hit **skips the network fetch
entirely** — `device-view-render.js`:

```js
const isCached = lastPayload && (now - lastPayloadAt) < 5000
const shouldUseCache = !forceRefresh && isCached && lastPayload
…
if (shouldUseCache) { state.lastPayload = lastPayload; ctx.renderFromState(...); return }  // no fetch
```

There is no background fetch and no later re-render on the cache-hit branch, so the pre-delete
payload is re-rendered and the row stays. The `>= 5s` branch below it *does* self-heal, which is why
the bug reads as sticky-but-intermittent — it only bites when a snapshot was fetched within the
preceding 5 s, which a click-to-select-then-delete flow guarantees.

**Why adding one "fixes" it:** the add path was already converted and forces a refetch
(`device-view-events.js`, `ctx.load({ forceRefresh: true })` with a comment describing this exact
trap). Any forced load repopulates the cache from the server, and the deleted destination — long
gone server-side — finally disappears.

This is a known defect class fixed too narrowly before: **WO-276** (stale inspector read-back),
**WO-278**, and **WO-480** (filed under [WO-478](./478_WO_DEVICE_VIEW_FOUR_UI_DEFECTS.md), "the view
does not always refresh after adding an output") whose fix covered "all 11 post-mutation reloads
*in that file*" — `device-view-bands-render.js` only. The remove paths were never swept.

### 1.2 Refuted: the server and the config generator are correct

The obvious hypothesis — an additive apply that never removes a stale screen consumer — is **false**
for GPU screen consumers. Regenerating the Caspar XML from the live modular config with and without
a destination shows `applyDestinationOverridesToScreens` recomputes `screen_count` from the
surviving destinations (`src/config/build-caspar-generator-config-screens.js:78-80`) and
`normalizeScreenDestinations` → `compactMainScreenIndices` (`src/config/screen-destinations.js:238`,
`:178-227`) re-ranks indices densely. Removing a destination correctly drops `screen_count 2 → 1`,
clears `screen_2_screen_consumer`, and reduces the `<screen>` consumer count 3 → 2. The handler
itself (`src/api/device-view-crud.js:223-236`) filters, prunes the graph and persists both.

### 1.3 Second defect found in the same path (NOT fixed here — see §4)

`forceRefresh` did not bust the **browser's** HTTP cache. `GET /api/device-view` answers
`Cache-Control: private, max-age=3`; `loadDeviceView` supports `bustCache`
(`client/components/device-view-actions.js:9-20`) but the only call site passing it sat *inside* the
`if (!forceRefresh && …)` stale branch, so it was always `false`, and the real forced-fetch path
passed no `bustCache` at all. `bustCache` was dead code everywhere. Fixed here (§2) — without it a
forced reload issued within 3 s of the DELETE could still be handed a pre-change response.

### 1.4 Genuine additive leak — physical outputs only (NOT fixed, see §4)

`applyDestinationOutputEdgesToCasparConfig` (`src/api/device-view-apply.js:18-24`) seeds
`nextCaspar = { ...ctx.config.casparServer }` and only *writes* keys for destinations that still have
edges — it never clears `screen_N_decklink_device` / `_key_device` / `_replace_screen` for a deleted
destination, and neither does `handleRemoveDestination`. The generator only releases a device when
some **other** target claims it (`build-caspar-generator-config-decklink.js:63-97`, WO-275
`releaseDecklinkDeviceFromOtherTargets`). Combined with index compaction: with
`screen_1_decklink_device = 3` owned by the index-0 destination, deleting that destination makes the
surviving PGM 2 compact into `screen_1` and **inherit** the dead binding — the regenerated XML still
emits `<decklink><device>3</device></decklink>`, now under the wrong channel, until DeckLink 3 is
claimed by a new binding. Also "until a new one is made", but a different mechanism and a config
mutation on a live playout box, so it is left for an owner decision.

## 2. What was done

Converted every genuinely post-mutation `ctx.load()` in Device View to `ctx.load({ forceRefresh: true })`
— 12 call sites, all reloads that follow a server-side commit:

| file | sites |
|---|---|
| `device-view-render.js` | `patchDestination`, `removeDestination`, `applyPlan` |
| `device-view-selection.js` | `removeDestination` (inspector button) |
| `device-view-cable-outputs.js` | output-mapping save, DeckLink-as-destination-output, and the stream / record / audio / virtual-cam remove handlers (6) |
| `device-view-cable.js` | undo (restores graph + screenDestinations) |
| `device-view-inspector-replication-controls.js` | become-leader, connect-follower, refresh-connection, reload-local (4) |

Plus §1.3: the forced-fetch path now passes `bustCache: forceRefresh`, so a forced reload bypasses the
browser's 3 s HTTP cache as well as our 5 s payload cache.

**Deliberately left as plain `ctx.load()`** (not mutations — the cache is doing its job):
`device-view.js` initial mount, `device-view-toolbar.js` view-mode transition, and
`device-view-selection.js` focus-connector-miss.

## 3. What was VERIFIED

- `npx eslint` on all five changed files → **clean, no output**.
- Full offline gate `node tools/ci/run-offline-tests.js` → **1982 tests, 1980 pass / 0 fail / 2 skip**
  — the WO-483/489 baseline, unchanged.
- `npm run build:client`, then grepped the shipped bundle: both `removeDestination` call sites in
  `dist-web/assets/device-view-DB3i218w.js` now read
  `…setCasparRestartDirty(!0),e.load({forceRefresh:!0})` where the previous bundle had bare
  `e.load()`. Kiosk reloaded.

**NOT verified live:** deleting a real screen destination on this box mutates the Caspar config and
implies a restart, so the end-to-end delete was not exercised. The stale-render mechanism is proven
by code + bundle inspection; **owner QA: delete a screen destination and confirm the row disappears
immediately** (do it within 5 s of another Device View interaction — that is the window that used to
reproduce it).

## 4. Follow-up — §1.4 is now [WO-491](./491_WO_REMOVE_DESTINATION_LEAVES_DECKLINK_BOUND.md)

§1.4's DeckLink binding leak was split out, reproduced end-to-end and fixed under WO-491. The
diagnosis there is sharper than the sketch above: clearing the flat `screen_N_*` keys alone is NOT
sufficient, because cabling also writes a positional `connector.caspar.outputBinding` that the
generator's legacy fallback re-asserts once the edge is pruned. Both had to be released.
