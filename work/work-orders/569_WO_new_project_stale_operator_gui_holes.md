**Status: IMPLEMENTED (2026-09-10, offline suite 2406/0/2, syntax-checked, prettier pre-existing-only) — needs `highascg` service restart + owner on-hardware confirmation**

## Investigation

`work/work-orders/todos10.09.26`: "had a problem where when i created a new project while being
in the looks tab of the operator gui, the cut out shapes of the previous setup just stayed there
and did not hide when i changed tabs."

`POST /api/project/new` → `createNewProject()` ([new-project.js](../../src/engine/new-project.js))
never touched the operator-GUI compose layout at all — it resets scene deck, hardware config, and
explicitly clears the **multiview** layout (`clearPersistedMultiviewLayout`), but had no equivalent
for the operator-GUI **compose** surface (the Looks tab's video holes).

Root cause is a channel-renumbering race, not a missing withdrawal call:
[routing-map.js](../../src/config/routing-map.js) allocates the operator_gui channel
**dynamically**, after `programChannels`/multiview (`nextCh` climbs through both before
`operatorGuiChannels.push(allocCh())`). A New Project resets destinations to the factory starter
(one `operator_gui` dest, zero PGM) — `buildStarterHardwareConfig` → `applyHardwareConfigToCtx`,
which mutates `ctx.config` **in place** via `Object.assign`. That shrinks or grows
`programChannels`, which shifts every later allocation including `operatorGuiCh`.

Any clear/withdraw issued **after** that reset resolves against the NEW channel
(`resolveOperatorGuiChannel(ctx.config)` re-reads `ctx.config` fresh every call — see
[operator-gui-channel-geometry.js:34-41](../../src/system/operator-gui-channel-geometry.js)). The
OLD channel's route layers (10-49) and shape-overlay rects are left applied with nothing that will
ever target them again — not even a later tab switch, since the client's own withdrawal
(`DELETE /api/operator-gui/layout`) also resolves the channel fresh at call time and hits the same
NEW, unrelated channel. That is exactly "stayed there... did not hide when i changed tabs."

A second, adjacent gap: `_doApplyOperatorGuiLayout`'s clear path deliberately never persists an
**empty** cell set (documented "a live reconnect blip must not wipe the saved arrangement"), so the
old project's non-empty `operatorGuiLayout` persisted entry would survive a New Project untouched —
a later Caspar reconnect (`ensureOperatorGuiChannel`) could reapply the OLD project's compose
layout onto whichever channel the NEW project's `operator_gui` destination resolves to, since
`shouldReapplyPersistedLayout` only vetoes a channel it has a recorded client intent for.

## What was done

[new-project.js](../../src/engine/new-project.js), `createNewProject()`: added a block at the very
top, before `buildStarterHardwareConfig`/`applyHardwareConfigToCtx` run, mirroring the DELETE
`/api/operator-gui/layout` handler's own pair
([routes-operator-gui.js:88-91](../../src/api/routes-operator-gui.js)):

- `noteClientLayoutReport(ctx, [])` — records an explicit withdrawal for the **current** (about to
  be stale) channel, so `shouldReapplyPersistedLayout` vetoes ever re-lighting it on reconnect.
- `clearOperatorGuiLayout(ctx)` (fire-and-forget, `.catch()`-guarded like the existing
  `ensureLiveAudioRouting` call further down) — stops route layers 10-49, `MIXER CLEAR`s them, and
  feeds the shape helper an empty rect set.
- `persistence.remove('operatorGuiLayout')` — closes the "never persist empty" gap above; a New
  Project is exactly the case that SHOULD wipe the saved arrangement, same as
  `clearPersistedMultiviewLayout`'s unconditional `persistence.remove('multiviewLayout')` a few
  lines later in the same function.

The key correctness property: `resolveOperatorGuiChannel()` resolves **synchronously** against
`ctx.config` the instant it's called — calling this block before `applyHardwareConfigToCtx` mutates
`ctx.config` in place captures the OLD channel number as a plain value; the actual AMCP STOP/MIXER
CLEAR calls happen async afterward, unaffected by the later config mutation.

Not touched: the equivalent gap for multiview (`clearPersistedMultiviewLayout` only wipes
persistence, never stops live route/FILL layers on the old multiview channel either) — same shape
of bug, but not what the owner reported, and multiview's crossfade/route model is different enough
to warrant its own look rather than a bolt-on here.

## What was verified

- New smoke test in `tools/smoke/smoke-new-project.test.js`: builds an OLD config with an
  `operator_gui` destination among two PGM destinations (resolves to channel 3), calls
  `createNewProject`, confirms the fresh project's `operator_gui` destination resolves to a
  **different** channel (1) — proving the fixture actually exercises a renumber, not a no-op — then
  asserts the persisted `operatorGuiLayout` was cleared and `shouldReapplyPersistedLayout` vetoes
  reapplying the old cells onto the OLD channel number.
- `node --test tools/smoke/smoke-new-project.test.js tools/smoke/smoke-fresh-box-clean-device-view.test.js` — 3/3 (first file) + existing suite, all pass.
- `node tools/ci/run-offline-tests.js` — **2406 pass / 0 fail / 2 skip** (full suite).
- `node --check` on both touched files — syntactically valid.
- `check-max-file-lines.js` — neither touched file near the cap; the one file over
  (`scene-take-lbg.js`, 522) is pre-existing and unrelated.
- Not yet verified live: needs `kill -TERM $(systemctl show -p MainPID --value highascg)`, then on
  hardware: configure an operator monitor + some Looks-tab compose holes, click New Project from the
  Looks tab, confirm the holes close immediately (not just on next tab switch).
