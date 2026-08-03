# Codebase review 2026-08-03 — src misc subsystems (replication, streaming, media, audio, capture, previews, long tail)

Read-only review wave (7 reviewers over the full repo), owner-requested full codebase review (todos03.08.26).
Scope: src/utils, src/replication, src/media, src/preview, src/audio, src/streaming, src/capture, src/virtual-output, src/artnet, src/sampling, src/cg-studio, src/previs, src/network, src/share, src/shaderfx, src/support, src/tracking, src/companion*, src/plugins.

Verification status: finding #1 independently re-verified in source by the coordinating session
(zero `on('error')` in all four named files; `process-guards.js` exits 1 on uncaughtException).
Other findings are the reviewer's own source-verified claims, spot-checks pending fix work.

Covered: replication (all core files read in full), streaming, capture, media, audio, and preview/gui-stream-ingest read directly; utils, preview (rest), virtual-output, artnet, sampling, cg-studio, previs, network, shaderfx, support, tracking, companion, companion-bridge, plugins swept with load-bearing claims re-verified in source; only skimmed: replication-ssh-setup/caspar-parity/follower-* internals, companion protocol internals, plugins (src/share is empty).

### 1. [HIGH] Spawned children without `'error'` handlers can kill the whole playout server
`src/audio/live-audio-bridge.js:221`, `src/capture/v4l2-input-bridge.js:155`, `src/preview/gui-stream-ingest.js:146`, `src/media/usb-drives-discovery.js:106`
```js
const proc = spawn(ffmpegBinary(cfg), args, { stdio: ['ignore', 'ignore', 'pipe'] })
// ... only proc.on('close') / stderr handlers — no proc.on('error')
```
`spawn()` delivers ENOENT/EMFILE/EAGAIN asynchronously via the child's `'error'` event. With no listener, that throws → `uncaughtException` → `src/bootstrap/process-guards.js:28` does `process.exit(1)` — the entire server dies mid-show. Concrete triggers: a typo'd `streaming.ffmpeg_path` in config (used verbatim as the binary), or transient fd exhaustion (EMFILE) on a stressed box. Exposure is constant: `usb-automount.js` spawns `lsblk` (also handler-less, via `usb-drives-discovery.js:106`) every 3 seconds forever. Note the sibling files (`browser-capture-bridge.js`, `audio-capture-fft.js`, `rsync-exec.js`) all do register `'error'` — these four are the stragglers.

### 2. [HIGH] AMCP fan-out silently drops take commands while follower Caspar is down — no replay on reconnect
`src/replication/amcp-fanout.js:219-222`
```js
const peer = _runtime?.peerCasparConnection
if (!peer?.isConnected) {
    if (_runtime) _runtime.amcpFanoutSkippedNotConnected = (...) + 1
    return
}
```
In `amcp-fanout` transport mode the semantic live-state mirror is explicitly disabled (`shouldSkipSemanticLiveMirror`), so fan-out is the *only* thing keeping backup air in sync. When the follower's CasparCG restarts (config apply, crash) while its node stays up, the leader's TCP client reconnects with backoff (`peer-caspar-connection.js` → `TcpClient`, 2–30 s), but the `'connected'` handler only logs — nothing re-sends channel state, and `peer-client.js:228` only calls `syncPeerCasparConnection` on HTTP-reachability/instance transitions (which don't fire here, since node HTTP stayed up). Every take fired during the gap is gone; backup PGM diverges silently until the operator happens to re-take those channels. Same silent-drop applies at the 128-deep backpressure cap (`peer-caspar-connection.js:113`). Only evidence is a status counter.

### 3. [MED] ~6 s peer HTTP outage permanently dissolves the hot-backup pairing
`src/replication/peer-client.js:249-252` → `src/replication/connect-pair.js:20-27`
```js
if (repl.disconnectPolicy === 'standalone' || !repl.autoPromote) {
    const { disconnectToStandalone } = require('./connect-pair')
    await disconnectToStandalone(ctx, runtime, { reason: 'peer_lost' })
```
`disconnectToStandalone` persists `enabled: false, peer: { host: '', token: '' }` to saved config — the pairing is destroyed, not suspended. The trigger needs only `FAILOVER_MS` (5 s default) plus 3 failed pings at 2 s cadence. The documented deploy loop (`kill -TERM` on the server, systemd restart) or any network blip slightly over ~6 s on *either* box tears down replication on the surviving peer; when the restarted box returns, its pings hit a peer with replication disabled, and it goes standalone too. Recovery is a manual re-Connect. If this hair-trigger is deliberate policy, the window deserves to be much wider than one service restart.

### 4. [MED] GUI stream: remux death during `start()` leaves `running=true` with no process and no restart
`src/preview/gui-stream-ingest.js:159-168, 172-183`
```js
proc.on('exit', (code, signal) => {
    if (state.proc !== proc) return
    state.proc = null
    if (!state.running) return // expected — we killed it during stop()
```
`start()` spawns the remux first, then `await opts.amcp.raw(cmd)`. If ffmpeg exits inside that await window (e.g. UDP port 9250 already bound by a stale reader from a crashed run — bind failure exits well within an AMCP round trip), the exit handler sees `running === false` and treats it as an intentional stop: no restart timer. `start()` then sets `running = true` with `proc === null`. The NVENC consumer encodes into a dead port; clients get a frozen preview until refs drop to zero and a fresh acquire.

### 5. [MED] `extractWaveform` decodes entire file into a JS number array, no timeout
`src/media/local-media-ffmpeg.js:60-103`
```js
const chunks = []
ff.stdout.on('data', (chunk) => chunks.push(chunk))
...
for (let i = 0; i < buf.length; i += 2) { samples.push(buf.readInt16LE(i)) }
```
Full-file PCM buffered in memory, then re-expanded as a `samples` array of JS numbers — a 2-hour clip at 8 kHz mono is ~57.6 M array entries (~450 MB+ with array overhead) per request, HTTP-triggered via `/api/local-media/<file>/waveform` (`local-media-api.js:61`) with no per-file dedup, so concurrent requests multiply it. Neither `extractWaveform` nor `probeMedia` (`local-media-ffmpeg.js:14`) has a kill timeout — a hung ffprobe/ffmpeg on a stalled USB/exFAT mount leaks the process and wedges the request forever, while `extractThumbnailPng` right below (line 281) does have a 10 s SIGKILL. RMS can be computed streaming in O(bars).

### 6. [MED] Bridge restart races single-open ALSA/V4L2 devices: SIGTERM then immediate respawn
`src/audio/live-audio-bridge.js:204-221` (same shape in `v4l2-input-bridge.js:139-155`)
```js
stopLiveAudioBridge(n)        // SIGTERM, returns immediately
...
const proc = spawn(ffmpegBinary(cfg), args, ...)
```
`stop` sends SIGTERM and returns without waiting for exit; `start` spawns the replacement in the same tick. On single-open hardware (this rig's DM3 is exactly that) the new ffmpeg can open the device before the old one has released it → "device busy" → new proc dies. The busy text doesn't match `isAlsaFormatError`, so no plug-fallback retry fires; `playLiveAlsaClipWithRecovery` (`live-audio-health.js:96`) burns a clip variant per race and only recovers if a later variant retries after the old proc has died. Worst case the watchdog "repair" of a merely-stale-meters slot kills a working capture and fails to restart it on that pass.

### 7. [MED] `getChrome()` caches a dead/failed Chrome forever
`src/media/cg-look-thumb-render.js:111-122`
```js
if (!chromePromise) { chromePromise = launchHeadlessChrome() }
return chromePromise
```
`chromePromise` is never reset: if the launch rejects once, the rejected promise is cached and every subsequent CG-look thumbnail render rethrows forever; if the long-lived headless Chrome later crashes (OOM — it lives for weeks), `openPage`'s `fetch` to the stale port fails on every call with no relaunch path. Either way, thumbnail rendering is dead until the node service restarts. Also `kill()` is never called, so the `mkdtemp` user-data-dir (`headless-chrome-cdp.js:133`) persists for the process lifetime.

### 8. [LOW] cg-studio API reads request bodies with no size cap
`src/cg-studio/routes.js:149-152`
```js
const chunks = []
for await (const chunk of req) chunks.push(chunk)
```
Unlike the main server's body reader (which enforces a limit), any POST/PUT to the studio API buffers unbounded — a runaway or malicious LAN client can exhaust heap and take the process down. Small blast radius (LAN-only tooling port) but it's the one body path in the codebase without a cap.

### 9. [LOW] `mkfifo` via shell interpolation of a config path
`src/sampling/dmx-sampling-ingress.js:209`
```js
execSync(`mkfifo "${fifoPath}"`)
```
`fifoPath` comes from config (`sampling.<ch>.pipe`) and is interpolated into a shell string — a path containing `"` or `$(...)` breaks or executes. Everything else in this codebase uses arg-array `spawn`/`execFileSync`; this is the one shell-string straggler. One-line fix: `execFileSync('mkfifo', [fifoPath])`.

### 10. [LOW] rsync timeout sends SIGTERM only, resolves immediately, no SIGKILL escalation
`src/replication/rsync-exec.js:30-43`
```js
try { proc?.kill('SIGTERM') } catch {}
finish({ ok: false, ... timedOut: true })
```
On timeout the promise resolves while the rsync/ssh pair may still be alive (ssh stuck in a dead TCP connection can ignore SIGTERM's effect for a long time); a follow-up sync then starts a second rsync over the same tree. With the 30-minute default timeout this needs a genuinely wedged transfer, but on a weeks-long uptime box orphaned ssh processes accumulate with no reaper.

---

**Overall health.** This is an unusually disciplined codebase for its niche: arg-array spawning almost everywhere, path traversal defended in depth (`resolveSafe` + `..` rejection at every media entry point), replication has real split-brain guards (leader epochs, `rejectIfLeader` on all inbound apply routes, pairId/role checks on every ping) so the classic push-back feedback loop is structurally impossible, and timers/backoffs are consistently bounded and cleared. The genuine risk concentrates in two places: process-lifecycle edges (the missing `'error'` handlers interacting with the `process.exit(1)` guard is the one thing that can drop the whole box, and the SIGTERM-then-respawn races), and the fan-out transport's fire-and-forget nature, where the deliberate trade-off (no replay, drop-when-disconnected, hair-trigger standalone teardown) means divergence and silent unpairing are one Caspar restart or network blip away — worth a work order weighing a state re-send on peer-Caspar reconnect and a wider failover window.
