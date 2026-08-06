# WO-404 — Compose preview "loses signal" during any sources-panel drag (goes black ~1 s)

**Status: DONE (06.08.26 — deploy leg complete: live since today's batch build+F5+restart. Owner QA on `work/checklist06.08.26_close_all_wos.md`.)**

Owner report (`issues_01.08.26` item 2): "when dragging a shader from the sources browser to
drop it on a list the compose preview 'looses signal' goes black for a second and then comes
back."

## Investigation

The compose tiles are X SHAPE holes punched through Firefox (WO-263); "black" = hole withdrawn,
"signal re-acquire" = the compose channel's route producers being STOPped and re-PLAYed. The
drag pays both, by design chain:

1. `client/lib/operator-gui-interaction-suppress.js:121-124` — a document-level capture-phase
   `dragstart` sets the `_htmlDrag` latch **unfiltered** (unlike `onPointerDown`, which gates on
   `PREVIEW_SURFACE_SELECTOR`). Any sources→playlist drag trips it. This part is CORRECT and
   kept: dragover/drop can never fire over a hole (outside the window shape), and template/media
   payloads have legitimate under-hole drop targets — the scenes-compose frame accepts "media or
   templates … to add a layer" (`client/components/scenes-compose.js:120-184`) and sits behind
   the WO-343 look-editor PRV hole; the mv editor accepts any payload.
2. The COST was in what suppression sent: `setInteractionSuppressed(true)` →
   `sendLayout([])` → `api.delete('/api/operator-gui/layout')`
   (`client/lib/operator-gui-mode-report.js`, old `effectiveCells()` emptied on `_suppressed`).
3. Server `_doApplyOperatorGuiLayout(ctx, ch, [])` (`src/system/operator-gui-channel.js:165-259`)
   withdraws all shape rects AND `STOP`s every route layer + `MIXER CLEAR` (`:205-216`), wiping
   the `lastAppliedRouteByChannel` cache (`:222`).
4. Restore (drag end + 300 ms `RESTORE_DEBOUNCE_MS`) re-POSTs the cells; with the route cache
   empty, `routeLive` is false for every cell → serial `PLAY route://…` + `MIXER FILL` +
   `COMMIT` per cell (`:183-221`) — a genuine producer re-acquire. Total: black for the drag
   + ~350 ms + N AMCP round-trips ⇒ exactly "loses signal for a second".
5. The cheap mechanism ALREADY EXISTED: WO-319's `suppressHoles` flag on the layout POST — the
   server keeps the route+FILL mosaic and feeds the shape overlay an empty rect set
   (`operator-gui-channel.js:172-176`, `routes-operator-gui.js` passes it through). Only the
   live-canvas toggle used it; interaction suppression didn't.

## What was done (client-only, `client/lib/operator-gui-mode-report.js`)

- `effectiveCells()` empties on the foreground-tab latch (WO-265, unchanged — CG Studio wants
  the channel torn down) but NOT on `_suppressed` any more.
- `sendLayout` folds `_suppressed` into the WO-319 flag: `suppressHoles = _composeHolesSuppressed
  || _suppressed` (host only, as before). Suppress ⇒ POST the SAME cells with holes closed —
  routes never stop. Restore ⇒ same cells, holes reopen; the route cache is intact so the apply
  is FILL/COMMIT-only and the picture is there the instant the hole is (video behind never
  stopped).
- Side effects, all improvements:
  - a mid-modal reconnect/heartbeat now re-asserts the layout WITH closed holes instead of
    re-asserting empty;
  - a REMOTE client's modal/drag now dedupes into silence instead of DELETE-ing the shared
    layout out from under the host (WO-319's stated intent);
  - repeated modal open/close no longer thrash STOP/PLAY on the compose channel at all.
- Suppression TRIGGERS unchanged: same latches, same `isInteractionSuppressed()` semantics —
  the WO-343 acceptance suite passes untouched.
- Repointed two source-assert smokes to the new contract (reason recorded inline):
  `smoke-wo265-cg-studio-tab.test.js` (effectiveCells shape + new flag assert),
  `smoke-wo256-operator-compose-tiles-wiring.test.js` ("sends immediately" kept, "sends empty"
  replaced).

Residual black during the drag itself is intentional and unavoidable under WO-343's rule (drop
targets under holes must be reachable); what's gone is the signal loss and the slow re-acquire
after the drop.

## What was VERIFIED to work

- Full offline suite: **1766 pass / 0 fail / 2 skip** (includes the WO-343 suppression state
  machine tests and the two repointed smokes).
- NOT yet verified live (no dist-web rebuild mid-show). Owner QA post-deploy: drag a shader from
  Sources over the workspace — tiles blank while the drag is held, and on drop the picture is
  back essentially instantly with NO "signal lost" re-acquire; journal shows no
  `operator-gui: PLAY … route://` burst after drags.
