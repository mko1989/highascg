# PF-02 — WebSocket chatter (`change`, `log_line`, variable storms)

**Linked bulletin:** PERF-C3, PERF-C1, PERF-F1  
**Status:** **Implemented (Phases A–C)** — see [`README.md`](./README.md); details below.

---

## Problem

1. **`change`** events fan out **one WS message per StateManager emission**, with **no coalescing** at the socket layer — rapid **`channels.*`** / nested updates multiply **`send`** calls × clients.  
2. **`log_line`** broadcasts **every** HighAsCG log line to **all** clients with **no rate limit** — verbose modules × tabs ⇒ CPU + bandwidth spikes.  
3. **`variable_update`** batches exist in **`StateManager`** (~100 ms); **`channels.*`** updates from **`updateFromInfo`** do not share an equivalent WS-side debounce.

---

## Why it keeps coming back

- Logs feel “free” until production verbosity or automation connects.  
- Adding a new **`state.emit`** path often wires straight to **`broadcast('change')`** without asking “how often?”  
- **`log_line`** was built for the logs modal UX — correctness favored over safety caps.

---

## Direction that sticks

**Bounded fan-out policy** (defaults safe for broadcast rigs):

| Stream | Policy |
|--------|--------|
| **`change`** | Coalesce **same-path** updates within **50–100 ms** window per client batch OR merge pending `{ path → value }` map before stringify once. |
| **`log_line`** | **Hard cap** e.g. **50 msgs/sec** global + drop/sampler beyond; expose **`HIGHASCG_WS_LOG_LINE_MAX_HZ`** (default sane). Below cap: unchanged behavior. |
| **`channels.*`** | Debounced WS emission piggybacking on **`variable`** throttle OR dedicated **`channels_digest`** tick (≤10 Hz). |

---

## Implementation path

| Phase | In-tree |
|-------|---------|
| A | Done — `HIGHASCG_WS_LOG_LINE_MAX_HZ` (`ws-server.js`). |
| B | Done — `HIGHASCG_WS_CHANGE_COALESCE_MS` (`ws-server.js`). |
| C | Done — `HIGHASCG_WS_CHANNELS_INFO_DEBOUNCE_MS` (`state-manager.js`); OSC: `HIGHASCG_WS_CHANNELS_BLOB_DEBOUNCE_MS` (`periodic-sync.js`). |

### Phase A — **`log_line`** safety (highest ROI, isolated)

- Add **token bucket** or **rolling window** in **`logBuffer.setOnNewLine`** callback path (before **`_wsBroadcast`**).  
- When over cap: **drop** or **sample** (e.g. keep 1 of N identical prefix lines).  
- Log **one** **`warn`** when throttling activates (rate-limited).

### Phase B — **`change`** coalescing in `ws-server.js`

- Replace immediate **`broadcast('change', { path, value })`** from StateManager hook with **`queueChange(path, value)`** flushing on **`setImmediate`** or **`setTimeout(0, …)`** boundary, merging paths.  
- Danger: reordering semantics — document that **last write wins** per path within window (matches typical UI expectation).

### Phase C — **`channels.*`** profile-driven debounce

- In **`state-manager`** after **`updateFromInfo`**, batch **`channels.${ch}`** WS payloads behind **`DEBOUNCE_MS`** (reuse pattern from **`setVariable`**).

---

## Acceptance criteria

- Synthetic flood: **`console.log`** loop cannot saturate WS (**CPU bounded**).  
- Functional: logs modal still receives **recent** tail (may miss ultra-fast bursts — acceptable with banner “throttled”).  
- **`change`** storm tests: rapid **`setVariable`** bursts produce **bounded** outgoing WS messages/sec.

---

## Regression risks

- Clients relying on **every** intermediate **`change`** for animations — verify timeline/multiview UIs still converge within one frame tick.
