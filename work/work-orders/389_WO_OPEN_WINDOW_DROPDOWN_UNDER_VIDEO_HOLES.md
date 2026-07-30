# WO-389 — "Open window" dropdown hides under the compose preview windows

**Status: DONE (2026-07-30, offline suite 1719/0, client build clean; owner QA pending — needs kiosk reload)**
**Source:** owner 30.07.26 — "the open window drop down 'hides' under the compose preview windows"

## 1. Investigation

### 1.1 It is not a z-index problem

The menu already carries the highest z-index in the operator header
(`client/components/header-bar-operator-helper.js:73` — `z-index: 9000`), and it is `position:
absolute` inside a `position: relative` wrapper, so nothing in CSS is stacking above it.

The compose preview tiles are **not DOM elements**. Per WO-263 (and the operator-GUI stacking model
settled 2026-07-16) the operator monitor works like this:

- the CasparCG screen consumer window sits **below** the Firefox kiosk (`_NET_WM_STATE_BELOW`) and is
  input-dead (empty X input shape),
- `tools/runtime/operator-shape-overlay.py` punches **X SHAPE holes** into the Firefox window at the
  tile rectangles, so the video below shows through.

A hole is a region *removed from the Firefox window's shape*. Pixels Firefox paints there do not
exist — they are never composited. So any HTML that overhangs a tile is simply absent, and no
z-index can change that. The dropdown "hid under" the video because the part over a tile was
literally not drawn.

### 1.2 Why the existing suppression did not cover it

`client/lib/operator-gui-interaction-suppress.js` exists for exactly this class of bug — it calls
`setInteractionSuppressed()` (which POSTs an empty rect set, withdrawing the holes) while an
occluder is on screen. Its modal detection is a `MutationObserver` on `document.body` looking for
`.modal-overlay` appearing/disappearing:

```js
_modalObserver.observe(document.body, { childList: true, subtree: true })
```

The WO-387 "Open window" menu is neither:
- it is **not** a `.modal-overlay` (it is bespoke header chrome), and
- it opens by toggling `menu.style.display` on a node that **never leaves the DOM**, so even if it
  had the class, a `childList` observer would not see it.

## 2. What was done

- **client/lib/operator-gui-interaction-suppress.js** — new keyed occluder registry
  `setOccluderOpen(key, open)`, folded into `recompute()` alongside the existing modal / pointer-drag
  / HTML5-drag latches, and cleared in `stopOperatorGuiInteractionSuppress()`.

  Keyed (not a boolean) so two overlapping panels cannot have one's close re-open the holes under the
  other.

  Chosen over widening the MutationObserver to attribute/style mutations: that would fire on every
  render across the whole app to serve one dropdown, on the machine that is running 8 Caspar
  channels. Explicit registration costs two call sites.

- **client/components/header-bar-operator-helper.js** — declares
  `setOccluderOpen('operator-app-menu', …)`: `true` on open, `false` in `closeMenu()`.

  `closeMenu()` is the single choke point for every close path — the outside-click handler
  (`:179`), `openHelper()` (`:118`), and `render()` when a helper is busy (`:105`) all route through
  it, so the latch cannot stick open and blank the video. `setOccluderOpen` is also idempotent
  (no-ops when the state is unchanged), which matters because the outside-click handler fires on
  every stray click.

## 3. What was VERIFIED

- `node tools/ci/run-offline-tests.js` → **1721 tests, 1719 pass, 0 fail, 2 skipped** (pre-existing
  `CI=1` skips).
- `npm run build:client` clean.
- Every close path traced to `closeMenu()` by inspection (grep for `closeMenu()` + the document
  click handler) — the failure mode to avoid here is a stuck occluder, which would leave the
  operator's compose tiles permanently black.
- **NOT verified on the box:** requires `DISPLAY=:0 xdotool key F5` on the kiosk to load the new
  bundle, held back because 30.07 is a show day (the AskBio summit slide is live on PGM). Owner QA:
  open the "Open window ▾" menu over a compose tile — the tiles should go black for as long as the
  menu is open, and the menu should be fully readable.

## 4. Follow-up worth considering

Any future non-modal floating panel over the operator canvas needs the same call. The cheap
alternative — give such panels a shared class and observe attributes — was rejected above on cost,
so this is a convention that has to be remembered. `setOccluderOpen`'s doc comment says so.
