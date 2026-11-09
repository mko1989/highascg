# WO-1020 — Caspar fork: add/remove channels and video modes at runtime (dynamic config research + patch)
**Area:** caspar-build, devices-config
**Status: IN PROGRESS (09.11, Caspar patch deployed + live-tested 19/20 steps on the box; HighAsCG apply-diff side not started)**

Owner, 09.11 (verbatim), answering the WO-1016 proposal of a `CHANNEL ADD` patch:
> id like that. also i think its possible to distroy those channels so i dont know why removing would be tricky.
> it might be possible to also add video modes dynamically. lets check whats possible in source and do a research on what it would take to add dynamic config changes to casparcg source and building with that enabled.

Builds on WO-1016 (live-vs-restart audit of the Devices settings). That audit's P-a/P-b (consumer XML options
over AMCP) are part of this patch; P-c (CHANNEL ADD) and P-d (route format refresh) as well.

Patch branch `wo1020-dynamic-channels` (worktree `~/caspar-build/src-wo1020`, based on `highascg-main` 2476644c4),
build `~/caspar-build/build-wo1020/shell/casparcg` (script `~/caspar-build/build-wo1020.sh`), exported patch
`caspar/patches/wo1020-dynamic-channels-video-modes.patch`. **Not deployed** — the live box still runs 2476644c4.

## Investigation

Line numbers below are in the unpatched tree (`~/caspar-build/src-v2/src`, = `highascg-main`) unless marked *(new)*.

### What the startup config is, and when it is read

`shell/server.cpp` `start()` (:128-152) runs once, in this order: `setup_video_modes` (:180-254) →
`setup_channels` (:256-304) → `setup_osc` (:306-342) → `setup_channel_producers_and_consumers` (~:344-404) →
`setup_controllers` (~:432-470). Everything else in `casparcg.config` goes through `env::properties()` (common/env.cpp:185),
a `const&` to one global ptree loaded once; the media/log/template/data paths are static `std::wstring`s
(env.cpp:40-45) returned **by reference** (env.cpp:139-169). Nothing in the tree ever re-reads the file.

### Item by item: what would it take to change it at runtime

| Item | Where it lives | What makes it hard | Size / risk | Verdict |
|---|---|---|---|---|
| **Video modes** (`<video-modes>`) | `core::video_format_repository` (video_format.cpp); copied by value into the accelerator and the AMCP static context but all copies share one impl | Unlocked `std::map` read by every `SET MODE`/`CHANNEL ADD`/consumer; the accelerator sizes a static zero buffer from the **boot** max frame size (image_mixer.cpp:97, accelerator.cpp:31) — a larger mode added later would read past it | S / low once locked | **Done** (VIDEO-MODE ADD) |
| **Channels: add** (`<channels>`) | `std::vector<channel_context>` built in setup_channels (:300 `emplace_back`), shared by pointer with the AMCP repository and every AMCPProtocolStrategy | Read **unlocked** by every AMCP thread (amcp_command_repository.cpp:153 size check, :199-202 lock check; AMCPCommandQueue.cpp:135-139 batch). The per-channel command queues are built once in the strategy ctor (AMCPProtocolStrategy.cpp:99-106) and dispatched with `commandQueues_.at(channel_index+1)` (:221) — a new channel would throw out_of_range there | M / medium | **Done** (CHANNEL ADD) |
| **Channels: remove** | same | see the removal analysis below | M / medium-high | **Done, guarded** (CHANNEL REMOVE) |
| **Consumers from XML** (`<consumers>` with every option) | `frame_consumer_registry` has a preconfigured (ptree) factory (frame_consumer_registry.cpp:182-197) that only boot uses; AMCP `ADD` goes through the param factory, which lacks many options (screen geometry/borderless/vsync, decklink keyer/latency/subregion, ndi, portaudio …, WO-1016 table) | Nothing hard: call the existing ptree factory from AMCP | S / low | **Done** (`ADD ch[-idx] XML`) |
| **Route format after SET MODE** | `route` caches the source's format_desc; upstream TODO at video_channel.cpp:216 | The destination's route producer keeps scaling against the old size | S / low | **Done** (format refreshed each tick) |
| OSC predefined clients (`<osc><predefined-clients>`) | setup_osc :306-342 holds subscription tokens for the server's life | Clients are endpoints, not per channel; runtime add/remove = keep tokens in a map | S / low | Later (P-f), node can use `OSC SUBSCRIBE` (AMCPCommandsImpl.cpp:1845-1876) today |
| OSC default port / send-to-AMCP-client | setup_osc | boot-time socket | — | Boot only, low value |
| Log level | `log::set_log_level` | already live (`LOG LEVEL`) | — | Already live |
| Log path, media/template/data/font paths | env.cpp static strings returned by ref | Any runtime write races every reader holding the ref; needs atomic shared_ptr<const wstring> + touching ~15 call sites | M / medium | Not worth it |
| ffmpeg/portaudio/ndi/decklink global settings | read per producer/consumer from the frozen `env::properties()` (readers: portaudio 7, html 4, av_producer 4, AMCPCommandsImpl 2, ndi consumer 2, flash, newtek, decklink producer, ogl device) | A `CONFIG SET` would need a copy-on-write properties holder like the channel list below; each reader takes a snapshot | M / low | Later (P-e) if a concrete setting needs it |
| html/CEF (`<html>` gpu, remote-debugging-port) | CEF initialises once per process | CEF cannot be re-initialised | — | Impossible without restart |
| `ndi.auto-load`, controllers (AMCP ports) | boot | Adding AMCP listeners at runtime is possible but pointless | — | Boot only |

Recommended order (what was implemented first, then what is left): (1) VIDEO-MODE ADD + route refresh on SET MODE,
(2) ADD XML, (3) CHANNEL ADD, (4) CHANNEL REMOVE with guards — all in this patch; later (5) OSC predefined
clients, (6) a properties COW for global producer/consumer settings; paths and HTML are not worth it.

### Channel removal, honestly

The owner is right that channels *can* be destroyed: the `video_channel` destructor already tears down
stage → mixer → output in order, and that runs at every server shutdown. What makes removal at **runtime**
harder than at shutdown is everything else that still points at the channel while the server keeps running:

1. **Numbering is positional.** Channel *n* is `channels[n-1]` everywhere (AMCP parse, queues, OSC `/channel/n`,
   `route://n`, INFO, LOCK keys, and HighAsCG's own config/generator). Erasing an element would renumber every
   later channel under running commands and clients. → **Tombstones**: the slot stays, empty. Numbers never shift.
2. **Reuse.** Default `CHANNEL ADD` appends `size()+1` and never silently reuses a hole — a client still holding an
   old number would otherwise hit a different channel. Reuse is explicit (`CHANNEL ADD … AT n`), for re-creating a
   channel at the same number with a different mode/depth/colour space. Safe because of (4).
3. **Unlocked vector shared by all AMCP threads.** Every `push_back` can reallocate under a reader. → copy-on-write
   `channel_list`: readers take an immutable snapshot (`spl::shared_ptr<vector>`), writers are serialised and publish
   a new vector. A snapshot keeps its channels alive, so a command that already parsed against a channel can finish.
4. **In-flight / queued commands.** A command parsed for channel 10 may sit in the channel-10 queue while 10 is
   removed and re-added. → each command records a `weak_ptr` to its target at parse time; at execute the wrapper
   compares control-block identity with the current slot and refuses (403) on mismatch or empty slot.
5. **AMCP queues.** Correction to the WO-1016 wording: queues are **not per connection**. There is one
   AMCPProtocolStrategy per AMCP port (plus one for the console), shared by all its connections
   (AMCPProtocolStrategy.cpp:319, :327); it owns one queue per channel built in the ctor (:99-106). → queues are now
   created lazily per index under a mutex, so a connection opened **before** the add can address the new channel.
   A removed channel's queue just stays (idle thread; commands to it fail at parse).
6. **route:// holders.** The destination's route_producer holds a **shared** `route` (route_producer.cpp:125); the
   source channel holds only `weak_ptr`s (video_channel.cpp:74, :213, :226). Removing the source therefore does not
   crash — but the destination froze on the last frame and **looped that frame's audio forever**
   (receive_impl :229/:257). → `route::source_removed` makes the producer return empty frames (black, silent), and
   `CHANNEL REMOVE` refuses (403) while live routes exist unless `FORCE`. Routes requested after close start closed.
7. **OSC/monitor.** Subscriptions are per endpoint, not per channel. The per-channel tick lambda sends
   `/channel/n/…` and the OSC client is stateless (it replaces its bundle) → a new channel just appears, a removed
   one stops being sent. Consumers of OSC must time out stale `/channel/n` state themselves.
8. **LOCK.** The channel's lock_container hands out release callbacks that captured raw `this`
   (lock_container.cpp:49) → use-after-free if a client disconnects after the channel is gone. → weak_ptr to the impl.
9. **Batches.** BEGIN/COMMIT parses into a vector indexed by channel position (AMCPCommandQueue.cpp:135-139) →
   empty placeholders for tombstones. CHANNEL ADD/REMOVE **inside** a batch is not supported (later commands in the
   batch were parsed against the old list).
10. **Other positional code.** CHANNEL_GRID uses `back()`/`size()` (AMCPCommandsImpl.cpp:1544-1584), SWAP/LOCK use
    `at()` (:1774), INFO/CLEAR ALL iterate everything (:1704) → all skip or refuse empty slots now.
11. **Teardown order and threads.** CEF/HTML producers and DeckLink/screen consumers already have their own async
    destroy paths (frame_producer_registry destroyer thread, consumer destroy threads). The removal drives them in the
    same order as AMCP does today: tombstone (no new commands) → close routes → clear locks → `output().clear()`
    (each consumer destroyed like AMCP `REMOVE`) → `stage()->clear()` (producers incl. CEF go to the destroyer,
    like `CLEAR`, waited ≤5 s) → drop the reference. The last reference is the REMOVE command's own snapshot, so the
    channel thread is joined on the AMCP queue thread after the reply, **never on the channel's own thread** —
    checked: no producer/consumer stores a channel strongly (no stored frame_producer_dependencies or channel vectors;
    cg_proxy does not keep the channel; image mixer frames use `weak_self`).
12. **Destroyer warnings.** `CASPAR_VERIFY(destroyer->size()<8)` (frame_producer_registry.cpp:89) and `counter<8`
    (frame_consumer_registry.cpp:68) only log on Linux (`_CASPAR_DBG_BREAK` is empty) — removing a channel with many
    layers may log a warning, not crash.

**Verdict:** removal is feasible and implemented, but it is the riskiest part — hazards 3-8 were real bugs waiting
for anyone who removes a channel, not theoretical. It is guarded (route refusal, lock check, generation check) and
can be left unused until the live test passes.

### Things that stay different after a runtime change

- `casparcg.config` cannot express holes: after a Caspar restart numbering is compacted from the XML. HighAsCG must
  keep the XML and the runtime numbering aligned (append-only, or `AT n` to fill a hole that the XML also has).
- `INFO CONFIG` shows the live slot list (see below), but runtime-added consumers and `SET MODE` changes are not
  reflected (upstream behaviour; WO-919 already knows runtime consumers are invisible to config diffs).
- Removing a channel that routes into **itself** counts as a live route → STOP it or FORCE.

## What was done

Five commits on `wo1020-dynamic-channels` (≈ +850/-172, 20 files), each with a full message:

| Commit | What | Why this way |
|---|---|---|
| `3c15fbe7a` core: video modes can be added at runtime safely | `video_format_repository` behind a `shared_mutex`, `store()` returns bool; `make_custom_video_format_desc()` *(new, video_format.cpp:257)* is the single validator for boot and AMCP; image_mixer zero buffer is growable *(new image_mixer.cpp:103-105)* and the mixer is created from the live max | Copies of the repository share one impl, so one lock covers boot, accelerator and AMCP |
| `9e243d9b4` core: routes survive a source mode change and a removed source; output::clear | `route` gets locked `format_desc()/fps()/set_format_desc()` and `atomic source_removed`; the channel refreshes route formats from its own tick *(new video_channel.cpp:160-166)*; `live_route_count()`, `close_routes()`; `output::clear()` | Resolves the upstream TODO without the destination ever seeing a torn format |
| `2f168f91f` protocol: LOCK release callbacks no longer capture a raw lock_container | weak_ptr to a shared impl *(new lock_container.cpp:51)* | UAF fix needed once channels can die before clients |
| `d8e02f9ef` amcp: CHANNEL ADD / CHANNEL REMOVE / VIDEO-MODE ADD at runtime | `channel_list` COW *(new amcp_shared.h:40)*; tombstones; generation check (`checked_channel`, *new* amcp_command_repository_wrapper.h:55); lazy queues (`queue_for`, *new* AMCPProtocolStrategy.cpp:121); server `make_channel`/`add_channel`/`remove_channel`/`live_config` *(new server.cpp:222, :291, :339, :424)*; the three commands *(new AMCPCommandsImpl.cpp:1956, :1993, :2016)*; INFO/INFO CONFIG/CLEAR ALL/CHANNEL_GRID/SWAP/LOCK aware of empty slots | The whole server keeps one list object; channel creation shares one function between boot and runtime |
| `5c3373ec5` amcp: ADD ch[-idx] XML <consumer element> | quoted XML or base64; exactly one element; preconfigured factory *(new AMCPCommandsImpl.cpp:516)* | Gives every XML consumer option live (WO-1016 P-a/P-b) without per-consumer AMCP parsers |

### Command reference (as implemented)

- `CHANNEL ADD <video-mode> [8|16 | DEPTH n] [BT709|BT2020] [AT n]` → `201 CHANNEL ADD OK\r\n<n>\r\n`.
  AT n: only an empty slot or `size()+1`, else 403. Unknown mode/invalid depth → 403. 501 if the hook is missing.
- `CHANNEL REMOVE <n> [FORCE]` → `202 CHANNEL REMOVE OK`. Unknown/empty slot → 401; locked by another client → 503;
  live routes from it and no FORCE → `403 CHANNEL REMOVE FAILED (N live routes from it; STOP them or add FORCE)`
  (after a ≤500 ms wait for just-stopped routes to drain).
- `VIDEO-MODE ADD <id> <width> <height> <time-scale> <duration> [1|2|P|I] [cadence…]` → 202. Same id with identical
  parameters → 202 (idempotent); different parameters → 403; sides ≤ 32768. Same validation as `<video-modes>`.
- `ADD <ch>[-<idx>] XML "<screen>…</screen>"` or `ADD <ch>[-<idx>] XML <base64>` → 202. Parsing errors → 403.
- Commands to an empty slot: channel commands (PLAY, MIXER …) → 401 at parse; global commands with a numeric arg
  (e.g. `CLS 3`) still work; past the end → 400 as before; command queued before a remove/re-add → 403 at execute.
- `INFO` lists only live channels. `INFO CONFIG` = boot tree with `<channels>` replaced by the live slot list:
  runtime channels as `<channel runtime="true">` (video-mode, color-depth, color-space, empty `<consumers/>`),
  removed slots as `<channel removed="true"/>`.

## What was verified

- **Build green**: `~/caspar-build/build-wo1020.sh` → `build_rc=0` at `5c3373ec5` (09.11 13:52); only the
  pre-existing deprecation warnings. Binary `~/caspar-build/build-wo1020/shell/casparcg`, version string
  `2.5.1 5c3373ec5 Stable`, md5 `6372ec07b43f1878350cdcc8e8b51bc2`, RUNPATH `$ORIGIN/../lib`.
  `build-26/` and `bin/` untouched.
- **Headless unit test** (scratch, linked against the built static libs `protocol`/`core`/`common`): **24/24 pass**,
  also under `-fsanitize=thread` with no reports (the static libs themselves were not TSan-instrumented, so this
  covers the test's own threads and the inline/header code). Covered: format validator accept/reject + NTSC cadence;
  repository store dedupe across copies, case-insensitive find, max-size growth; 4 readers during 2000 concurrent
  stores; channel_list snapshot isolation, no publish on throw, 2000 modifies vs concurrent readers; parse of
  `PLAY`/`MIXER FILL` to an empty slot → out_of_range (401); `CLS 2` falls back to global; `PLAY 9-1` past the end →
  nullptr; `check_channel_lock` on an empty slot.
- **Code review** of the thread/lifetime paths listed in the removal analysis (ownership of the last channel
  reference, destroyer threads, OSC tick lambda, lock callbacks, route weak/shared split).
- Live box, read-only via `/api/amcp/raw`: `VERSION` → `2.5.1 2476644c4 Stable`; `INFO` → 9 channels
  (1 1080p5000, 2-3 3072x1024, 4 1080p5000, 5-6 7680x2160, 7-8 1080p5000, 9 64x36). So the first append on the
  box will be **10**. Node's AMCP parser already treats `201` as one data line (src/caspar/amcp-protocol.js:13).

**Live on the box (lead, 09.11 14:02-14:07).** Deployed per the plan: `bin/casparcg.pre-wo1020` = the 2476644c4
binary (md5 e34b3bac…), `bin/casparcg` = md5 6372ec07…, `casparcg.prev` untouched; Caspar + node restarted;
`VERSION` → `2.5.1 5c3373ec5 Stable`, same 9 channels, WO-1013 restore brought back test card, GUI cells, DeckLink
7-1/8-2 and Zoom 7-23. Every command went through node's connection (`/api/amcp/raw`), opened before the adds.

| # | Result |
|---|---|
| 1-2 | `CHANNEL ADD 1080p5000` → `201` / `10`; INFO 10 lines; journal `CHANNEL ADD: channel 10 1080p5000 8-bit bt709` |
| 3-4 | `PLAY 10-1 #FFFF0000` 202; OSC :6250 carried `/channel/10/…` (602 messages in 2 s) |
| 5-6 | `PLAY 9-20 route://10` 202; `CHANNEL REMOVE 10` → `403 … (1 live routes from it; STOP them or add FORCE)` |
| 7-10 | `STOP 9-20`, `CHANNEL REMOVE 10` → 202 (`removed (0 consumers)`); INFO 9 lines; `PLAY 10-1` → `401` |
| 11-12 | `INFO CONFIG` `<channels>` ends with `<channel removed="true"/>`; OSC: no `/channel/10` in 2 s |
| 13 | `VIDEO-MODE ADD 1234x567 1234 567 50000 1000` 202, repeat 202, `… 568 …` → 403 |
| 14-15 | `CHANNEL ADD 1234x567` → `11` (10 not reused); `PLAY 11-1` 202; INFO `11 1234x567 PLAYING` |
| 16 | `CHANNEL ADD 1080p5000 AT 10` → `10`; `AT 3` → 403 |
| 17 | Audio source: `CHANNEL ADD` → 12, `PLAY 12-1 BRIDGE/TALK2 LOOP`, `PLAY 10-20 route://12`, meter consumer `ADD 10-720 STREAM udp://…`. `/channel/10/mixer/audio/volume`: 100/100 messages non-zero before; after `CHANNEL REMOVE 12 FORCE` 150/150 zero over 3 s; `PRINT 10` max RGB 0, max A 0 (black, no frozen frame, no audio loop). Same on 9-20 from ch 11 (route producer stays, shows nothing) |
| 18 | `ADD 10-777 XML "<ffmpeg><path>…/wo1020.ts</path><args>-codec:v libx264 -preset ultrafast -filter:a aformat=channel_layouts=stereo,aresample=48000 -codec:a aac -b:a 128k</args></ffmpeg>"` 202; 4 s later `REMOVE 10-777` 202; file h264 1920x1080 + aac. Two earlier tries failed inside the ffmpeg consumer (a 16-ch 9.1.6 layout into the `.ts` default mp2 encoder; `-an` is not honoured): consumer config, not the patch |
| 20 | `CHANNEL ADD 720p5000` → 13, `PLAY 10-21 route://13`, `SET 13 MODE 1080p5000` 202. SET MODE clears the source's stage (upstream), so re-`PLAY 13-1 #FF00FF00`; `PRINT 10` green at all four corners and the centre: the route follows the new size, no stretch |
| 19 | `CHANNEL REMOVE 13 FORCE` (`0 consumers, FORCE`), `CHANNEL REMOVE 10` (`1 consumers`) 202; INFO = the 9 boot channels |

Existing outputs during adds/removes: OSC `/channel/2/output/port/600/screen/dropped_frames` 1 before and 1 after
(int64), `/channel/1/output/port/740/shm/dropped` 0 → 0. No exception or destroyer warning in the Caspar journal
apart from the two ffmpeg-consumer encoder errors above. Caspar restarted once more afterwards to drop the empty
slots: 9 channels, everything restored, GUI screenshot normal.

**Still not verified:** REMOVE of a channel with a screen or DeckLink consumer (only a STREAM consumer was torn down
live); intermediate commits built individually (only HEAD); the HighAsCG side (below) does not exist yet.

## LIVE TEST PLAN

Preconditions: PGM lock taken, owner informed, nothing on air. All commands via
`curl -s localhost:4200/api/amcp/raw -H 'Content-Type: application/json' -d '{"cmd":"…"}'` (node's existing
connection — it was opened **before** the adds, which is exactly the queue case to prove). Never connect to :5250.

**Deploy**
1. `cp -a ~/highascg/bin/casparcg ~/highascg/bin/casparcg.pre-wo1020` (keep `casparcg.prev` as is).
2. `cp ~/caspar-build/build-wo1020/shell/casparcg ~/highascg/bin/casparcg.new && mv -f ~/highascg/bin/casparcg.new ~/highascg/bin/casparcg`
3. `sudo -n systemctl restart casparcg-server.service`; then restart node
   (`P=$(systemctl show -p MainPID --value highascg); [ "$P" -gt 1 ] && kill -TERM "$P"`) — OSC latch is per process.
4. `VERSION` → `2.5.1 5c3373ec5 Stable`; `INFO` → the same 9 channels as before; screens/DeckLinks lit as before
   (screenshot :0), journal clean apart from DeckLink keyer noise.

**Sequence** (expected replies; numbers assume 9 boot channels)

| # | Command | Expect |
|---|---|---|
| 1 | `CHANNEL ADD 1080p5000` | `201 CHANNEL ADD OK` / `10`; journal `CHANNEL ADD: channel 10 1080p5000 …` |
| 2 | `INFO` | 10 lines, `10 1080p5000 PLAYING` |
| 3 | `PLAY 10-1 #FFFF0000` | `202 PLAY OK` |
| 4 | OSC sniff :6250 | `/channel/10/…` appears (stage/mixer/framerate) |
| 5 | `PLAY 9-20 route://10` | 202; channel 9 shows red (64x36 — read via PRINT or OSC layer frames) |
| 6 | `CHANNEL REMOVE 10` | `403 CHANNEL REMOVE FAILED (1 live routes from it; STOP them or add FORCE)` |
| 7 | `STOP 9-20` (or `CLEAR 9-20`) | 202 |
| 8 | `CHANNEL REMOVE 10` | `202 CHANNEL REMOVE OK`; journal `CHANNEL REMOVE: channel 10 removed (…` |
| 9 | `INFO` | 9 lines again |
| 10 | `PLAY 10-1 #FF00FF00` | `401` (empty slot) |
| 11 | `INFO CONFIG` | `<channels>` ends with `<channel removed="true"/>` |
| 12 | OSC sniff | no more `/channel/10/…` |
| 13 | `VIDEO-MODE ADD 1234x567 1234 567 50000 1000` | 202; repeat → 202; `VIDEO-MODE ADD 1234x567 1234 568 50000 1000` → 403 |
| 14 | `CHANNEL ADD 1234x567` | `201` / `11` (10 is not reused implicitly) |
| 15 | `PLAY 11-1 #FF0000FF`, `INFO 11` | 202; INFO shows 1234x567 |
| 16 | `CHANNEL ADD 1080p5000 AT 10` | `201` / `10`; `CHANNEL ADD 1080p5000 AT 3` → 403 (occupied) |
| 17 | `PLAY 9-20 route://11`, `CHANNEL REMOVE 11 FORCE` | 202 each; layer 9-20 goes black and **silent** (no frozen frame, no audio loop) |
| 18 | `ADD 10-777 XML "<screen><device>1</device><windowed>true</windowed><width>320</width><height>180</height></screen>"` | 202 — only if a test screen on the operator monitor is acceptable; else use an NDI or `<ffmpeg><path>/tmp/wo1020.ts</path></ffmpeg>` consumer; then `REMOVE 10-777` |
| 19 | `CHANNEL REMOVE 10`, `CLEAR 9-20` | 202; `INFO` = boot 9 channels |
| 20 | `SET MODE` on a routed source (optional): `CHANNEL ADD 720p5000` → n, `PLAY 9-20 route://n`, `SET n MODE 1080p5000` | dest keeps showing the route at the new size, no stretch; then STOP + REMOVE |

Throughout: `journalctl -u casparcg-server -f` for exceptions/`destroyer` warnings; `:6250` screen presented/dropped
for the existing outputs (must not drop during adds/removes); node log for parser errors on 201.

**Rollback:** `cp ~/highascg/bin/casparcg.pre-wo1020 ~/highascg/bin/casparcg.new && mv -f … ~/highascg/bin/casparcg`
(or `casparcg.prev`), restart casparcg-server + node, `VERSION` → `2476644c4`.

## What HighAsCG would need (no code yet)

- AMCP client helpers for `CHANNEL ADD` (parse the 201 data line as the number), `CHANNEL REMOVE [FORCE]`,
  `VIDEO-MODE ADD`, `ADD … XML` (base64 from the generator's consumer XML to avoid quoting).
- A capability check (`VERSION` hash / `HELP CHANNEL ADD`) so older binaries keep the restart path.
- Apply-diff logic in the Devices/config generator: classify each change as live (add channel at the end, new video
  mode, consumer add/remove, SET MODE) vs restart (paths, HTML/CEF, ports), and keep XML numbering aligned
  (append-only or `AT n`).
- Handle removed slots: stale OSC `/channel/n` state must time out; channel maps/screens/destinations must tolerate
  holes until the next restart compacts them.
- The WO-919 config comparison (`refreshConfigComparison`, "channel resolutions match running server") must understand `INFO CONFIG`'s `runtime="true"` / `removed="true"` attributes.
- Owner decision (WO-440 line): whether removal is exposed in the UI at all, or only adds + restart for removals.
