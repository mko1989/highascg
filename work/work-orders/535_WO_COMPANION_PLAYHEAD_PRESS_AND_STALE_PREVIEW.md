# WO-535 — The playhead never pressed a Companion button; the flag inspector showed a stale one

**Status: FIXED in repo (14.08.2026) — 10 smokes, suite 2245 / 2243 pass / 0 fail / 2 skip. Owner QA owed (§6).**
**Priority:** High (the whole point of Companion flags is the playhead firing them)
**Source:** `work/work-orders/todos14.08.26` lines 8–10:
- *"the companion connection is not working correctly, it seems slow, gives many different errors. main use case is to use companion button presses inside the timeline."*
- *"it displays cannot reach companion satelite, and to check companion settings if its enabled. That is very wrong because the companion sattelite setting CANNOT be turned off."*
- *"the test press goes thru but the playhead does not trigger a press. also the flag correctly displays the current display of the button, but inside the inspector it shows a stale button display."*
**Related:** WO-75 (companion_press flags), WO-450 (rounds 4–5: the inspector preview binding and live
updates — this is the same widget, a different staleness), WO-452

---

## 1. The asymmetry in the report IS the diagnosis

*"the test press goes thru but the playhead does not trigger a press."* Two different code paths:

| | path |
|---|---|
| **Test press** (settings modal / flag inspector) | `POST /api/companion/button-preview/test-press` → plain HTTP `http://host:port/api/location/p/r/c/press` (`routes-companion-preview.js:179`). **Works** — the owner confirms it. |
| **Playhead flag** | `_fireCompanionPress` (`timeline-playback.js:191`) → Satellite first, HTTP only as a fallback. **Silently dropped.** |

```js
let satelliteOk = false
try {
	const { getSatellitePreviewClient } = require('../companion/satellite-preview-client')
	getSatellitePreviewClient().pressButton(page, row, col)
	satelliteOk = true            // ← unconditional
} catch (_err) { /* Satellite unavailable, will fall back to HTTP */ }
if (!satelliteOk) { …HTTP… }
```

and the thing it calls, `satellite-preview-client.js:138`:

```js
pressButton(page, row, column) {
	if (!this._connected) return          // ← silent, returns undefined
	…
}
```

`pressButton` **cannot throw** for the case that actually happens. A disconnected socket is a quiet
early return, so `satelliteOk` was always `true`, the HTTP fallback never ran, and nothing was
logged. The comment `/* Satellite unavailable, will fall back to HTTP */` describes an intention the
code does not implement: the catch only covers a `require`/construct failure.

Note also that the preview singleton is refcounted and closes when the last picker subscription is
released (`_closeSocket` at `_refs.size === 0`) — so on a normal show, with no picker open, the
socket is exactly as disconnected as this path assumes it never is.

## 2. Two doors to the same wrong port

The fallback did its own config resolution:

```js
const port = comp.port || 8000
```

while everything else goes through `resolveCompanionConfig`. The live box runs Companion on **8001**
(`config/companion.json`), so the config saves it either way — but a second default is a second
thing to keep in step, and this whole WO is about two paths that drifted.

## 3. The stale preview in the inspector

`inspector-panel-timeline-flag.js:158`:

```js
previewImg.src = companionButtonPreviewUrl(coords.page, coords.row, coords.column)   // no mtime
```

`companionButtonPreviewUrl` appends `?t=<mtime>` **only when given one**. The timeline flag thumb
(`loadCompanionFlagThumb`) always passes `latestMtimeFor(...)` — the mtime carried by the live
`companion.buttonPreview` WS event — so it is current. The inspector's *first* paint passed nothing,
so the browser answered from its own cache with whatever that jpg looked like last time. Every
*later* repaint in that widget already busted correctly (`refreshPreviewImg`, `onPreviewWs`), which
is why only the initial view was wrong — and why the flag and the inspector disagreed on screen at
the same moment, exactly as reported.

WO-450 rounds 4 and 5 fixed the *rebind* and the *live update* of this same widget. This is the
third staleness in it, and the only one on the opening frame.

## 4. The message that blamed a setting that is already on

```js
st?.hint || 'Companion button preview unavailable. Enable Satellite + Button Subscriptions API in Companion Settings.'
```

The Satellite TCP server and the **Button Subscriptions API** are two separate Companion settings,
and the status endpoint already distinguishes them — it returns `reason` as one of
`satellite_disabled`, `subscriptions_disabled`, `satellite_reconnecting`. The blanket sentence
ignored all of that and told the operator to enable Satellite even in the case where the probe had
just reported it **connected**. Probed live while writing this:

```
GET /api/companion/connection-status
{"connected":true,"http":{"connected":true,"port":8001,"status":200},
 "satellite":{"enabled":true,"connected":true,"subscriptionsSupported":true}}
```

So on this box the whole message was false, which is the owner's *"that is very wrong"*.

## 5. The fix

| file | change |
|---|---|
| `src/companion/satellite-preview-client.js` | `pressButton` returns `false` when disconnected, `true` when the KEY-STATE line went out. Documented as load-bearing. |
| `src/engine/timeline-playback.js` | `satelliteOk = …pressButton(…) === true`; the HTTP fallback now resolves host/port through `resolveCompanionConfig`. |
| `client/lib/companion-button-preview-url.js` | exports `latestCompanionButtonPreviewMtime` — the value the flag thumb already busts on. |
| `client/components/inspector-panel-timeline-flag.js` | first `<img>` src busts on that mtime; the unavailable text comes from `companionPreviewUnavailableText(reason)`, which names the actual missing piece and never claims Satellite is off when it is connected. |

**Not changed, deliberately:** the Satellite-first ordering. Satellite is the lower-latency path and
is right to try first — it just has to admit when it did nothing.

*"it seems slow, gives many different errors"* is not separately addressed. With presses falling
through to HTTP that has a real chance of resolving on its own; if it does not, it needs its own
measurement (probe timings, reconnect churn) rather than a guess here. Recorded in §7.

## 6. Owner QA

Server + client — needs `kill -TERM $(systemctl show -p MainPID --value highascg)` **and** a kiosk
reload.

1. Put a `companion_press` flag on a timeline and play through it **with no button picker open** (the
   condition that used to guarantee a dropped press). The Companion button must fire.
2. Open the flag inspector for a button whose appearance has changed since the page loaded: the
   preview must match the flag's thumbnail immediately, with no reload.
3. If a preview is ever unavailable, read the message: it must not tell you to turn on something the
   status page shows as connected.

## 7. Still open

- *"it seems slow"* — unquantified. If presses now land but late, the next step is timing the
  Satellite reconnect and the HTTP round trip, not more code reading.
- The preview singleton closes its socket when the last picker subscription is released. Pressing no
  longer depends on that, but a **persistent** Satellite connection would make presses take the fast
  path always instead of falling back. Worth its own WO if latency matters.

## 8. Work log

- 2026-08-14 — The owner's own "test press works, playhead doesn't" split the problem in one line:
  Satellite reported a success it never had, so the working HTTP path was never reached. Fixed with
  a real return value, plus the first-paint cache-bust and a reason-aware message. 10 smokes.
