# WO-385 — Screen name and destination label were two things, and the second one never saved

**Status: 🟡 Implemented 29.07.26 (live: `channelMap.screenLabels` = `["ekran","podglad","record"]`; suite 1690/0/2) — owner: check the Devices inspector**

Owner, 2026-07-29:
> "something is wrong with the screen labels in highascg. name and label should be one thing. dont
> know why they are split in the screen's inspecotr. ive changed the labels before, now i cant
> write anything in them. due to that labels in companion are empty."

---

## 1. Investigation

### 1a. Two fields for one idea

The destination inspector carried both:
- **Destination label** → `patchDestination(id, { label })` — what the card shows (the owner had
  set "ekran", "podglad", "record");
- **Screen label** → `POST /api/screens/label` → `config.screenLabels[mainScreenIndex]` — a
  *separate* string (WO-222) used by the looks selector, multiview, panels and Companion.

Nothing kept them in step, so a box could be fully named and still read `S1` everywhere that
mattered. Measured on the live box: destinations named, `channelMap.screenLabels` `[]`.

### 1b. The screen-label field could never save — two independent defects

```
POST /api/screens/label {"screenIdx":0,"label":"__probe__"}   →  200, EMPTY body
config.screenLabels                                            →  [] (unchanged)
```

1. **Routes receive the body as a RAW STRING** (`router-dispatch.js`: `@param {string} body`; every
   other handler calls `parseBodyStrict`). `routes-screens.js` read `body?.screenIdx` off that
   string, got `undefined`, and returned its validation error before touching the config.
2. **It returned a bare `{ ok }` object**, not the `{ status, headers, body }` shape the route
   registry hands to the HTTP layer — so even the error never reached the client. The browser saw
   an empty 200 and assumed success.

The WO-222 test passed throughout because it called `handlePost` with an already-parsed **object** —
it encoded a contract the HTTP path never had.

That is the whole of "i cant write anything in them", and the cause of the empty Companion labels.

## 2. What was done

**One thing.** A screen's name is the name of the destination that owns it.

- `src/config/screen-destinations.js` — new `screenLabelsFromConfig(cfg, screenCount)`: for each
  screen index, the label of the destination holding it (`isMainBusDestinationMode`), else the
  legacy `config.screenLabels[i]`, else `''` (readers render `S<n>`). A label equal to the
  destination's **id** does not count as a name — `normalizeDestination` falls an unset label back
  to the generated id (`dst_ms5xojur_1`), which must not outrank a stored label or `S<n>`.
- `src/config/routing-map.js` — `channelMap.screenLabels` comes from that function, so every
  reader (looks selector, multiview, panels, `/api/state`, Companion) agrees.
- `client/components/device-view-destinations-inspector-form.js` — the second input is gone; the
  remaining one is labelled *Name* and its tooltip states that it names the screen.
- `src/api/routes-screens.js` — parses the raw body, returns a real response, and **renames the
  owning destination** so the API and the UI write the same thing. With no destination behind an
  index it still writes the legacy array.

## 3. What was VERIFIED

- **Live on the box**: after the fix, `/api/state` reports
  `channelMap.screenLabels = ["ekran","podglad","record"]` — the owner's own names, with no
  re-typing. `POST /api/screens/label {"screenIdx":1,"label":"podglad"}` now answers
  `{"ok":true,...,"renamedDestination":"dst_ms5xoz2h_1","screenLabels":[…]}` instead of an empty 200.
- **Suite**: 1690 pass / 0 fail / 2 skip. Two guards repointed, with the reason inline:
  WO-222's roundtrip test now drives the handler the way HTTP does (raw string in, `{status,body}`
  out) and covers the rename path, a 400 on a broken body, and `null` for other paths — it would
  have caught this; WO-270's inspector guard now asserts the second field is **gone** and that one
  field patches the destination. WO-242's pixelmap case gained the both-halves check (auto-id does
  not outrank a stored label; a real name does).
- Client rebuilt, server restarted, kiosk reloaded.
- **Owner QA**: the inspector on glass — one Name field per screen, and the looks selector /
  multiview / panels showing those names.

## 4. Note

Boxes that set a `screenLabels` entry under the old model keep it until the owning destination is
given a real name; the array is never written for an owned screen any more.
