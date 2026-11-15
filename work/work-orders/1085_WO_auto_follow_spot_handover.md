# WO-1085 — Auto follow: spot handover (N nearest heads lit, the rest dark, cross-faded take-overs; PSN-only levels to the desk; the LD's grant)

**Area:** tracking-vr, lighting, godot-client
**Status: DONE (15.11.26 — 33 node + 7 Godot tests; box harnesses on the live patch → 127.0.0.1:6455; Split / no-grant byte-identical; follow-up: grant scales the PSN levels; GUI shows on the next relaunch; MA3 side untested)**

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
- **The LD's grant** (`grant`: universe + address, optional `per_head` = N consecutive channels, patch order): *(Follow-up below: the grant now also
  scales the levels universe, proportionally, in PSN + levels mode.)*
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

### grandMA3 side (PSN + levels, the one-fader workflow) — NOT TESTED against a desk

1. PSN as in the in-app help (`godot/client/help/psn-output.md`, grandMA3 ≥ 1.7): one MArker per Auto lane (tracker
   id 64999 = A1, 64998 = A2 …), the spot heads' fixture group set to that MArker on XYZ page 3. The desk aims.
2. **The grant fader**: patch one spare channel as a dimmer-only fixture named e.g. "HighAsCG grant" on a universe
   the desk outputs to this box over Art-Net (Menu → DMX Protocols → Art-Net → an Output line to this box's IP). Put
   it on a fader. In HighAsCG: Follow → Spot handover → Grant on, that universe (port-address) and address.
3. **The levels**: Menu → DMX Protocols → Art-Net (or sACN) → an **Input** line for the levels universe from this
   box. Per pool head one sequence holding that head's Dimmer at full (or the look you want), on an executor; Menu →
   In & Out → **DMX Remotes**: one remote per head channel (start address + i), target = that executor, type fader.
   HighAsCG's level is the fader, so the take-over cross-fades are HighAsCG's timing.
4. **The workflow**: grant fader up = the automation's levels arrive (scaled by the fader, slewed at the take-over
   fade, so a snapped fader still fades); grant fader down = levels 0 = the executors sit at 0 and the LD's own
   playbacks have the fronts. Pan / tilt keep following through PSN either way (they are dark unless lit).
5. Information channels (never scaled): start + N "someone followed", then A1…A9, Pin 1…9 — e.g. a remote on
   "someone followed" for a house look; the channel after them echoes the grant HighAsCG applies now (0–255), so a
   desk channel monitor shows the permission is honoured.
6. Lost desk → HighAsCG holds the last grant 7.5 s (2.5 s stale + 5 s), then fades its levels to 0.
Check on the desk: HTP vs LTP of the executors against other playbacks, and that a DMX remote's fader maps 0–255.

### Deferred / not built

- sACN console input for the grant (the console input is Art-Net only today, as WO-632).
- PREAIM_S (0.5 s) is a constant, not a setting; the Auto overlay's per-slot head counts (WO-710) do not apply in
  handover mode (N heads per person replaces them).
- Going home: lit heads dip (fade out → re-aim dark → fade up at home, ~1.5 s); accepted to keep "never a lit swing".
- Generic (non-GDTF) heads have no Dimmer: they aim like the rest but cannot be darkened (listed in `no_dimmer`).

## Follow-up (15.11, owner): the grant in PSN + levels mode

Owner: "psn plus an extra universe seems good. how to make the input universe from highascg drive real dimmers but
only when the operator lets it". **Investigation**: the grant was read only with read-through
(`follow-handover.js _readGrant` returned "off" unless `_thru()`), and the console's Art-Net input
(`ConsoleFrames`) was only started for read-through or the visualiser (`follow-service.js` apply). In PSN mode the
desk drives every real dimmer, so the only thing the grant can hold back is the levels universe.

**What was done** (`src/fixtures/follow-handover.js`, `follow-service.js`, Godot `handover_model.gd` /
`handover_section.gd`):
- The grant is read in every mode once configured; `follow-service.js` starts the console input when
  `handover.grant.enabled` (the WO-1078 pin `|| vis.length) consoleFrames.start()` still matches).
- **Levels: proportional.** Each head level × grant / 255 (per head with `per_head`), slewed towards the value at
  1 / `fade_s` per second (`_slewGrant`): one desk fader cross-fades the whole automation, a fader snapped to 0 or
  full still fades (≤ 7 per 25 ms tick at 1 s). Presence channels stay unscaled; a new channel after Pin 9 echoes the
  applied grant (`EXTRA_CH` 19 → 20; the per-head echo is the mean). The levels apply the proportional grant in
  every mode (also next to read-through).
- **Rig (own DMX + read-through) keeps the ≥ 50 % switch.** Why not proportional there too: the grant hands over
  pan / tilt as well, and a pan half-way between the desk's position and the person is no look; the read-through
  fade already gives the switch a soft edge. Own DMX without read-through: the grant scales the levels only
  (`needs_through` says so).
- **Fail-safe**: the same hold — the last fresh value is used for `GRANT_HOLD_MS` (5 s) after the frame is stale
  (2.5 s); then (state "lost") the target is 0 and the levels fade out: when HighAsCG can no longer hear the LD's
  permission it stops asking for light. The rig is untouched (in PSN mode the desk drives it). Never seen = 0.
- **Collisions**: the levels universe on the grant's Art-Net universe is refused (`levels.problem`), on top of the
  rig / self-loop / read-back refusals.
- **No grant configured**: unscaled, echo channel 0 — the packets are byte-identical to before.
- **Status / UI**: `grant.applies` ("levels" | "rig"), `grant.value` (the fader's byte), `grant.applied` (0–255).
  The Godot section keeps the levels and grant rows reachable in Split too (the spot settings hide); its status line
  reads e.g. "grant: LD fader 50 % — levels × 50 %", "console silent — last grant held …", "console lost — levels
  fading to 0 …", "no console frame on U5 yet — levels at 0".

**Verified**:
- Engine suite 22/22 (8 new: grant 0 / 128 / 255 → head levels 0 / 128 / 255 with presence 255 and the echo equal,
  no rig packets in PSN; fader snaps 255 → 0 → 255 with no step > 7; lost console held for GRANT_HOLD_MS then faded
  to 0 with "someone followed" still 255; never seen = 0; per-head [255, 0, 128] on the three active heads with the
  mean echoed; levels on the grant universe refused; no grant = full scale, echo 0; the service wiring pin).
- Golden compare against the commit before the follow-up (`a0f7dca4`), no grant configured: handover PSN + levels
  849 / 849, handover Art-Net + levels 849 / 849, Split + levels 615 / 615 packets identical.
- Box harness (`box-harness-grant.js`: the live patch read-only, PSN mode, a real `ConsoleFrames` fed encoded Art-Net
  grant packets at ~40 Hz on U5 ch 512 — no socket on :6454, so the live server's input saw nothing; real
  `ArtnetSender` → 127.0.0.1:6455, 201 / 201 packets captured, no rig universe): presenter at y −3 → FP3-5 chosen;
  fader 0 → levels 0 while presence 255; ramp to 255 over 2 s → 121 at 5 s, 255 by 7 s; snap to 0 at 10 s → 0 by
  11 s; snap to 255 at 13 s → 255 by 14 s; 128 at 16 s → 128; console silent at 19.0 s → held 128 until 26.48 s,
  all 0 at 26.95 s; largest head-level change per tick 7.0 (slew 6.4 + rounding). Echo channel followed throughout.
- Live server restarted (21:22:55, flock + PID guard): `handover.grant` "off" / applies "levels", console input not
  started (grant off in the owner's show), no new errors (the live-audio ALSA bridge error is on every boot since
  20:53, before this work).
- Godot `test_handover`: 76 passed (levels-mode grant texts, Split keeps levels + grant reachable).

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
