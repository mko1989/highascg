# WO-281 — CasparCG log audit (logs.19.07.26)

**Question from the owner:** *"so many errors and false calls, just wild west… maybe connected to use batch amcp that was recently enabled. might have screwed some part of amcp."*

**Short answer:** the log is not wild west. It is **one** real fault (a powered-off DeckLink 4) amplified ~40× by CasparCG's stacktrace-per-failure logging, plus benign server-side chatter. **`amcp_batch` did not break anything** — and on this box it is not even the thing that got enabled. Details and evidence below.

Source: `work/work-orders/logs.19.07.26`, 493 lines, covering 21:51:10 → 21:53:10 (2 minutes). Level split: **273 `[error]` / 13 `[warning]` / 206 `[info]`**.

---

## 1. Pattern table

| # | Pattern | Count | Emitter | Verdict | Recommended action |
|---|---|---|---|---|---|
| 1 | `[error] Exception: …/decklink_producer.cpp(530): Throw in function …decklink_producer(…)` | 7 | CasparCG server (`decklink_producer.cpp:530`), triggered by `src/config/routing-setup.js:85` `tryPlayDecklinkInput` | **Real fault** — DeckLink 4 input cannot be opened (camera powered off / not cabled). Single root cause. | Fix at source (power/cable the camera) or disable the input. Already classified + retried + toasted by us. No code change. |
| 2 | `[error] [caspar::tag_msg_info*] = DeckLink 8K Pro [4\|1080p5000] Could not enable video input.` | 7 | same as #1 | **Real fault** — this is the *true* message for #1/#3/#5. | none (this is the useful line) |
| 3 | `[error] <n># 0x… in /home/casparcg/highascg/bin/casparcg` (stacktrace frames) | **210** | CasparCG server, 30 frames per failed `PLAY` × 7 | **Benign noise** — pure amplification of #1. 210 of the 273 `[error]` lines (**77%**) are stack frames for one dead camera. | Server-side log verbosity; not ours to change. Documented so it is not mistaken for 210 faults. |
| 4 | `[error] File not found.` | 7 | CasparCG server | **Mislabelled** — nothing is missing from disk; it is #2. Known Caspar behaviour: any producer that fails to construct surfaces as 404. | none server-side; **fixed our side** — see §3. |
| 5 | `[info] Sent message to 127.0.0.1:404 PLAY FAILED` | 7 | CasparCG server, in reply to `PLAY 6-4 DECKLINK 4` (7×) | **Mislabelled success code** — a genuine failure reported under a misleading code. Correctly classified by `routing-setup.js:89` (`/404\|PLAY FAILED/i`). | none — already handled |
| 6 | `[warning] Device supports video-format with conversion: 1080p50` | 7 | CasparCG server, decklink producer probe | **Benign** — informational; card would accept 1080p50 with conversion. Emitted once per retry attempt. | none |
| 7 | `[info] Sent message to 127.0.0.1:404 REMOVE FAILED` (for `REMOVE {1,2,3,4,6,7}-701`) | 12 | our `src/preview/compose-preview-consumer.js:159` → `basic.remove(ch, null, 701)` (`COMPOSE_FILE_CONSUMER_INDEX = 701`), 6 channels × 2 rounds | **Benign** — best-effort teardown of a compose-preview consumer that is not attached. Caller swallows it (`/* ok if absent */`). | none — **already** downgraded to `debug` our side by `amcp-protocol.js:183-186` (`optionalRemoveMiss`). Noise is Caspar's own log only. |
| 8 | `[warning] Executing batch: BATCH(n commands)` (n = 6, 7, 6, 2) | 4 | CasparCG server, on every `BEGIN…COMMIT` | **Benign** — server logs normal batch execution at `warning` level. Reads as an error; it is not. | none (server log-level choice). Called out so it stops being read as a fault. |
| 9 | `[warning] ffmpeg[PROJECTS/TETST/02_BUMPER\|0.0000/15.0400] Latency: 0` | 2 | CasparCG ffmpeg producer | **Benign** — latency report at clip start; `0` is the good value. | none |
| 10 | `[info] ffmpeg[…] Destroyed.` | 4 | CasparCG ffmpeg producer | **Benign** — normal producer teardown on `STOP`/`CLEAR`. | none |
| 11 | `Received message … MIXER <n> COMMIT` (standalone, outside any batch) | 16 | our take/preview pipeline (`mixerCommit`) | **Benign but redundant** — several fire back-to-back on the same channel within ms (e.g. lines 66 & 74 both `MIXER 2 COMMIT`, 73 ms apart; 96 & 108; 159/161/165). Harmless, adds AMCP round-trips. | **Recommend only** (behaviour change): coalesce duplicate per-channel `MIXER n COMMIT` within a tick. Not implemented. |
| 12 | `BEGIN` / `COMMIT` / `202 COMMIT OK` | 4 / 4 / 4 | `runBeginCommitBatch`, `src/caspar/amcp-batch.js:192` | **Benign — all healthy.** 4 opened, 4 committed, 4 acked. Zero missed acks. | none |

**Totals reconcile:** 273 `[error]` = 210 stack frames (#3) + 7×(#1 exception + #2 msg_info + #4 file-not-found) + 42 blank/`[boost::errinfo_api_function_*] = EnableVideoInput` continuation lines. **Every single `[error]` line in this log traces to the one powered-off DeckLink 4.** There are no unexplained 404s.

---

## 2. `amcp_batch` verdict — **NOT GUILTY. No evidence of harm.**

### 2a. The flag that got enabled is not `amcp_batch`

`config/general.json` on this box, live, unmodified vs `HEAD`:

```
  "amcp_batch": false,
  "amcp_max_batch_commands": 64,
  "amcp_mixer_commit_before_amcp_batch": true,
  "take_two_phase_batch": true,
```

`amcp_batch` is **`false`**. The batching visible in the log comes from **`take_two_phase_batch: true`** (WO-259), which drives the only two `forceBatch` call sites:

- `src/engine/scene-take-lbg-amcp-pipeline.js:234` — `batchSendChunked(phaseALines, { skipMixerPreCommit: true, forceBatch: true })`
- `src/engine/scene-route-deps.js:333` — `batchSendChunked(block, { skipMixerPreCommit: true, forceBatch: true })`

`forceBatch` is documented at `amcp-batch.js:322` as deliberately *"independent of the global `isAmcpBatchEnabled`… does not affect any other caller."* So the suspicion is misaimed: **the global AMCP batching flag is off**; only the take path and route-dep path batch, by design.

### 2b. Every batch in the log succeeded

Four batches, all clean — e.g. lines 76-91:

```
[2026-07-19 21:51:16.642] [info]    Received message from 127.0.0.1: BEGIN\r\n
… 6 commands …
[2026-07-19 21:51:16.642] [info]    Received message from 127.0.0.1: COMMIT\r\n
[2026-07-19 21:51:16.642] [warning] Executing batch: BATCH(6 commands)
[2026-07-19 21:51:16.643] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
…
[2026-07-19 21:51:16.644] [info]    Sent message to 127.0.0.1:202 COMMIT OK\r\n
```

Checks against each suspected failure mode:

| Suspected failure mode | Evidence | Result |
|---|---|---|
| Missed `COMMIT` acks | 4 `BEGIN`, 4 `COMMIT`, 4 `202 COMMIT OK` | **None.** Every batch acked, within 1-2 ms. |
| Batch-drain wedge / ack timeout | live journal, last 6 h: `batch COMMIT ack timeout\|stale batch drain\|falling back to sequential\|response timeout` → **0 matches** | **None.** The WO-259 drain timeout (`amcp-batch.js:269`) never fired. |
| `MIXER n COMMIT` illegally inside `BEGIN…COMMIT` | All 16 `MIXER n COMMIT` are outside batches. Structurally impossible anyway: `validateBatchLine` (`amcp-batch.js:132`) rejects `/^MIXER\s+\d+\s+COMMIT\b/i` before send. | **None.** Guard holds. |
| Commands rejected inside a batch | No 4xx/5xx line appears between any `BEGIN` and its `COMMIT OK`. | **None observed** — but see the real caveat in §4.1. |
| Keyword-FIFO desync | See below | **Not applicable to batches** — batch replies bypass the FIFO entirely. |

### 2c. Out-of-order batch replies exist — and are harmless

Lines 150-157 are the one case where CasparCG replied out of submission order:

```
[2026-07-19 21:51:16.902] [info]    Received message from 127.0.0.1: PLAY 1-10\r\n
[2026-07-19 21:51:16.902] [info]    Received message from 127.0.0.1: MIXER 1-110 OPACITY 0 25 linear\r\n
[2026-07-19 21:51:16.902] [info]    Received message from 127.0.0.1: COMMIT\r\n
[2026-07-19 21:51:16.902] [warning] Executing batch: BATCH(2 commands)
[2026-07-19 21:51:16.903] [info]    Sent message to 127.0.0.1:202 MIXER OK\r\n
[2026-07-19 21:51:16.903] [info]    Sent message to 127.0.0.1:202 PLAY OK\r\n
[2026-07-19 21:51:16.903] [info]    Sent message to 127.0.0.1:202 COMMIT OK\r\n
```

Commands went `PLAY` → `MIXER`; replies came back `MIXER` → `PLAY`. **Reversed.** This *would* be a keyword-FIFO desync hazard in single-command mode — but it is not, because while a batch is in flight the response path never reaches the FIFO. `amcp-protocol.js:116-124` short-circuits:

```js
if (self._amcpBatchDrain && typeof self._amcpBatchDrain.onLine === 'function') {
    try { self._amcpBatchDrain.onLine(line) } catch (e) { … }
    return
}
```

The drain (`amcp-batch.js:207-228`) accumulates lines and resolves only on `isBatchCommitAckLine`. Per-command replies are never matched to per-command waiters, so their order cannot desync anything. **Batching is, on this specific axis, more robust than the sequential path.**

**Verdict: enabling batching broke nothing observable in this log or in the last 6 hours of live operation. Do not roll back `take_two_phase_batch`.** Note also that the `route://` PLAYs in this capture (lines 45-56, 243-254) went out **un-batched** as individual `PLAY`+`MIXER` pairs, so the `scene-route-deps` folding path did not even engage here.

---

## 3. What was fixed

**`src/caspar/amcp-protocol.js` (~line 188) — added context to a misleading log line.** Text-only, no behaviour change.

The single loudest line in live operation is `Got error MEDIAFILE_NOT_FOUND: 404 PLAY FAILED`, which is emitted for a DeckLink producer failure where **no media file is involved at all**. It sent the owner looking for a missing file. The logger now appends, for `MEDIAFILE_NOT_FOUND` on `PLAY` only:

> `— note: 404 on PLAY also covers a producer that could not open (e.g. DeckLink input powered off / not cabled), not only a missing media file`

This mirrors the existing `optionalRemoveMiss` precedent two lines above and the classification already done in `routing-setup.js:89`. Genuine missing-media 404s still log as errors, unchanged.

**Verification:** `npm run test:ci` → `tests 763 / pass 761 / fail 0 / skipped 2` (matches baseline). `npx eslint src/caspar/amcp-protocol.js` → exit 0, no output.

---

## 4. Real faults worth fixing — prioritised (recommendations only, NOT implemented)

### 4.1 — HIGH: command failures inside a `BEGIN…COMMIT` batch are silently swallowed

Not triggered in this log, but it is a live latent hole and the best available explanation for the owner's *"PRV sometimes recalls all layers of the look, sometimes not… sometimes recalls a layer with other layers' position/scaling."* Three independent facts compound:

1. `amcp-protocol.js:116-124` returns **before** the error-classification `switch` whenever a drain is active — so a `404`/`401` line arriving inside a batch is **never logged**.
2. `amcp-batch.js:210-227` `drain.onLine` pushes the line and only tests `isBatchCommitAckLine`. It **never inspects the status code**, and resolves `{ ok: true }` as long as the `COMMIT` ack arrives.
3. The captured lines are returned as `rawLines` — and `grep -rn "rawLines" src/ test/` outside `amcp-batch.js` returns **nothing**. No caller ever looks at them.

Net: a `MIXER`/`LOADBG`/`PLAY` line that fails inside a batch produces **no log, no rejection, no GUI signal** — the take reports success with a layer missing or mis-positioned. Exactly the reported symptom.

**Recommendation:** in `drain.onLine`, test each line for a `4xx`/`5xx` status and either (a) log it at `warn` with the batch context, or (b) surface it in the resolved object (e.g. `{ ok: true, failedLines: [...] }`) for take-path callers to check. Option (a) alone is low-risk and would have made this diagnosable. **Behaviour change — not implemented per WO scope.**

### 4.2 — HIGH (operational, not code): DeckLink 4 is dead and retrying forever

The live journal, last 6 hours:

```
   1079 [amcp-send-queue] 404 PLAY FAILED
   1079 [2026-07-20 TS] (HACG) [error] Got error MEDIAFILE_NOT_FOUND: 404 PLAY FAILED
```

Consecutive timestamps confirm a fixed 20 s cadence:

```
2026-07-20T10:43:30+00:00
2026-07-20T10:43:51+00:00
2026-07-20T10:44:11+00:00
2026-07-20T10:44:31+00:00
```

1079 ≈ 6 h ÷ 20 s = 1080. This is `DECKLINK_INPUT_RETRY_MS = 20000` (`routing-setup.js:96`) doing exactly what WO-4aa8627 designed it to do. **These 1079 errors are one powered-off camera, and they are 100 % of the live error volume** — the journal contains *no other* error or warning in 6 hours (the only other repeated lines are 360 `[OS-Config] Layout …` info lines and 11 `[Pointer confine]` info lines).

**Recommendation:** power/cable DeckLink 4, or remove it from `extraLiveSources` in `config/general.json` (it is configured there as `"label": "DeckLink 4"`, `route://6-4`). No code change needed.

### 4.3 — MEDIUM: the retry should back off and stop shouting

The retry is correct but unbounded and logs at full `error` severity forever, burying everything else (§4.2). **Recommendation:** exponential back-off (20 s → cap at ~5 min) after N consecutive failures, and/or log the repeat as `warn` with an occurrence count (`"…failed 47× since 21:51"`) instead of one `error` per attempt. **Behaviour change — not implemented.**

### 4.4 — LOW: redundant `MIXER n COMMIT` churn

16 in 2 minutes, with same-channel duplicates milliseconds apart (pattern #11). Harmless, but each is an AMCP round-trip on the take hot path. **Recommendation:** coalesce per-channel commits within a tick. **Behaviour change — not implemented.**

### 4.5 — LOW / informational: stacktrace amplification

77 % of `[error]` lines in the sample are Caspar stack frames (pattern #3). This is a CasparCG server log-verbosity choice, not ours. If it keeps obscuring real signal, the server log level for the decklink module could be lowered in the Caspar config — but the cleanest fix is §4.2.

---

## 5. Bottom line for the owner

- **Not wild west.** One dead camera, retried every 20 s, each attempt printing ~40 lines. Fix the camera and the log goes quiet.
- **`amcp_batch` is innocent — and it is `false` on this box anyway.** What you turned on is `take_two_phase_batch`. All four batches in the sample committed cleanly; the live journal shows zero batch timeouts, zero drain wedges, zero sequential fallbacks in 6 hours.
- **The one genuinely worrying thing batching introduced** is §4.1: errors *inside* a batch are invisible. That is worth fixing next, and it is a plausible root cause for the flaky PRV look-recall you reported separately.
