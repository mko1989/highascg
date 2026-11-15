# WO-1085 — Auto follow: spot handover (N nearest heads lit, the rest dark, cross-faded take-overs; PSN-only levels to the desk; the LD's grant)

**Area:** tracking-vr, lighting, godot-client
**Status: DONE (15.11.26 — 25 node + 6 Godot tests; box harness on the live patch → 127.0.0.1:6455; Split byte-identical to HEAD; GUI shows on the next relaunch; MA3 side untested)**

Owner (15.11): "id like an effect that the lone presenter is lit by the 3 heads and the rest is off, then when he moves
the heads follow him but also other heads 'take over' when his crossing a threshold." — "id like to also be able to send
just psn, but id like to also be able to create the above type of automations".

Context: a row of front moving heads (the active project "90C PGRP Hilton Wawer": 8 × ADJ Focus Profile, GDTF
`cb73a616bb97` "Standard Mode 40ch", Art-Net U0 @ 1/41/…/281, hung at x 4.9, y 3.5 → −10.5 every 2 m, z 5.06; the
tracking stage grid 3 × 15 m centred at x 11.05, y −3.5). A grandMA3 LD must stay in charge of whether HighAsCG or
the console drives the fronts.

## Investigation

### What exists (read before designing)

- **Auto pool and lanes** — `src/tracking/auto-director.js`: the pool is every head whose `follow` is
  `AUTO_MARKER_ID` 64999 (`step`, `pool = fixtures.filter(f => f.follow === AUTO_MARKER_ID)`); each followed person is a
  lane with its own hub marker (A1…A9 = 64999…64991, Pin k = 64980 + k), dropped `LOST_S` 3 s after the person is
  lost (status 0 marker held meanwhile), re-acquired near where it was lost (same uid). `resplit()` (line 181) calls
  `splitHeads` only when lanes / slot counts / pool change. `resolveAuto(fx, marks)` (line 227) is the follow engine's
  hook: the lane's marker, the home point while `homeActive` (WO-709), or null (hold).
- **Split** — `src/tracking/auto-split.js:48 splitHeads`: a lone lane takes **the whole pool** (line 51, owner 23.10);
  2+ lanes share the pool evenly (Hungarian, `hungarian.js`), a kept head costs `STAY_M` 0.5 m less (line 21: the
  hysteresis idea). There is no notion of "only the N nearest heads are used and the rest are dark", and **nothing
  drives a dimmer from tracking** — the engine writes pan / tilt only.
- **Engine** — `src/fixtures/follow-engine.js` tick: an Auto head's target comes from `resolveAuto` (line 262, pinned
  by `smoke-wo708-auto-split`); `tracking` (line 276) = following with marker status > 0 drives the WO-632 read-through
  weight `_w` (line 280: ramps by `dt / fade_s`, 1 when there is no console frame). With a console frame the head is
  written by `blendFixture` (line 291, pan / tilt + `fixed` blended, every other channel = the console's); without one,
  a typed head gets `writeGdtf` (programmer value, else the GDTF default for **every** channel) then `writeFixture`
  pan / tilt (line 299). So in own-DMX mode the Dimmer is the programmer's / the file default (0 for the Focus
  Profile: `Dimmer` 16-bit @ 15/16, default 0) and nothing changes it per head.
- **Read-through** — `src/fixtures/follow-through.js`: `ConsoleFrames` keeps the console's frame per port-address,
  fresh for `STALE_MS` 2.5 s (line 23), `last(pa)` (line 154) holds a lost console's look forever. It only listens
  while read-through or the visualiser is on (`follow-service.js` apply).
- **PSN** — `src/fixtures/psn.js` sends every hub marker as a tracker; the Auto lanes are hub markers, so PSN already
  carries one tracker per followed person (A1 = 64999 …). What PSN cannot say is *which heads* should be on: the desk
  only gets positions.
- **Previs beams** — `src/fixtures/gdtf-visual.js:138` multiplies the beam intensity by the decoded `Dimmer`: the
  previs draws a typed head from the bytes the engine wrote (`tracking:fixtures`), so a dimmer written by the
  automation shows as lit / dark beams with no client change.
- **Self-loop guard** — `follow-service.js` `isSelfLoop` / `reachesSelf` (+ WO-845 re-check): a universe that lands on
  this box's own Art-Net input (:6454, the global-border port-address) or sACN input is never sent.
- **Wiring limits** — `src/tracking/register.js` is at the 500-line limit; `auto-director.js` is 406 lines;
  `follow-engine.js` 350. The `resolveAuto` wiring line and two engine lines are pinned by smoke regexes.
- **Settings homes** — the Auto director's per-box settings live in `~/.highascg/tracking-auto.json` (`auto-store.js`:
  slot head counts, home `after_s`); the rig's output settings live in `project.fixtures` (Godot-owned slice in
  `CLIENT_OWNED_SLICES`, normalized identically by `follow-patch.js` and `follow_model.gd`; every Godot writer of the
  slice goes through `F.normalize`, which keeps only the keys it knows — a new key must be added there or the next
  Godot edit drops it).

### The live box (read-only, 15.11)

- `GET /api/tracking/follow`: output off, protocol psn, through off, dmx off; all 8 Focus Profiles `follow: 0` and
  "would loop into this box's Art-Net input (universe 0)" (broadcast on U0 = the box's own input port-address).
- `GET /api/tracking/auto`: pool empty (no head on Auto), nobody detected; puppet off.
- So a live end-to-end run through the running server would need the project's `follow` changed to Auto — not
  allowed (the owner has this show open). Box verification therefore runs the real modules in a separate node process
  on the live project's patch and GDTF types (read-only) — see "Verified".
- Geometry note: in this project the truss runs along **Y** (stage width = PSN y), not X. "Horizontal distance along
  the truss" must not assume X: the metric is floor distance and thresholds are computed along the rig's own axis.

## What was done

### Design and why

- **Selection — floor distance, greedy, owner-respecting** (`src/tracking/auto-handover.js` `chooseHeads`). Each
  followed person (an Auto director lane) wants `heads` (N, default 3) heads; pairs head↔lane are taken cheapest
  first on floor distance (x, y — the truss here runs along Y, so no axis is assumed). A head that IK cannot reach for
  that person is no candidate (the next nearest is taken). Too few usable heads: shared evenly (⌊T / L⌋ each, the
  remainder to the nearest), auto-split's rule. A head lit or fading out for one person is no candidate for another
  until it rests, so a lit beam is never handed across the stage. *Rejected:* a global Hungarian (auto-split's tool)
  — when two presenters cross it hands every lit head to the other person at once and all of them fade out together
  (a total dark moment in the crossing test).
- **Hysteresis — `margin_m` (default 0.5 m) on the cost**: a head not already active for the person costs margin
  more, so a new head takes over only once it is nearer by more than the margin. Standing on a threshold: 0 changes
  in 60 s of ±0.3 m jitter at margin 0.5 (vs > 10 at margin 0). Margin is in floor metres; with the presenter 6.15 m
  beside the truss line (this rig: heads at x 4.9, grid at x 11.05) a 0.5 m margin is ~0.6 m along the axis (box run).
- **Thresholds** (`thresholds()`): for heads sorted along the rig's own axis (the farthest-apart pair), the bisector
  of head k and head k + N — where a lone person's N-nearest set changes. The live rig gives y 0.5, −1.5, −3.5, −5.5,
  −7.5 (x 4.9). Sent in `tracking:follow` and GET `/api/tracking/follow` → `handover.thresholds`.
- **Take-over — phases rest → preaim → in → on → out → rest.** The incoming head aims at its person dark for
  PREAIM_S (0.5 s, the motor gets there first), then fades up at 1 / `fade_s` (default 1 s) while the outgoing head
  — still following its person — fades down on the same ticks, so their levels sum to 1 (no dark gap, never more than
  N + 1 lit). An outgoing head waits while its replacement is still pre-aiming (or still lit for another person and
  wanted here), but one wanted by another person only waits for pre-aiming heads, so two people trading heads never
  deadlock. Fully out it rests: holds its last aim, dark.
- **Nobody followed** — `idle` "home" (default): the lit heads hold where they are (a lost person is re-acquired
  without a swap; same as Split, which holds) until the director's home is active (WO-709 `after_s`), then every Auto
  head fades out, re-aims dark to its home point and fades up there (a lit head is never swung home). "dark": all fade out.
- **Output a — own DMX** (`src/fixtures/follow-handover.js` `dim`): the head's first GDTF channel with a `Dimmer`
  function = level × base; base = the console's Dimmer under read-through (blended with the read-through weight like
  pan / tilt), else the programmer's `Dimmer` (WO-615), else full. Every other attribute stays the console's
  (read-through) or the programmer's / fixed channels. A head with no Dimmer channel (generic patch) is listed in
  `handover.no_dimmer`. The engine change is three lines in `follow-engine.js` (step, decide/aim, dim).
- **Output b — PSN only + the automation levels universe**: the PSN trackers are unchanged (the lanes are already hub
  markers, A1 = 64999 …); in addition a universe (`levels`: Art-Net or sACN, universe, start address, destination)
  carries address + i = pool head i's level 0–255 (patch order), then 1 "someone followed", A1…A9 and Pin 1…9 (255
  while that lane's person is tracked) — 19 extra channels (`EXTRA_CH`). Sent while the follow output master is on
  (any protocol), through the engine's own send (lighting duty). Refused, with a `levels.problem` shown in the
  section: a bad destination, a rig universe, this box's own Art-Net / sACN input (the `isSelfLoop` guard, WO-845),
  the read-through console universe or the grant universe read back (`reachesSelf`), a block past channel 512.
  Split mode sends 255 for every following / home head.
- **Output c — off**: levels off, output master off → nothing.
- **The LD's grant** (`grant`: universe + address, optional `per_head` = N consecutive channels, patch order):
  read-through only (the heads need a console frame to go back to; without read-through the section says
  `needs_through`). ≥ 128 = HighAsCG drives the pool's pan / tilt / Dimmer; < 128 = the console's values pass through
  with the read-through fade. Revoking freezes the head's level in a `released` phase while the read-through weight
  fades to the console — never a snap (≤ 6 / tick in the test). Re-granted, a lit head fades out first (its aim is the
  console's), then joins. No grant configured = today's behaviour.
- **Lost console fail-safe — hold, then hand back softly.** The console frame is stale after 2.5 s (`STALE_MS`);
  the last fresh grant value is held a further `GRANT_HOLD_MS` (5 s), then the grant is released: the read-through
  fades every head to the console's **last** frame (`ConsoleFrames.last`). Why: a dropped network blip (seconds) must
  not kill the spot in the middle of a speech; a desk that is really gone means the LD is no longer in control of
  the automation, and the safest state is the look the LD last sent — never a snap to black or to defaults. A console
  never seen = not granted (the automation never starts on its own).

### Files

- `src/tracking/auto-handover.js` (new, pure core, 204 lines) — `chooseHeads`, `thresholds`, `createHandover().step`.
- `src/fixtures/follow-handover.js` (new, 268) — `normalizeHandover` (project.fixtures.handover), `FollowHandover`
  (lanes from the director, reach via `aimFixture`, Dimmer, grant, levels universe, status).
- `src/fixtures/follow-engine.js` — creates `this.handover`, steps it per tick, Auto heads in handover mode aim through
  it, `tracking` respects the grant, Dimmer written before the WO-807 pixel map, levels sent after the rig.
- `src/fixtures/follow-patch.js` — `handover: normalizeHandover(s.handover)`.
- `src/tracking/auto-director.js` — `handoverInput(headsOf)`: the lanes `{ id: uid, marker }` and home points; in
  handover mode the director's snapshot shows the handover's heads per person (auto overlay stays right).
- `src/tracking/register.js` — `_follow.engine.autoLanes = auto.handoverInput` (one line; file stays 500).
- `src/fixtures/follow-service.js` — WS `tracking:follow` carries `level` per head + `handover { mode, thresholds, grant }`.
- Godot: `handover_model.gd` (normalize twin, threshold segments clipped to the tracking grid, status / grant
  text), `handover_section.gd` (mode Split · Spot handover; heads per person, margin, fade, nobody → home / dark;
  levels on / protocol / universe / address / destination; grant on / universe / address / per head; status line),
  `handover_3d.gd` (thin floor lines while the Follow section is open and the handover is on); `follow_model.gd`
  keeps the slice (else a Godot save drops it), `follow_section.gd` hosts the section and shows `lit NN%` per head,
  `follow_output.gd` emits `polled` (the status line reuses its GET), `marker_driver.gd` keeps `handover`,
  `previs_tab.gd` adds the lines (2 calls). Beams need no change: the previs decodes the Dimmer the engine wrote
  (`gdtf-visual.js:138`).
- Tests: `tools/smoke/smoke-wo1085-handover-core.test.js` (11), `…-engine.test.js` (14), curated in
  `offline-test-files-2.js`; `godot/client/tests/test_handover_model_wo1085.gd` (6 tests). WO-807's pixel-map smoke
  pinned "pixel map right after writeFixture" — repointed to include the new Dimmer line (same strictness).

### grandMA3 side (PSN only + levels) — NOT TESTED, no desk here

1. PSN as in the in-app help (`godot/client/help/psn-output.md`, grandMA3 ≥ 1.7): one MArker per Auto lane (tracker
   id 64999 = A1, 64998 = A2 …), the spot heads' fixture group set to that MArker on XYZ page 3.
2. Levels: Menu → DMX Protocols → Art-Net (or sACN) → an **Input** line for the levels universe from this box.
3. Per pool head one sequence holding that head's Dimmer at full (or the look you want), on an executor.
4. Menu → In & Out → **DMX Remotes**: one remote per head channel (start address + i), target = that executor,
   type fader — the executor fader follows HighAsCG's level, so the cross-fades are HighAsCG's timing.
5. Optional: channel start + N ("someone followed") on a remote → a sequence for "nobody on stage" (house look).
6. HighAsCG: Follow → Output PosiStageNet ON, Spot handover, "Send head levels to the console" with the desk's IP.
Check on the desk: HTP vs LTP of the executor against other playbacks, and that the remote's fader range maps 0–255.

### Deferred / not built

- sACN console input for the grant (read-through is Art-Net only today, as WO-632).
- PREAIM_S (0.5 s) is a constant, not a setting; the Auto overlay's per-slot head counts (WO-710) do not apply in
  handover mode (N heads per person replaces them).
- Going home: lit heads dip (fade out → re-aim dark → fade up at home, ~1.5 s); accepted to keep "never a lit swing".
- Generic (non-GDTF) heads have no Dimmer: they aim like the rest but cannot be darkened (listed in `no_dimmer`).

## What was VERIFIED

- **Offline (node --test)**: core 11/11 — walk full width and back (lit ≤ N + 1, level sum exactly N after the first
  1.5 s, 10 swaps, each decided 0.2–0.6 m past its threshold in the walk direction), threshold jitter 60 s (0 changes
  at margin 0.5), two presenters crossing (each person's sum ≥ N, a lit head never changes person), contested / shared
  quotas ([2, 3, 3], [2, 2, 2, 2]), lost & re-acquired, idle dark / home, unreachable head skipped, grant release
  freeze, thresholds on X and Y rigs. Engine 14/14 — own DMX (3 nearest at 255, the rest 0, a resting head holds
  its aim, programmer Dimmer 0.5 → 128), no-Dimmer listing, read-through granted (console intensity 200 on the 3
  active heads, colour passes through), revoked (≤ 6 per tick, ends byte-for-byte the console frame), per-head grant,
  lost console (held for GRANT_HOLD_MS, then faded to the last frame: all 200), never seen = not granted, levels
  universe content (PSN-only mode: no rig packets; head levels, someone-followed, A1), Split levels 255, master off =
  nothing, rig / self-loop / read-back refusals, Split byte-for-byte with and without the key, the real Auto director
  feeding it (snapshot shows h5 h6 h7), source wiring pins.
- **Split unchanged — golden compare against HEAD before this WO** (`git archive` of the old `src/`): 400 packets
  test rig (with a programmer value and a non-Auto head), identical; **600 packets on the live project's patch and
  GDTF types** (all 8 Focus Profiles on Auto, 16-bit Dimmer @15/16), identical.
- **Box harness** (a separate node process: live project + `_gdtf` read-only copies in memory, real `FollowEngine`,
  real Auto director with synthetic world persons — the puppet only writes one marker along X and detect-sim needs
  `detection.simulate` in the project, so neither could drive this without editing the owner's show; real
  `ArtnetSender` → `127.0.0.1:6455`, captured by a socket bound there): 70 s, 2772 packets captured = 2772 sent
  (1921 rig U0, 851 levels U100).
  - One presenter walks y +4 → −11 → +4 at 1 m/s (x 11.05): FP1-3 pre-aim dark at 2.02 s, fade in 2.52 s; then
    FP4 in at y −0.6 / FP1 dark, FP5 at −2.6 / FP2 dark, FP6 −4.6, FP7 −6.6, FP8 −8.6; on the way back FP5 at −6.4,
    FP4 −4.4, FP3 −2.4, FP2 −0.4, FP1 1.6 (hysteresis ≈ 1.2 m between the two directions). Every incoming head moved
    dark 0.5 s before its fade. 5–32 s: never more than 4 lit, Dimmer sum min 3.000 / max 3.000 (no dark gap, no
    overshoot); largest pan / tilt step of a lit head 29 / 65535 per 25 ms (no lit swing). FP4 held 17081 / 17088
    while dark (14–16 s).
  - Two presenters crossing (32–47 s): sum min 6.0, max 6.5, at most 8 lit during the swaps.
  - Nobody (47 s): heads hold lit, levels ch "someone followed" / A1 / A2 drop to 0 at 48 s; home at 57 s: all 8 at
    home points by 60 s (dip described above).
  - Levels universe vs rig Dimmer: worst difference 0 (0–255) across 851 packets.
- **Live server**: node restarted once (21:08:45, flock + PID guard) to load the code; GET `/api/tracking/follow`
  → `handover { mode: "split", … thresholds: [], grant.state "off" }`; the project untouched (output off, PSN, follow 0);
  no new journal errors (only the pre-existing U0 self-loop warnings and LTC-out aplay warnings).
- **Godot**: `run-client.sh --test` 28566 passed, 0 failed (the WO file: 70 assertions — normalize parity with node's
  outputs, follow_model keeps the slice, segments clipped to the live grid, status / grant text, the section in a
  tree (Split hides the form, edits emit, levels rows show only when on), the 3D lines only while shown). The new
  scripts pass `--check-only` analysis. **Not seen on glass**: the owner's GUI was not relaunched (rule) — the
  section and lines appear on the next relaunch; the previs beam Dimmer is unchanged code.
- **Not verified**: grant against a real console; the grandMA3 recipe; the levels universe into a real desk.
