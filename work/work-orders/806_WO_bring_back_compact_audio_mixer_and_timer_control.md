# WO-806 — Godot client: bring back the compact audio mixer and the compact timer control

**Area:** godot-client, audio
**Status: DONE except G3 (29.10) — G1 / G2 / G4 / G6 implemented (Godot suite 22176 passed / 0 failed, headless box probe read-only) · live e2e 29.10: G1/G2/G4/G6 PASS on the glass incl. a real timer run on PGM · G5 fixed 29.10 (dense 86 → 64 px, measured + tested) · only G3 open: an owner decision (own WO if wanted)**

Owner, 29.10:
> work order to bring back compact audio mixer and compact timer control

Parent area: the Godot port (WO-593 epic). Related: WO-186 / 192 / 210 / 219 / 226 / 320 / 381 / 567 (web timers dock),
WO-227 (dense mixer), WO-350 / 603 (the Playlists "compact" sibling), WO-601 (screen-timer inspector), WO-604 (Godot
Audio tab), WO-608 (port shell, footer strip left open), WO-799 (ALSA pane under the Godot Audio tab).

## 1. Investigation (29.10, read-only, no code changed)

### 1a. What the owner calls "compact" (owner's own words in the repo)

The web UI's right-hand Inspector column ends in three collapsible, always-present docks, mounted in this order
(`client/index.html:108-110`, initialised at `client/app.js:323-325`):

| Dock | Web file | Owner wording on record |
|------|----------|-------------------------|
| Playlists | `client/components/playlist-control-panel.js` | WO-350 "Playlists compact"; quoted in `godot/client/features/live/playlists_panel.gd:2`: owner 26.07 *"similar to timers and audio mixer compact"* |
| Timers | `client/components/timer-control-panel.js` (+ `-display.js`, `-inline-time.js`, `-settings-form.js`) | WO-186 "small collapsible display+control panel bottom-right next to the compact audio mixer"; WO-381 / WO-567 *"there is remove button in the compact timer"*, *"time inputs for the timer in the compact timers menu"*, *"the compact ones should stay as is"* |
| Program audio | `client/components/audio-mixer-panel.js` (+ `-masters.js`, `-input-layers.js`, `-live-inputs.js`, `-sync.js`) | WO-186 / WO-227 "the compact audio mixer" |

So "compact audio mixer" = the **Program audio** dock and "compact timer control" = the **Timers** dock. Both still
exist in the web client today and in the built bundle (`dist-web/assets/main-CLHcqx3W.js` contains
`audio-mixer--inspector` and `timer-control-panel__toggle`).

### 1b. The compact audio mixer (web "Program audio" dock)

- `client/components/audio-mixer-panel.js:1-33` — "Program master faders … collapsible section at the bottom of the
  Inspector"; collapsed by default, open state in `localStorage` `highascg_inspector_program_audio_expanded` (`:15`).
  Content: **Masters** (one column per PGM / PRV bus: vertical fader + one meter bar per bus channel —
  `audio-mixer-panel-masters.js:25-40`, `programBusChannelCount`, so an 8-channel screen shows 8 bars) and **Inputs**
  (live inputs via `audio-mixer-panel-live-inputs.js`, then per program channel one compact *row* per playing layer:
  label, S / M / ■, Screens row, stereo-pair select, horizontal meter + horizontal fader + dB —
  `audio-mixer-panel-input-layers.js:55-130`). Meters tick only while expanded (`:106-112`).
- All writes go to the server mixer store (WO-604 slice 2 moved the web onto it), the same calls the full console makes.

**WO-227 dense mode — where it really landed.** WO-227's task T227.1 pointed at `audio-mixer-panel*.js` + the 07b
sheet (the compact dock), but the implementing commit **35513a8c** (2026-07-15, "WO-225..227 …") changed the *full
console* instead: `client/components/audio-mixer-console-input-groups.js:52-55` adds `mixer-group--dense` when a
program channel's group has `list.length > 4` strips, and `client/styles/07c2-audio-mixer-view-console-layout.css:90-101`
narrows those strips from 98 px (`07c3-audio-mixer-view-channel-strip.css:12`) to **80 px** with `overflow-x: auto`.
Smoke `tools/smoke/smoke-wo227-mixer-dense.test.js` pins exactly that console code. The dock's master meter bank
(the literal owner complaint: *"when a screen has 8ch it doesnt fit in it space"*) was not changed; the dock's masters
row simply `flex-wrap`s (`07b-audio-mixer-modal-shell.css:85-92`). A227.1 (owner check at 8 ch) was never ticked.
OPEN_ISSUES MIXER-8CH still reads "🟡 Implemented".

**Godot today.**

- There is **no Program audio dock.** The Godot Inspector column has the footer mechanism
  (`godot/client/app/inspector_panel.gd:44-45`, `add_footer()` `:115-119`, added by **c497763c**, 2026-10-20, WO-603
  slice 5) but the shell mounts only Playlists (`godot/client/app/shell.gd:67`). `git log -S "Program audio"` over
  `godot/client` returns nothing: it was never written.
- WO-608 recorded it as not done: `work/work-orders/608_WO_godot_port_shell_settings_web_surfaces.md:203-204` —
  *"Open: … the bottom Playlists / Timers / Program audio strip"*. WO-603 later did Playlists only. WO-604's status
  line says "every web audio feature ported", but its slices are the Audio *tab* (console) only; the inspector dock
  appears only in its inventory (`work/godot-port/inventory/timeline-audio-media-secondary.md:145-149`).
- The full console **does** carry WO-227's dense rule: `godot/client/features/audio/audio_tab.gd:228`
  `_strip(r, 1, rows.size() > 4, …)` → `audio_strip.gd:45` (HEAD) `custom_minimum_size.x = 64 if dense else 84`; the
  inputs bay is a horizontal `ScrollContainer` (`audio_tab.gd:53-60`, the overflow-x equivalent). Added in
  **5c47b389** (2026-10-20, WO-604 slice 1); `git log -G "dense"` over `godot/client/features/audio` shows no later
  change, so it was never removed.
- **But the dense width is probably not real** (estimate from the code, not measured): the strip's content minimum is
  panel margins 2×8 (`app/theme_builder.gd:64`) + meter 10 (`meter_bank.gd` `set_count`) + 3 + scale column 20 + 3 +
  the fader's own width. With the default grabber that is already ≈ 68 px (> 64). The fader-cap change another agent
  has in progress right now (`fader_cap.gd` `WIDTH := 26`, `audio_strip.gd` working-tree diff sets
  `fader.custom_minimum_size.x = FaderCap.WIDTH`) puts it at ≈ 78 px, i.e. "dense" would be ~6 px narrower than
  normal. SOLO / MUTE / ALWAYS button text may push it further. To be measured (`get_combined_minimum_size()`).
- Since **20f0f7a3** (29.10, WO-799) the Audio tab is split — CasparCG top, ALSA bottom (`audio_tab_split.gd`
  `TOP_MIN_HEIGHT 240`) — while a strip asks for 360 px height (`audio_strip.gd:45`). Height is now the scarce axis on
  that tab; dense only narrows.

**Verdict (audio): never ported, not removed on purpose.** No WO, RULES.md entry or commit removes or declines the
Program audio dock in Godot. The console's dense mode was ported (5c47b389) but is likely ineffective at its current
numbers.

### 1c. The compact timer control (web "Timers" dock)

- `client/components/timer-control-panel.js:1-25,86-181` — collapsible "Timers" dock (collapsed by default,
  `highascg_timer_panel_collapsed`), **all** screen timers from `GET /api/timers/list`, polled 1 s while open, readout
  ticking 4×/s. Per row (after WO-381): name, readout, ⚙, ▶ ⏸ ⟲ (`POST /api/timers/cmd`), a standing Time / Target
  input (`timer-control-panel-inline-time.js` `parseTimeText` accepts `90`, `5:00`, `01:30:00`; saves through
  `POST /api/timers/assign` once per assigned screen), and one chip per assigned screen whose eye **fades** in/out
  (`POST /api/timers/visible` with `fadeFrames: 25`, `:315-320`). `isEditingInPanel()` (`:151-156`) holds the 1 s
  rebuild while a field has focus. The ⚙ form is `buildTimerSettings()` **without** `extended` — Duration, Mode,
  Target, Size (vw), Position + X / Y px (applied at once) — and WO-567 pins it: the compact form stays as is; font /
  colours / border are Inspector-only.
- Owner rules recorded in WO-381 (commit **2f966861**, 2026-07-29): the dock is a **live controller only** — no
  "+ New Timer", no add-to-screen dropdown, no per-chip remove; creation / assignment / removal live in the
  screen-timer Inspector and the looks-deck drop.
- The dock also feeds look saves: `getScreenTimersSnapshot()` → `sceneState.setTimersSnapshotFn` (`client/app.js:327-340`)
  writes `timersVisibility` into a saved look (WO-210 T210.8; consumed by `src/engine/screen-timers.js`
  `linesForLookVisibility`). `grep timersVisibility godot/client` → nothing.

**What was removed on purpose (and must stay removed).** WO-226 T226.5's "compact transport next to audio" (a second
per-active-screen timer strip inside `audio-mixer-panel.js`, added in **35513a8c**) was deleted by **2f966861**
(WO-381) on the owner's word: *"there is an additional timer in the most bottom right. not needed."* The comment is at
`client/components/audio-mixer-panel.js:35-38` and `tools/smoke/smoke-wo226-timer-overlay.test.js:176-182` asserts its
absence. TIMER-OVERLAY-UX's "compact transport next to audio" in OPEN_ISSUES is therefore stale wording: the surviving
compact timer is the Timers dock, not anything inside the mixer.

**Godot today.**

- There is **no Timers dock.** The only Godot timer controls are the per-screen **screen-timer Inspector page**
  (`godot/client/features/live/screen_timer_panel.gd:1-6`, 290 lines, added in **4922773b**, 2026-10-18, WO-601),
  opened from a deck column's ⏱ (`deck_head.gd:46` → `live_tab.gd:104-106`) and showing only that screen's timers
  (`screen_timer_model.gd:79` `on_screen`) with the *extended* form (Font, colours — `screen_timer_panel.gd:179,210`),
  Show/Hide as a cut plus separate Fade In/Out, + Add timer and Remove. That is the web's
  `inspector-screen-timer.js`, the "big" surface, not the compact one.
- `git log -S "timer-control-panel"` over `godot/client` finds only 4922773b, which ported the dock's *display maths*
  (`screen_timer_model.gd:36` `display_time`, `:60` `format`, `:67` `state`, golden-tested against
  `timer-control-panel-display.js`) for the Inspector page, not the dock.
- WO-606's investigation (20.10) counted "Timers / countdowns" as already ported via `screen_timer_panel.gd` /
  `countdown_section.gd` — that conflated the Inspector page with the dock. WO-608 (`:203-204`) still lists Timers
  among the open footer docks.
- Not related, already ported, must stay: `godot/client/features/live/template_section.gd:11,15,94` — the "Compact
  mode" checkbox is the playback_timers **HTML template's** on-air layout (`timersConfig.compact`, WO-601, commit
  **50c66ded**), not a timer control.

**Verdict (timers): never ported, not removed on purpose.** Only the WO-226 T226.5 strip inside the mixer was removed
on purpose (2f966861, web, owner rule); the Timers dock itself was kept in the web and simply never built in Godot.

### 1d. Constraints found on the way

- `godot/client/app/main.gd` is at **499 lines**: any new `--probe-*` must live in its own `app/*_probe.gd`
  (pattern: `deck_blank_probe.gd`), not in `main.gd`.
- Files other agents are editing right now (29.10) and this WO must not touch until they land:
  `features/audio/audio_strip.gd`, `features/audio/audio_tab_split.gd`, `features/settings/alsa_mixer_panel.gd`,
  `app/perf_probe.gd` (plus the untracked `features/audio/fader_cap.gd`).
- The Inspector column is 400 px minimum (`shell.gd` `inspector.custom_minimum_size.x = 400`); footers sit outside
  its scroll (`inspector_panel.gd:115`), so three open docks can squeeze the pages. Each dock needs a height cap.
- No WS change exists for screen timers (`routes-screen-timers.js` / `screen-timers.js` broadcast nothing): the dock
  polls, like the web and the Godot Inspector page.

## 2. Gap list — what the owner gets in the web vs the Godot client

| # | Web (today) | Godot (today) | Kind |
|---|-------------|---------------|------|
| G1 | Timers dock in the Inspector footer, every tab: all timers at once, readout, ▶ ⏸ ⟲, Time / Target input, per-screen eye that fades | Only the per-screen Inspector page, reached through each deck column's ⏱, one screen at a time | never ported |
| G2 | Dock ⚙ = compact settings form (Duration, Mode, Target, Size, Position + X/Y px) — WO-567: stays as is | Only the extended form in the Inspector page | never ported |
| G3 | Look save stores `timersVisibility` from the dock's last list (WO-210 T210.8) | Godot-saved looks never carry it | never ported (side finding — own WO if the owner wants it) |
| G4 | Program audio dock in the Inspector footer, every tab: masters with per-bus-channel meters, live inputs, per-screen compact layer rows (S/M/■, Screens, stereo pair, fader, meter) | Only the full Audio tab | never ported |
| G5 | WO-227 dense: >4 strips per screen group → 80 px + horizontal scroll (console only) | Ported in the Audio tab (64 vs 84 px + horizontal scroll), but the strip's content minimum (~68 px now, ~78 px with the in-progress fader cap) probably defeats it | ✅ fixed 29.10 (§ G5 below): dense 64 px for real |
| G6 | — (the dock's 8-bus-channel masters just wrap) | — | WO-227's literal complaint never fixed on the compact surface; to be done right in the Godot dock |

Not a gap: WO-226 T226.5's timer strip inside the mixer (removed on purpose, WO-381 — do not restore).

## 3. Plan

Order: G1+G2 first (self-contained, no file under concurrent edit), then G4+G6, then G5 once the fader-cap work in
`audio_strip.gd` has landed. G3 only if the owner says so (separate WO).

### 3a. G1 + G2 — Timers dock

Files:
- **new** `godot/client/features/live/timers_dock_model.gd` (pure, static): port of
  `timer-control-panel-inline-time.js` `parseTimeText` / `secondsToClockText` / `timeConfigPatch` /
  `timeInputValue`, row order and the per-screen chip list. Reuse `screen_timer_model.gd` `display_time` / `format` /
  `state` for the readout (server-clock offset from `serverNowMs`, as the Inspector page does).
- **new** `godot/client/features/live/timers_dock.gd` (VBoxContainer footer section, target < 300 lines): header button
  "Timers" + count (Playlists pattern, `playlists_panel.gd:30-45`), collapsed by default, open state in
  `user://ui.cfg` `[timers] open` (`playlists_panel.gd:93-110` pattern). Open: `GET /api/timers/list` every 1 s, rows
  rebuilt only when the list's shape changes and never while a field in the dock has focus (WO-381 guard); readouts
  tick every 250 ms. Row = name, readout (amber / red like the Inspector page), ⚙, ▶ ⏸ ⟲ → `/api/timers/cmd`,
  Time / Target `LineEdit` → `/api/timers/assign` once per assigned screen with only the time patch (the server
  re-anchors only on a changed duration — WO-601 addendum 6), one chip per screen (screen label) with an eye →
  `/api/timers/visible {fadeFrames: 25}`, list re-read ~700 ms after the ramp. **No** add, add-to-screen or remove
  (WO-381). Empty list → one muted line pointing at the deck's ⏱. Content in a ScrollContainer with a height cap.
- **new** `godot/client/features/live/screen_timer_settings.gd`: the settings form pulled out of
  `screen_timer_panel.gd:152-217` with an `extended: bool` flag (web `buildTimerSettings` `deps.extended`). The
  Inspector page keeps `extended = true` (unchanged behaviour); the dock's ⚙ uses `extended = false` — no Font,
  colours or border (WO-567). `screen_timer_panel.gd` shrinks.
- `godot/client/app/shell.gd:67` — `inspector.add_footer(TimersDock.new())` right after Playlists (web order).

RULES.md: Input fields 1 (focus selects — `core/numeric_field.gd` `install()` covers every LineEdit) and 2 (maths):
the Time field is text with H:M:S syntax; a plain number there should also go through `math_line()` so `5*60`
works, and anything unparseable restores the previous value (web: garbage restores). Number fields in the compact
form (Size, X, Y, H/M/S) are SpinBoxes → covered by `install()`.

Tests (Godot suite, `godot --headless --script res://tests/run_tests.gd`):
- `tests/test_timers_dock_model.gd` — golden values for `parseTimeText` / `timeConfigPatch` / `timeInputValue`
  produced by the web functions under node (WO-601 method), incl. `90`, `5:00`, `01:30:00`, `90:00`, garbage, clock
  mode.
- `tests/test_timers_dock.gd` — dock built headless with a canned list: rows per timer, one chip per screen, no
  add / remove control in the tree (WO-381 rule as a test), the ⚙ form has no Font field (WO-567), the eye's request
  body carries `fadeFrames: 25`.
- `tests/test_inspector_panel.gd` — footer order Playlists → Timers.
- Box: a `--probe-timers-dock` in a new `app/timers_dock_probe.gd` (main.gd is full) driving a real timer on a free
  screen: start / pause / time input / eye fade, journal shows `MIXER <ch>-98x OPACITY … 25 linear`; probe removes its
  timer. Second windowed instance, owner GUI left running.

### 3b. G4 + G6 — Program audio dock

Files:
- **new** `godot/client/features/audio/audio_console_ctl.gd` (RefCounted): the server-write half of `audio_tab.gd`
  (`_on_gain` debounce / `_on_solo` / `_on_mute` / `_on_screen` / `_send`, `audio_tab.gd:255-336`) moved out so the
  tab and the dock use one write path (one mixer, WO-604). `audio_tab.gd` shrinks; behaviour unchanged.
- **new** `godot/client/features/audio/audio_dock.gd` (footer section): header "Program audio", collapsed by default,
  `[audio_dock] open` in `ui.cfg`. Data from the same models the tab uses (`audio_rows.gd` `input_rows` /
  `program_rows`, `audio_meter_model.gd` `read_key` / `smooth` / `colour`, `audio_actions.gd` requests); meters at
  `AM.TICK_S` only while expanded and visible. Sections: Masters, Live inputs (Ch routes / send / START as on the tab),
  Inputs per program channel.
- **new** `godot/client/features/audio/audio_dock_row.gd`: the compact layer row (label, S / M / ■, Screens toggles,
  horizontal meter, `HSlider` on `mixer_math.gd`'s taper, dB, double-click / Ctrl+click → 0 dB) and the compact master
  column (vertical fader + one bar per bus channel). Does **not** reuse `audio_strip.gd` (vertical console strip,
  under concurrent edit).
- **G6 (WO-227 on the compact surface):** masters with > 4 bus channels or > 4 masters switch to a dense master
  column (narrow bars, ~80 px column like the web's dense width) inside a horizontal ScrollContainer, so an 8-channel
  screen fits the 400 px column; an input group with > 4 rows uses a tighter row height. Two to four channels render
  exactly as the non-dense layout (WO-227's "pixel-identical" rule). The dock body is height-capped with its own
  vertical scroll so an open dock never pushes the Inspector pages off.
- `godot/client/app/shell.gd` — `inspector.add_footer(AudioDock.new())` after Timers.

Tests:
- `tests/test_audio_dock.gd` — canned channelMap / mixer: rows per program channel, live-input section, dense switch
  at > 4 (and not at 2–4), an 8-bus master's combined minimum width ≤ the column's 400 px, a fader change goes through
  `audio_console_ctl.gd` (same request as the tab — compare against `tests/golden/audio_mixer.json`).
- `tests/test_audio_mixer.gd` / `test_audio_actions.gd` stay green after the controller extraction.
- Box: `--probe-audio-dock` (own probe file): dock opened on a screen with an 8-channel layout; meters move with
  program audio; one fader write shows in `GET /api/audio/mixer` and on the Audio tab's strip.

### 3c. G5 — the Audio tab's dense mode (after the fader-cap work lands)

Measure `Strip.get_combined_minimum_size().x` for dense and normal strips headless. If dense is not clearly narrower,
make it real: scale column labels hidden in dense (marks kept), SOLO / MUTE as "S" / "M" (the web dock's labels),
font 10, target the web's 80 px. Add the measurement as a test (`dense < normal`, `dense ≤ 80`). Coordinate with
whoever owns `audio_strip.gd` at that time. Height under the WO-799 split is a separate question for the owner (below).

### 3d. Housekeeping

- OPEN_ISSUES: TIMER-OVERLAY-UX's "compact transport next to audio" → note it was retired by WO-381; MIXER-8CH → note
  the fix covers the console only and the compact case moves here.
- WO-606's "timers ported" claim and WO-604's "every web audio feature ported" get a one-line pointer to this WO.
- 500-line limit: every new file well under it; `screen_timer_panel.gd` (290) and `audio_tab.gd` (371) shrink.
  `node tools/ci/check-max-file-lines.js` must stay green.

## 4. Owner questions (before building)

1. "Compact audio mixer" read as the web's **Program audio dock** at the bottom of the Inspector (plus checking the
   Audio tab's dense mode). Right, or did you mean a compact mode *of the Audio tab itself* (now that the ALSA pane
   takes the bottom half)?
2. Footer order and default: Playlists, Timers, Program audio, all collapsed until opened (web). OK?
3. Should the Program audio dock stay visible while the Audio tab is open (web keeps it), or hide there?
4. Timers dock with no timers: hide the whole section (web) or keep the header with "0"?
5. G3 (`timersVisibility` stored on look save) — wanted in Godot? It is a separate behaviour; own WO if yes.

## 5. Acceptance

- A806.1 Every tab of the Godot client shows a collapsible **Timers** section under Playlists listing every screen
  timer; Start / Pause / Reset, typing `5:00` + Enter, and the eye (fade, ~25 frames, to the stored opacity) work on
  the box output; no create / assign / remove controls; ⚙ shows the compact form without Font / colours / border.
- A806.2 A **Program audio** section under Timers shows masters (one bar per bus channel), live inputs and per-screen
  layer rows; faders, S / M / ■ and Screens write through the same path as the Audio tab (a move in one shows in the
  other); an 8-channel screen fits the 400 px column without clipping; 2–4 channel layouts unchanged by the dense rule.
- A806.3 On the Audio tab, a group with > 4 strips is measurably narrower than with ≤ 4 (test-proven).
- A806.4 Godot suite and offline suite 0 fail; `check-max-file-lines` green; the WO-226 / WO-227 / WO-381 smokes
  untouched and green; box probes recorded in this WO; owner QA on the glass.

## Owner answers (29.10)

1. "Compact audio mixer" = the web **Program audio** dock at the bottom of the Inspector (`client/index.html:108-110`,
   `audio-mixer-panel.js`), like Playlists. Not a compact mode of the Audio tab.
2. "Compact timer" = the web **Timers** dock (`timer-control-panel.js`) in the same footer. Timers-only control: no
   create / assign / remove (WO-381); its ⚙ form stays the short one (WO-567).
3. Both collapse like Playlists; the open / closed state is per session.

## Implementation investigation (29.10, Opus)

Read before coding (no code changed while writing this section).

**Web Program audio dock (what to port).**
- `client/components/audio-mixer-panel.js:20-33` — toggle "Program audio", body "Masters" + "Inputs"; collapsed by
  default (`:97-104`, localStorage); rebuilds on channelMap / scene.live / settings changes only while open (`:127-145`);
  meter loop runs only while open (`:121`).
- Masters (`audio-mixer-panel-masters.js:25-40`): one 58 px column per PGM / PRV bus (`07b-audio-mixer-modal-shell.css:95-103`)
  = label, meter bank with `programBusChannelCount` bars, a vertical range fader, dB. No SOLO / MUTE on a master. With 8
  bus channels the 8 bars do not fit 58 px — the WO-227 complaint; the masters row only `flex-wrap`s (`:85-92`).
- Live inputs (`audio-mixer-panel-live-inputs.js:36-80`): divider + AUTO MIX, then per input a row with Ch route buttons,
  send policy, START, meter, fader, mute.
- Program layers (`audio-mixer-panel-input-layers.js:55-130`): divider "PGM n (ch c) Inputs", then per layer one row:
  Screens buttons (look layers), label, S / M / ■ (audio-only look), stereo-pair select, then horizontal meter +
  horizontal fader + dB. Writes: fader → `postAudioVolume` debounced while moving + on change (`:225-262`), mute →
  `/api/audio/mute` with the current gain (`:180-213`), solo → `/api/audio/solo {keys}` (`:166-178`), look layers patch
  the look (`sceneState.patchLayer`) — exactly the calls the full console makes.

**Web Timers dock (what to port).** `timer-control-panel.js:86-181`: toggle "Timers", collapsed by default, whole dock
hidden when the list is empty (`:157`), `GET /api/timers/list` every 1 s while open (`:28,341-350`), readouts tick 4×/s
(`:315-332`). Row (`:173-268`): name, readout, ⚙; ▶ ⏸ ⟲ → `POST /api/timers/cmd`; Time / Target input
(`timer-control-panel-inline-time.js:24-129`: `parseTimeText` accepts `SS`, `MM:SS`, `HH:MM:SS`, minutes not clamped;
Enter / blur commits, Escape and garbage restore; clock mode writes `targetTime`; saves `/api/timers/assign` once per
assigned screen; no-op when unchanged; disabled when unassigned); one chip per assigned screen (label + eye, eye = fade
`fadeFrames: 25`, re-read 700 ms later, `:290-300`). Rows are not rebuilt while a field in the dock has focus
(`:151-160`). ⚙ = `buildTimerSettings` without `extended` (`timer-control-panel-settings-form.js:101-110`): Duration,
Mode, Target, Size (vw), Position, X / Y px — no font, colours, border. No create / assign / remove (WO-381, `:9-17`).

**Godot pieces to reuse.**
- Footer: `app/inspector_panel.gd:44-45,116-119` (`add_footer` puts a separator + the section under the scroll);
  `app/shell.gd:67` mounts Playlists only. Collapse pattern: `features/live/playlists_panel.gd:30-45` (flat toggle
  button "▸ / ▾ Title" + muted count) and `:98-110` (`set_open`, poll timer started / stopped).
- Audio write path: today it lives inside the tab — `features/audio/audio_tab.gd:260-341` (`_on_gain` with the 80 ms
  debounce flushed in `_process` `:348-354`, `_on_solo`, `_on_mute`, `_on_screen`, `_after`, `_send`) plus the data side
  `:93-131` (`_on_visible` fetches `/api/audio/mixer`, `/api/audio/live-inputs`, `/api/audio/inputs/routing`; `_on_store`;
  `_state`) and the plan fetch `:303-310`. The request shapes are already pure in `audio_actions.gd` (volume / mute / solo
  / route / send / stop / cross-screen). To give the dock one write path the tab's half moves into a shared controller
  (`audio_console_ctl.gd`) that both surfaces bind; a strip only needs `row`, `gain()`, `muted()`, `set_solo()` and the
  `audio_strip.gd:10-18` signals (`gain_changed(gain, final)`, `solo_pressed(multi)`, `mute_pressed`, `screen_toggled`,
  `route_toggled`, `stop_pressed`).
- `audio_strip.gd:48` is a 360 px tall vertical strip (`64 if dense else 84` wide) — too tall for a footer, so the dock
  row is its own compact control emitting the same signals; it reuses `mixer_math.gd` (taper, dB text),
  `fader_cap.gd` (the master's vertical fader cap), `meter_bank.gd` (master bars), `audio_meter_model.gd`
  (`read_key` `:247`, `smooth` `:268`, `colour` `:274`), `audio_rows.gd` (`input_rows` `:243`, `program_rows` `:100`,
  `bus_channel_count` `:278`, `meter_meta` `:69`).
- Width budget: `meter_bank.gd:27-33` sizes a bank at 9 px per bar → 8 bars = 72 px + fader cap 26 (`fader_cap.gd:7`)
  ≈ 100 px per master, 4 masters (2 screens × PGM / PRV) ≈ 420 px > the 400 px column (`shell.gd:65`). Dense rule for
  the dock: a master with > 4 bus channels draws 5 px bars (8 bars ≈ 48 px → column ≤ 80 px) and the masters flow-wrap.
- Timers: readout maths `features/live/screen_timer_model.gd:36` (`display_time`, server clock via `serverNowMs`),
  `:60` (`format`), `:67` (`state` amber / red); the settings form `screen_timer_panel.gd:151-215` is the *extended*
  one inline — it moves to `screen_timer_settings.gd` with an `extended` flag (web `deps.extended`), the Inspector page
  keeps `extended = true`. Screen chip label: `deck_model.gd:69` `screen_label` (Godot's "Main n" fallback, matching the
  deck columns, where the web says "S n"). Timer API: `src/api/routes-screen-timers.js:6-10`, `visible` accepts
  `fadeFrames` 0-500 (`:223-227`).
- No server field is missing for either dock; no new endpoint.

## What was done (29.10, Opus)

New footer sections, mounted in `godot/client/app/shell.gd` after Playlists (web order Playlists → Timers → Program
audio). Both start collapsed and remember open / closed for the running session only (a `static var`, owner 29.10 —
not written to `ui.cfg` like Playlists).

**Timers (G1 + G2)**
- `features/live/timers_dock.gd` (267) — header "Timers" + count; body height-capped (280 px) in its own scroll.
  Open: `GET /api/timers/list` every 1 s, readouts every 250 ms on the server clock (`screen_timer_model.gd`), amber / red.
  Row: name, readout, ⚙ (cog icon); ▶ ⏸ ⟲ icons → `/api/timers/cmd`; Time / Target field → `/api/timers/assign` once per
  assigned screen (disabled when unassigned, Escape / garbage restore, unchanged = no write); one chip per screen
  (`deck_model.gd` `screen_label`, i.e. "Main n" like the deck columns) with an eye icon → `/api/timers/visible`
  `fadeFrames: 25`, re-read 0.7 s later. Rows rebuild only when the list's shape changes and never while a field in the
  dock has focus; open ⚙ forms stay open across a rebuild. No create / assign / remove (WO-381). Empty list: the header
  stays with a muted hint (web hides the dock — owner question 4 was not answered; the visible header is the safer reading).
- `features/live/timers_dock_model.gd` (120) — pure: `parse_time_text` (web `parseTimeText` + RULES.md maths for a
  plain expression without ':' — `5*60` → 300), `seconds_to_clock_text`, `time_config_patch`, `time_input_value`,
  `commit_time`, `screens`, `rows`, `shape`, request bodies.
- `features/live/screen_timer_settings.gd` (118) — the settings form moved out of `screen_timer_panel.gd` with an
  `extended` flag (web `deps.extended`). The Inspector page passes `true` (unchanged form), the dock's ⚙ `false`
  (Duration, Mode, Target, Size, Position, X / Y px — WO-567). `screen_timer_panel.gd` 290 → 201 lines.

**Program audio (G4 + G6)**
- `features/audio/audio_console_ctl.gd` (207) — the Audio tab's server reads and every write (fader debounce, mute,
  solo, routes, send, START, STOP, Screens + plan) moved out of `audio_tab.gd` into one controller that both surfaces
  `bind()` their strips to. Same `audio_actions.gd` requests, same look patches; no new endpoint. `audio_tab.gd`
  405 → 269 lines, behaviour unchanged. Autoloads are looked up at runtime (`_g()`) so the unit runner can compile it.
- `features/audio/audio_dock.gd` (186) — header "Program audio"; Masters (flow-wrapping columns) then Inputs (groups
  "Live inputs", "PGM n (ch c)"); height-capped 320 px scroll; meters at `AM.TICK_S` only while open and on screen.
- `features/audio/audio_dock_master.gd` (113) — master column: label, `meter_bank.gd` (one bar per bus channel), a
  vertical fader with the console's `fader_cap.gd`, dB; no solo / mute (web dock).
- `features/audio/audio_dock_row.gd` (241) — one-line row: label, S / M (■ on audio-only looks), routing toggles (look
  layer Screens with > 1 program channel, live-input Ch routes; inline up to 4, else a second line), a 4 px level bar
  over a horizontal fader on the console taper, dB. Same signals as `audio_strip.gd`. Double-click / Ctrl+click → 0 dB.
- `features/audio/audio_dock_model.gd` (69) — groups, masters, routing kind, the dense rule: > 4 bus channels → 6 px
  bars (2–4 channels keep meter_bank's 9 px); > 4 rows in a group → tighter rows.
- Not in the dock (they stay on the Audio tab): stereo-pair select, the live-input send policy, START, AUTO MIX,
  the WO-800 layer lanes.
- `app/docks_probe.gd` (50) + one entry in `main.gd`'s probe table (`--probe-docks`, line count unchanged at 499):
  opens both sections against the live server, reads only, prints what they built.

## What was verified (29.10)

- Godot suite: **22176 passed, 0 failed** (baseline 22037; +139 from `tests/test_audio_dock.gd` and
  `tests/test_timers_dock_model.gd`: web goldens for the time helpers, WO-381 / WO-567 as tests, the dense rule, widths
  measured on the real controls, both surfaces bound to the controller, footer order).
- `run-client.sh --check`: boot OK. `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- Measured with the app theme (headless): master column 52 px (2 ch), 70 px (4 ch), **82 px (8 ch)**; a layer row
  258–350 px wide and 20 px high (1–4 screens), 8 screens → routing on a second line, 258 px.
- Box, `--probe-docks` (second headless instance, owner GUI untouched, reads only): masters
  `pgm:1 8 bars 82px, prv:2 2 bars 52px, pgm:3 2 bars 52px, prv:4 2 bars 52px` — the box's real 8-channel PGM 1 —
  0 layer rows (nothing playing), 0 timers on the server.
- **Not verified:** the look on the glass (owner QA), a real timer run through the dock (start / pause / time / eye
  fade — the box has no timer and the probe writes nothing), a fader / mute move in the dock reaching the Audio tab live
  (shared code path is test-proven, not exercised on air), meters moving with real program audio.

## Input faders vertical (29.10, Opus)

Owner, 29.10: *"the compact audio mixer has masters as vertical faders (good) and inputs as horizontal (bad)"*.

### Owner decision on G3 (30.10)

*"timers should be saved in looks presets as they are per screen not per look."* Timer visibility moves from the
look to the look preset (one per screen), in both clients. Filed as WO-840. RULES.md "Timers" rule 1.

## Investigation (before the change, file:line at HEAD 335b030f)

- **Row builder** — `godot/client/features/audio/audio_dock_row.gd` (245 lines), `extends VBoxContainer`, one
  `setup()` (`:59-143`) that builds a single `HBoxContainer` line (`:64-66`): label 86 px (`LABEL_W :20`, `:67-79`),
  S / M / ■ (`:80-91`, built by the static `small()` `:147-167`: min 20 px, 4 px side margins), the routing toggles
  (`:92-109`: inline on the line up to 4 programs, else an `HFlowContainer` second line `:94-97`), a 70 px column
  (`:110-114`) with the 4 px horizontal `HBar` level (`:37-56`, `:115-118`) over an **`HSlider`** (`var fader: HSlider`
  `:24`, built `:119-134`), and the dB label 50 px (`DB_W :21`, `:136-141`). Measured in WO-806: 258–350 px × 20 px.
- **Where the fader value is set** — at build from the row: `fader.value = MM.gain_to_fader(r.v)` (`:126`); from the
  server / look in `set_gain()` (`:215-221`, skipped while `dragging`, `_syncing` suppresses the emit), which
  `audio_dock.gd` `_refresh()` calls per row unless the controller has a pending write (`audio_dock.gd:125-126`).
  `gain()` (`:225-227`) returns the stored value while the fader still shows it, else the fader's position.
- **Where it is written** — the row only emits: `value_changed → _on_value` (`:127`, `:199-202`) emits
  `gain_changed(fader_to_gain(p), false)`; `drag_started / drag_ended` (`:128-132`) set `dragging` and emit
  `gain_changed(gain(), true)` on release; double-click / Ctrl+click (`_on_fader_input :205-211`) → `set_gain(1.0)` +
  `gain_changed(1.0, true)`. `audio_dock.gd:150-152` `rebuild()` → `ctl.bind(row, r)` →
  `audio_console_ctl.gd:95` connects `gain_changed` to `gain()` (`:116-130`: live/look layer patch, then
  `AA.volume_request` at once when final, else the 80 ms debounce flushed by `flush()` `:134-142`, called from
  `audio_dock.gd:162`). Mute / solo / screens / routes / ■ are the same `bind()` (`:96-106`).
- **Where rows are laid out** — `audio_dock.gd:57-60` `_inputs` is a `VBoxContainer`; `rebuild()` (`:146-153`) adds per
  group a title then one row per line. Meters: `audio_dock.gd:177-180` → `row.level.set_level()` /
  `set_input_state()`; `app/docks_probe.gd:37` reads `row.level.v`.
- **Masters (the model)** — `audio_dock_master.gd:26-76`: `PanelContainer` (`box(...)`, 3 px margin), centred 10 px
  label, a 96 px body (`BODY_H :16`) = `meter_bank` + `VSlider` with `FaderCap.grabber()` / `track()` and
  `custom_minimum_size.x = FaderCap.WIDTH` (26), dB under it. Same gesture code as the row (`:64-70`, `:79-105`).
- **Not in the dock today** (WO-806 "What was done"): the stereo-pair select, the live-input send policy, START,
  AUTO MIX, the WO-800 layer lanes — they stay on the Audio tab; nothing to keep in a column.
- **Tests that pin the horizontal row** — `tests/test_audio_dock.gd` `test_rows_fit_the_column` (`:68-77`, a row's
  minimum width ≤ 384 for 1/2/4/8 screens); `test_row_state` / `test_one_write_path_with_the_audio_tab` use the row's
  API (`gain`, `set_gain`, `muted`, `_toggles`, `_solo`, signal connections), which stays. No node smoke reads the
  dock files.
- **Width budget** — Inspector 400 px minimum (`app/shell.gd:67`), its panel margin 8 per side
  (`theme_builder.gd:64`, `inspector_panel.gd:30`) → ~384 px for the dock, minus the dock scroll's vertical bar when
  it scrolls. Eight columns per line need ≤ ~44 px each with 3–4 px gaps.

### Plan

The row becomes a column (`PanelContainer` like the master): shortened name on top (tooltip = full label), a 110 px
body = a 4 px vertical level bar + a `VSlider` with `FaderCap` (same handlers, same signals), dB, then S / M (■ on its
own line for an audio-only look), then the Screens / Ch toggles in a 2-wide grid. Compact buttons (16 px, 2 px
margins) so the column is ~42 px. `audio_dock.gd` lays each group's columns in an `HFlowContainer` (like the masters).
Signals, `gain()` / `set_gain()` / `muted()` / `set_solo()` / `set_screens()` / `set_routing()` / `level` unchanged.

### What was done

- `godot/client/features/audio/audio_dock_row.gd` (245 → 261 lines) — the row is now a **column**
  (`extends PanelContainer`, same panel box as the master): shortened name on top (`clip_text` + ellipsis, centred,
  tooltip = the full label + "(src n)"), a 110 px body (`FADER_H`) = a 4 px vertical level bar (`VBar`, fills from the
  bottom; replaces the horizontal `HBar`, still `level` with `set_level()` / `no_signal`) beside a **`VSlider`** with
  `FaderCap.grabber()` / `track()`, 26 px wide (the master's fader), then the dB, then S / M (■ under them on an
  audio-only look) in a 2-wide grid, then the Screens / Ch toggles **one per line** with the screen name
  (`short_label(name, 6)`), because two 16 px buttons per line only fit two letters and the names are what 335b030f
  put on them. Buttons are 16 px with 2 px margins and `clip_text`, so the column is 42 px in any theme. Every
  handler is unchanged (`_on_value`, drag start / end, double-click / Ctrl+click → 0 dB, `set_gain`, `gain()`,
  `muted()`, `set_solo()`, `set_screens()`, `set_routing()`, `set_input_state()`), as are the six signals; the
  controller binding and every write are untouched (`audio_console_ctl.gd` not changed).
- `godot/client/features/audio/audio_dock.gd` — each group's columns sit in an `HFlowContainer` (h 3, v 4) under the
  group title, like the masters; `MAX_H` 320 → 420 so masters + one line of input columns show without scrolling
  (the dock is not wider: still the Inspector's 384 px content width).
- `audio_dock_master.gd`, `audio_dock_model.gd`, `fader_cap.gd`, `audio_console_ctl.gd`: not changed.
- Still not in the dock, as before: stereo-pair select, send policy, START, AUTO MIX, layer lanes (Audio tab only).
- `tests/test_audio_dock.gd`: `test_rows_fit_the_column` (horizontal row width) replaced by
  `test_input_columns_are_vertical_and_fit` — for 1/2/4/8 screens × live input / layer / audio-only × dense: the
  fader is a `VSlider` with the fader cap, no `HSlider` in the column, body 110 px, column ≤ 44 px and eight columns
  + gaps ≤ 400 − 16 − 12 (scroll bar). `test_row_state` / write-path tests unchanged and green.

### What was verified (29.10)

- Godot suite: **22424 passed, 0 failed** (the brief's baseline 22252; the replaced width test now asserts 8 things
  per case over 24 cases). `run-client.sh --check`: boot OK. `check-max-file-lines`: 0 over 500 (row 261, dock 190).
- Headless with the app theme (scratch script, real `ThemeBuilder.build()`): every input column **42 px** wide
  (live input / layer / audio-only, 1–8 screens); heights 165 (1 screen, no toggles) / 184 (audio-only, live input
  with 1 route) / 203 (2 screens) / 241 (4) / 317 (8 screens: the toggles are one per line). In a 384 px flow
  (the Inspector content width): 2 inputs → 1 line, rightmost 87 px; 4 → 1 line, 177 px; **8 → 1 line, 357 px**.
  Fader 26 × 110. Masters unchanged: 82 / 52 / 52 / 52 px.
- Box, `--probe-docks` (second headless instance, reads only): masters `pgm:1 8 bars 82px, prv:2/pgm:3/prv:4 2 bars
  52px`, 5 input rows from the live look, dock **384 × 459** (scroll capped at 420), Inspector 384 px.
- Rendered on a private Xvfb (:77, second instance, `--probe-docks` opens the dock): the masters look as before, the
  live input "DeckLink…" is a vertical column (fader with the cap, 0.0 dB, M, route toggles "Dioda" / "Proj"),
  the PGM 1 group's columns follow in a line under it (`scratchpad/dock_vertical/xvfb_6_inspector.png`).
- **Not verified:** the dev-mode glass check (restart the owner's client + screenshot) — the running client (started
  13:50 with `--open-pixel-map`, another agent's, older than this change) was left alone and was still up at 14:22;
  the relaunch + screenshot is still to do. Note: the dock starts collapsed after a relaunch (session state), so a
  screenshot without a click shows only the "▸ Program audio" header. Owner's eye on the glass; a fader drag in a
  column reaching the server live (same handlers and controller as before, test-proven, not exercised on air).

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS** (G1/G2/G4/G6).
- Program audio dock: it scrolls (q806_dock_scrolled.png). Its fader on L11 PK BACK TRACK went to −18.5 dB, and the
  Audio tab showed the same value (q806_dock_fader.png, q806_audiotab_l11.png). A double-click reset it to 0 dB.
- Screen timer: a test timer was added on Dioda. 1:30 was typed in the dock, then START and PAUSE (q806_timers2.png,
  q806_timer_run.png). The timer showed on PGM (full806_timer.png). The eye hid it with a 25-frame fade
  (full806_eye_mid_c.png → full806_eye_off_c.png). The gear opens the compact form (q806_gear.png). The test timer was
  removed afterwards.
- G3 is still not done (owner decision, own WO). G5: done, see below.

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).

## G5 — dense strips made real (29.10)

**Investigation.** Measured headless, with real `audio_strip.gd` strips in the tree and the client theme:
`get_combined_minimum_size().x` = **86 px for dense and normal alike**. The 64 px `custom_minimum_size` never won.
The floor is the body row: meter 18 + scale column 20 (it needs that width for the "+6 … -∞" labels) + fader cap 26
+ 2 × 3 px separation = 70, plus the panel's 8 + 8 px content margin. SOLO and MUTE (41 and 42 px) fit inside that,
so they were not the limit.

**Done** (`godot/client/features/audio/audio_strip.gd`, non-master strips only, masters never go dense):
- the scale column becomes 8 px and draws only the marks (labels skipped in `_draw_scale`);
- body separation is 2 px and the panel's side padding 3 px;
- SOLO and MUTE become **S** and **M** (the web dock's labels; tooltips keep the words);
- the name and dB readout use font 10.

**Verified.**
- Headless measurements: dense is 64 px for a look layer, a DeckLink live input (MUTE, START, send picker, routes)
  and an audio-only look (STOP). Normal stays 86 px.
- New `tests/test_audio_strip_dense.gd`:
  - `dense < normal` and `dense ≤ 64` for those three row types;
  - S and M with full-word tooltips;
  - masters keep SOLO.
- Godot suite: 22845 passed, 0 failed.
- Visual: real strips rendered windowed (Xvfb) side by side, 2 normal and 5 dense (`g5-strips.png` in the session
  scratchpad). Dense shows marks without labels, S/M, and a muted strip's M lights red.
- The owner GUI was relaunched on the Audio tab from this tree. The live project's groups have ≤ 4 strips (the
  largest look has 4 layers), so they render in normal mode, unchanged.
