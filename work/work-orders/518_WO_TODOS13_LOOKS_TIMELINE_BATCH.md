# WO-518 — todos13 batch: drag highlight, looks↔timeline transitions, AMCP drag flood, clip copy

**Status: PARTIAL (13.08.2026). §2 blue dashed outline — DONE. §4 looks↔timeline transitions — prior WO found, one fail-dark bug fixed (WO-519, in WO-139 §5). §5 clip exchange fit — DONE (WO-520); the 'extended duration' half is NOT done. §3 AMCP drag flood — cause found, deferred. Suite 2150/2148/0, client rebuilt.**
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

## 3. Timeline clip position/size flooding the server — FIXED (WO-522)

Owner: *"changing clips position/size (on the screen) in timelines takes a while to show up on the
preview screen, looks like amcp gets overrun."* **The owner's diagnosis was right.**

### Two wrong answers from me first, both recorded

1. *"There is no throttle, debounce or coalescing anywhere on that path."* Wrong — the
   **scenes/compose** editor has both `schedulePreviewPush` (debounce + max-wait) and
   `scheduleMixerNudge` (single timer, in-flight guard, `nudgeQueued`, i.e. trailing coalescing).
   I generalised from the wrong editor.
2. *"Nothing is sent until a 3 s autosave debounce."* Also wrong. I traced
   `updateClip → _save() → localStorage + emit('change')` and stopped there, concluding the only
   server path was `app.js`'s autosave. I never found the second path.

### What is actually happening

`inspector-panel-timeline-clip.js`'s `applyFillPx` — the X/Y/W/H **drag inputs** — calls
`refreshTimelineClipGeometryOnServer()` on every change, and that is **two** round-trips:

```js
await syncTimelineToServer()                          // PUT the ENTIRE timeline
await api.post(`/api/timelines/${id}/seek`, { ms })   // engine re-applies every layer → AMCP burst
```

Fired as `void`, so a drag put two full requests per pointer move on the wire, with no coalescing
and **no ordering guarantee** — a slower earlier response could land after a newer one. Four drag
handlers did this: position, size, opacity and in-point.

### Fix

`client/lib/trailing-throttle.js` — `createTrailingThrottle(fn, ms)`: one pending timer, an
in-flight guard, and a queued flag so the **last** call always runs. Extracted rather than
reinvented: it is the same shape `scenes-preview-runtime-mixer-nudge.js` already uses for compose,
and a second subtly-different implementation would drift.

The property that matters: **the value the operator settles on always reaches the server.** Dropping
intermediate frames is the point; dropping the final one leaves a layer visibly wrong — which is why
a leading-edge throttle would be wrong here. All four drag handlers now go through it at 80 ms;
discrete one-shot actions still `await` the un-throttled function directly.

Verified by `smoke-wo522-timeline-geometry-throttle.test.js`, 9 tests: a 50-frame burst collapses to
under 10 runs; the last value always arrives; work never runs concurrently (the out-of-order
hazard); a change made *during* an in-flight request is still sent; a throwing call does not wedge
the throttle; every drag handler is wired and no `void refresh…` remains; `flush()` beats the window
and never races an in-flight call.

**NOT verified on the box.** The measurable claim is that a drag now issues far fewer PUT+seek pairs
and the preview settles sooner — owner QA.

## 4. Looks↔timeline transitions — NOT investigated

The owner believes there is an existing WO. **I searched and did not find one** for this symptom:
`rg -il` across `work/work-orders/*.md` for the transition/partial-layer wording, and the queue rows
mentioning timeline+look, turned up WO-448 (timeline routed to PGM too early), WO-362 (route layer-10
look reliability) and WO-34 (switcher bus transition rebuild) — all adjacent, none describing *"some
of the layers play or nothing at all"*. Either it was never written up, or it is filed under wording
I did not guess. Worth the owner naming the WO if they remember it, otherwise this needs a fresh
diagnosis with a reproduction.

## 5. Copy clip + drop new media — HALF DONE (WO-520)

**The fit half is done.** Owner decided the rule: *"I want the new media to be confined to the same
max size the layer had before keeping the new clips ratio. no crops."*

`containRectPreservingAspect(prevRect, contentW, contentH)` in `client/lib/fill-math.js` treats the
layer's existing rect as a **max bounding box**: scale the new clip to fit inside at its own aspect
ratio, centred on the old rect, never cropped, never grown past it. Wired into both drop branches in
`scenes-compose.js` via `createApplyExchangeFitForSource`, replacing the old
`isExchange ? Promise.resolve()` — which preserved the transform verbatim and therefore stretched
anything whose ratio differed. An **empty** layer still content-fits to the canvas
(`applyNativeFillForSource`), unchanged.

Deliberate: unknown media resolution patches nothing at all. Guessing would silently move a live
layer, and "leave it exactly as it was" is the only safe answer when the size is not known.

Verified by `smoke-wo520-exchange-contain-fit.test.js`, 9 tests, including a no-crop sweep over five
aspect ratios asserting all four edges stay inside the old bounds. One assertion was too strict on
the first run — an odd fitted width cannot sit exactly centred in an even box at integer
coordinates — and now allows a half-pixel.

### The "extended" half — DONE (WO-523)

`replaceClipSource` overwrote `clip.duration` with the incoming media's length unconditionally, so
any edge-drag was discarded on a media swap. Nothing recorded the media's own length either, so
"extended" could not be told from "happens to match its media" after the fact.

`clip.naturalDuration` now records the media's own length (seeded in `addClip`, refreshed on every
swap). On a swap: **any clip whose duration differs from its natural length was resized by the
operator and keeps its length**; a clip that simply matched its media adopts the new one's. Legacy
clips with no `naturalDuration` are **preserved** — silently shrinking a clip the operator had
stretched is the worse error, so unknown provenance resolves toward keeping it. Shortened clips
count as resized too; the rule is "the operator touched it", not "it got longer".

Keyframes are clamped to the **preserved** duration, not the incoming one — clamping a 12 s clip's
keyframes to a 3 s incoming file would destroy them. Trim points still reset (they index into the
outgoing media and mean nothing for a different file), and `fillPx` is untouched.

The timeline drop path also got the WO-520 aspect rule: `refitExchangedClipToOldRect` contains the
new media inside the clip's existing rect, reusing `containRectPreservingAspect` rather than a second
copy. Best-effort and silent — the swap has already succeeded, and an unknown resolution leaves the
rect exactly as it was.

Verified by `smoke-wo523-clip-exchange-preserves.test.js`, 9 tests driving the real store methods.

### Original scoping, kept for context

Two requirements, and the second is the harder one:

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
