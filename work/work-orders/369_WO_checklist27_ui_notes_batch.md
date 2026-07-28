# WO-369 — Checklist27 UI notes: drop the "Back to GUI" button, retune the wall clock

**Status: DONE (28.07.26 — both items shipped, built and reloaded on the kiosk; clock verified in a screenshot of the running GUI, owner sign-off on legibility owed).**

Source: `work/checklist27.07.26_manual_verify.md`, notes added by the owner on the 28th (file
saved 14:26, after the 14:02 client rebuild + kiosk reload — so both notes describe the
*current* deployed UI, not a stale bundle).

Two small, independent UI items. Batched because they touch the same header/taskbar surface and
should ship in one build + reload rather than two.

## 1. "Back to GUI" button is now redundant (checklist item 8)

Owner, ticking item 8 (WO-317/WO-352 taskbar):

> seems to work. doesnt need the back to gui button.

### Investigation

The button exists because parking a raised helper used to require an explicit action — the
original complaint (todos27) was *"when i click back to gui, the browser hides under the casparcg
screen, but after around 2s. but then i cant recall to the front the browser again."*

`98c80e3` (WO-352 follow-up, live-verified with screenshots) made **clicking anywhere on the GUI**
park every raised helper, via a `pointerdown` capture handler with the taskbar's own chrome
exempt. That is the behaviour the owner asked for in the same note batch (*"just clicking on the
gui should push the window under the caspar consumer"*), and it now covers everything the button
did — hence "doesnt need".

### What needs doing

- Remove the "Back to GUI" control from the operator header/taskbar, and the handler behind it if
  nothing else calls it.
- **Check before deleting the handler**, not after: the Companion module and any API route may
  invoke the same park action remotely. `grep -rn "back.to.gui\|backToGui\|parkAll" client/ src/ tools/eggs/companion/`
  first — if a remote caller exists, remove only the button and keep the action reachable.
- Do not weaken the `pointerdown` park path while removing the button; the smoke coverage that
  `98c80e3` added for auto-park must still pass.

### Acceptance

- No "Back to GUI" button in the operator GUI.
- Clicking the GUI still parks raised helpers; clicking a chip still raises and *keeps* the helper
  raised (the old ~2 s steal must not come back).
- Existing taskbar smokes green.

## 2. Wall clock typography (checklist item 29)

Owner, ticking item 29 (WO-355 clock, third placement):

> needs to have bigger font and be closer to the eyes, minimum padding.

### Investigation

The clock has been moved three times already — `ccbfd89` (next to the eyes), `3c739c8`
(right-aligned), `7875b40` (left of the eyes), `1d1dca0` (between the PGM progress block and the
eyes). The **position is now accepted** — the owner ticked the item. What remains is purely
typographic: font size up, horizontal padding down so it sits tight against the connection eyes.

Related precedent for the spacing target: `a6ac9f1` closed the connection-eyes gap from 21px to
6px across all 12 state variants — match that density rather than inventing a new value.

### What needs doing

- Increase the clock font size (it is currently sized to disappear; the owner wants it readable at
  a glance from the operator position).
- Reduce the padding/margin between the clock and the eyes cluster to the minimum that still reads
  as two separate elements — reuse the 6px from `a6ac9f1` unless it visually collides.
- Do not move it. The placement from `1d1dca0` is signed off; a fourth position is a regression.
- Verify against **all** eye state variants — `a6ac9f1` had to touch 12 of them, so a padding
  change here can easily look right in one state and broken in another.

### Acceptance

- Clock is legible from normal operating distance; owner confirms on the glass.
- Gap to the eyes is tight and consistent across every connection-state variant.
- Clock stays between the PGM progress block and the eyes.

## 3. Deploy

Client-only, both items: `npm run build:client` then `DISPLAY=:0 xdotool key F5` (kiosk reload,
XTEST — `XSendEvent` F5 is dropped by Firefox).

## 4. What was DONE

### Item 8 — Back to GUI

The plan's "check before deleting" found a condition the note could not have known about: the
auto-park handler that makes the button redundant is **gated on the multi-helper taskbar flag** —
`header-bar-operator-helper.js` starts its `pointerdown` handler with `if (!_taskbarOn) return`,
and `_taskbarOn` mirrors `operatorTools.multiHelperTaskbar` (`operator-helper-live.js:33`). That
flag is `true` in this box's `config/general.json` and the live API reports
`{"enabled":true}` — but with it off (the WO-283 single-helper configuration other boxes ship
with) auto-park never runs and the button is the only way back.

So the button is **gated, not deleted**: `backBtn.style.display = busy && !_taskbarOn ? '' : 'none'`.
On this box it can never appear again; the flag-off fallback keeps its escape hatch. `refresh()`
was reordered to read taskbar state *before* `render()`, otherwise the first pass after load
would decide the gate on a stale `_taskbarOn`.

Nothing else calls the action: the only other `parkAllOpen()` callers are server-side
(`operator-helper-coordinator.js:121`, `operator-helper-live.js:150`) and stay reachable. The
auto-park path is untouched.

### Item 29 — wall clock

`client/styles/01a2-header-bar.css` `.header-wall-clock`: `12px` → **17px**, weight 600,
`line-height: 1`, colour `--text-muted` → `--text` (the note asks for legible at a glance; muted
grey at 12px was the "sized to disappear" the WO describes). `margin-right: 10px` → **-2px**,
which nets to a **6px** gap against `.header__status`'s `gap: 0.5rem` — the density `a6ac9f1`
established for the eyes cluster, reached without touching a row gap every other status child
shares. The 28px eye row is the height ceiling and 17px clears it. Placement untouched.

## 5. What was VERIFIED

- **On the glass.** Client rebuilt, kiosk reloaded (`DISPLAY=:0 xdotool key F5`, XTEST), and a
  screenshot of the running operator GUI shows the clock ticking at the new size, sitting tight
  against the connection eyes, still between the PGM progress block and the eyes
  (`… P1 | BRIDGE/291780 0:09 / 0:16 | 14:58:00 | 👀`).
- **New smoke** `tools/smoke/smoke-wo369-header-clock-and-back-button.test.js` (4 tests) in the
  curated FILES list: the button gate + the refresh ordering it depends on; the auto-park path
  that replaces it (capture-phase listener, own-chrome exemption, raised-only filter, server
  `parkAllOpen` still reachable); clock font ≥16px, effective gap ≤ the row rhythm and > 0,
  tabular numerals; and that the clock is still inserted before the eye container.
  **Note for the record:** the WO assumed "the smoke coverage that `98c80e3` added for auto-park
  must still pass" — `98c80e3` added no tests (3 files, all production). This is the first test
  of that behaviour.
- **Full offline suite: 1590 tests, 1588 pass / 0 fail / 2 skip.** Lint clean. Build OK.

**Owner QA owed:** confirm the clock is legible from the operating position, and that clicking a
chip still raises and *keeps* a helper raised (the old ~2 s steal must not be back).
