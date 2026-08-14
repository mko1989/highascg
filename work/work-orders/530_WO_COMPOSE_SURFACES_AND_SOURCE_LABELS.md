# WO-530 — Compose preview holds one editor's arrangement, and DeckLink labels are doubled/stale

**Status: DONE in repo (14.08.2026) — 9 smokes, suite 2209 / 2207 pass / 0 fail / 2 skip. Owner QA owed on the kiosk (§5).**
**Priority:** High (operator-GUI usability; all three hit on every session)
**Source:** owner 14.08, three reports in one message:
- *"the compose preview just 'remembers' either the settings of looks eidotr or timeline, never both at the same time."*
- *"in decklink ports inspector there are 2 input boxes for labels."*
- *"the labels then doesnt show up on the compose preview label bar."*
**Related:** [WO-529](./529_WO_COMPOSE_PREVIEW_RESETS_ON_EDITOR_SWITCH.md) (same area, different faults — the DELETE churn and the hidden-pane resize), WO-525 (whose regression (b) is), WO-323 (source tiles), WO-506 (source labels)

---

## 1. (a) The two editors share seed keys, so one arrangement overwrites the other

WO-529 fixed the *transition* between the editors. This is the *persistence*, and it is a different
mechanism — which is why the owner still saw a loss after that fix.

The looks editor and the timeline editor each own a tile canvas and report into **one** shared
server layout, tagged `surface` (`'compose'` / `'timeline'`). But the seed identity is
`operator-compose-tiles-state.js`:

```js
export function tileSeedKey(c) {
	return c.role === 'mvcell' ? `mvcell:${c.srcCh}` : `${c.role}:${c.mainIndex}`
}
```

**The surface is not part of it.** Both editors produce a `pgm` cell at `mainIndex 0`, so both
produce the key `pgm:0`. `seedHostLayoutFromCells` builds `new Map(cells.map(c => [tileSeedKey(c), c.rect]))`
over the *whole* layout — last one wins — and applies it to every tile on the canvas.

And it **persists what it seeds** (`onPersist?.()`), writing the other editor's rects into this
canvas' own localStorage key. So the loss is permanent, not transient: whichever editor last wrote
the shared layout became both editors' arrangement. Exactly *"never both at the same time"*.

Verified against the live box: the shared layout really is one list carrying `"surface":"compose"`
tags (`GET /api/operator-gui/layout`), so the discriminator was already on the wire and simply
unused.

**Fix.** `cellsForSurface(cells, surface)` filters the layout to the canvas' own surface, and both
seeders use it. `surface` is threaded `scenes-editor`/`timeline-editor` → `initPreviewPanel` →
`initOperatorComposeTiles` → the tile controller's `getSurface()`. The looks editor takes the
default `'compose'`; the timeline editor declares `'timeline'`, matching `reportTimelineCellRects`.

Untagged cells are treated as `'compose'` on purpose: that was the only surface when the layout
format was introduced, so an existing persisted record keeps restoring into the looks editor rather
than silently becoming unseedable.

## 2. (b) Two Label boxes — a WO-525 regression

`device-view-inspector-decklink-input.js` mounts the shared control itself (`:36`) **and** mounts
`mountDecklinkHostSourceControls` (`:77`), which WO-525 taught to mount its own (`inspector-decklink-host.js:68`).
Two fields, same connector id, same endpoint.

Neither mount was simply removable: the ports inspector's label must appear even when the input has
no host channel yet (the host controls are inside `if (inputEntry?.channel != null)`), and the
host-channel inspector reaches the label only through the host controls.

**Fix.** `mountDecklinkHostSourceControls` takes `includeLabel` (default `true`, so every other
caller is unchanged); the ports inspector passes `false` because it already mounted one.

## 3. (c) The compose label bar showed the name from drop time

A WO-323 source tile stores its drag payload — `{ type, value, label }` — and the tile label bar
rendered `def.label` verbatim. That is the label **captured when the source was dropped onto the
canvas**. Renaming the input never reached it.

There is a second half. A rename broadcasts only:

```js
ctx._wsBroadcast('change', { path: 'sourceLabels', value: res.sourceLabels })   // routes-sources.js
```

The enriched `extraLiveSources` (where the server has already folded the override into `label`) is
**not** re-pushed, so reading it alone would still be a reload behind.

**Fix.** `liveSourceLabelForValue(sources, value, fallback, sourceLabels)` resolves the tile's route
value against `extraLiveSources`, then lets a `sourceLabels` override win — the same resolution the
server does in `src/config/source-labels.js`, so a rename shows immediately. The stored payload
label stays the fallback, so a tile whose source has left state still reads meaningfully. The tiles
also subscribe to `sourceLabels` and relabel on the broadcast.

Confirmed against the live box: `extraLiveSources` carries `label: "Cam1"` / `"Cam2"` with
`labelIsCustom: true` and `connectorId: "dlsdi_3"` / `"dlsdi_4"` — the names were saved correctly
all along, only the label bar was reading the wrong field.

## 4. What was VERIFIED

- `tools/smoke/smoke-wo530-compose-labels-and-surfaces.test.js` — 9 tests in the curated CI list:
  the exact colliding-cell set splits by surface; untagged cells stay compose-only; both seeders
  filter and each editor declares its surface; the ports inspector mounts exactly one label while
  the host-channel inspector keeps its own; and the label resolver honours an override, ignores
  another source's override, and falls back when the source is gone.
- Suite **2209 / 2207 pass / 0 fail / 2 skip**. Lint 0 errors. Line limit clean. Client builds.
- Live-state evidence for §1 and §3 read off the running box (endpoints quoted above).

## 5. Owner QA on the kiosk

1. Arrange the tiles differently in the looks editor and the timeline editor. Switch back and forth
   — **each must keep its own arrangement**, now and after a reload.
2. Open the DeckLink ports inspector: **one** Label field.
3. Rename a DeckLink input. The compose preview's label bar for that source tile must change
   **immediately**, without a reload.

## 6. Work log

- 2026-08-14 — Three reports triaged to three independent causes: a seed key missing its surface
  discriminator (and persisting the collision), a double mount left by WO-525, and a label bar
  reading the drop-time payload instead of state. All three fixed, 9 smokes.
