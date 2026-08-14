# WO-538 — CI has been red at the "Unwired exports" gate; six exports nobody imports

**Status: FIXED in repo (14.08.2026) — gate exits 0, suite 2263 / 2261 pass / 0 fail / 2 skip, boot check green.**
**Priority:** High (it fails every push, and a standing red hides the next real regression)
**Source:** found while running the gates for WO-536, then confirmed against GitHub Actions —
run `31808496051` on `5fb0adc` and the run on `85ea2ad` both failed at the same step.
**Related:** WO-367 (the gate itself), WO-420 (the last time a stacked red hid another red),
WO-492/493/506/518 (the WOs whose exports these are)

---

## 1. It really was failing, and not because of today's work

```
verify  Unwired exports  [check-unwired-exports] 6 export(s) nothing anywhere references:
verify  Unwired exports    client/lib/drag-highlight-cleanup.js: DRAG_HIGHLIGHT_CLASSES
verify  Unwired exports    client/lib/drag-highlight-cleanup.js: clearDragHighlights
verify  Unwired exports    client/lib/source-label.js: sourceLabelIsCustom
verify  Unwired exports    src/bootstrap/led-test-layer-999.js: isLedTestLayerOccupied
verify  Unwired exports    src/config/decklink-key-fill.js: resolveDecklinkPixelFormatOverride
verify  Unwired exports    src/config/source-labels.js: applySourceLabel
verify  Unwired exports  ##[error]Process completed with exit code 1
```

All six come from WOs that landed **after** `unwired-exports-baseline.json` was last written
(6 Aug) — WO-492, WO-493, WO-506, WO-518. None is from this session; every file this session
touched or created has zero orphans and zero lint warnings.

Worth stating plainly because the memory note *"CI red is never assumed local"* cuts both ways: the
gate was doing its job, nobody had read the failing step, and the owner has been pushing onto a red
main for days.

## 2. What the six actually were — checked one at a time, not assumed

The gate's message is *"wire it up or delete it"*, and WO-367's thesis is that an unwired export is
usually the **symptom of a feature that never got connected**. That is the alarming reading, and it
is worth ruling out before reaching for the un-export. It does not hold here — checked individually:

| export | reality |
|---|---|
| `DRAG_HIGHLIGHT_CLASSES` | read by `clearDragHighlights` in the same file |
| `clearDragHighlights` | called by `installDragHighlightCleanup` in the same file |
| `isLedTestLayerOccupied` | called at `led-test-layer-999.js:64` |
| `resolveDecklinkPixelFormatOverride` | called at `decklink-key-fill.js:84` |
| `applySourceLabel` | called at `source-labels.js:87` |
| `sourceLabelIsCustom` | **referenced nowhere at all — not even in its own file** |

**WO-518's feature is live** — the entry point `installDragHighlightCleanup` is imported by
`scenes-compose.js:25`. Likewise WO-493's pixel format really does reach the config generator, via
`decklinkPixelFormatXml`. So five of the six are redundant *export surface*, not dead behaviour, and
deleting the code behind them would have been wrong.

`sourceLabelIsCustom` is the one genuine orphan. It answered "did an operator name this source",
and the code that needed that answer reads the field directly instead
(`inspector-source-label.js`: `mine?.labelIsCustom`). Superseded, not missing. Deleted.

## 3. The fix

Five `export` / `module.exports` entries removed; the symbols stay exactly where they are and keep
doing their jobs as module-private helpers. One dead function deleted. No behaviour changes, and
**no test needed repointing** — an earlier grep appeared to show `smoke-wo506-source-labels.test.js`
using `applySourceLabel`, but that was the plural `applySourceLabels` matching as a substring; a
word-boundary search finds no test importing any of the six.

`drag-highlight-cleanup.js` gained a line saying why its parts are private: the file's own header
already warns *"Add new ones here, not to a second sweeper"*, and exporting the pieces is exactly
how a second sweeper gets written.

## 4. What was NOT done, deliberately

**`check-unwired-exports.js --update` was not run.** It rewrites the baseline from the current
orphan set, which would have "fixed" CI by recording all six as acceptable. The checker's own
header forbids it: *"The baseline is allowed to go down, never up: adding to it by hand is how this
gate would rot."* Baselining a gate to make it green is how it stops finding anything.

The gate still reports **9 baseline entries no longer orphaned** and invites a shrink. Left alone:
shrinking the baseline is a separate, purely-good change, but it is not this WO's subject and doing
it here would mix a real fix with 43 KB of churn.

## 5. What was VERIFIED

- `node tools/ci/check-unwired-exports.js` → **exit 0**, "1099 files scanned — no NEW orphan exports".
- Suite **2263 / 2261 pass / 0 fail / 2 skip**; `npm run lint` 0 errors / 218 warnings (at the cap,
  unchanged — this session added none); line limit 0 over; `node index.js --no-http` boots; client
  builds.

## 6. Two things the owner should know

1. **The lint ratchet has zero headroom.** `npm run lint` reports exactly **218** warnings against a
   `--max-warnings 218` cap. The next warning anyone adds turns CI red. Worth a deliberate pass to
   burn some down, or the cap becomes a tripwire rather than a ratchet.
2. **`npm run verify:repo-integrity` fails locally** on 11 Syncthing `sync-conflict` files under
   `projects/`. They are gitignored and untracked, so CI never sees them — but it means that gate
   cannot be trusted as a local pre-push check until they are cleared.

## 7. Work log

- 2026-08-14 — Found while gating WO-536; confirmed red on GitHub Actions across two of the owner's
  pushes. Each of the six checked individually rather than swept: five are internal helpers with a
  redundant `export`, one is a genuine orphan superseded by direct field access. Un-exported and
  deleted respectively; the baseline was deliberately NOT rewritten.
