# WO-984 — Code-health sweep of src/ and tools/
**Area:** engine, testing-ci, network, process
**Status: DONE (07.11.26, Round 2: 90 smoke tests pass; eslint, line and export gates pass)**

## Investigation

Scope: eligible `src/` and `tools/`, read-only inspection of CI tooling/baseline. No edits
in WO-980's server/WS/OSC/state/bootstrap lane, index.js, or WO-798's Godot lane. No live
service, Caspar, Godot, GUI, E2E, network probe or deployment was run. INDEX searches preceded
issue classification: WO-101 (robustness), WO-201 (multiview queue), WO-445/446 (duplicates),
WO-831 (dead code), WO-367 (export ratchet), WO-61/78 (replication), WO-156 (MV reapply).

Lexical sweep across 849 eligible src JS files: 194 timer lines/136 files, 65 synchronous
process-call lines/29 files, 734 synchronous fs lines/152 files, 153 JSON.parse lines/118
files. Across 94 tools JS files excluding smoke/CI/E2E: respectively 48/32, 13/10, 204/46,
35/23. Counts are search candidates, including comments; they are NOT confirmed bugs or an
exhaustive call-graph audit. Focused inspection and isolated execution produced these findings,
ranked by plausible live-box impact rather than number of matches.

### 1. High: synchronous system commands can stall all Node control traffic (deferred)

`src/system/network-inventory.js:65-93` calls nmcli synchronously two or three times per
`readNmcliMode`. Caller: `src/api/system-hardware-network.js:29-34` (network GET), also
`src/api/system-hardware-summary.js:250`. There is no cache at this helper. Offline injected
input: active connection list empty, fallback `wired:eth0`, method `ipv4.method:auto`.
Two successive lookups make **six synchronous calls**, each configured with a 5,000 ms
timeout. A slow-but-returning command sequence can consume almost 15 seconds per lookup;
a first command that times out short-circuits in catch. These are budgets, not measured
production stalls. Frequency is per corresponding HTTP request, not a proven polling rate.

Other blocking request/periodic paths inspected (not changed):

| Evidence | Trigger/frequency | Blocking work / concrete input or budget |
| --- | --- | --- |
| `src/api/system-hardware-network.js:102,163` | Each network apply/reset POST | synchronous sudo script, 30,000 / 45,000 ms timeout; script slow to return |
| `src/api/system-time.js:51,135-162` | Each time GET; set/NTP POST | timedatectl show (GET: 5,000 ms), synchronous time-setting commands |
| `src/replication/replication-ssh-setup.js:208,326` | Missing pairing key; pairing connectivity check (`connect-pair.js:241,327`) | ssh-keygen has no timeout; rsync dry-run timeout 20,000 ms; unreachable peer |
| `src/api/routes-system-setup.js:105,117,212,275` | Setup/status/action request | shell lookup 4 s, systemctl 5 s, synchronous sudo actions; slow service manager |
| `src/api/routes-cg-thumb.js:24-29,85-86` | Every cached PNG GET / completed render cache miss | synchronous stat/read/write; even a matching conditional GET reads the PNG first |
| `src/api/routes-logs.js:27-39`; `src/streaming/stream-link-health.js:76-81,95-117` | Active stream watcher, default every 2 s; status reads cached 1 s | synchronous open/read/close of up to 256 KiB tail plus log path resolution; slow disk |
| `tools/sweep/sweep-util.js:16-23` | Each CLI sweep sh() invocation | spawnSync default 60 s; CLI, not server request path |
| `tools/test-agent/lib/xinput.js:23` | Each CLI xdotool operation | spawnSync with no timeout; wedged X server; CLI, not server request path |

Project-store/persistence sync writes are existing WO-101/WO-981 territory; no competing
rewrite attempted. Converting these to async requires explicit ordering/concurrency tests.

### 2. High: transition STOP/CLEAR failure is silently reported as completion (deferred; WO-101)

`src/engine/scene-exit-layers.js:359-383`, `runExitLayersStopAndClear`: timer callback
catches all exceptions and always resolves. Offline input: exiting layer 10 on channel 1,
zero-duration transition, `batchSendChunked` rejects `AMCP transport failed`. Observed:
commands `STOP 1-10`, `MIXER 1-10 CLEAR` attempted, **zero logs**, zero mixer commits, outer
promise resolves undefined. This can leave an exiting producer alive while callers proceed.
No on-air failure was induced. Existing WO-101 T101.0 owns the wider silent-catch sweep.

### 3. Medium: rsync timeout settles before process termination, with unbounded capture (deferred)

`src/replication/rsync-exec.js:23-45,55-60`: timeout sends SIGTERM once, clears its only
deadline and resolves. No SIGKILL escalation or output limit; stdout/stderr listeners retain
and append strings after settlement. Offline injected child ignores SIGTERM and never closes:
result says timedOut, **one SIGTERM, zero timers, one stdout data listener** remain. Emitting
another 1 MiB chunk after settlement still reaches the capture callback. A hung replication
child can survive while later operations start another. This is a simulated child lifecycle,
not proof that the installed rsync ignores SIGTERM. Process-tree policy is a larger change.

### 4. Medium/conditional: async module boot rejection is not observed (deferred; WO-101)

`src/module-registry.js:123-135,162-173`: bootOne/bootAll invoke onBoot inside synchronous
try/catch without awaiting/attaching a rejection handler. Offline descriptor returns a
rejected promise: bootOne reports **true with zero logs**. Test observes the promise itself
to avoid intentionally crashing the runner. Current previs/tracking/autofollow onBoot
entries are synchronous wrappers; this is an API robustness hole if a hook returns a
rejecting promise, not evidence of an active production rejection or failed module.

### 5. Low: multiview deadline retains a timer after request settlement (FIXED)

Diagnosis recorded before production edit: original `src/api/routes-multiview.js:51-53`
created a 25,000 ms timeout per valid apply without clearing it when the race settled.
Before-fix smoke: **1 pass, 3 fail** (success/503/502 each retained one timer; 504 test passed).
After fix: success loop runs 100 applies and each returns to zero timers; errors do likewise;
504 still works. At sustained r requests/second, roughly 25r pending timers could accumulate
until deadlines expire. This is **bounded 25-second retention**, not a permanent leak.
Promise.race observes the later rejection; this was not an unhandled rejection claim.
Existing WO-201 is an apply-chain deadlock, distinct from deadline retention.

### 6. Low under normal LAN use: request caches retain old identities/filenames (deferred)

`src/api/routes-usb-ingest.js:54-69`: browse rate-limit Map never deletes IP keys. Offline
input: 1,000 distinct IPs, missing driveId (400; no disk access), advance clock 60 s then
browse from another IP. **1,001 entries** remain, including timestamps older than 10-second
window. Each IP's array is capped at 40; distinct identities are not. No claim that a normal
small LAN reaches material memory pressure. `src/api/routes-media.js:37,95,155-162` similarly
retains failed thumbnail keys until that filename later succeeds; unique failed filenames
can accumulate. The thumbnail case is static evidence, not a measured heap increase.

### 7. Low/CLI only: remote client EOF waits out deadline (deferred)

`tools/test-agent/lib/remote.js:16-43`: no end/close handler. Offline socket emits end and
close without a newline JSON answer: **zero deadline clears**, pending send rejects only
when its deadline fires (default 30 seconds). This delays failed CLI operations; it does
not retain forever or run on the Node playout server. Buffer also has no size cap before
newline (static evidence). No Godot or socket was launched by the reproduction.

### 8. Low maintenance impact: verified helpers repeated at least three times (proposal only)

Exact numeric clamp `(v, lo, hi) => Math.max(lo, Math.min(hi, v))`:
`src/ptz/ptz-calibrate.js:26`, `src/ptz/ptz-model.js:109`,
`src/fixtures/pixel-map-propose.js:113`. Concrete equivalence input `(2,0,1)` returns 1;
NaN remains NaN. Propose `src/utils/numeric.js` with this exact finite/nonfinite contract;
other clamp helpers have different coercion/fallback semantics and must not be folded in.

Identical four-entity `String(s)` escaping:
`src/cg-studio/export-template.js:90`, `src/api/routes-osc.js:169`,
`tools/wiki/md-to-html.js:8`, plus one-line `src/cg-studio/gtzip-import-html.js:19`.
Input `&<>"` yields `&amp;&lt;&gt;&quot;`; apostrophe remains unchanged. Propose a pure
CommonJS `src/utils/escape-markup.js` for these server/tool callers. Browser/CEF standalone
scripts need separate packaging. `config-generator-utils.js:18` differs for falsy inputs
(`0` becomes empty), so do not merge it without contract tests. Follow WO-446; savings are
maintenance, not a proven runtime performance gain.

### 9. Low maintenance impact: baseline orphans need classification, not blind deletion

Baseline has 691 known entries. Read-only export gate now scans 1,393 files and finds 685
current orphans, zero new, six resolved baseline entries (the new tests reference public
helpers). Gate counts names outside their declaring file, including tests/comments: it is
not a call graph and says nothing about internal callers or dynamic descriptor dispatch.

Repo searches across src/client/tools/scripts/template/test/index.js classify these samples:

- **Truly unused function bodies in checked-in code:**
  `src/engine/scene-play-seek.js:156` elapsedFramesFromPlayback;
  `src/engine/scene-transition.js:241` runTimelineOnlyTake;
  `src/module-registry.js:68` listNames. Each appears only at declaration/export plus the
  baseline. No in-repo direct or string-name caller was found. All three are in the 691
  baseline. Do not claim external consumers are disproven; remove only after coordinator review.
- **Unused export, live local function:** `src/api/host-live-ndi.js:71,110` update/reload
  are called by handleNdiHostLive at 136/139, itself reached by routes-host-live.js:114.
  `src/api/box-local-request.js:28` splitHostHeader is called at 50;
  `src/api/routes-osc.js:146` buildConfigHintXml is called at 52/123. All are baseline entries;
  their function bodies are not dead. Export removal could be considered separately.
- **Dynamic entrypoints:** module-registry.js:55 loads `./${name}/register`; handleApi at
  214 and handleWs at 245 dispatch descriptor members; previs/tracking/autofollow register
  onBoot/onShutdown hooks are live by descriptor lookup, not orphan candidates. These
  descriptor hooks are not the three baseline dead-body samples above.

JSON/error sweep negative evidence: peer-client.js:63, syncthing-client.js:45,
discover-leaders.js:19, peer-ws-client.js:102, ltc-input.js:120 and ltc-output.js:168 all wrap
JSON.parse in try/catch. No unguarded parse crash is claimed for those inputs. Discovery
HTTP body collection (`discover-leaders.js:13-16`) remains unbounded and uses an idle timeout;
a drip-fed response is a follow-up candidate, not reproduced here. Art-Net tap subscribe
returns an unsubscribe (`src/artnet/artnet-tap.js:26-28`); simulated OSC feeder returns its
interval clearer (`src/caspar/sim-osc-feeder.js:90`). Creation alone is not leak evidence.

## What was done

- `src/api/routes-multiview.js`: retain deadline handle, clear in finally on every settled
  race. Four additions and one deletion; status codes, persistence keys, apply operation and timeout
  duration preserved. No existing source-pinned smoke assertion needed repointing.
- `tools/smoke/smoke-984-multiview-deadline.test.js`: four acceptance tests execute the actual
  route in VM with isolated timer/engine/persistence dependencies; prove before/after and
  preserved success/debug/persistence/error/timeout behavior.
- `tools/smoke/smoke-984-resource-findings.test.js`: six diagnostic reproductions execute
  actual source with controlled child/socket/clock/AMCP dependencies. Assertions intentionally
  document current deferred defects; replace with desired contracts when fixing them. They
  do not certify those defects as acceptable behavior.
- `work/work-orders/984_WO_src_tools_code_health_sweep.md`: this ranked evidence and handoff.

No curated list, baseline, index or queue edits; coordinator registers the two new tests and
regenerates WO index. No git state-changing command executed. Other engineers' changes left alone.

## What was VERIFIED

Exact final commands:

```
node --test --test-isolation=none tools/smoke/smoke-984-multiview-deadline.test.js tools/smoke/smoke-984-resource-findings.test.js tools/smoke/smoke-multiview-reapply.test.js tools/smoke/smoke-wo600-multiview-audio-focus.test.js
npx eslint src/api/routes-multiview.js tools/smoke/smoke-984-multiview-deadline.test.js tools/smoke/smoke-984-resource-findings.test.js
node tools/ci/check-max-file-lines.js
node tools/ci/check-unwired-exports.js
```

Results: **21 tests pass, 0 fail, 0 skipped** (10 new: four acceptance + six diagnostic;
11 existing multiview regressions). ESLint exit 0, zero diagnostics. Line gate exit 0,
zero files over 500. Export gate exit 0, zero new orphans, 685 current / 691 baseline.

Normal runner verification:
`node --test tools/smoke/smoke-984-multiview-deadline.test.js` — exit 1, runner reports one
file failure / zero passes without subtest diagnostics. Identical tests execute successfully
with `--test-isolation=none`; the initial child-runner failure had no useful diagnostic (later reruns below).
A later rerun succeeded:
`node --test tools/smoke/smoke-984-multiview-deadline.test.js tools/smoke/smoke-984-resource-findings.test.js`
— 2 file-level passes, zero failures. Final normal-runner regression command:
`node --test tools/smoke/smoke-984-multiview-deadline.test.js tools/smoke/smoke-984-resource-findings.test.js tools/smoke/smoke-multiview-reapply.test.js tools/smoke/smoke-wo600-multiview-audio-focus.test.js`
— **4 file-level passes, zero failures**, exit 0. This runner reports file-level counts;
the isolation-disabled run above supplies the 21 individual subtest results. Initial runner
failure is intermittent rather than an outstanding failing test.

Shell invocations also intermittently print `Failed to create stream fd: Operation not
permitted`; treated as sandbox artifacts. No listen/connect-dependent test was attempted;
all new tests use fakes, and no network/service success is inferred.

Not proven: full offline suite, outside-sandbox execution, production timings,
heap RSS under actual requests, real child/process-tree termination, on-air visuals or audio,
external/dynamic consumers beyond inspected repository code, exhaustive absence of leaks.
No live QA or restart. These limits do not block the small timer cleanup's isolated proof.

## Proposals

1. WO-101 follow-up: log/propagate exit STOP/CLEAR errors with an explicit transition policy;
   accept/reject async boot hooks deliberately; test failure reporting without altering air blindly.
2. Move network/time/setup/SSH status commands off the event loop; bound subprocess budgets,
   coalesce status polls and test cache freshness/order. Measure p95 control latency outside sandbox.
3. Give rsync deadline a termination/reaping policy, process-tree handling, and capped logs;
   test a real SIGTERM-resistant fixture outside this live-box sweep.
4. Prune expired USB browse identities and bound failed-thumbnail retention with a tested TTL/limit;
   preserve the rate-limit window exactly. Small-LAN impact is currently unmeasured.
5. Make test-agent remote settle once on premature EOF; bound response size and clear timers/listeners.
6. Follow WO-446 for exact helper consolidation; review dead bodies separately from unused exports.
7. Coordinator: register new smoke files in tools/ci/offline-test-files.js, rebuild index with
   tools/wo/build-index.js, then run check-wos and the normal isolated tests outside this sandbox.

## Round 2 (fixes)

07.11.26. The six round-1 diagnostic tests are now regression contracts asserting correct
behavior. This section supersedes their deferred status and corresponding proposals above.
No git state operation, live service command, socket, deployment or PGM change was used.
INDEX and curated lists remain coordinator-owned under the explicit assignment.

### Investigation

Ranked by potential control-path impact; references below are repaired-source locations.
Before changing production code, changed the six assertions and ran:
`node --test --test-isolation=none tools/smoke/smoke-984-resource-findings.test.js`.
Result: **0 pass, 6 fail, 0 skipped**. Captured runner output in `/tmp/wo984-before.txt`
(ephemeral); durable assertion evidence is recorded here. No stash or replacement checkout.

1. `src/system/network-inventory.js:67`: two fallback eth0 reads ran six synchronous nmcli
   commands instead of three (assertion actual 6, expected 3). Now two reads within five
   seconds make three calls; expiry at exactly five seconds makes three more; explicit
   invalidation makes three more. `src/api/system-hardware-network.js:117,180` invalidates
   after apply/reset helper attempts, including failure because helpers can partly apply.
2. `src/engine/scene-exit-layers.js:383`: rejecting STOP/CLEAR for layer 1-10 produced zero
   warning logs (expected one). Now warning includes 1-10 and AMCP transport failed; promise
   still resolves, no commit on failure. Success still sends commands and commits without
   adding warnings.
3. `src/replication/rsync-exec.js:38`: timeout left zero escalation timers (expected one).
   Now SIGTERM is followed by SIGKILL after 3000 ms unless exit/close cancels escalation.
   A 1 MiB ASCII chunk on each stream is retained as only the last 256 KiB each; late data
   is not even decoded after settlement. Normal exit clears timers before close. Timeout
   still resolves promptly with timedOut=true; this does not await process-tree reaping.
4. `src/module-registry.js:117`: async boot rejection produced zero logs (expected one).
   Now bootOne and bootAll both observe rejected promises and warn with the error. bootOne
   remains synchronous: true for invoked async hooks, false for sync throws/missing module.
5. `src/api/routes-usb-ingest.js:62`: 1000 old identities plus a new client retained 1001
   entries (expected one). Now inserting a new identity prunes entries whose last hit is
   older than the existing 10-second window. No timer and no rate-window boundary change.
6. `tools/test-agent/lib/remote.js:47`: end/close cleared zero deadlines (expected one).
   Now EOF rejects immediately with a closed-before-complete-answer error; subsequent
   close/deadline callbacks cannot settle again. No real Godot connection was made.

### What was done

- `src/system/network-inventory.js`: five-second per-interface cache, expired-entry cleanup,
  copied return objects and explicit invalidation export; lookup remains synchronous.
- `src/api/system-hardware-network.js`: invalidate in both helper finally blocks, before
  rebuilding response status, including failed/partially applied commands.
- `src/engine/scene-exit-layers.js`: warn with affected physical channel-layers and error.
- `src/replication/rsync-exec.js`: unref'd escalation deadline, exit/close cleanup, bounded
  UTF-8 output tails and no post-settlement appends; original success/result shape retained.
- `src/module-registry.js`: shared promise observer; synchronous hook semantics retained.
- `src/api/routes-usb-ingest.js`: prune expired identities when inserting a new identity.
- `tools/test-agent/lib/remote.js`: shared settle-once handling and immediate EOF failure.
- `tools/smoke/smoke-984-resource-findings.test.js`: replace all six defect-pinning tests;
  add output/cleanup and apply/reset invalidation coverage (eight total regression tests).
- This work order: preserve round-1 history and append before/after evidence and limits.

### What was VERIFIED

Final commands (all exit 0):

```
node --test tools/smoke/smoke-984-resource-findings.test.js tools/smoke/smoke-wo708-auto-split.test.js tools/smoke/smoke-project-fps-network.test.js tools/smoke/smoke-wo830a-parsers.test.js tools/smoke/smoke-scene-exit-orphans.test.js tools/smoke/smoke-wo265-cg-studio-tab.test.js tools/smoke/smoke-wo419-review-rows-6-7-10.test.js tools/smoke/smoke-wo830b-injection-validation.test.js tools/smoke/smoke-wo616-tracking-marker-hub.test.js
npx eslint src/engine/scene-exit-layers.js src/replication/rsync-exec.js src/api/routes-usb-ingest.js tools/test-agent/lib/remote.js src/module-registry.js src/system/network-inventory.js src/api/system-hardware-network.js tools/smoke/smoke-984-resource-findings.test.js
node tools/ci/check-max-file-lines.js
node tools/ci/check-unwired-exports.js
```

Normal runner: **90 pass, 0 fail, 0 skipped**, 18 suites (8 repaired/new regressions plus
82 existing tests). Existing files discovered with
`rg -l 'scene-exit-layers|rsync-exec|routes-usb-ingest|lib/remote|module-registry|network-inventory|system-hardware-network' tools/smoke`.
ESLint: zero diagnostics. Line gate: zero files over 500. Export gate: no new orphans,
1393 files scanned, 685 current / 691 baseline; baseline left untouched.

Intermediate isolation-disabled existing-smoke run: 81 pass, 1 fail; WO-708 expects the
normal test runner's temp storage context but resolved ~/.highascg/tracking-auto.json.
Normal runner subsequently passed all 90 tests twice. This failure was not suppressed or
fixed by changing its assertion. No listen/connect test hit EPERM in these runs.

Not proven: real nmcli latency, SIGTERM-resistant real rsync/process-tree termination,
full offline suite, on-air output/audio, or production memory measurements. All injected
process/socket tests are offline. Unrelated working-tree changes belong to other engineers;
no edits were made to their reserved lanes, configuration, index or curated CI files.

### Proposals (not built)

- Convert network inventory to asynchronous/coalesced commands; TTL still allows one
  synchronous miss per interface per five seconds and unknown results may be cached that long.
- Validate real rsync escalation/reaping outside the live sweep; descendants are not targeted.
- Bound remote reply size and failed-thumbnail cache retention (round-1 follow-ups).
- Coordinator: regenerate INDEX after review; no new test file needs curated registration
  for this round (the existing WO-984 file still needs registration if round 1 was not added).

## Coordinator follow-up (07.11, Claude)
- Review of `rsync-exec.js`: round 2 cleared the deadline `timer` in the `exit` handler. When rsync exits while a grandchild
  (its ssh) still holds stdout/stderr, `close` never fires and the promise would hang forever (the old code at least
  timed out). The `exit` handler now clears only the SIGKILL escalation timer; the deadline stays until `close`/settle.
  The round-2 test that pinned "exit clears timers before close" now asserts the deadline survives `exit`, plus a new
  case: exit without close still settles `timedOut` at the deadline.
- `network-inventory.js`: JSDoc moved back onto `readNmcliMode` (it had ended up above the cache Map).
- Registered `smoke-984-resource-findings.test.js` in `tools/ci/offline-test-files-3.js`: 9 pass.
