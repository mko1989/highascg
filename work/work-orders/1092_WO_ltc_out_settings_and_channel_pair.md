# WO-1092 — LTC out: on time at the card, real settings, LTC on its own channel (pair) of a multichannel output

**Area:** audio, engine, godot-client
**Status: DONE (16.11.26 — decoded at the card with an independent decoder (25 / 29.97 DF / 30 / 24 fps), share proven on the PCH card with Caspar playing, missing-device back-off live; mixed-output per-channel RMS needs snd-aloop (owner command below))**

Owner (16.11): "the ltc output needs better settings and additional ability to send the ltc out of a specific channel
(pair) of a multichannel output." Live symptom: `[LTC out] aplay -D plughw:CARD=Pro,DEV=0 exited: … No such device`
every 2 s (20 325 such lines in today's journal before the fix, 970 between 11:00 and 11:47). UI placement (owner, via
WO-1093): no Timecode page in Settings — LTC lives in the Audio tab as one compact fold.

## 1. Investigation

Code as found (snapshot of the pre-WO files; line numbers are of that snapshot):

- **Generator.** `tools/ltc/ltc_helper.py` (libltc via ctypes) encoded frames and wrote them to `aplay` started by the
  helper on a 4 KiB pipe (WO-1058). Rates: `timecode-math.js` modes 24 / 25 / 29.97 DF / 30 only — no 23.976, no
  29.97 NDF; the rate was the shared `ltc.fps`, not the on-air timeline's (a 50 fps show sent 25 only because the
  operator typed it). No DF override, no user bits (always 00000000).
- **Playhead / pacing.** `src/timecode/ltc-output.js:37-39` targeted `playhead + cfg.leadMs` (default 60,
  `ltc-config.js:48`) and judged the encoder's reports against the wall clock at REPORT time — a report said which
  frame was being written, not when it would play. The real path (encoder → 4 KiB pipe → aplay's buffer → card) was
  ~143 ms, so LTC ran 53–109 ms **late** depending on start phase (± the 2-frame tolerance `:18`), the re-locate
  "aim" (`:56, :102`) learned a landing latency instead of measuring it.
- **Sink / device / level.** `:159-160` `aplay -D <device> -c <channels>`; level −18 dBFS peak (fine); one channel only
  (`channel`), no pair, no notion of the program card.
- **Failure handling.** `:17 RESTART_MS = 2000`, `scheduleRestart` (`:129-139`) logged a warn line on EVERY retry and
  respawned forever — the journal storm. No state in `/api/ltc` beyond `error`, nothing in keeping-up.
- **Settings.** `config.ltc.output` = enabled, source, sink, device, channels, channel, path, volumeDb, offset, leadMs.
  Edited in Settings ▸ Timecode (`godot/client/features/settings/ltc_pane.gd`), stored in config/general.json (ltc).
- **Stop / loop / seek.** A seek or loop wrap re-located with a learned aim: 2–3 re-locates per jump, first frames
  after a wrap off by up to 4 frames; pause = silence (good, a chasing reader parks).
- **Multichannel.** Not possible: Caspar's PortAudio consumer opens the program card `hw:0,0` exclusively, a second
  opener gets EBUSY.

Measured before (tools/ltc/measure-ltc-out.js, the OLD module, ALSA `tee` tap in front of hw:1,7 + the card's
`hw_ptr` timing each sample, independent biphase decoder tools/ltc/ltc-biphase.js; error = LTC − playhead):

| run | start latency | steady error | after seek | after resume | after wrap | breaks |
|---|---|---|---|---|---|---|
| before1 | 153 ms | −73.1 ms | −73.1 | −73.1 | −73.1 | 3 |
| before2 | 149 ms | −68.5 | −68.5 | −108.5 | −68.5 | 3 |
| before3 | 136 ms | −55.7 | −55.7 | −55.7 | −55.7 | 3 |
| before4 | 173 ms | −93.1 | −53.1 | −93.1 | −53.1 | 3 |
| before5 | 172 ms | −92.4 | −52.4 | −92.4 | −52.4 | 3 |

(parity errors 0, level −18.1 dBFS peak in all; the error is constant within a run — jitter is in the start phase.)

## 2. What was done

**Encoder plays to ALSA itself** (`tools/ltc/ltc_helper.py`): libasound via ctypes, `snd_pcm_set_params`
S16_LE / 48 kHz / 40 ms, EPIPE → `snd_pcm_recover` (counted as under-runs). Each report carries `at` = wall time
the frame's first sample PLAYS (`time + snd_pcm_delay`). Commands: `align TC EPOCH` (that frame starts playing at
that wall time: pads < 1 frame of silence or skips frames), `slew N` (stretch / shrink ≤ 1 % per frame), `hold`,
`stop`, `quit`; `--df`, `--userbits`, `--channel 7,8`. Exit 5 = open failed, 4 = sink lost. The PCM is closed on
every exit path (quit, EOF, SIGTERM/SIGHUP, write error) — see the share section for why.

**Lock** (`src/timecode/ltc-out-sync.js`, pure; `ltc-output.js`): error = label − expected(at). ≥ 1 frame or a
playhead jump → one `align` to the exact epoch; smaller steady errors → `slew` (median of 5 reports, 1.5 ms
deadband). Reports between an align and the helper's `{"aligned"}` are ignored (they describe frames written before).

**Device trouble** (`ltc-output.js`): states off · starting · running · silent · missing · busy · error; ONE journal
line per state change (`missing: … is not connected`, `back: …`); a card absent from /proc/asound/cards is polled
every 2 s without spawning anything and resumes at once when plugged; other failures back off 2 → 4 → 8 → 16 → 30 s
(reset after 5 s healthy). `GET /api/ltc` output has state, device latency, drift, under-runs, re-aligns.
Keeping-up "LTC out" check (`src/health/keeping-up-ltc.js`): amber for missing / busy / not running / under-runs /
drift re-aligns, nothing while LTC out is off.

**Settings — the minimal block** (`src/timecode/ltc-config.js`, defaults in `LTC_DEFAULTS.output`, reset root
`src/config/defaults-core.js`):

| key | why |
|---|---|
| `device: 'program'` + `channel` + `pair` | the owner's ask: LTC on channel n (or n+n+1, the same signal on both) of a multichannel output |
| `fps: 'timeline'` or a forced rate (adds 23.976, 29.97 NDF) | follows the on-air LTC timeline (50 → 25, 59.94 → 29.97 DF, 60 → 30); forced for a receiver fixed to one rate |
| `source: 'test'` | free-running from `offset`: line up a receiver without a show |
| `latencyMs` (replaces `leadMs`) | trim to meet picture at the receiver; 0 is now correct at the card (leadMs 60 compensated a path that is gone) |
| `whenPaused: silence \| hold` | silence lets a chasing reader park (default); hold repeats the frame for displays that blank on silence |
| `userBits` | 8 hex digits; some receivers / shows carry a date or reel there |

Rejected: a separate DF toggle (the rate key carries it: 29.97 = DF, 29.97 NDF), output sample rate (48 kHz fixed —
Caspar is 48 k), "lead"/pre-roll (the align is exact), a level in dBu (needs the card's calibration; dBFS + the
R68 note), per-timeline LTC offsets (stay with the timeline: `ltcOut` per timeline, WO-1060), LTC through Caspar
(below).

**LTC on a channel (pair) of the program card** (`src/timecode/ltc-share.js` pure, `ltc-share-io.js`): two ALSA
`dshare` PCMs on one slave (same `ipc_key`, disjoint bindings) in a managed block of `~/.asoundrc` (both services run
as casparcg, HOME=/home/casparcg; no root):
`hcg_prog_<card>_<dev>` = plug (ttable) → dshare on the program channels that are not LTC's;
`hcg_ltc_<card>_<dev>` = plug → dshare on the LTC channel(s); slave hw at all channels, 48 kHz, period 256,
buffer 1024. While LTC shares, the casparcg.config generator names `hcg_prog_…` as the PortAudio device
(`build-caspar-generator-config-audio.js` → `programDeviceName`), Apply restarts Caspar. dshare keeps a channel mask
in shared memory: a client asking for a used channel is refused ("destination channel specified in bindings is
already used"), so program can never reach LTC's channels and LTC never the program's. LTC never enters Caspar, so
stream / record / NDI (Caspar consumers) cannot carry it. A device that is not the program card is opened directly
(plughw, all channels, LTC on the chosen ones, silence elsewhere). `GET /api/ltc/devices` lists the program output
first, then every playback device with channel count and who uses it.
Rejected: LTC as a Caspar layer/channel (record / stream / NDI would carry it, the mixer would touch it, a Caspar
restart cuts LTC), PulseAudio/PipeWire routing (none runs for Caspar here), `/etc/asound.conf` (root).
Trade-offs: the program card runs through dshare (period 256, buffer 1024 = 21 ms; Caspar used period 256 directly);
the LTC channels are taken from the program layout (a 6-ch card with stereo program: ch 3+4 free); dshare channels
of a client that dies without closing stay marked used until Caspar restarts — hence the clean close below.

Box findings while proving it (all fixed in a6ad7118):
- A dshare client that is SIGKILLed keeps its channels: node used `quit` + immediate SIGKILL, and systemd
  (KillMode=mixed) SIGKILLs every node child when node exits → after ANY node restart LTC was refused on the shared
  card. Now: quit → SIGTERM 0.5 s → SIGKILL 1.5 s, a new encoder waits for the old one, the helper closes its PCM on
  every exit, and node's shutdown awaits LTC out (≤ 1 s). The leftover case says what frees it.
- LTC's start path counted the card's channels with `aplay --dump-hw-params` on `hw:0,0` when the card was free —
  i.e. exactly while Caspar restarts at Apply. It now never opens the card (the picker asks a free card once, cached).
  Caspar fell back to "default" once at 11:50 with the probe in place; whether that probe or a GUI start caused it is
  not proven (see the GUI note below) — after the fix, 2/2 Apply rounds A→B landed on hcg_prog_PCH_0.
- **Not LTC's, but it bites the share:** a Godot client started while Caspar restarts opens ALSA "default" → dmix on
  card 0 and holds hw:0,0; Caspar then cannot open hw:0,0 (or hcg_prog) and falls back to "default" (seen 12:08 with
  another session's GUI relaunches: `/proc/*/fd` → godot held pcmC0D0p). Follow-up candidate: the Godot client should
  not open the program card (dummy audio driver or a non-program device).

**UI** (`godot/client/features/audio/ltc_fold.gd`, in the Audio tab under the hardware panes): one status line while
closed; open → LTC out: Send, Device (from /api/ltc/devices), Channel (Ch n / Ch n+n+1), share note, Time, Start TC,
Level, measured status; "More": LTC rate, user bits, latency trim, while paused. LTC in keeps its rows (Read, From,
device/slot, channel, chase; "More": rate, channels, chase offset). Settings ▸ Timecode removed
(`features/settings/settings_tab.gd`: the preload + `LtcPane.build` lines; `ltc_pane.gd` deleted) — config keys
unchanged. Helpers in `features/settings/ltc_model.gd`.

## 3. Verified

Decoded at the card (measure-ltc-out.js: the NEW module, tee tap on hw:1,7 + hw_ptr, independent decoder;
scripted playhead: stopped 1.5 s, play, seek to 60 s, pause 2 s, resume, loop wrap, stop):

| run | fps | frames | parity bad | start latency | steady (sd) | after seek | resumed | after wrap | DF flag | user bits |
|---|---|---|---|---|---|---|---|---|---|---|
| after1 | 25 | 658 | 0 | 79.7 ms | +0.3 ms (0) | +0.3 | +1.1 | +0.9 | no | 00000000 |
| a2 | 25 | 657 | 0 | 78.9 | +1.1 (0) | +0.2 | +0.5 | +1.0 | no | 00000000 |
| a3 | 25 | 656 | 0 | 119.0 | +1.0 (0) | +0.5 | +0.9 | +0.9 | no | 00000000 |
| a4 | 29.97 DF | 787 | 0 | 99.1 | +1.0 (0) | +0.6 | +0.4 | +1.5 | yes | 00000000 |
| a5 | 30, hold, ub | 904 | 0 | — | +0.3 (2) | +0.2 | +0.4 | +0.4 | no | deadbeef |
| a6 | 24, trim 20 ms | 630 | 0 | 102.6 | −19.3 (0) | −18.9 | −19.5 | −19.2 | no | 00000000 |

Monotonic within each segment, one align per seek / wrap (relocates 2 per run = the seek + the wrap), 0 drift
re-aligns, 0 under-runs, peak −18.1 dBFS, silence while paused (a5: held frames by design, counted as breaks).
Start latency 79–119 ms (frame-quantised: the first frame after the sink opens) vs 136–173 ms before; steady error
≤ 1.5 ms vs −52…−109 ms before. The pacing smoke passed under full CPU load (28 busy loops, 5/5).

Shared program card on the box (PCH ALC1220, 6 ch, Caspar playing; LTC device 'program', channel 3, pair):
- Apply → Caspar log `Using PortAudio device: "hcg_prog_PCH_0"`, card hw_params `channels: 6`, dshare segment
  nattch 2, `/api/ltc` running, device latency 14–19 ms, drift −0.2…−0.1 ms, 0 under-runs.
- Through the share (tee in front of hcg_ltc_PCH_0, Caspar on the program channels): 658 frames decoded, 0 parity
  errors, 0 under-runs, −18.1 dBFS. Timing through dshare is not measured by the tool (the slave's hw_ptr is not
  the client's stream position); the helper's own report says drift 0.
- Clash: a second client on LTC's channels is refused (EINVAL "already used") — the isolation mechanism.
- Two node restarts with the share running: LTC back `running` each time, no `Killing process … python3` line.
- Apply race rounds (LTC busy on the program card while Caspar holds hw:0,0 → Apply): 2/2 Caspar on hcg_prog,
  LTC running.

Missing device live (owner config, plughw:CARD=Pro,DEV=0 absent): journal after a node restart =
`[LTC out] missing: plughw:CARD=Pro,DEV=0 is not connected` + `[LTC out] timeline → … @ 25` + one keeping-up
`behind: LTC out` line, then nothing; `/api/ltc` output.state `missing`; hot-plug resume proven in
smoke-wo1058 (no process while missing, `back:` on plug-in).

Tests: smoke-wo1092-ltc-out (31: helper output decoded by the independent decoder — rates, DF, user bits, 24 h wrap,
pair on ch 7+8, level; normaliser; rate mapping; sync decisions; share builder + casparcg.config name; ~/.asoundrc
merge; keeping-up words; source pins for the clean close / no-probe rules), smoke-wo1058 (5, back-off + hot-plug),
smoke-wo974 lock-chase + roundtrip (repointed); Godot suite 28905 passed 0 failed (test_ltc_pane: status words,
device / channel pickers; settings layout without Timecode; audio tab split).

Not verified: per-channel RMS of the mixed card output (needs a capture of the far end: `sudo modprobe snd-aloop
index=20 id=Loopback pcm_substreams=2`, then `measure-ltc-out.js --capture hw:CARD=Loopback,DEV=1` with the share
pointed at the loopback); `ltcdump` cross-check (`sudo apt install ltc-tools`; the own decoder is used instead);
the fold on glass (the GUI was being relaunched by another session's probe runs throughout; the fold is covered by
the Godot tests); a real "Pro" LTC box (not connected).
