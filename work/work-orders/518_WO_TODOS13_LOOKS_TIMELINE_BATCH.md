# WO-518 — todos13 batch: drag highlight, looks↔timeline transitions, AMCP drag flood, clip copy

**Status: PARTIAL (13.08.2026). §2 the blue dashed outline — DONE, 6 smokes, suite 2133/2131/0, client rebuilt. §3–§5 — INVESTIGATED, not fixed; each says exactly how far I got.**
**Source:** owner `todos13.08.26` (new block)
**Related:** [WO-404](./404_WO_COMPOSE_PREVIEW_DRAG_BLACKOUT.md) (compose preview during drags), [WO-448](./448_WO_timeline_unrouted_until_take.md), [WO-401](./401_WO_MACHINE_PERFORMANCE_RESEARCH_PASS.md) F4 (AMCP send cost)

---

## 1. The four items

1. *"transitions between looks and timelines doesnt work correctly, either some of the layers play or nothing at all. this already happend so there should be a wo about that."*
2. *"going between looks and timelines screwes up the compose preview. also there is a weird dotted blue line around the compose preview, why???"*
3. *"changing clips position/size (on the screen) in timelines takes a while to show up on the preview screen, looks like amcp gets overrun."*
4. *"when copying a clip in timelines to another layer then dropping a different media on to it, i want it to preserve all the settings … also when the clip was 'extended' … it should preserve that too."*

## 2. The blue dashed outline — FIXED

It is `outline: dashed var(--accent)` (#58a6ff) from **`scenes-layer--drag-over`**
(`07a-scenes-compose-canvas.css:129`), added on `dragover` in `scenes-compose.js:324` and removed
only on `dragleave`.

**`dragleave` is not a reliable counterpart to `dragover`.** It does not fire when the drag is
cancelled with Esc, when the pointer leaves the window, or when the drop lands on a different
element — and if the view re-renders mid-drag the element keeps the class with no listener left to
clear it. So the highlight outlives the gesture and is still there when the operator moves between
looks and timelines, which is exactly when it was noticed.

`client/lib/drag-highlight-cleanup.js` installs ONE window-level sweeper on `dragend` (fires on the
source), `drop` (fires on the target) and `Escape` — between them every completed or abandoned drag
is covered. Capture phase, because `scenes-compose.js` calls `stopPropagation()` in its own drop
handler and would otherwise swallow it. The per-element `dragleave` is **kept**: the sweeper is a
backstop for abandoned gestures, not a replacement for immediate feedback when the pointer moves off
a layer mid-drag.

## 3. AMCP flood on clip position/size drag — CAUSE FOUND, not fixed

**There is no throttle, debounce or coalescing anywhere on that path** — verified by grep across
`client/lib/mixer-fill.js`, the inspector components, `src/api/routes-mixer.js` and
`amcp-client-transport.js`. Every drag frame becomes a POST, and every POST becomes an AMCP line
serialised on `_amcpSendQueue`. The owner's read — *"looks like amcp gets overrun"* — is correct.

The fix is a **trailing-edge coalescer keyed on (channel, layer, command)**: keep only the newest
transform per layer in flight, drop superseded ones, and always send the final position on
pointer-up so the last frame is never lost. That is a behaviour change on a live-control path
(a dropped intermediate frame is fine, a dropped FINAL frame is a visibly wrong layer), so it wants
its own WO and its own acceptance test rather than being tacked onto a batch.

## 4. Looks↔timeline transitions — NOT investigated

The owner believes there is an existing WO. **I searched and did not find one** for this symptom:
`rg -il` across `work/work-orders/*.md` for the transition/partial-layer wording, and the queue rows
mentioning timeline+look, turned up WO-448 (timeline routed to PGM too early), WO-362 (route layer-10
look reliability) and WO-34 (switcher bus transition rebuild) — all adjacent, none describing *"some
of the layers play or nothing at all"*. Either it was never written up, or it is filed under wording
I did not guess. Worth the owner naming the WO if they remember it, otherwise this needs a fresh
diagnosis with a reproduction.

## 5. Copy clip + drop new media should preserve settings — NOT started

A feature, not a fault. Two requirements, and the second is the harder one:

- preserve transform/settings when the media under a copied clip changes — there is precedent in
  `scenes-compose.js`'s `isLayerSourceExchange`, which already keeps an existing layer's transform on
  exchange and only content-fits an *empty* layer (todos19.07.26);
- preserve a clip's **extended** duration (dragged edge). That is timeline-model state, not layer
  transform, and nothing in the exchange path touches it today.

The owner's parenthetical — *"resolution should be similar when ratios doest match"* — needs a
decision before implementation: on a ratio change, preserve the transform verbatim (letterbox/crop
differs), or refit preserving area/height/width? Those give visibly different results and it is not
mine to pick.

## 6. Work log

- 2026-08-13 — §2 fixed with 6 smokes. §3 root cause established by grep, deliberately deferred as a
  live-control behaviour change. §4 searched for the prior WO and did not find it. §5 scoped, blocked
  on one owner decision.
