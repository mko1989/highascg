# WO-383 — Devices page rendered a TypeError instead of its contents (my regression), + a gate for the class

**Status: 🟡 Implemented 29.07.26 (fixed, deployed, 8/8 destination cards render live; suite 1690/0/2) — owner: confirm the page**

Owner, 2026-07-29:
> "on the devices page i have cant access lexical declaration p before init"
> …then, after a hard refresh: "i tried hard refreshing and nothing. still this error instead of the
> actual device view contents"

**This was mine**, introduced the same day in `20641b9` (WO-381's badge rework).

---

## 1. Investigation

### 1a. What I got wrong first

I could not reproduce it: I loaded the Devices page in headless Chrome and in headless Firefox
(WebDriver BiDi, so Firefox's own console), clicked through the view toggles, the `+` control and
every node, and saw **no console errors**. I sampled the pane's text — but only the first 120
characters, which is the toolbar. The destinations section simply was not there, and I read
"no errors" as "renders fine". The throw is swallowed upstream, so an empty console proves nothing
here. Sampling the *toolbar* to conclude the *page* rendered was the mistake.

### 1b. The actual defect

`client/components/device-view-destinations-ui.js`, in the per-destination loop:

```js
const hostCh = d?.casparChannel ?? intent?.pgmChannel ?? null     // line 162
…
const intent = intentItems.find((x) => …) || null                 // line 186 — 24 lines LATER
```

`intent` is a `const` in the same block, so reading it at 162 is a temporal-dead-zone access:
Firefox says *"can't access lexical declaration 'intent' before initialization"* (the owner's `p`
is the minified name). It throws on the first card whose `d.casparChannel` is unset, killing the
whole destinations render — hence the error **instead of** the contents.

Why it only bit now: the pre-existing code had the same `?? intent?.pgmChannel` term, but **inside
the `isHost ? … : …` ternary branch**. `??` short-circuits, and every host channel has a
`casparChannel`, so `intent` was never evaluated; screen destinations took the other branch
entirely. WO-381 hoisted the expression to an unconditional `const hostCh = …` so it now ran for
**every** destination — and a PGM/PRV card has no `casparChannel`, so it fell through to `intent`.
This box has four such cards, which is why the page died for the owner and not in any test.

### 1c. Static scan found a second, pre-existing one

An acorn-based scan for the same shape across `client/` found exactly one other:
`client/components/scenes-compose.js` — inside the multi-source drop handler, reads of the row's
`layer` at lines 351/354 (`routeLayerDropAllowed`, `isLayerSourceExchange`) sat above a
`const layer = updated?.layers?.[realIdx]` **in the same block**, which shadows the enclosing
loop's `const layer = sorted[ord]` for the entire block. Dropping more than one source onto a
layer therefore threw instead of dropping. Not reported by the owner; found by the gate.

## 2. What was done

- `device-view-destinations-ui.js` — `intent` is resolved *before* the `??` chain that can reach
  it; the later duplicate declaration removed. Comment records why the order is load-bearing.
- `scenes-compose.js` — the inner binding renamed to `updatedLayer`, so the reads above resolve to
  the row's `layer` as intended.
- `tools/ci/check-tdz-reads.js` (new) — flags an identifier read in **straight-line** code that
  precedes its `const`/`let`/`class` in the same scope. Forward references from inside nested
  functions are legal and ignored; that distinction is what keeps it quiet enough to gate on (the
  naive version reported ~40 false positives in `client/`). Wired into
  `tools/ci/run-offline-tests.js` next to the dom-escape duplicate check.
- `tools/smoke/smoke-wo383-tdz-gate.test.js` (new, in the curated list) — 6 tests.

## 3. What was VERIFIED

- **The gate catches the real thing**: a test reproduces the exact hoisted-`??` shape and the
  shadowed-`layer` shape and asserts both are flagged; two more assert silence on legal forward
  references (callbacks, `setTimeout`, function declarations) and on ordinary code. Run against the
  tree it reports clean, and it *did* report both defects before they were fixed.
- **Live, in Firefox** (headless, BiDi, against the running box), after the fix:
  `{"destinationCards":8,"hostCards":4,"subtitles":["OPG · 1920x1080@50","PGM/PRV · 1920x1080@50","PGM · 1920x1080@50","PGM/PRV · 1920x1080@50","HOST · ch 7","HOST · ch 8","HOST · ch 9 (planned)","HOST · ch 8"]}`
  — the four screen-destination cards that used to kill the render are present, and no page errors
  (two pre-existing `[gpu-layout]` warnings only). Note `HOST · ch 9 (planned)` — WO-381's badge
  correctly flagging a host channel the running Caspar does not have yet.
- **Suite**: 1690 pass / 0 fail / 2 skip, with the new gate running as a CI step.
- Client rebuilt, kiosk reloaded.

## 4. Lesson recorded

"No console errors" is not evidence a page rendered — an exception inside a render can be caught
upstream and leave a blank section. Assert on the DOM the feature is supposed to produce (card
counts, text), which is what the live check above now does.
