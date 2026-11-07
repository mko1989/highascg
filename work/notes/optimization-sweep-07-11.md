# Optimization sweep — 07.11.26 (consolidated findings)

Owner, 07.11.26: *"run an optimazation sweep where you check code for possible optimazation tweaks. using also codex
astra and sol create and run tests, do different sweeps of the code base, looking for things to improve. document your
findings"*.

This note is the index of that sweep: what each lane found, what was fixed and measured, and what is left as a
proposal or an owner call. The detail (method, `file:line` evidence, raw numbers) lives in the WOs.

| Lane | WO | Who | Result |
|---|---|---|---|
| Node server hot paths | [WO-980](../work-orders/980_WO_node_hot_paths_sweep.md) | Claude subagent (Opus) | 3 fixes live, node CPU 6.5 → 5.3 %, loop p99 17.6 → 7.0 ms |
| Take / project / autosave path | [WO-981](../work-orders/981_WO_take-project-autosave-path-cost.md) | Claude subagent + Codex Sol review | autosave −22 %; take latency = 80 ms deliberate prebuffer |
| CasparCG load attribution | [WO-982](../work-orders/982_WO_caspar_cpu_attribution_07_11.md) | Claude subagent | 251 % CPU = one 4K ProRes HQ clip, not HighAsCG |
| AMCP planning + timecode math tests | [WO-983](../work-orders/983_WO_amcp_timecode_scene_math_sweep.md) | **Codex Astra** | 41 new assertions, 2 rounding bugs fixed, 1 TODO |
| Code health (leaks, timers, sync IO) | [WO-984](../work-orders/984_WO_src_tools_code_health_sweep.md) | **Codex Sol** | 7 defects found and fixed (2 rounds) |
| OSC WS delta mode | [WO-985](../work-orders/985_WO_osc_ws_delta_replace_and_enable.md) | Claude | client merge bug fixed, delta mode ON + factory default |
| Security sweep | [WO-986](../work-orders/986_WO_security_sweep.md) | **Codex Astra** | 1 traversal fixed, 4 findings open (proposals) |
| Godot client idle CPU | [WO-798](../work-orders/798_WO_godot_client_idle_cpu_regression.md) | Claude subagent (Sonnet) | no hidden-tab waste; floor attributed |
| Godot client code health | [WO-987](../work-orders/987_WO_godot_client_code_health.md) | **Codex Sol** | thumbnail waiter pile-up fixed; 3 findings open |
| Offline suite / CI runtime | [WO-988](../work-orders/988_WO_offline_suite_runtime.md) | Claude | suite 229 → 81 s on 4 cores |

## Headline numbers (measured on the box)

| Metric | Before | After | Source |
|---|---|---|---|
| node CPU (idle show, /proc) | 6.48 % | 5.33 % | WO-980 |
| node event-loop p99 | 17.6 ms | 7.0 ms | WO-980 |
| `GET /api/playlist/state` (polled 1.5/s by Companion + Godot) | 23.3 ms | 6.2 ms | WO-980 |
| `GET /api/replication/status` | 16.6 ms | 2.8 ms | WO-980 |
| `findmnt` spawns from node | ~7 /s | 0 | WO-980 |
| autosave persist p50 (edit / echo) | 2.87 / 1.64 ms | 2.22 / 1.30 ms | WO-981 |
| OSC WS bytes per client | 202 KB/s | 65 KB/s (measured, delta mode on) | WO-985 |
| Godot client idle, Live tab | 18.4–20.9 % of a core | 17.0–17.3 % (2×20 s, 07.11 01:27, delta mode on) | WO-798 / this note |
| offline suite, 4 cores (CI-sized) / full box | 229 s / 63 s | 81 s / 42 s | WO-988 |
| CI Offline tests step / verify job (GitHub) | 4 m 02 s / 4 m 50 s | **1 m 27 s / 2 m 10 s** | WO-988 |
| casparcg CPU with the PRV loop playing / paused | 249 % / 44 % | unchanged (owner's media choice) | WO-982 |

## What was fixed (committed)

- **WO-980** (`f96c55b0`):
  - `isVolumeMountedSync` reads `/proc/self/mountinfo` instead of spawning `findmnt` on every poll;
  - media dedupe uses a shared `Intl.Collator` instead of building a new one per compare;
  - follow-service builds its guard key once instead of on every evaluation.
- **WO-981** (`12aafcf1`, `be4af080`):
  - `canonicalJson` is hand-rolled and byte-identical to the old one (a Sol review found 2 divergences, now fixed);
  - `persistProject` reads the stored project once and reuses the serialized text for the `_autosave` copy.
- **WO-983** (`5fdd4b06`):
  - fractional channel fps (29.97/59.94) is parsed with `parseFloat` for mixer tweens;
  - `msToFrames` floors with a 1e-6-frame tolerance, so exact frame boundaries are no longer one frame short.
- **WO-984 round 1** (`d7b1002d`): the multiview route's deadline timer is cleared in `finally` (it used to leak per request).
- **WO-985** (`759ced32`, `0cd0d189`):
  - every OSC consumer now REPLACES a delta channel instead of merging it; merging kept pruned layers alive;
  - this covers the web client, Godot, and the multiview/timer templates;
  - `osc.wsDeltaBroadcast` is ON live and in `defaults-core.js`.
- **CI flake** (`9f47a20e`): `smoke-wo570` stamped its 5 s offset before a slow first `recordPlay` on a loaded runner.
- **WO-798** (`d15d3aad`): `--probe-perf` lists the scripts with `_process` on (tooling only).

## Where the CPU actually goes (attribution)

- **CasparCG (~250 %)**: ~200 points are one clip. `abstract-falling-neon-lines…mov` is 3840×2160 ProRes HQ 10-bit at
  610 Mbit/s, looped on PRV into a 2560×640 channel. With it paused the floor is ~40 %. HighAsCG's own AMCP/OSC traffic
  is negligible.
- **Node (~5 %)**: after WO-980 the remaining cost is OSC decode (~0.8 %) and request handling. Nothing polled costs
  more than 1 ms.
- **Godot (~17 % on Live)**:
  - ~5 points: uploading and redrawing the held 1080p opgui surface;
  - ~2 points: OSC JSON, now lower with delta mode;
  - ~5 points: the engine/driver floor;
  - the rest: within noise per script.
- **Take latency (PRV, 136–186 ms)**: ~2 ms is server compute. 80 ms is a fixed prebuffer `setTimeout` and the rest is
  AMCP acks and HTTP.

## Proposals — need an owner decision

| # | Proposal | Expected gain | Cost / risk | WO |
|---|---|---|---|---|
| O1 | Add a 2560-wide ProRes Proxy/LT or HAP **version** of the PRV/Dioda loop | Caspar ~250 % → ~50–80 % | Media prep only (auto-proxies were ruled out 04.10) | 982 |
| O2 | Cap Caspar's ffmpeg filter-graph threads (build-v2 patch next to the WO-790 `<threads>` knob) | ~25–35 % of a heavy clip's cost | Caspar rebuild + binary swap | 982 |
| O3 | Shorter prebuffer for preview-only (bankless, cut) takes: 80 → 0–20 ms, behind a knob | PRV take −60 ms | AMCP timing; glass A/B on PRV | 981 |
| O4 | Godot idle redraw cap at 60 fps | ~2 points | Less smooth UI | 798 |
| O5 | Opgui preview upload at half size on Live | most of ~5 points | Softer preview | 798 |
| O6 | Compact persistence state file (`HIGHASCG_PERSISTENCE_PRETTY=0`) | state write −30 % | Unreadable state file | 981 |

## Proposals — engineering backlog (no owner call needed, low priority)

- **Delta mode, server side**: `osc-lifecycle.js:66-72` still clones a full `getSnapshot()` every tick for the
  StateManager mirror. Clone only dirty channels. (WO-985)
- **Project read memo**: key it on mtime+size and hand out `structuredClone` copies (callers mutate). About 1 ms per
  polled call, so low value after WO-980. (WO-980 P2)
- **OSC decode fast path**: drop unrouted addresses before arg decode (WO-401 F10). Saves under 1 %, but the
  float-endian latch makes it risky. (WO-980 P3)
- **`getRawMediaCatalog`**: read `getStateShared()` instead of a deep clone. (WO-980 P4)
- **Push `playlist_state` over WS** instead of 1.5 req/s polling. Needs Companion + Godot changes. (WO-980 P5)
- **Take path**: `withScreenGlobalBorderForChannel` re-reads the project on every take. Decide the semantics first:
  the disk copy lags edits by 750 ms. (WO-981 P2)
- **Late keyframe entry**: the tween length/easing continuation on late segment entry is an executable TODO in
  `smoke-983-timeline-schedule`. It changes live tween timing, so it needs glass QA. (WO-983)
- **Async network status**: nmcli/timedatectl status calls still run synchronously on the event loop. Round 2 adds
  only a TTL cache. (WO-984 P2)

## WO-984 round 2 (Codex Sol) — fixes for the 6 code-health findings (`5fea890b`)

| Finding | Fix | Test |
|---|---|---|
| Exit-layer STOP/CLEAR batch rejection was swallowed (`catch {}`) | logged as `warn` with the channel-layers; still resolves | STOP rejection warns + resolves |
| rsync timeout sent SIGTERM only, unbounded stdout/stderr | SIGKILL after 3 s, output capped at 256 KiB, late chunks ignored | 3 rsync cases |
| USB browse rate-limit Map kept every identity forever | expired identities pruned on insert of a new one | 1001 → 1 |
| test-agent remote hung until the deadline on EOF | settles once on `end`/`close` | EOF rejects immediately |
| async `onBoot` rejections unobserved | `.catch` logs `[modules] onBoot(...) failed` | bootOne + bootAll |
| nmcli spawned on every network status GET | 5 s TTL cache, cleared by apply/reset POSTs | 6 → 3 calls; invalidation |

The round-1 tests had pinned the defects as passing. They now assert the correct behaviour: 0/6 passed before the
fixes, 9/9 after.

Coordinator review found one regression in Sol's rsync change. Clearing the deadline on `exit` would hang forever when
ssh keeps the pipes open. The deadline now survives `exit`, and a test covers it.

On the box: node restarted with the fixes; clean boot. `GET /api/system/network` takes 62 ms cold and 40–47 ms cached.

## WO-986 (Codex Astra) — security sweep (`bb510dd3`)

**Fixed:** USB import followed a **symlinked parent** out of the drive. `lstat` checked only the leaf, so a crafted
stick plus a LAN caller selecting `escape/x` could import any server-readable file into the media library. Selected
items now get a realpath containment check. The coordinator limited the check to selected items, so a whole-drive walk
does not pay 2 realpath calls per file.

**Open (proposals, pinned as executable TODO tests):**
1. The media resolver (`local-media-paths.js` `resolveSafe`) is lexical and follows an existing link outside the
   roots. Media deliberately uses bridge/project links, so the fix is a canonical-root allowlist, not a no-symlink rule.
2. Stream URLs that embed a key (`rtmp://…/live/<key>`) survive the base settings redaction. The fix is a
   credential-free URL plus a has-credential flag (WO-830c round-trip contract).

**Recorded, not changed:**
- With `enforceAuth` off (the WO-811 design), any browser origin that can reach the LAN can drive the API. The
  proposal is to separate origin policy from auth.
- Legacy replication (`peer-client.js`) sends its Bearer token and replication token over plain HTTP. Signed cluster
  calls (WO-712) are fine.

**Clean:**
- Command execution: every request-derived spawn uses argv, no shell.
- AMCP quoting folds CR/LF.
- Project slugs refuse traversal.
- Repo secret scan: 23 tracked config JSONs plus key/token patterns, no hit. This is a bounded scan, not a history
  audit.

## WO-987 (Codex Sol) — Godot client code health (`8ffa13be`)

**Fixed:** `look_thumb.gd` appended the card's redraw callback on every refresh while a thumbnail request was pending,
and kept callbacks of freed cards. Two cards × 100 refreshes left 400 waiters; now there is 1 per live card. The test
fails 100× on the old code. Godot suite: 26182 / 0.

**Open (proposals):**
1. Thumbnail caches are never evicted: the `LookThumb` static cache, plus the Visuals memory and disk caches. They grow
   with every distinct media/shader revision over a multi-day session. A bounded LRU needs visual QA.
2. The whole deck is rebuilt on any `scene*` change, including a pure "which look is live" change. Reconcile the cards
   by ID instead; WO-971 covers the scroll side.
3. The `ws.gd` handler registry keeps Callables of freed receivers (it is not a native signal). Conditional on a
   recreate path; not proven live.

## WO-988 — offline suite runtime (`6bc00cfd`)

CI's critical path was the 4-minute offline test step. Per-file timing showed 257 s of actual test work but 709 s of
process time. The difference was files idling after their last test:
- five timeline smokes kept a `TimelineEngine` 40 ms ticker alive, 60 s each;
- the web client's roster-import timeout timer was never cleared, 15 s × 2 files (a real product bug, fixed);
- WO-543 had the same ticker problem, 10 s.

Node's default concurrency of 3 on the 4-vCPU runner left those sleep-bound files serial.

Fixes:
- the affected smokes clean up their engines (test-only);
- `withParseTimeout` clears its timer;
- the runner uses concurrency `min(1.5×cores, cores+4)`.

Result: **229 s → 81 s** on 4 pinned cores and 63 → 42 s on the box, 0 failures. Starting the slowest files first was
also tried and gave no gain (228.6 vs 228.5 s).

## How the sweep was run

- **Lanes**: one lane per agent, set in a shared contract (scratchpad `CONTRACT.md`) with file ownership. Agents did no
  git operations; the coordinator reviewed each diff, ran the gates and committed explicit paths.
- **Box lock**: AMCP/PGM-touching measurements ran under the box lock (`flock box2.lock`), and the box was left as found.
- **Codex** (ChatGPT Plus):
  - command: `codex exec -m gpt-6-astra|gpt-6.1-sol -s workspace-write --ephemeral -o <out> "<brief>" </dev/null`;
  - on-box jobs add `-c sandbox_workspace_write.network_access=true`;
  - Astra wrote the AMCP/timecode test sweep and the security sweep;
  - Sol did the code-health sweep plus a correctness review of WO-979/981, which caught the 2 `canonicalJson`
    divergences.
- **Rules for agent tests**: tests that pin a defect as "expected" are not registered in CI. They are converted into
  regression tests that assert the correct behaviour (WO-984 round 2).
