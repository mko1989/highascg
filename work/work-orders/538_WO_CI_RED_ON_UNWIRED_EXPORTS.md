# WO-538 — CI red: six unwired exports, and four tests the gate was hiding

**Status: FIXED in repo (14.08.2026) — BOTH layers. Gate exits 0; suite green with AND without `dist-web/` (2266 / 2264 pass / 0 fail / 2 skip, and 2263 / 0 fail / 3 skip on a clean tree).**
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

The gate also reported **9 baseline entries no longer orphaned** and invited a shrink. That IS
purely good — the ratchet tightening in the allowed direction — and was done separately once the
red was cleared: `--update` took the baseline 688 → 679, a 10-line diff, no entries added. (Running
`--update` while the six orphans were still present would have been the forbidden move; running it
after they were fixed is the intended one.)

## 5. What was VERIFIED

- `node tools/ci/check-unwired-exports.js` → **exit 0**, "1099 files scanned — no NEW orphan exports".
- Suite **2263 / 2261 pass / 0 fail / 2 skip**; `npm run lint` 0 errors / 218 warnings (at the cap,
  unchanged — this session added none); line limit 0 over; `node index.js --no-http` boots; client
  builds.

## 6. Layer two — fixing the gate revealed four tests it had been hiding

Pushing the fix did **not** turn CI green. The workflow runs `Unwired exports` at step 47 and
`Offline tests` at step 59, and a failing step aborts the job — so while the gate was red the
offline tests **never ran at all**. Run `31810058268` on `f210561` is the first time they executed
in weeks, and four failed. This is WO-420's masking pattern again, one layer down.

All four passed locally and failed only on the runner, which is the tell.

### 6a. Three update-helper tests were reading the real installation

`scripts/exfat/highascg-webui-server-update.sh` had `DST="/home/casparcg/highascg"` **hard-coded**,
while `USER_NAME`, `APPLY_SH` and `LOG_DIR` beside it all take env overrides. `start_service` gates
on `[[ -f "${DST}/package.json" ]]`.

So the WO-499 and WO-501 harnesses, which carefully build a temp destination *and write a
`package.json` into it*, were handing that tmpdir to nobody: the helper looked at the real install
instead. On this box that file exists → `systemctl start` fires → green. On a clean machine it does
not → `NOT starting …` → `attached mode still starts (WO-499)` fails. The tmpdir was decorative and
the tests were passing for the wrong reason.

`DST` now honours `HIGHASCG_UPDATE_DEST`, the same pattern as its three neighbours, and both
harnesses pass their tmpdir. Production is untouched: `sudo`'s default `env_reset` drops `HIGHASCG_*`
on the way in, so only a direct invocation can set it. Confirmed by pointing the override at a
nonexistent path — the assertions fail exactly as CI reported.

### 6b. One test asserts on build output that the verify job never builds

`smoke-wo497 A: the real built bundles match` reads `dist-web/index.html`. `dist-web/` is gitignored
and built by the *separate* `build-client` job, so in `verify` the file cannot exist. It now skips
with a reason when the artefact is absent, rather than asserting against a file that is never there.

Verified both ways: with `dist-web/` present it runs and passes; with the directory moved aside the
whole suite is **2266 / 0 fail / 3 skip** instead of a failure.

**This does trade CI coverage for green**, and that should not pass unnoticed: the guarantee is now
enforced only where a build exists (this box, any pre-push run). Restoring it properly means running
that file in the `build-client` job after its build step — a workflow change, worth doing, not done
here because it belongs to whoever owns the CI layout.

## 7. Two things the owner should know

1. **The lint ratchet has zero headroom.** `npm run lint` reports exactly **218** warnings against a
   `--max-warnings 218` cap, so the next warning anyone adds turns CI red. The breakdown:

   | count | rule |
   |---|---|
   | 132 | `no-unused-vars` (110 "assigned but never used", 10 unused catch bindings, 12 args/vars) |
   | 80 | `no-restricted-syntax` (the WO-103 `innerHTML` escaping guard) |
   | 6 | `no-useless-assignment` |

   **A bulk burn-down would be a mistake**, and it is worth saying why rather than just doing it: the
   110 "assigned but never used" are spread over 103 files, and at least some are the *only* trace of
   an unimplemented feature. I audited the 61 with a call on the right-hand side and found one real
   fault that way — [WO-539](./539_WO_GUI_STREAM_FPS_OPTION_DOES_NOTHING.md), an operator-GUI stream
   option that is accepted, announced to the browser, and never encoded. Deleting the variable would
   have deleted the evidence.

   The genuinely signal-free subset is the unused `require`/import destructures. Clearing those buys
   real headroom at zero risk, and is the pass to do if headroom is wanted.

   Ruled out while auditing, so nobody re-checks them: the AMCP transport's unused `p`
   (`_sendAfter` — `execute` returns `p` on every path, so the destructure is merely redundant), the
   two `labelY` cases in `preview-canvas-draw-base.js` (dead setup under commented-out `fillText`),
   `publish-modal`'s discarded `await fetch` (a deliberate reachability probe whose value is not
   wanted), and `decklink-install`'s `payload` (assigned for `parseBody`'s throwing side effect).
2. **`npm run verify:repo-integrity` fails locally** on 11 Syncthing `sync-conflict` files under
   `projects/`. They are gitignored and untracked, so CI never sees them — but it means that gate
   cannot be trusted as a local pre-push check until they are cleared.

## 8. Work log

- 2026-08-14 (later) — The fix did not turn CI green: with the gate no longer aborting the job, the
  offline-test step ran for the first time in weeks and four tests failed, all runner-only. Three
  were reading the real installation through a hard-coded `DST`; one asserts on a build the verify
  job never makes. Both fixed; suite verified green with and without `dist-web/`.
- 2026-08-14 — Found while gating WO-536; confirmed red on GitHub Actions across two of the owner's
  pushes. Each of the six checked individually rather than swept: five are internal helpers with a
  redundant `export`, one is a genuine orphan superseded by direct field access. Un-exported and
  deleted respectively; the baseline was deliberately NOT rewritten.
