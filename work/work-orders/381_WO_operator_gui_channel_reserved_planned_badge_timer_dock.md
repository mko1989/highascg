# WO-381 — Host channels stuck on "planned", ch 4 collision with the Operator GUI, timers dock

**Status: 🟡 Implemented 29.07.26 (server + client live on the box; suite 1675/0/3) — owner eyeball on the dock**

Owner, 2026-07-29:
> "i have a setup right now and all the host channels are stuck on planned. when i was adding a host
> channel it first was created as ch4 which was already occupied by operator gui."
> "in the small compact timers at the bottom right there should be a way to set time. the adding of
> the timers shouldnt be there at all."

Three separate defects behind that, plus one UI change. Owner decision (asked mid-session): the dock
loses BOTH the create button and the per-timer screen-assignment dropdown.

---

## 1. Investigation

### 1a. ch 4 was handed out because the Operator GUI channel was never counted as used

`routing-map.js` allocates `operator_gui` a real Caspar channel immediately after multiview
(`src/config/routing-map.js:265-273`) — on this box that is **ch 4** (pgm 1, prv 2, pgm 3, GUI 4,
DeckLinks 5-7, NDI host 8). But `usedCasparChannels()` in `src/config/host-live-sources.js:85`
enumerated program / preview / switcher-bus / multiview / inputs / streaming / monitor / audio-only /
DeckLink / live-audio / v4l2 / `inputChannels` / extra-live-source channels — and **not**
`operatorGuiCh` / `operatorGuiChannels`. `suggestNextHostChannel()` walks up from 1 to the first
number that set does not contain, so it returned the Operator GUI's own channel.

Measured on the box's live config **before** the fix (pre-fix module copied out of `git show HEAD:`
and required directly):

```
PRE-fix suggestNextHostChannel => 4          # the Operator GUI's channel
PRE-fix channel order => ["1:pgm","2:prv","3:pgm"]
```

A host source that took ch 4 would then PLAY onto the channel whose `<screen>` consumer is the
operator monitor (`config-generator-operator-gui.js`), since the stored `hostChannel` is honoured
verbatim by `mergeHostLiveChannelsIntoRouting` (`host-live-sources.js:320`).

### 1b. Device View showed a hole where ch 4 is

`buildGeneratedChannelOrder()` (`src/api/device-view-snapshot.js:196`) emits pgm / prv / bus /
multiview / input / audio-only / streaming rows — never `operator_gui`. The live payload really did
read `1:pgm 2:prv 3:pgm 5:decklink_input …`, so every reader of that order — and the operator
looking at Device View — saw ch 4 as free. (`destinationIntent` separately reports the GUI
destination as a `pgm_prv` on ch 1; left alone, out of scope here.)

### 1c. "(planned)" could never clear — it compared the saved config with itself

`device-view-destinations-ui.js:164` labelled a host channel `(planned)` from
`hostChannelsPendingApplyForPayload(payload, stateStore.channelMap)`, i.e.
`casparHostChannelsPendingApply(planned, live)` where

- `planned` = `_settings.channelMap` → `GET /api/settings` → `buildChannelMap(ctx)`
- `live` = the state store's `channelMap` → `GET /api/state` / WS → `buildChannelMap(ctx)`

**Both sides are the same function over the same saved config** (`src/api/settings-get.js:52`,
`src/api/get-state.js:29`, `src/api/device-view-caspar-snapshot.js:19`). Verified on the box: the
settings map, the `/api/state` map and `live.caspar.channelMap` were byte-identical on every key the
comparison reads. So the flag carried no information about what CasparCG is actually running — and
`casparHostChannelsPendingApply` returns **`true` when `live` is falsy**
(`planned-channel-map.js:32`), which is what a client whose store holds no channel map hits. Result:
every host channel reads "(planned)" with no state of the world that can clear it.

The real live evidence was already on the wire and unused: `configComparison.serverChannels`, parsed
from Caspar's **INFO CONFIG** (`src/config/config-compare.js:216`, broadcast on the
`configComparison` path). On the box it reports 8 channels with ch 4 as a 1920x1080 `hasScreen`
channel — the Operator GUI, exactly as generated.

### 1d. Timers dock

`client/components/timer-control-panel.js` is the collapsible dock at the bottom of the right
inspector column (`client/index.html:109`). Setting a time existed only behind the ⚙ button, and its
save wrote to `Object.keys(timer.screens)[0]` — the FIRST assigned screen only, silently returning
when the timer had no screen. Creation lived here too: "+ New Timer" with two `prompt()` dialogs.

---

## 2. What was done

**Server**

- `src/config/host-live-sources.js` — `usedCasparChannels()` now pushes `map.operatorGuiCh` and
  `map.operatorGuiChannels`. One-line class of fix; the map already exported both.
- `src/api/device-view-snapshot.js` — `buildGeneratedChannelOrder()` emits
  `{ ch, role: 'operator_gui', mainIndex }` rows next to the multiview block. Safe for the client:
  `operator_gui` is not in `HOST_CHANNEL_DEST_ROLES` / `HOST_DEST_ROLES`, so it renders no
  host-channel card and creates no connector — it only stops the channel reading as free.

**Client — the badge**

- `client/lib/planned-channel-map.js` — new `liveCasparChannelSet(configComparison)` and
  `hostChannelPendingApply(channel, configComparison)`. A host channel is "planned" **iff the running
  Caspar has no such channel**; with no evidence at all (Caspar down, nothing reported yet) it claims
  nothing instead of defaulting to "planned". Dead `hostChannelsPendingApplyForPayload` removed.
- `device-view-destinations-ui.js` — per-destination now, from `stateStore.configComparison`.
- `live-input-modal.js` — the "(planned — Apply Caspar config to activate)" note uses the same test.

`casparHostChannelsPendingApply` / `effectiveChannelMap` are untouched: for *numbering* (which map to
render while an edit is unapplied) "prefer the planned map" is the right default.

**Client — timers dock** (owner choice: create AND assign both go)

- New `client/components/timer-control-panel-inline-time.js`: click the readout, type `90`, `5:00` or
  `01:30:00`, Enter commits (Esc cancels). Clock-mode timers edit `targetTime` through the same box.
  Saves via `POST /api/timers/assign` **once per assigned screen** — each screen needs its own CG
  UPDATE, which is why the settings form's first-screen-only write left the others stale.
- `timer-control-panel.js`: "+ New Timer" (and its `prompt()`s) and the "Add to screen" dropdown
  removed; the 4×/s tick skips a readout marked `data-editing="1"` so it cannot type over the owner.
  Creation still lives in the screen-timer Inspector (`inspector-screen-timer.js` "＋ Add timer"),
  the looks-deck drop, and the audio-mixer panel.
- `client/styles/07b2-timer-control-panel.css`: rules for the editable readout + input; the
  `__new-timer-btn` / `__screen-select` rules deleted with their controls.

---

## 3. What was VERIFIED

- **ch 4 collision, on the box's own config**: pre-fix `suggestNextHostChannel` → **4**; post-fix,
  against the real on-disk config (with `extraLiveSources`) → **9**, i.e. past the GUI (4), the three
  DeckLinks (5-7) and the existing NDI host (8).
- **Device View hole, live after restart**: `generatedChannelOrder` now reads
  `1:pgm 2:prv 3:pgm 4:operator_gui 5:decklink_input 6:decklink_input 7:decklink_input 8:ndi_host`.
- **Badge semantics against live state**: with the box's real `configComparison` (running Caspar =
  channels 1-8), `hostChannelPendingApply` is `false` for ch 4-8 and `true` for ch 9 — so an
  unapplied host channel reads "planned" and clears itself on the next INFO CONFIG after Apply +
  restart.
- **Tests**: `tools/smoke/smoke-wo381-operator-gui-channel-reserved.test.js` (3) and
  `tools/smoke/smoke-wo381-planned-badge-and-timer-dock.test.js` (5), both registered in the curated
  CI list. The first was proven to fail against the pre-fix modules (4, and the hole in the order).
- **Suite**: `node tools/ci/run-offline-tests.js` → **1675 pass / 0 fail / 3 skip** (1678 tests).
  `check-max-file-lines` 0 over; `check-unwired-exports` no new orphans (baseline shrunk 695→693).
  **WO-210's CSS guard was repointed, not weakened**: it required `__new-timer-btn` and
  `__screen-select`; it now requires the successor controls `__timer-display--editable` and
  `__timer-input`.
- **Deployed**: `npm run build:client` (bundle checked: no `new-timer-btn` / "Add to screen", has
  `timer-control-panel__timer-input` and `configComparison`), server restarted via
  `kill -TERM $(systemctl show -p MainPID --value highascg)` (came back in ~2s), kiosk reloaded
  (XTEST F5).
- **Not verified / owner QA**: the dock on glass — click-to-set on a real timer (duration and clock
  mode, single- and multi-screen), and that no host channel still reads "(planned)" in the owner's
  browser after a reload. `npm run lint` could not run here (`eslint` is not in this box's partial
  `node_modules`) — CI covers it.

## 4. Not done (deliberately)

- `destinationIntent` still reports `dst_operator_gui` as a `pgm_prv` item on ch 1 (§1b). It feeds
  labels, not allocation, and no owner symptom points at it — separate WO if it ever shows.
- The ⚙ settings form still writes config to the first assigned screen only. The new inline editor
  fans out correctly; folding the form onto the same helper is a follow-up.
