# WO-731 — Audio operator page: presenter cards from the intake, mic → desk channel matching, Accept drives the desk

**Area:** audio
**Status: DONE (24.10.26) — offline smokes 18/18 (accept rule, service, routes, and an emulator for each protocol
family); live on this box against an emulated X32: Accept unmuted and raised a low fader, and left a higher fader
alone. Owner QA on a real desk is still open (see the end).**

Owner, 24.10: *"create a sister page for intake for audio operators where there is a little dashboard with the
presenter photos from intake, with mic # note etc. ability to accept the presenter from there and set audio
automations … automations should let operator match channels to the mics, on accept unmute the presenters mic
channel and make sure its at least on threshold level (shouldnt move it if higher, only move when fader is lower).
so for operator, choose desk, input ip, match channels to mics, accept presenters."*

## Investigation

**Prior work.** WO-675 built the presenter roster (photo, name, mic #, note; `src/tracking/presenters.js`, routes
under `/api/tracking/presenters`, phone intake at `/intake`). Its owner decision **D4** said *"mics go through
Companion, no desk protocol on the box"*. **This request reverses D4 for mics.** The box now talks to the desk
directly. Companion actions on a presenter (`on_enter`/`on_exit`) are unchanged.

The roster ids are **reused slots** (`p${nextSlot()}`, presenters.js `create`). Deleting p1 and adding someone new
gives them id p1 again. An accept result keyed only by id would show on the new person. The result therefore
carries the presenter's `created` stamp, and the page only shows it when that stamp matches. This was found while
cleaning up after the live test.

**Desk protocols.** Each fact below was checked against a primary document (maker PDF or spec) and, where one
exists, the Bitfocus Companion module that is in daily use with that desk. Research notes are in the session
scratchpad. The sources that matter:

| Family | Transport | Mute | Fader | Read back | Source |
|---|---|---|---|---|---|
| X32 / M32 | OSC UDP 10023 | `/ch/NN/mix/on ,i` 1 = **on** | `/ch/NN/mix/fader ,f` 0..1, 4-segment law (f ≥ .5: 40f−30; ≥ .25: 80f−50; ≥ .0625: 160f−70; else 480f−90; 0 = −∞) | same address, no args | X32-OSC.pdf (Companion behringer-x32 `docs/`), Maillot unofficial OSC doc |
| X Air / MR | OSC UDP 10024 | same as X32 | same | same | X AIR Remote Control Protocol.pdf |
| WING | OSC UDP 2223 | `/ch/N/mute` 1 = **muted** | `/ch/N/fdr` in dB, −144 = −∞ | query → `,sff`/`,sfi`; the 3rd value is in real units | WING Remote Protocols V3.0.6 (Music Tribe), pmaillot/WingRemoteProtocols |
| Yamaha CL/QL/TF/DM3/DM7/RIVAGE | RCP, TCP 49280, LF lines | `set MIXER:Current/InCh/Fader/On <ch0> 0 1` (1 = on) | `…/InCh/Fader/Level` dB×100, −32768 = −∞, max 1000 | `get …` → `OK get addr x y val` | Companion yamaha-rcp `schemas/` (prminfo dumps per model), BrenekH/yamaha-rcp-docs, DM3/DM7 OSC spec PDFs |
| A&H dLive | MIDI over TCP 51325 (MixRack) / 51328 (Surface) | `9N CH 7F\|3F 9N CH 00` (vel ≥ 40 = muted) | NRPN `BN 63 CH BN 62 17 BN 06 LV`, LV = (dB+54)/64·127 | SysEx `F0 00 00 1A 50 10 01 00 0N 05 0B 17 CH F7` (fader), `… 05 09 CH F7` (mute), `… 01 CH F7` (name) | dLive MIDI Over TCP/IP Protocol V1.9/V2.0 PDF, Companion allenheath-dlive |
| A&H SQ | MIDI over TCP 51325 | NRPN MB 00 / LB n−1, VF 01 = muted | NRPN MB 40 / LB n−1 (to LR), 14-bit | `BN 63 MB BN 62 LB BN 60 7F` → the 4-CC set message | SQ MIDI Protocol Issue 3 PDF, Companion allenheath-sq |

Channel counts used for "Read channel names" and the channel lists: X32 32, X Air 16, WING 40, CL/QL 72, TF 40,
DM3 16, DM7 120, RIVAGE 288, dLive 128, SQ 48. Yamaha counts come from the prminfo dumps. Yamaha has no "DM5"; the
DM family is DM3 and DM7 (with DM7 Compact).

Findings that shaped the code:
- **SQ fader law.** Companion uses dB = (v−15196)/118.775. That drifts from the PDF's Linear Taper table. A fit of
  (v−15196)/118.72 hits every row of the table exactly (`allenheath-sq.js`, smoke checks the rows). The SQ's
  NRPN fader law must be set to **Linear** on the desk. The model label says so.
- **dLive** answers a get with the normal set message and uses running status. TCP splits and coalesces freely,
  so bytes go through a real MIDI parser (`midi-tcp.js`: running status, real-time bytes dropped, SysEx collected,
  NRPN assembled per channel). Velocity 00 in the mute note is "ignored" per the PDF; the read matches `vel > 0`.
- **No echo on sets** (X32, WING): Accept always reads back with a query rather than trusting the set.
- **WING allows one subscriber**; we never subscribe, only query.
- **Yamaha RCP** pushes `NOTIFY` lines and can answer late. One command is in flight at a time, and a late `OK`
  only resolves the pending command if its verb and address match.
- **Avantis is not offered.** It has the same set messages as dLive but no documented read, so it cannot honour
  "never lower a fader that is higher".
- **DiGiCo** (OSC, External Control must be enabled on the console) is possible later. **Midas PRO** and
  **Soundcraft Si/Vi** have no usable open protocol: not offered.
- **Caveat:** a mute group or a DCA can still silence a channel that is ON with its fader up. Accept sets the
  channel's own mute and fader only. The page says what it did.

## What was done

`src/audio-desk/` (new):
- `desk-models.js`: the model list (label, family, default port, input count) and `createDriver`. Drivers are
  required lazily, so the server pulls in no desk code until a desk is chosen.
- `drivers/osc-udp.js` (one query in flight, one retry), `behringer-x32.js` (X32 + X Air), `behringer-wing.js`,
  `yamaha-rcp.js`, `midi-tcp.js`, `allenheath-dlive.js`, `allenheath-sq.js`. Each driver offers the same calls:
  `probe`, `getChannel(n) → { on, db }`, `setOn`, `setDb`, `names(count)`, `close`.
- `desk-service.js`: the link (connect → probe, status off / connecting / ok / error), a queue so desk calls never
  overlap, and **the accept rule** `acceptChannel`:
  1. read the channel;
  2. if muted → unmute;
  3. if the fader is below the threshold (0.1 dB tolerance) → set it to the threshold. If it is at or above the
     threshold → **leave it**;
  4. read back. OK = on and fader ≥ threshold − 0.5 dB (desk quantisation).
  The result says what happened in words, e.g. `unmuted, fader -30 → 0 dB` or `already on at 5 dB`, and goes to the
  journal as `[audio-desk] accept …`. Changing the threshold or the mic map does not reconnect. Changing the model,
  host, port or MIDI channel does.
- `desk-store.js`: settings in `~/.highascg/audio-desk.json` (outside the synced repo; a temp file under the test
  runner). Threshold −60..+10 dB, default 0. Mic names follow the intake's mic field (16 chars).
- `audio-routes.js`: the page and its JSON (contract in the file header). A server whose presenters duty is off
  (WO-723) answers 409, like the intake.
- `audio-page.html`: one page in the intake's style. Desk row: model, IP, port (placeholder = model default),
  MIDI channel (A&H only), "Fader at least (dB)", Connect, status. Mic → channel table with the desk's channel names
  ("Read channel names") and "Add mic". Presenter cards: photo, name, mic → channel, note, last result, **Accept** /
  **Accept again**. The button is disabled with a reason when the mic has no channel. Polls every 2 s.

Wiring:
- `src/tracking/register.js` creates the service on init and stops it on shutdown. `handleAudioDesk` answers before
  the presenter routes, as its own line, so the WO-708 pin on the `handlePresenters … || handleAuto(…)` line is
  untouched (the first attempt chained it in and broke that pin).
- `src/server/http-server.js` makes `/audio` a 302 to the page, next to `/intake`.

Why direct protocols rather than Companion buttons (D4): Companion can't express "raise only if lower" without a
read. Each desk needs a read-then-write. Doing that on the box keeps the rule in one tested place.

## What was VERIFIED

Offline (in the CI list, `tools/ci/run-offline-tests.js`):
- `smoke-wo731-audio-desk.test.js`, 9 tests: the accept rule (low → raised and unmuted; higher → never written;
  at the threshold within quantisation → no write; −∞ counts as lower; a desk that doesn't follow is reported),
  settings validation, the service (reconnect only on link fields, mic → channel, 409 for unmapped or missing mics,
  a throwing desk → 502 + error status, the result carries `created`), routes incl. the 409 duty-off page, wiring
  pins (register, `/audio` redirect, the page's `created` match).
- `smoke-wo731-desk-drivers.test.js`, 9 tests against emulators on localhost:
  - X32 (read, unmute, raise, names, `/info`) and X Air (a higher fader is never written); a silent desk is a clear
    "no answer" error;
  - WING (`,sff`/`,sfi` replies, dB, mute 0);
  - Yamaha RCP (get/set lines, labels after values, NOTIFY lines ignored, ERROR reported with the desk text);
  - dLive (the exact bytes from the PDF go out; running-status replies with active sensing, split across TCP
    writes, come back);
  - the MIDI parser (running status, SysEx, real-time bytes inside messages, NRPN per channel);
  - SQ (get answers the 4-CC message; mute and 0 dB match the protocol tables).
- **18/18 pass.** Full `test:ci` on a clean export: 3161 tests, 3157 pass, 3 skipped, 1 fail (WO-498, which only
  fails in an export without `.git`). Lint 214 warnings (unchanged), max-lines, unwired-exports, repo-integrity
  and boot all OK.

Live on this box (server restarted on the WO-731 code), against an emulated X32 on 127.0.0.1:10123:
- `/audio` → 302; the page returns 200 text/html.
- Desk x32 / 127.0.0.1 / 10123: status ok "X32 (emulated) · firmware 4.06". "Read channel names" listed
  `2:HH Bob`, `5:Lav Anna`.
- Two intake presenters (mic 3, mic 7) with mics matched 3 → ch 5, 7 → ch 2:
  - ch 5 muted at −30 dB: Accept → `unmuted, fader -30 → 0 dB`. The emulator logged `SET /ch/05/mix/on 1` and
    `SET /ch/05/mix/fader 0.75` (0.75 = 0 dB on the X32 law).
  - ch 2 on at +5 dB: Accept → `already on at 5 dB`, **no write** at the emulator.
  - The journal has both `[audio-desk] accept …` lines.
- Cleanup: both test presenters deleted, desk settings reset to "no desk", emulator stopped, server restarted.
  After the restart the view showed desk off and nothing accepted.
- No page screenshot: headless Chrome on the box hangs on the page (it keeps polling) and puppeteer isn't installed.

**Owner QA (open):** connect to a real desk and run the checklist below. Vendor docs and emulators can't prove a
real console's behaviour.
1. Choose the model, type the desk IP (and MIDI channel for A&H), press Connect: status turns green with the
   model/firmware.
2. "Read channel names": the desk's names appear in the channel lists.
3. Mute a mic channel and pull its fader down, then Accept: the channel unmutes and the fader comes up to the
   threshold.
4. Push the fader above the threshold, then Accept again: nothing moves.
5. SQ only: set the desk's NRPN fader law to Linear first. dLive Surface: port 51328.
