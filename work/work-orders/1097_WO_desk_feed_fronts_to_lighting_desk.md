# WO-1097 — Desk feed: the fronts' final pan / tilt / dimmer to the LD's desk on a spare universe; take-over under a fader (MagicQ tested, grandMA3 guide)

**Area:** lighting, tracking-vr, godot-client
**Status: DONE (16.11.26 — 13 node + 4 Godot test functions (Godot suite 28975 passed / 0 failed); live on the box: HighAsCG feed → MagicQ PC 1.9.8.3, Patch Over + Mul-In, take-over playback measured 0 / 49 % / 100 % → 0 / 125 / 254, feed stop held, fader = fail-safe; grant scaling live 0 / 128 / 255 / lost; MA3 side not tested on a console; Godot section not looked at on glass)**

Owner (16.11): "for this we need a path that is after highascgs corrections, calculations etc with the 3 head moving
logic etc. the best path would be to send this as an unused artnet/sacn universe for ld's show and let him programm
highascg take over of fronts under a fader. write a guide for how to on chamsys and ma3".

## 1. Investigation

### 1.1 Where the final values live
- `src/fixtures/follow-engine.js`: every tick builds one 512-byte frame per rig universe (`frameOf(fx)`) with aim →
  calibration (offset / offset_map pins, calibrated pose) → GDTF IK → Auto follow → WO-1085 handover Dimmer
  (`handover.dim`). The frames are built even when the output master is off (`_live(u)` only gates sending). So the
  feed can be tapped from those frames after the tick, with no second computation: byte-for-byte what the heads would
  get, invert and ranges included.
- Split mode (no handover decision) leaves a typed head's Dimmer to the programmer / GDTF default, so the feed applies
  the handover's own writer (`handover.dim`) at level 1 while aimed (following / home / calibrating), 0 otherwise —
  the levels universe's rule (follow-handover.js `send`).
- Guards that must hold for the feed too: the WO-845 self-loop guard (`isSelfLoop`, `reachesSelf`), the levels
  universe, the grant universe, read-through console universes (`through.offset`).

### 1.2 What the desks can do (vendor docs; full notes with quotes in the session scratchpad desk-research/notes.md)
**ChamSys MagicQ 1.9.8.x** (docs.chamsys.co.uk/magicq/1.9.8.x/manual/):
- Setup → View DMX I/O: In Type / In Uni per console universe; Test = Input / Merge (whole universe, HTP).
- Patch → View Chans: per-channel **Merge** + **From**: Input, **Over** (input unless a playback / the programmer
  controls the channel), Merge (HTP), Mult, **Mul-In** (input × MagicQ's calculated value), Copy. No LTP option.
- **DMX In Tracker** (trackers.html): Tracker Rx = DMX Input; pan / tilt taken from the input at the same channel
  numbers (= mirror) while a tracker palette is active, crossfaded by fade times. Needs a console or ChamSys
  hardware ("Remote tracker protocols are only supported on MagicQ consoles and MagicQ PC systems connected to MagicQ
  wings and interfaces"). 16-bit, dimmer: not documented.
- sACN input: highest priority wins; equal priorities alternate. Input loss: no documented timeout.

**grandMA3 2.5** (help.malighting.com/grandMA3/2.5/HTML/):
- DMX Protocols Art-Net / sACN rows with Mode Input → Local Universe, **Merge Mode** Off / Prio / HTP / LowTP,
  **Input Priority** Super, Prog, Highest, High, LTP, Low, Lowest (1.1 added, 1.8 reorganised; LowTP from 2.2).
  sACN input ignores packet priorities.
- A higher-priority playback beats the input — the reverse of "fader up = external". Executor switching of Merge
  Mode: not documented. DMX Remotes drive object faders / keys only, not attributes. Input stop: not documented.
- Merge is per universe: channels the feed does not carry arrive as 0 (whether a Lowest-priority 0 overrides
  defaults: not documented).

**sACN** (ETC sACN library / KB, ENTTEC): source-loss 2.5 s; the highest priority takes the whole universe; equal
priorities are HTP-merged by many receivers.

### 1.3 Layout decision
**Mirror** (default): every fed head's pan, pan fine, tilt, tilt fine, dimmer (+ fine) at its own channel numbers,
one feed universe per rig universe (rig order, from the feed universe up), everything else 0. Why: MagicQ's DMX In
Tracker expects exactly that, MagicQ's Patch Merge (From = same channel) fills itself in, and grandMA3 merges an input
universe channel-for-channel into a local universe. **Compact** (8 ch per head: pan…dimmer fine, active, level) stays
as an option for desks that patch channels by hand; no documented desk recipe needs it.

### 1.4 MagicQ on this box (MagicQ PC 1.9.8.3, demo mode, Xvfb :99)
- Show: new empty show + the HighAsCG-built MVR of the Hilton Wawer rig (8 × ADJ Focus Profile 40 ch, Uni 1 =
  Art-Net 0, 1.001 … 1.281). MagicQ output unicast to 127.0.0.3 and captured there (loopback only, never the rig).
- Tracker Rx shows [Locked] (no ChamSys hardware): the DMX In Tracker cannot be tested here.
- MagicQ took input only when sent to the box's LAN address (192.168.0.15); packets to 127.0.0.1 never showed in
  "In last rx".
- Test sender first (U200 ch1–4 = 10/11/20/21, dimmer 99/98): Input column showed it; **Over** → output = input;
  programmer intensity 1@50 took the dimmer (127) and CLEAR gave it back (99); input stopped → output held unchanged
  for 20 s. **Mul-In** on the dimmer with input 99: desk 0 → 0, 50 % → 49, 100 % → 98.
- ENTER in the Merge column sets **Copy** (my first scripted pass set Copy on heads 2–8; fixed by picking from the
  list) — written into the guide.

## 2. What was done
- `src/fixtures/desk-feed-layout.js` (pure): `normalizeFeed` (project.fixtures.feed: enabled false, artnet | sacn,
  universe 200, dest, priority 1–200, mirror | compact, address), `feedDest` (Art-Net needs the desk's IP, broadcast
  refused; sACN "" = multicast), `feedHeads` (moving, enabled, follow > 0, plus parked), `buildLayout`, `refusal`
  (no / bad / broadcast destination, rig output universe, levels universe, grant universe, own input, read-back
  console universe), `tableRows` / `tableCsv` (the LD's channel table).
- `src/fixtures/desk-feed.js` `DeskFeed`: tapped after every head is written (`follow-engine.js` tick end), bytes from
  `frameOf`; unfed / parked heads hold their last pan / tilt with dimmer 0 (never 0 / 0); sends on change (engine
  rate while moving) or every 1 s; its own switch, independent of the output and DMX masters; through the engine's
  send (lighting duty); E1.31 at the feed priority. Status: live, heads, active, parked, universes, problems, pps.
- **Grant** (second commit): the WO-1085 grant channel (console → this box, slewed over the take-over fade, 0 once
  the console is lost) scales the fed dimmers through the handover's own dimmer writer — one desk fader is
  HighAsCG's dimmer master on any desk (the grandMA3 recipe; grant full = engine bytes unchanged).
- `follow-patch.js` normalizes `feed`; `src/tracking/register.js` `GET /api/tracking/follow/feed.csv` (the follow GET
  block, file kept at 500 lines).
- Godot: `desk_feed_model.gd` (normalize twin + status line), `desk_feed_section.gd` in Follow → Output (switch,
  protocol, universe, desk address, sACN priority, layout, first channel, Copy channel table (CSV), status line, "?"
  → the MagicQ guide); `follow_model.gd` keeps the slice; `follow_section.gd` hosts it and feeds it the poll.
- Help: `godot/client/help/desk-feed-magicq.md` (tested recipe: In Type / In Uni, Patch Over on pan / tilt, Mul-In on
  dimmer, a playback at intensity 100 % = the take-over; measured fader table; fail-safe; DMX In Tracker as the
  untested console route) and `desk-feed-grandma3.md` ("Not tested on a console": Art-Net Input row → local
  universe, Prio + Lowest, grant fader on an executor; whole-universe warning; not-confirmed list); both cite the
  vendor pages; `psn-output.md` links them. Docs: the API contract (docs/wiki/api/contract/http.md) lists the route.
- Tests: `tools/smoke/smoke-wo1097-desk-feed.test.js` (curated in offline-test-files-2.js), Godot
  `tests/test_desk_feed_wo1097.gd`, `test_help_pages.gd` topics + wiring.

Alternatives not taken: per-channel desk switching of the merge (not possible on MagicQ, undocumented on MA3); a
compact-only layout (no desk recipe uses it); feeding through the rig masters (the box must never talk to the rig in
this mode).

## 3. What was verified
- **Offline**: smoke-wo1097 13/13 — mirror byte-for-byte against `frameOf` over a 12 s walk (> 300 packets, > 2400
  head comparisons, take-overs visible, no rig packets), resting / nobody hold, parked hold, compact bytes, Split
  dimmer + programmer, 1 Hz refresh static, off = silent, refusals never sent, sACN priority unicast, grant
  255 / 128 / lost → full / half / dark, wiring + route pins. WO-1085 smokes 33/33 and related follow smokes 162/162
  unchanged. Godot suite 28975 passed, 0 failed (desk feed twin vs node answers, status lines, section show / edit,
  help pages load + links + "?" wiring).
- **Live on the box** (node restarted with the code; project 90c_pgrp_hilton_wawer, feed set via autosave):
  - `GET /api/tracking/follow` `feed` live, 8 heads, ~30 packets/s with the puppet walking, 1/s static;
    `GET /api/tracking/follow/feed.csv` 200 text/csv (Focus Profile 1 pan Art-Net 0.1 → 200.1 … dimmer 0.15 → 200.15,
    540° normal / 270° inverted).
  - HighAsCG → MagicQ (dest 192.168.0.15, U200 → MagicQ Uni 1 In uni "Art 200 (12-8)"), all 8 heads Pan / Pan F /
    Tilt / Tilt F = Over, Dimmer / Dimmer F = Mul-In; MagicQ output captured on 127.0.0.3 (~22 packets/s):
    - fader 0 (Mul-In, no intensity): pan / tilt follow HighAsCG on all 8 heads, dimmers 0;
    - take-over playback PB1 (heads 1–8 intensity 100 %): **100 % → 254** (feed 255), **49 % → 125**, **0 → 0**,
      pan / tilt HighAsCG's at every level;
    - 30 s walk at 100 %: every head lit at some point (max 254), 32–91 in-between dimmer values per head = the 1 s
      handover fades passing through; 96–301 distinct pan values per head;
    - programmer LOCATE on 1–8: pan / tilt 32896 (128/128) on all 8 (desk wins under Over), dimmers = 100 % ×
      HighAsCG (lit only where HighAsCG lit them); CLEAR → HighAsCG again;
    - feed switched off: MagicQ output unchanged for 12 s ("In last rx" counting up, lit fronts stayed lit); pulling
      PB1 → all dimmers 0 = the fail-safe.
  - Grant live (feed → 127.0.0.4 capture, test console → 127.0.0.2 U50 ch512): no console → fed dimmers 0; 255 → 255;
    128 → 128; console stopped → last lit packet +7.3 s, then 0, grant state "lost".
  - Screenshots (scratchpad only, MagicQ's UI): /tmp/claude-1000/-home-casparcg/b8ff075d-eabe-4bed-9570-f2b4603d84a3/scratchpad/mq/h8bc.png
    (Patch: Over / Mul-In, Output = Input), f1c.png / f2c.png (PB1 at 100 / 49), io3c.png (In uni 200 receiving),
    evidence-small.png.
- **Not verified**: the grandMA3 recipe on a console (every *not confirmed* in its page); the MagicQ DMX In Tracker
  route (locked without ChamSys hardware); a MagicQ cue fade on the fronts' position (snap vs fade); sACN into
  MagicQ; the Godot section on glass (Godot tests only; the running GUI picks it up on its next relaunch).
- Box left as found: project fixtures identical to before (feed key absent, grant off), puppet off, MagicQ quit,
  ~/Documents/MagicQ restored byte-identical (new files moved to the scratchpad), Xvfb :99 stopped.
