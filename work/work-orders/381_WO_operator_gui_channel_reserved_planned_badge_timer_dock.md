# WO-381 — Host channels stuck on "planned", ch 4 collision with the Operator GUI, timers dock

**Status: 🟡 Implemented 29.07.26 in three rounds (server + client live on the box; suite 1684/0/2) — owner eyeball on the dock; Companion needs a module reinstall + restart**

Owner, 2026-07-29:
> "i have a setup right now and all the host channels are stuck on planned. when i was adding a host
> channel it first was created as ch4 which was already occupied by operator gui."
> "in the small compact timers at the bottom right there should be a way to set time. the adding of
> the timers shouldnt be there at all."

Then, after seeing the first cut (§1e): the duplicate timer strip below the dock is not needed, the
per-chip remove is not needed, the eye should fade, and the time wants a real input box.

Three separate defects behind the first two lines, plus the dock rework. Owner decision (asked
mid-session): the dock loses BOTH the create button and the per-timer screen-assignment dropdown.

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

### 1e. Third round: position, input width, Companion (owner, same day)

> "the input box for the time is too wide."
> "positioning of the timer doesnt work. inputing anything in x or y doesnt do anything"
> "now i need full timer control and display as variable in companion."

**Position: every link in the chain was verified WORKING, one at a time.**

1. The form sends it. `buildTimerSettings` driven headlessly from `client/` source with `fetch`
   captured: Save posted `{"posX":300,"posY":150,…}`.
2. The server stores and emits it. `assignTimerToScreen` on the box's own registry produced
   `CG 3-980 UPDATE 0 {…,\"posX\":120,\"posY\":64}`.
3. The template honours it — including on the RUNNING Caspar. `CG 3-980 INVOKE` (set + read +
   restore inside one synchronous JS turn, so the compositor never sees the intermediate state)
   reported:
   `B[countdown-root countdown-pos-bottom-left~none] M[countdown-root countdown-pos-top-left~150px 0px 0px 300px] A[…bottom-left~none]`.
4. End to end through the live API: posting the config moved the on-air template and the registry
   kept `posX 300 / posY 150`, then restored.

So nothing in the pipeline was broken. What could lose the entry is the dock's **1s poll rebuilding
the whole row while the ⚙ form is open** — `updateTimerRows()` re-creates the form (and hides it)
every second, discarding whatever was typed. That is the bug fixed in the second round
(`isEditingInPanel()`), and it fits the symptom exactly. To remove the failure mode entirely rather
than rely on a focus guard, position now applies on `change` with no Save round-trip.

### 1e-bis. Second round (owner, same day, after seeing the first cut)

> "there is an additional timer in the most bottom right. not needed."
> "there is remove button in the compact timer, not needed."
> "the eye button should perform fade in and fade out of the timer."
> "there should be time inputs for the timer in the compact timers menu."

- **The additional timer** is WO-226 T226.5's compact per-active-screen strip, rendered by
  `audio-mixer-panel.js` into `.audio-mixer__timers-compact`. The audio mixer mounts *below* the
  Timers dock in the same column (`index.html:109-110`), so the box literally sat at the bottom
  right, under the dock, duplicating its transport with a second poll and a second add button.
- **The eye cut instead of fading.** `setTimerVisible` (`src/engine/screen-timers.js:281-284`) emits
  `MIXER ch-layer OPACITY <v> <frames> linear` when `fadeFrames > 0` and a bare
  `MIXER ch-layer OPACITY <v>` otherwise. The dock posted no `fadeFrames` → the bare form, a hard
  cut. (The strip being removed *did* pass 25 — the surviving surface had the worse behaviour.)
- **Time inputs**: the first cut made the readout click-to-edit; the owner wants standing input
  boxes. Note the dock's 1s poll rebuilds every row, so any field — the new input, and the ⚙ form
  before it — was liable to be wiped mid-typing.

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

**Client — timers dock.** The dock is now a live controller and nothing else: name, ticking readout,
⚙, start/pause/reset, a time input, and one chip per screen whose eye fades the timer in/out.

- New `client/components/timer-control-panel-inline-time.js` — `createTimerTimeInput(timer)` builds
  the labelled box for a row ("Time", or "Target" in clock mode). Accepts `90`, `5:00`, `01:30:00`;
  Enter or blur commits, Escape restores, garbage restores. Minutes/seconds are not clamped to 59
  (`90:00` is 90 minutes). Saves via `POST /api/timers/assign` **once per assigned screen** — each
  screen needs its own CG UPDATE, which is why the ⚙ form's first-screen-only write left the others
  stale. A timer with no screens gets a disabled box (the assign API needs a screen index).
- `timer-control-panel.js` — removed: "+ New Timer" (and its `prompt()`s), the "Add to screen"
  dropdown, the per-chip remove (×) and `onUnassign`. The eye now posts `fadeFrames: FADE_FRAMES`
  (25, matching the Inspector) and re-reads the list after the ramp. `isEditingInPanel()` holds the
  1s poll's row rebuild while a field in the list has focus — that guard covers the ⚙ form too.
  Creation/assignment/unassignment live in the screen-timer Inspector
  (`inspector-screen-timer.js`), plus the looks-deck drop for creation.
- `audio-mixer-panel.js` — the whole WO-226 T226.5 compact strip deleted (~170 lines: render, tick,
  add, its two `setInterval`s and three subscriptions) with its now-unused imports; the panel is
  program-audio only again. 226 → 154 lines.
- CSS: `07b2-timer-control-panel.css` gains `__time-row` / `__time-label` / `__timer-input` and
  loses `__new-timer-btn`, `__screen-select`, `__chip-unassign`; `07b-audio-mixer-modal-shell.css`
  loses the whole `__timer-compact-*` block.

**Third round**

- `timer-control-panel-settings-form.js` — X, Y and the position preset apply on `change`
  (`applyPositionNow`), no Save round-trip, so nothing can eat the entry between typing and saving.
  Save itself now goes through `saveTimerConfigPatch`, i.e. every assigned screen instead of the
  first. A note under the fields states that X+Y override the preset.
- The time input is `width: 8ch` instead of `flex: 1` (owner: "the input box for the time is too
  wide") — sized to `hh:mm:ss` in the monospace face.

**Companion module** (`~/companion-module-dev/companion-module-highpass-highascg`) — screen timers
were entirely absent from it; the old `countdown_*` actions drive the unrelated WO-169
channel/layer templates.

- `src/screen-timers.js` (new) — the model: deterministic ordering (screen, then CG layer, then id)
  so `highascg_timer_1_*` keeps meaning the same timer; the same local countdown math the web UI
  uses, so a running timer ticks on a button without polling 4×/s; time parsing; the variable set.
- `src/bridge/screen-timer-poller.js` (new) — polls `/api/timers/list` every 2s, recomputes the
  variables every 250ms, publishes only on change, and rebuilds the action dropdowns only when the
  set of timers changes.
- `src/actions/screen-timer-actions.js` (new) — Start, Pause, Reset, Start/Pause toggle, Set time
  (`90` / `5:00` / `01:30:00`, `targetTime` in clock mode), Add/subtract time, Show/Hide with a fade
  (0 frames = cut) per screen or all screens. Timer choice is a live dropdown whose empty value
  means "first timer", so buttons survive a show being rebuilt with new ids.
- Variables: `highascg_timer_count` + 8 slots × `_name _time _time_short _seconds _state _visible
  _mode _duration _screens _id`.
- `src/bridge/api-client.js` — `getScreenTimers`, `screenTimerCmd`, `screenTimerVisible`,
  `screenTimerAssign`.

**Companion look presets** (owner: "the preset buttons for looks dont use variables in names …
when a look gets a diferent title it still stays look 1") — a preset's style is COPIED onto the
button when it is dragged out, so a name baked in at build time is frozen there forever.

- `src/presets.js` — look buttons now read `$(<connection>:highascg_look_label_<id>)`; slot buttons
  read a new `$(<connection>:highascg_look_slot_<n>_label)`, which follows both a rename and the
  look moving to another slot.
- `src/look-vars.js` — `lookSlotLabelVariableId` / definitions / `syncLookSlotLabelVariables`, kept
  in step from `syncLookSlots()` and the look-list refresh.

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
- **Eye fades, proven from the engine** rather than by toggling a live on-air timer:
  `setTimerVisible` emits `MIXER <ch>-<layer> OPACITY <v> 25 linear` when `fadeFrames > 0` and the
  bare `MIXER <ch>-<layer> OPACITY <v>` otherwise (`src/engine/screen-timers.js:281-284`); a
  fade-in targets the screen entry's stored opacity. The dock sent no `fadeFrames` before, i.e. the
  cut form. WO-226 T226.1's existing test pins both forms and still passes.
- **Tests**: `tools/smoke/smoke-wo381-operator-gui-channel-reserved.test.js` (3) and
  `tools/smoke/smoke-wo381-planned-badge-and-timer-dock.test.js` (7), both in the curated CI list.
  The first was proven to fail against the pre-fix modules (4, and the hole in the order).
- **Position, third round**: the change handler was captured producing
  `{…,"posX":420,"posY":260}` with no Save click, and that exact body replayed against the live
  server stored 420/260 and restored cleanly. (The headless page's own POST was blocked by CORS —
  a harness artefact, not the app; the captured body is the app's output.)
- **Companion**: `npm test` → **18/18** in a new `test/screen-timers.test.js` (the module had a
  test script but no tests). Covers ordering, the countdown math incl. paused/past-zero, formats,
  parsing, the full variable block filled and empty, clock mode, and every action against a stubbed
  API — including that 0 fade frames sends no `fadeFrames` (a cut, not `fadeFrames: 0`), that an
  unparseable time is refused rather than sent as 0, and that adjust refuses clock timers. Against
  the LIVE box: the API client read `Timer S2` and produced
  `count=1 name=Timer S2 time=00:10:00 state=ready visible=true screens=2`, and a no-op
  `Set time` through the real action reached the server and left the config intact. Lint/format
  clean (prettier + eslint on the touched files).
- **Suite**: `node tools/ci/run-offline-tests.js` → **1684 pass / 0 fail / 2 skip** (1686 tests).
  `check-max-file-lines` 0 over; `check-unwired-exports` no new orphans (baseline shrunk 695→693).
  **Two existing guards were repointed, not weakened**: WO-210's CSS list swapped the removed
  `__new-timer-btn` / `__screen-select` / `__chip-unassign` for the successor `__time-row` /
  `__timer-input`; WO-226's T226.5 test now asserts the compact cluster's **absence** from
  `audio-mixer-panel.js` and that the dock owns `/api/timers/cmd` + `/api/timers/visible`, and its
  CSS guard moved to the dock's stylesheet. Both carry the reason inline.
- **Deployed**: `npm run build:client` (bundle checked: no `timer-compact` / `chip-unassign`; has
  `timer-control-panel__time-row`, `fadeFrames`, `configComparison`. The two remaining
  `timers-compact` / `timers/unassign` hits are unrelated — an HTML-template config checkbox and the
  Inspector's own unassign), server restarted via
  `kill -TERM $(systemctl show -p MainPID --value highascg)` (back in ~2s), kiosk reloaded (XTEST F5).
- **Not verified / owner QA**: the dock on glass — typing a time on a real timer (duration and clock
  mode, single- and multi-screen), the eye's fade as seen on the screen, and that no host channel
  still reads "(planned)" in the owner's browser after a reload. The on-air timer (`Timer S2`,
  screen 2, visible) was deliberately **not** toggled to test the fade. **Companion**: the module
  changes are on disk in `companion-module-dev` and unpackaged — the owner must rebuild/point
  Companion at the dev module and restart it (WO-372's dev-mode flow) before the new actions,
  variables and preset labels appear. Nothing was installed into the running Companion from here. `npm run lint` could not run
  here (`eslint` is not in this box's partial `node_modules`) — CI covers it.

## 4. Not done (deliberately)

- `destinationIntent` still reports `dst_operator_gui` as a `pgm_prv` item on ch 1 (§1b). It feeds
  labels, not allocation, and no owner symptom points at it — separate WO if it ever shows.
- The ⚙ settings form still writes config to the first assigned screen only. The new time input fans
  out correctly; folding the form onto `saveTimerConfigPatch` is a follow-up.
- `createHmsInput` (`client/lib/duration-hms-input.js`) hard-codes element ids `hms-hours` /
  `hms-minutes` / `hms-seconds`, which collide once more than one timer renders a ⚙ form — the
  settings form even reads them back with `querySelector('[id="hms-hours"]')`. Not touched here (the
  new input does not use it), but it is a real latent bug.
