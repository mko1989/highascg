# WO-560 — a timeline layer was permanently flagged as "missing media"

**Status: FIXED in repo (03.09.2026), root cause confirmed by reading the live project file
directly (not guessed). 6 new smokes. Full offline suite 2400/2398/0/2. Client built, server
restarted, live. Owner QA owed — the badge should simply be gone now.**
**Priority:** Medium — cosmetic, but persistent and confusing (three separate sessions' worth of
investigation across this WO's own predecessor questions in WO-555/556/558/559 write-ups).
**Source:** owner: *"the warning triangle in the web gui is still present. its there all the time.
it seems like it was added as a test. find it and remove it."*
**Related:** the "header warning-triangle question" left open in
[WO-555](./555_WO_TIMELINE_PREVIEW_ROUTING_CORRUPTION.md) §5 and never resolved in WO-556 despite a
dedicated live-diagnostic session — this WO is that investigation's payoff, found once the owner
supplied the missing fact ("there all the time," not intermittent) that pointed at a persistent
badge instead of a transient connection/boot indicator.

---

## 1. Investigation

With devtools open on the live kiosk, queried every element whose bounding rect fell in the
top-left corner region (`top<40 && left<60`) directly instead of guessing at DOM structure:

```js
[...document.querySelectorAll('img,svg,span,div')].filter(e => {
  const r = e.getBoundingClientRect()
  return r.top < 40 && r.left < 60 && r.width > 0 && r.width < 60
})
```

Two elements: the header logo, and —

```html
<span class="scenes-card__missing-badge" title="Missing in Caspar media:
tmsro89fsecg">⚠</span>
```

`scenes-card__missing-badge` is the WO-360 "this look carries media Caspar doesn't recognize"
corner badge (`scene-list-column.js`), rendered on a `.scenes-card` — a LOOK CARD, not a header
element at all; it only visually reads as "in the header" because of where its card happens to be
positioned. `tmsro89fsecg` looked exactly like a plausible-but-deleted media id — which is exactly
why three earlier sessions (this one included) couldn't place it via code search.

Read `projects/test420.json` directly instead of guessing further:
```json
"timelines": { "activeId": "tmsro89fsecg", "timelines": [{ "id": "tmsro89fsecg", ... }] }
```
```json
"scenes": [ ..., { "name": "Look 5", "layers": [{ "source": { "type": "timeline", "value": "tmsro89fsecg" } }] } ]
```
`tmsro89fsecg` is not a media filename — it is the project's one `Timeline` object's own `id`, and
it is Look 5's one layer's `source.value` (`source.type: "timeline"`). Look 5 is the exact look this
entire session's WO-546→559 chain has been using as its timeline-look test fixture all day — which
is exactly why the owner's "it seems like it was added as a test" read was so close: not a stray
test *fixture*, but a stray test *artifact* of THIS session's own investigation surfacing a
pre-existing, unrelated bug.

`missingMediaInScene` (`media-exists.js`) pushes `layer.source.value` into its missing-media check
for every layer, with **no regard for `layer.source.type`**. `clipMissing`'s own filtering
(`NON_MEDIA_RE`, `TEMPLATE_PATH_RE`) is a VALUE-pattern match — `route://`, `https://`, `decklink`,
`color`, template-ish paths — and an opaque timeline id matches none of those patterns, so it slid
straight through as if it were a plausible, simply-absent clip name. Since the timeline is a
permanent part of the project (its own persisted object, never a Caspar media file), the look
carrying it was flagged **forever** — "there all the time," never intermittent, exactly as the
owner described once given the chance to say so plainly.

## 2. What was done

`media-exists.js`: `missingMediaInScene` now skips any layer whose `source.type` is a type that is
never a Caspar media clip path in the first place —
`timeline, template, live_audio, placeholder, effect, browser, route` — before ever looking at its
`.value`. An untyped/legacy layer (`source.type` absent, the historical default for a plain clip)
is still checked, same as before.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo560-timeline-layer-not-missing-media.test.js` — 6 tests: reproduces the
  EXACT live case (a `type: 'timeline'` layer with `value: 'tmsro89fsecg'`) and confirms it is no
  longer flagged; a regression test pins that `clipMissing` alone (no type awareness) still
  returns `true` for that value, documenting exactly why the bug was invisible to the existing
  value-pattern filtering; confirms a genuinely missing plain-media layer is still correctly
  flagged (the fix doesn't just silence everything); confirms an untyped/legacy layer is still
  checked (the guard is type-specific, not a blanket skip); confirms the other five non-media
  types are also excluded; a source-level wiring pin.
- Full offline suite: `node tools/ci/run-offline-tests.js` → 2400 tests, 2398 pass, 0 fail, 2 skip
  (pre-existing).
- `npm run build:client` succeeded (only pre-existing, unrelated chunk-size warnings). Server
  restarted — client and server both live.

## 4. What remains owner-QA

- Confirm the badge is gone from Look 5's card in the Scenes/Looks grid, and that the take-time
  toast (`⚠ Missing in Caspar media: ...`) no longer fires when taking a look containing a timeline
  layer.
