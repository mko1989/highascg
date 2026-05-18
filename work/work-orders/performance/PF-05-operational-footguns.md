# PF-05 — Operational footguns (batch APIs, logging, config churn)

**Linked bulletin:** PERF-D4, PERF-J2, PERF-A2  
**Status:** Design / implementation roadmap

---

## Problems

1. **`/api/amcp/raw-batch`** — sequential **`await amcp.raw`** per line ⇒ latency explosion vs **`/api/amcp/batch`** chunked (**PERF-D4**).  
2. **Art-Net `handleData`** logs **`info`** on **every** universe delta ⇒ log flood (**PERF-J2**).  
3. **`configManager.emit('change')`** restarts OSC, streaming lifecycle, **`SamplingManager.updateConfig`**, Caspar TCP — rapid saves ⇒ reconnect storms (**PERF-A2**).

---

## Why they recur

- **`raw-batch`** easy for debugging/scripts — leaks into production tooling.  
- Logging defaults favor **`info`** visibility on integration code paths.  
- Config reload hook is central — every save triggers **full subsystem recycle** without diff.

---

## Direction that sticks

**Make the safe path the easy path:**

| Issue | Pattern |
|-------|---------|
| AMCP batches | CLI/UI defaults call **`batch`**; **`raw-batch`** requires **`?debug=1`** header **or** warns once when **`lines > N`**. |
| Art-Net logs | **`debug`** level or **≥500 ms throttle** on **`info`** delta lines (**same spirit as PF-02**). |
| Config churn | **`syncRuntimeConfigFromManager`** compares stable hashes (**serialized normalized subsets**) — **no-op skip** when only irrelevant keys toggled (explicit allow-list). |

---

## Implementation path

### Phase A — AMCP guardrail

- If **`raw-batch`** body **`lines.length > 50`**: **`log.warn`** “prefer /api/amcp/batch” + metrics counter.  
- Doc + Companion template update.

### Phase B — Art-Net log policy

- Downgrade **per-delta `info`** → **`debug`**; keep **`info`** first baseline + **`warn`** on anomalies.

### Phase C — Config diff no-op

- Build **`pickSignificantConfig(config)`** (OSC host/port, Caspar TCP, DMX blocks, streaming).  
- Hash compare; skip **`casparConn.start/stop`** if only cosmetic keys changed.

### Phase D — Rate-limit config reload

- Ignore duplicate saves within **300 ms** debounce window (careful with legitimate double-save tests).

---

## Acceptance criteria

- Accidental **`raw-batch`** 500-liner triggers **single** warn, not silent path.  
- Art-Net soak: log lines/sec **bounded** under active desk simulation.  
- Flapping UI field: **no Caspar TCP reconnect** when resulting normalized config unchanged.

---

## Regression risks

- Skipping reload hides bugs when listeners fail — add **`HIGHASCG_CONFIG_FORCE_RELOAD=1`** escape hatch.
