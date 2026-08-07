# Work Order: Migrate AMCP Stack to `casparcg-connection` Library

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Completion status (2026-06-03)

**Work order closed for engineering.** Do not continue agent implementation unless T7.4 visual QA fails or a production bug is filed.

| Scope | Status |
|-------|--------|
| **Engineering / code** | **Done** — default transport is `casparcg-connection@6`; rollback via `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` |
| **Automated QA** | **Done** — `npm run test:highascg:migration:all` (single `node --test` invocation) |
| **T7.4 automated proxies** | **Done** — `npm run test:highascg:air-paths` (batchSendChunked, DEFER batch, reconnect) |
| **T7.4 visual / operator** | **Pending** — [`docs/reference/amcp-migration-qa-checklist.md`](docs/reference/amcp-migration-qa-checklist.md) rows 1–6, 8–11 on **both** playout PCs |

---

## Goal

Adopt the community-standard **`casparcg-connection`** npm library (SuperFlyTV / Sofie) as the **transport and typed command layer** behind HighAsCG's existing `AmcpClient` API surface. This is an **adapter/hybrid** migration (Option B from the assessment doc) — **not** a big-bang rewrite.

**What this achieves:**
- HighAsCG's custom TCP socket (`tcp-client.js`), AMCP response parser (`amcp-protocol.js`), and reconnect logic are replaced by the maintained library
- Typed command helpers (`amcp-basic.js`, `amcp-mixer.js`, etc.) delegate to the library where there is a 1:1 match
- HighAsCG-specific batch orchestration (`amcp-batch.js`), command plan builders (`amcp-command-plan.js`), and engine `raw()` sequences are **preserved**
- External API surface (`appCtx.amcp.*`, REST routes, WebSocket proxy) **does not change** — callers are unaffected

**What this does NOT change:**
- `amcp-batch.js` — all chunking, CG-aware pre-commit, DEFER/COMMIT logic stays
- `amcp-command-plan.js` — clip/PLAY/LOADBG string building with `[HTML]`, NDI, STING
- Engine files under `src/engine/` — scene take, multiview, global border, etc.
- `AmcpSimulated` — offline mode stub
- REST routes and WS proxy — they keep calling the same `amcp.*` methods

---

## Reference Material

| Resource | Location |
|----------|----------|
| Assessment document | [`work/casparcg-node-connection.md`](file:///home/casparcg/highascg/work/casparcg-node-connection.md) |
| Library reference copy (v7 source) | `work/references/show_creator/casparcg-connection-main/` |
| Library npm page | https://www.npmjs.com/package/casparcg-connection |
| Library API docs | https://superflytv.github.io/casparcg-connection/ |
| Library GitHub | https://github.com/SuperFlyTV/casparcg-connection |
| Current AMCP stack | [`src/caspar/`](file:///home/casparcg/highascg/src/caspar) (19 files, ~3,200 lines) |
| Main entry point | [`index.js`](file:///home/casparcg/highascg/index.js) (line 168: ConnectionManager init) |
| AMCP mapping docs | [`docs/reference/amcp-mapping.md`](file:///home/casparcg/highascg/docs/reference/amcp-mapping.md) |
| Smoke tests | [`tools/smoke/highascg-health-api-amcp.test.js`](file:///home/casparcg/highascg/tools/smoke/highascg-health-api-amcp.test.js) |
| Live AMCP tests | [`tools/smoke/highascg-live-amcp.test.js`](file:///home/casparcg/highascg/tools/smoke/highascg-live-amcp.test.js) |

---

## Architecture: Before vs After

### Before (current)

```
index.js → ConnectionManager → TcpClient (raw TCP)
                              → AmcpProtocol (AMCP state machine parser)
                              → AmcpClient → AmcpBasic/Mixer/CG/Query/… (string builders)
                                           → AmcpBatch (BEGIN/COMMIT chunking)
                                           → AmcpSimulated (offline stub)
```

### After (target)

```
index.js → ConnectionManager → CasparCG (casparcg-connection library)
              ↓                    ↓ TCP, reconnect, AMCP parse, deserializers
              → AmcpClient (adapter) → raw() → library.sendCustom({ command: raw })
                                     → basic.*/mixer.*/cg.*/query.*/thumb.* → library typed methods
                                     → batchSendChunked → AmcpBatch (UNCHANGED)
                                     → AmcpSimulated (UNCHANGED)
```

**Key invariant:** Every call site in `src/engine/`, `src/api/`, `src/artnet/`, `src/streaming/`, `src/config/`, `src/server/`, `src/sampling/` continues to call `amcp.raw()`, `amcp.batchSendChunked()`, `amcp.basic.play()`, etc. with the **same signatures and return shapes**.

---

## ESM / CommonJS Compatibility Note

> [!IMPORTANT]
> **HighAsCG is CommonJS** (`"type": "commonjs"` in package.json, `require()` throughout).
>
> The reference copy at `work/references/…` is **v7.0.0-0** which is **ESM-only** (`"type": "module"`).
> Published **v6.3.x** on npm supports CommonJS `require()`. **Pin to `casparcg-connection@6`** (latest 6.x).
>
> If 6.x also requires ESM, use Node 20's dynamic `import()` from CJS:
> ```javascript
> // In connection-manager.js or adapter
> const { CasparCG } = await import('casparcg-connection')
> ```
> This is resolved in **Phase 1, Task T1.1**.

---

## Phases Overview

| Phase | Name | Effort | Parallelizable? | Description |
|-------|------|--------|-----------------|-------------|
| **1** | Spike & Install | 1 day | No | Install library, verify CJS compatibility, prototype minimal connection |
| **2** | Transport Adapter | 2–3 days | No | Replace `tcp-client.js` + `amcp-protocol.js` |
| **3** | Typed Command Wrappers | 2–3 days | **Yes** (per sub-module) | - **Goal**: Transition from string-based command generation to using library command classes where it makes sense.<br>- **Tasks**: 1. Rewire `amcp-basic.js` (Play, Load, Pause, Stop, Clear) to dispatch via `_invokeTyped`. 2. The remaining wrappers (`amcp-mixer.js`, `amcp-cg.js`, `amcp-query.js`, `amcp-thumbnail.js`, `amcp-data.js`) will continue to use `_send`, which the new `AmcpConnectionAdapter` routes through `sendCustom`.<br>- **Rationale**: Basic commands heavily benefit from native parameter serialization (files, transitions). For complex commands like Mixer or structured responses like Query, keeping them as strings allows `casparcg-connection` to return raw data arrays (`sendCustom` bypasses internal deserialization), perfectly matching HighAsCG's legacy expectations without brittle data mapping. |
| **4** | Response Shape Adapter | 1–2 days | Yes (with Phase 3) | Normalize library response objects to HighAsCG `{ ok, data }` shape |
| **5** | Batch Integration | 1–2 days | No (depends on Phase 2) | Wire `amcp-batch.js` to send through library transport instead of raw socket |
| **6** | Cleanup & Feature Flags | 1 day | No | Feature flag toggle, dead code removal, env var docs |
| **7** | Testing & QA | 2–3 days | **Yes** (per test category) | Parity tests, live Caspar smoke, regression on air-critical paths |

**Total estimated effort: 10–15 working days** (with parallelism in Phases 3 and 7).

---

## Phase 1: Spike & Install

### Goal
Prove that `casparcg-connection@6` works in HighAsCG's CommonJS environment, connects to Caspar, and can send VERSION.

### Tasks

- [x] **T1.1** — Install `casparcg-connection@6` and verify `require()` compatibility

  **File:** [`package.json`](file:///home/casparcg/highascg/package.json)

  **Steps:**
  1. Run `npm install casparcg-connection@6 --save`
  2. Create a scratch test file `tools/smoke/spike-casparcg-connection.js`:
     ```javascript
     'use strict'
     // If require() fails, try dynamic import — see ESM note above
     let CasparCG
     try {
       CasparCG = require('casparcg-connection').CasparCG
     } catch (e) {
       console.error('require() failed:', e.message)
       console.log('Trying dynamic import()...')
       // Dynamic import in CJS
       ;(async () => {
         const mod = await import('casparcg-connection')
         CasparCG = mod.CasparCG
         runTest(CasparCG)
       })()
     }
     if (CasparCG) runTest(CasparCG)

     async function runTest(CasparCGClass) {
       const conn = new CasparCGClass({
         host: process.env.CASPAR_HOST || '127.0.0.1',
         port: parseInt(process.env.CASPAR_PORT || '5250', 10),
         autoConnect: true,
       })
       // Wait for connect event
       conn.on('connect', async () => {
         console.log('✅ Connected to CasparCG')
         const result = await conn.version({})
         console.log('VERSION result:', JSON.stringify(result, null, 2))
         const clsResult = await conn.cls({})
         console.log('CLS result type:', typeof clsResult, 'data length:', clsResult?.request?.data?.length)
         conn.disconnect()
         process.exit(0)
       })
       conn.on('error', (err) => console.error('Connection error:', err.message))
       setTimeout(() => { console.error('Timeout — no connection'); process.exit(1) }, 10000)
     }
     ```
  3. Run: `node tools/smoke/spike-casparcg-connection.js`
  4. Document which import method works. If both fail, check npm for the latest CJS-compatible version.

  **Acceptance criteria:**
  - `require()` or `import()` loads the library without errors
  - VERSION response is received and printed
  - CLS response returns a list (even if empty)

  **Decision gate:** If `require()` does not work AND dynamic `import()` causes issues in the sync init path of `index.js`, document the blocker and consider:
  - Pinning an older version (5.x)
  - Using a CJS wrapper module that re-exports via `import()`
  - Adding `"type": "module"` to HighAsCG (LARGE scope change — don't do this)

- [x] **T1.2** — Document library API shape differences (see table below)

  **Output:** Update this work order's Phase 3 section with:
  - Library constructor options (compared to current `TcpClient` options)
  - Library event names vs current (`connect`/`disconnect`/`error` vs `connected`/`disconnected`/`error`)
  - Library command method signatures vs current HighAsCG methods (parameter objects vs positional args)
  - Library response shape (`SendResult<T>` with `.request.data`) vs current `{ ok: boolean, data: string|string[] }`
  - Library reconnect behavior (fixed 5s in v7 — check 6.x) vs current exponential backoff

### T1.2 — Library vs HighAsCG (v6.3.3, verified 2026-06-03)

| Topic | HighAsCG (legacy) | `casparcg-connection@6` |
|-------|-------------------|-------------------------|
| Import | N/A | `require('casparcg-connection').CasparCG` works (CJS) |
| Connect | `TcpClient.connect(host, port)` | `ccg.connect(host, port)`; events `connect` / `disconnect` / `error` |
| Raw command | `socket.send(line + '\r\n')` + `AmcpProtocol` callbacks | `ccg.sendCustom({ command })` → `normalizeResponse()` → `{ ok, data }` |
| Typed command | String builders in `amcp-*.js` | `ccg.play({ channel, layer, clip, … })` etc. via `_invokeTyped()` |
| Response shape | `{ ok, data: string \| string[] }` | `SendResult` → adapter normalizes to same shape |
| Batch BEGIN…COMMIT | One `socket.write` + `_amcpBatchDrain` line tap | `adapter.send(payload)` + raw socket `data` listener in `ConnectionManager` |
| Rollback | — | `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` → `TcpClient` + `AmcpProtocol` |
| Reconnect | Exponential backoff in `TcpClient` | Library-managed (fixed interval in v6; not matched to HighAsCG backoff) |

---

## Phase 2: Transport Adapter

### Goal
Replace `TcpClient` + `AmcpProtocol` with the library's `Connection` class, keeping `ConnectionManager`'s external API identical.

### Files modified

| File | Action | Lines |
|------|--------|-------|
| [`src/caspar/connection-manager.js`](file:///home/casparcg/highascg/src/caspar/connection-manager.js) | **MODIFY** — swap internal transport | 249 |
| `src/caspar/amcp-connection-adapter.js` | **NEW** — thin adapter between library and HighAsCG | ~150 |
| [`src/caspar/tcp-client.js`](file:///home/casparcg/highascg/src/caspar/tcp-client.js) | **DEPRECATE** (keep for feature flag fallback) | 160 |
| [`src/caspar/amcp-protocol.js`](file:///home/casparcg/highascg/src/caspar/amcp-protocol.js) | **DEPRECATE** (keep for feature flag fallback) | 276 |

### Tasks

- [x] **T2.1** — Create `src/caspar/amcp-connection-adapter.js`

  This file wraps the `casparcg-connection` library's `CasparCG` class and exposes the **same interface** that `AmcpClient._send()` expects — specifically a way to send a raw AMCP string and get a Promise back with `{ ok: boolean, data: string|string[] }`.

  **Skeleton:**
  ```javascript
  'use strict'

  /**
   * Adapter between casparcg-connection (npm) and HighAsCG's AmcpClient.
   * Replaces TcpClient + AmcpProtocol for transport and response parsing.
   */
  class AmcpConnectionAdapter {
    /**
     * @param {import('casparcg-connection').CasparCG} ccgInstance
     * @param {{ log?: (level: string, msg: string) => void }} [opts]
     */
    constructor(ccgInstance, opts = {}) {
      this._ccg = ccgInstance
      this._log = opts.log || (() => {})
    }

    get isConnected() {
      return this._ccg.connected
    }

    /**
     * Send a raw AMCP command string through the library.
     * Maps the library's response shape to HighAsCG's { ok, data } format.
     *
     * @param {string} cmd - Full AMCP command line (e.g. "PLAY 1-10 MY_CLIP MIX 25")
     * @returns {Promise<{ ok: boolean, data?: string|string[] }>}
     */
    async sendRaw(cmd) {
      const result = await this._ccg.sendCustom({ command: cmd.trim() })
      return this._normalizeResponse(result)
    }

    /**
     * Send raw bytes (for batch BEGIN...COMMIT payloads that must be one TCP write).
     * Falls through to the library's underlying socket.
     *
     * @param {string} payload - Multi-line AMCP payload with \r\n terminators
     */
    sendRawBytes(payload) {
      // Library exposes connection.sendCommand for individual commands.
      // For raw batch payloads we need the underlying socket.
      // Check if library exposes it; if not, use sendCustom per line.
      // IMPLEMENTATION NOTE: This is the trickiest part.
      // See Phase 5 for batch integration details.
    }

    /**
     * Normalize library SendResult to HighAsCG { ok, data } shape.
     * @param {import('casparcg-connection').SendResult<any>} result
     * @returns {{ ok: boolean, data?: string|string[] }}
     */
    _normalizeResponse(result) {
      // Library shape: { error?, request: { data: T } }
      // HighAsCG shape: { ok: boolean, data: string|string[] }
      if (result.error) {
        return { ok: false, data: result.error.message || String(result.error) }
      }
      const data = result.request?.data
      // Library may return parsed objects (e.g. array of clips for CLS).
      // For raw(), callers expect string or string[].
      if (Array.isArray(data)) return { ok: true, data }
      if (data !== undefined && data !== null) return { ok: true, data: String(data) }
      return { ok: true }
    }
  }

  module.exports = { AmcpConnectionAdapter }
  ```

  **Key design decisions:**
  - The adapter does NOT replace `AmcpClient` — it replaces what `AmcpClient._send()` calls internally
  - `AmcpClient._context.socket` currently points to `TcpClient`; after migration it will point to the adapter
  - The adapter must handle the `isConnected` property (used by `AmcpClient._send` guard check at line 236 of `amcp-client.js`)

  **Acceptance criteria:**
  - `adapter.sendRaw('VERSION')` returns `{ ok: true, data: '2.x.x ...' }`
  - `adapter.sendRaw('CLS')` returns `{ ok: true, data: ['line1', 'line2', ...] }`
  - `adapter.isConnected` mirrors the library's connected state
  - Error responses return `{ ok: false, data: 'error message' }`

- [x] **T2.2** — Modify `ConnectionManager` to use library + adapter

  **File:** [`src/caspar/connection-manager.js`](file:///home/casparcg/highascg/src/caspar/connection-manager.js)

  **What changes:**
  1. Constructor: instantiate `CasparCG` (from library) instead of `TcpClient`
  2. Map library events (`connect`, `disconnect`, `error`) to current event names
  3. Replace `this._protocol` (AmcpProtocol) — no longer needed; library handles parsing
  4. Keep: `_context` object shape, health check logic, status events, settle delay
  5. Keep: `start()`, `stop()`, `destroy()`, `reconnect()` public API

  **Critical preservation points:**
  - `_context.socket` must expose `.isConnected` and `.send(payload)` — adapter satisfies this
  - `_context.response_callback` — still needed by `AmcpClient._sendPrepare()` for callback queue
  - `_context._amcpBatchDrain` — still needed by `AmcpBatch`
  - `_context._resetAmcpProtocol` — can become a no-op (library handles parser reset on reconnect)
  - `_context.config` — still passed through
  - Health check (`_runHealthCheck`) — calls `this._amcp.version()` which goes through AmcpClient

  **Implementation approach:**

  ```javascript
  // In constructor, INSTEAD OF:
  // this._tcp = new TcpClient({ host, port, ... })
  // this._protocol = new AmcpProtocol({ ... })

  // NEW:
  const { CasparCG } = require('casparcg-connection') // or dynamic import
  this._ccg = new CasparCG({
    host: this._host,
    port: this._port,
    autoConnect: false, // we control when to connect via start()
  })

  this._adapter = new AmcpConnectionAdapter(this._ccg, { log: this._log })

  // Wire _context to use adapter as "socket"
  this._context = {
    socket: this._adapter,  // adapter.isConnected, adapter.send()
    response_callback: {},
    _pendingResponseKey: undefined,
    _amcpBatchDrain: null,
    config: options.config || {},
    log: this._log,
  }
  ```

  **Feature flag:** Add env var `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` to fall back to the old `TcpClient`/`AmcpProtocol` stack. This allows instant rollback in production.

  ```javascript
  const useLegacy = process.env.HIGHASCG_AMCP_LEGACY_TRANSPORT === '1'
  if (useLegacy) {
    this._tcp = new TcpClient({ ... })
    this._protocol = new AmcpProtocol({ ... })
    // ... existing wiring
  } else {
    this._ccg = new CasparCG({ ... })
    this._adapter = new AmcpConnectionAdapter(this._ccg, { log: this._log })
    // ... new wiring
  }
  ```

  **Acceptance criteria:**
  - `ConnectionManager.start()` connects to Caspar via library
  - `status` events still fire with `{ connected, host, port, versionLine }`
  - `connectionManager.amcp.version()` still returns `{ ok: true, data: '...' }`
  - `connectionManager.amcp.raw('VERSION')` still works
  - `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` reverts to old stack
  - Health check settle delay still applies

- [x] **T2.3** — Wire `AmcpClient._send()` to use adapter (`sendRaw` path); legacy callback queue unused when library transport active

  **File:** [`src/caspar/amcp-client.js`](file:///home/casparcg/highascg/src/caspar/amcp-client.js)

  **What changes:**

  The `_sendPrepare()` method (line 114–200) currently:
  1. Registers a callback in `_context.response_callback[key]`
  2. Sends bytes via `_context.socket.send(trimmed + '\r\n')`
  3. Waits for AmcpProtocol to call the callback when the response arrives

  **Two approaches (choose during spike):**

  **Approach A — Library handles response matching (recommended):**
  - `_send()` calls `adapter.sendRaw(cmd)` which calls `library.sendCustom()`
  - Library internally matches request→response, parses, returns Promise
  - `_sendPrepare` callback queue becomes unnecessary for commands routed through library
  - Keep callback queue ONLY for batch drain (Phase 5)

  **Approach B — Hybrid callback (fallback):**
  - Use library only for TCP transport (socket.write + parse)
  - Keep existing callback queue for response matching
  - More conservative but gains less benefit

  **Decision:** Made during T1.2 after studying library's `sendCustom()` and response flow.

  > [!WARNING]
  > **Critical:** The `_amcpSendQueue` serialization chain (line 242) ensures commands are sent one-at-a-time and responses are matched in order. The library has its own internal queue. We must NOT double-queue. If using Approach A, disable HighAsCG's `_amcpSendQueue` and rely on the library's queue.

  **Acceptance criteria:**
  - `amcp._send('VERSION')` returns `{ ok: true, data: '...' }` via library
  - `amcp._send('PLAY 1-10 MY_CLIP')` returns `{ ok: true }`
  - Timeout behavior still works (library may have its own; if not, wrap with HighAsCG timeout)
  - `_amcpHistory` recording still works (add hook before delegating to library)
  - `_sendAfter` still works for batch pre-flush sequences

---

## Phase 3: Typed Command Wrappers

### Goal
Rewire the typed helper classes to delegate to the library's typed methods where possible, keeping the same public method signatures.

> [!NOTE]
> **Each sub-task below can be done independently by a different agent.** They only depend on Phase 2 being complete. Assign one sub-task per agent for parallelism.

### Common Pattern

Each helper class currently calls `this._client._send(cmdString, responseKey)`. After migration:

```javascript
// BEFORE (amcp-basic.js line 81):
stop(channel, layer) {
  return this._send(`STOP ${chLayer(channel, layer)}`, 'STOP')
}

// AFTER:
stop(channel, layer) {
  if (this._client.isOffline) return this._client._simulated.send(`STOP ${chLayer(channel, layer)}`)
  return this._client._adapter.ccg.stop({ channel, layer })
    .then(result => this._client._adapter._normalizeResponse(result))
}
```

**However**, some commands have **no 1:1 library method** (custom build extensions, unusual parameter forms). Those keep using `sendCustom()` or `raw()`.

### Tasks

- [x] **T3.1** — Rewire `amcp-basic.js` (Basic producer commands) — **partial:** typed via `_invokeTyped` for simple clips + pause/resume/stop/clear/print/log/set/lock/ping; `call`/`swap`/`add`/`remove` and complex clips still `_send`

  **File:** [`src/caspar/amcp-basic.js`](file:///home/casparcg/highascg/src/caspar/amcp-basic.js) (146 lines)

  **Library mappings:**

  | HighAsCG method | Library method | Notes |
  |-----------------|---------------|-------|
  | `play(ch, layer, clip, opts)` | `ccg.play({ channel, layer, clip, ... })` | Clip command plan builds `[HTML]`, NDI, STING — **keep string builder**, use `sendCustom` for these |
  | `loadbg(ch, layer, clip, opts)` | `ccg.loadbg({ channel, layer, clip, ... })` | Same as play — use string builder for complex clips |
  | `load(ch, layer, clip, opts)` | `ccg.load({ ... })` | Same pattern |
  | `pause(ch, layer)` | `ccg.pause({ channel, layer })` | Direct mapping |
  | `resume(ch, layer)` | `ccg.resume({ channel, layer })` | Direct mapping |
  | `stop(ch, layer)` | `ccg.stop({ channel, layer })` | Direct mapping |
  | `clear(ch, layer)` | `ccg.clear({ channel, layer })` | Direct mapping |
  | `call(ch, layer, fn, params)` | `ccg.call({ channel, layer, ... })` | Check if library supports arbitrary CALL params |
  | `swap(ch1, l1, ch2, l2, transforms)` | `ccg.swap({ ... })` | Check parameter shape |
  | `add(ch, consumer, params, idx)` | `ccg.add({ channel, consumer })` | Check if library supports consumer index |
  | `remove(ch, consumer, idx)` | `ccg.remove({ channel, ... })` | Check parameter shape |
  | `print(ch)` | `ccg.print({ channel })` | Direct mapping |
  | `logLevel(level)` | `ccg.logLevel({ level })` | Direct mapping |
  | `logCategory(cat, enable)` | `ccg.logCategory({ category, enable })` | Direct mapping |
  | `set(ch, var, val)` | `ccg.set({ channel, variable, value })` | Direct mapping |
  | `lock(ch, action, phrase)` | `ccg.lock({ channel, action, lockPhrase })` | Check param name |
  | `ping(token)` | `ccg.ping({})` | Library may not support token |

  > [!IMPORTANT]
  > **`play`/`loadbg`/`load` with `[HTML]`, `ndi://`, `route://`, STING transitions:**
  > The `buildClipCommandPlan()` + `serializeClipCommandPlan()` pipeline in [`amcp-command-plan.js`](file:///home/casparcg/highascg/src/caspar/amcp-command-plan.js) builds these complex AMCP strings. The library's `play()` method may not handle all these special cases (e.g. `[HTML]` prefix, `ndi://` URLs without quoting, STING transitions).
  >
  > **Strategy:** For simple clips (no `[HTML]`, no `ndi://`, no STING), use the library's typed method. For complex clips, keep using `serializeClipCommandPlan()` → `sendCustom()`.
  >
  > ```javascript
  > play(channel, layer, clip, opts = {}) {
  >   const plan = buildClipCommandPlan('PLAY', channel, layer, clip, opts)
  >   // If clip needs special handling, fall back to raw
  >   if (this._needsRawSend(plan)) {
  >     const cmd = serializeClipCommandPlan(plan)
  >     return this._send(cmd, 'PLAY')
  >   }
  >   // Otherwise use library typed method
  >   return this._ccg.play({ channel, layer, clip, ... })
  >     .then(r => normalizeResponse(r))
  > }
  > ```

  **Acceptance criteria:**
  - All 16 methods still work with same signatures and return shapes
  - `play()` with `[HTML]` clips still works (falls back to raw)
  - `play()` with simple media clips uses library method
  - Offline mode still returns simulated responses

- [x] **T3.2** — Rewire `amcp-mixer.js` (Mixer commands) — **partial:** keyer/blend/invert/opacity/brightness/saturation/contrast/commit/clear/channelGrid typed; FILL/LEVELS/CHROMA/crop/etc. still `_send`

  **File:** [`src/caspar/amcp-mixer.js`](file:///home/casparcg/highascg/src/caspar/amcp-mixer.js) (215 lines)

  **Library mappings:**

  | HighAsCG method | Library method | Notes |
  |-----------------|---------------|-------|
  | `mixerKeyer(ch, layer, keyer)` | `ccg.mixerKeyer({ channel, layer, keyer })` | Direct |
  | `mixerChroma(ch, layer, opts)` | `ccg.mixerChroma({ channel, layer, ... })` | Check param names match |
  | `mixerBlend(ch, layer, mode)` | `ccg.mixerBlend({ channel, layer, value })` | Param name may differ |
  | `mixerInvert(ch, layer, invert)` | `ccg.mixerInvert({ channel, layer, value })` | Direct |
  | `mixerOpacity(ch, layer, val, dur, tween, defer)` | `ccg.mixerOpacity({ channel, layer, value, duration, tween, defer })` | Check `defer` support |
  | `mixerFill(ch, layer, x, y, xS, yS, dur, tween, defer)` | `ccg.mixerFill({ channel, layer, x, y, xScale, yScale, duration, tween, defer })` | Check param names |
  | … (all other mixer methods) | `ccg.mixer*()` | Similar pattern |
  | `mixerCommit(ch)` | `ccg.mixerCommit({ channel })` | Direct — critical for scene takes |
  | `mixerClear(ch, layer)` | `ccg.mixerClear({ channel, layer })` | Direct |
  | `channelGrid()` | `ccg.channelGrid()` | Direct |

  > [!WARNING]
  > **DEFER support:** The library's mixer methods in v7 accept `defer` as a parameter. Verify this in v6. If v6 does not support `defer`, these methods MUST fall back to raw string building (`MIXER 1-10 OPACITY 0.5 25 linear DEFER`). DEFER is critical for scene take crossfades.

  **Acceptance criteria:**
  - All 23 mixer methods work with same signatures
  - `mixerOpacity` with `defer=true` appends `DEFER` to the AMCP command
  - `mixerCommit` sends `MIXER <ch> COMMIT` correctly
  - Query mode (no value arg → returns current value) still works

- [x] **T3.3** — Rewire `amcp-cg.js` (CG/template commands) — **partial:** play/stop/next/remove/clear/update/invoke/info typed; `cgGoto` + `cgAdd` with data stay `_send`

  **File:** [`src/caspar/amcp-cg.js`](file:///home/casparcg/highascg/src/caspar/amcp-cg.js) (68 lines)

  **Library mappings:**

  | HighAsCG method | Library method |
  |-----------------|---------------|
  | `cgAdd(ch, layer, cgLayer, template, playOnLoad, data)` | `ccg.cgAdd({ channel, layer, cgLayer, template, playOnLoad, data })` |
  | `cgPlay(ch, layer, cgLayer)` | `ccg.cgPlay({ channel, layer, cgLayer })` |
  | `cgStop(ch, layer, cgLayer)` | `ccg.cgStop({ channel, layer, cgLayer })` |
  | `cgNext(ch, layer, cgLayer)` | `ccg.cgNext({ channel, layer, cgLayer })` |
  | `cgRemove(ch, layer, cgLayer)` | `ccg.cgRemove({ channel, layer, cgLayer })` |
  | `cgClear(ch, layer)` | `ccg.cgClear({ channel, layer })` |
  | `cgUpdate(ch, layer, cgLayer, data)` | `ccg.cgUpdate({ channel, layer, cgLayer, data })` |
  | `cgInvoke(ch, layer, cgLayer, method)` | `ccg.cgInvoke({ channel, layer, cgLayer, method })` |
  | `cgInfo(ch, layer, cgLayer?)` | `ccg.cgInfo({ channel, layer, cgLayer? })` |

  > [!NOTE]
  > CG commands are used heavily by the engine for PIP overlay borders, multiview chrome, and Art-Net. Template names are quoted by HighAsCG's `param()` function. Verify library quoting matches.

  **Acceptance criteria:**
  - All 9 CG methods work with same signatures
  - `cgAdd` with data parameter correctly escapes/quotes
  - `cgUpdate` with JSON data string works

- [x] **T3.4** — Rewire `amcp-query.js` (Query/info commands) — **partial:** version/cls/tls/fls/diag/gl\*/info\* typed; CINF/HELP/BYE/KILL still `_send`

  **File:** [`src/caspar/amcp-query.js`](file:///home/casparcg/highascg/src/caspar/amcp-query.js) (129 lines)

  **Library mappings:**

  | HighAsCG method | Library method | Response handling |
  |-----------------|---------------|-------------------|
  | `version(component?)` | `ccg.version({ component? })` | Library may return parsed object; normalize to `{ ok, data: 'string' }` |
  | `cls(subDir?)` | `ccg.cls({ subDir? })` | Library returns structured array; HighAsCG callers expect `data: string[]` (raw lines) |
  | `tls(subDir?)` | `ccg.tls({ subDir? })` | Same as CLS |
  | `fls()` | `ccg.fls({})` | Same pattern |
  | `cinf(filename)` | `ccg.cinf({ filename })` | Library returns structured object |
  | `info()` | `ccg.info({})` | Returns multiline XML strings |
  | `infoChannel(ch, layer?)` | `ccg.infoChannel({ channel }) / ccg.infoLayer({...})` | Returns XML string(s) |
  | `infoConfig()` | `ccg.infoConfig({})` | Returns XML |
  | `infoPaths()` | `ccg.infoPaths({})` | Returns structured data |
  | `infoSystem()` | `ccg.infoSystem({})` | Returns structured data |
  | `diag()` | `ccg.diag({})` | Direct |
  | `bye()` | `ccg.bye({})` | Direct |
  | `kill()` | `ccg.kill({})` | Direct |
  | `restart()` | `ccg.restart({})` | Direct |

  > [!WARNING]
  > **Response shape is the biggest challenge here.** The library's deserializers parse CLS, TLS, INFO responses into structured JavaScript objects. HighAsCG's callers (e.g. `media-catalog.js`, `routes-state.js`) expect raw string arrays or the `{ ok, data: string[] }` shape. The adapter must decide: use library's parsed data (and update callers), or request raw data from library and let HighAsCG parsers handle it.
  >
  > **Recommended:** Use library's parsed data where callers already parse (media catalog, etc.) — this eliminates `amcp-parsers.js`. Where callers pass through raw strings (INFO CONFIG XML), keep raw.

  **Acceptance criteria:**
  - `version()` returns `{ ok: true, data: '2.x.x ...' }`
  - `cls()` returns `{ ok: true, data: [...] }` with same shape callers expect
  - `infoConfig()` returns XML string (not a parsed object)
  - All 23 query methods work with same signatures

- [x] **T3.5** — Rewire `amcp-thumbnail.js` (Thumbnail commands) — typed except `thumbnailList(subDir)`

  **File:** [`src/caspar/amcp-thumbnail.js`](file:///home/casparcg/highascg/src/caspar/amcp-thumbnail.js) (37 lines)

  **Library mappings:**

  | HighAsCG method | Library method |
  |-----------------|---------------|
  | `thumbnailList(subDir?)` | `ccg.thumbnailList({ subDir? })` |
  | `thumbnailRetrieve(filename)` | `ccg.thumbnailRetrieve({ filename })` |
  | `thumbnailGenerate(filename)` | `ccg.thumbnailGenerate({ filename })` |
  | `thumbnailGenerateAll()` | `ccg.thumbnailGenerateAll({})` |

  **Acceptance criteria:**
  - All 4 thumbnail methods work with same signatures and return shapes
  - `thumbnailRetrieve` returns base64 PNG data as string

- [x] **T3.6** — Rewire `amcp-data.js` (DATA commands) — retrieve/list/remove typed; `dataStore` stays `_send` (escaping)

  **File:** [`src/caspar/amcp-data.js`](file:///home/casparcg/highascg/src/caspar/amcp-data.js) (49 lines)

  **Library mappings:**

  | HighAsCG method | Library method |
  |-----------------|---------------|
  | `dataStore(name, data)` | `ccg.dataStore({ name, data })` |
  | `dataRetrieve(name)` | `ccg.dataRetrieve({ name })` |
  | `dataList(subDir?)` | `ccg.dataList({ subDir? })` |
  | `dataRemove(name)` | `ccg.dataRemove({ name })` |

  > [!NOTE]
  > HighAsCG's `dataStore` has custom escaping logic (line 18–30 of `amcp-data.js`). Verify library handles this correctly or keep the escaping and use `sendCustom()`.

  **Acceptance criteria:**
  - All 4 data methods work with same signatures
  - `dataStore` with special characters (quotes, newlines, backslashes) correctly escapes

---

## Phase 4: Response Shape Adapter

### Goal
Create a centralized response normalizer that converts the library's `SendResult<T>` into HighAsCG's `{ ok: boolean, data?: string|string[] }`.

### Tasks

- [x] **T4.1** — Implement `normalizeLibraryResponse()` in the adapter

  **File:** `src/caspar/amcp-connection-adapter.js` (extend from Phase 2)

  The library returns:
  ```typescript
  // v7 shape (from api.ts):
  interface SendResult<T> {
    error?: Error
    request: Response<T> // { reqId, command, responseCode, data: T, type, message }
  }
  ```

  HighAsCG callers expect:
  ```javascript
  { ok: boolean, data?: string | string[] }
  ```

  **Mapping rules:**
  | Library response | HighAsCG output |
  |------------------|-----------------|
  | `result.error` exists | `{ ok: false }` + reject Promise with Error |
  | `responseCode >= 400` | `{ ok: false, data: errorMessage }` |
  | `responseCode === 200` (multiline) | `{ ok: true, data: string[] }` |
  | `responseCode === 201` (single line) | `{ ok: true, data: string }` |
  | `responseCode === 202` (OK, no data) | `{ ok: true, data: '202 CMD OK' }` |

  > [!IMPORTANT]
  > Some callers check `result.data` as a string (e.g. `typeof r.data === 'string'`), others check `Array.isArray(r.data)`. The normalizer must preserve the right type based on the AMCP response code.

  **Acceptance criteria:**
  - VERSION → `{ ok: true, data: '2.x.x ...' }` (string)
  - CLS → `{ ok: true, data: ['clip1 ...', 'clip2 ...'] }` (string array)
  - PLAY → `{ ok: true, data: '202 PLAY OK' }` (string)
  - Invalid command → Promise rejection with Error

- [x] **T4.2** — Verify all callers handle the normalized shape — `normalizeResponseData()` for VERSION `fullVersion`, arrays, objects; live VERSION/CLS/TLS pass

  **Audit these files for response handling patterns:**

  | File | How it uses `amcp.*` response |
  |------|-------------------------------|
  | [`src/api/routes-amcp.js`](file:///home/casparcg/highascg/src/api/routes-amcp.js) | `r.ok`, `r.data` |
  | [`src/api/routes-mixer.js`](file:///home/casparcg/highascg/src/api/routes-mixer.js) | `r.ok`, `r.data` |
  | [`src/api/routes-multiview.js`](file:///home/casparcg/highascg/src/api/routes-multiview.js) | mostly fire-and-forget `raw()` |
  | [`src/api/media-catalog.js`](file:///home/casparcg/highascg/src/api/media-catalog.js) | Parses `data` from CLS/TLS |
  | [`src/config/routing-setup.js`](file:///home/casparcg/highascg/src/config/routing-setup.js) | Fire-and-forget `raw()` |
  | [`src/engine/scene-take-lbg-amcp-pipeline.js`](file:///home/casparcg/highascg/src/engine/scene-take-lbg-amcp-pipeline.js) | Uses `batchSendChunked` |
  | [`src/streaming/caspar-ffmpeg-setup.js`](file:///home/casparcg/highascg/src/streaming/caspar-ffmpeg-setup.js) | `await amcp.raw(cmd)`, checks `.ok` |
  | [`src/server/ws-server.js`](file:///home/casparcg/highascg/src/server/ws-server.js) | Forwards `raw()` result to WS client |
  | [`src/bootstrap/fetch-server-info-config.js`](file:///home/casparcg/highascg/src/bootstrap/fetch-server-info-config.js) | `amcp.query.infoConfig()` |

  **Acceptance criteria:**
  - No runtime errors from response shape mismatches
  - REST endpoints return same JSON shapes
  - WebSocket proxy returns same message shapes

---

## Phase 5: Batch Integration

### Goal
Wire `AmcpBatch` to send through the library's transport while preserving all HighAsCG batch semantics.

### Why this is its own phase

`amcp-batch.js` is the most critical and delicate code in the AMCP stack. It:
- Sends `BEGIN\r\nline1\r\nline2\r\n...\r\nCOMMIT\r\n` as **one TCP write** (line 161 of `amcp-batch.js`)
- Uses a **custom drain handler** (`_amcpBatchDrain`) to intercept ALL incoming AMCP lines until the final `202 COMMIT OK`
- Has **CG-aware pre-commit suppression** and **skipMixerPreCommit** flags

### Tasks

- [x] **T5.1** — Investigate library batch support — documented in `docs/reference/amcp-migration.md` (raw socket batch, not lib begin/commit)

  **Question:** Does the library's `begin()` + `commit()` handle multi-command batches correctly?

  Check the library source:
  - [`CasparCG.ts`](file:///home/casparcg/highascg/work/references/show_creator/casparcg-connection-main/src/CasparCG.ts) lines 582–599: `begin()`, `commit()`, `discard()`
  - How does the library handle per-command responses inside a batch?
  - Does it support sending BEGIN + N commands + COMMIT as one TCP write?

  **Most likely outcome:** The library sends `begin()`, then individual commands, then `commit()` as separate TCP writes. HighAsCG's batch sends them as **one payload** for atomicity. This means:

  > [!CAUTION]
  > **The library's `begin()`/`commit()` may NOT be suitable for HighAsCG's batch needs.** HighAsCG sends `BEGIN\r\nMIXER 1-10 OPACITY 0 DEFER\r\n...30 more...\r\nCOMMIT\r\n` in one `socket.write()` call. The library may split these into individual writes, which could fail on some Caspar builds.

  **Decision options:**
  1. Use library's TCP socket directly for batch writes (adapter exposes it)
  2. Keep HighAsCG's batch sending entirely, routing through adapter's raw socket
  3. Use library's `begin()`/`commit()` if testing proves it works atomically

- [x] **T5.2** — Implement batch transport via adapter — `adapter.send()` + `_onRawCcgSocketData` drain; `batch-test.js` / `smoke-amcp-batch-library.test.js` pass on live Caspar

  **File:** [`src/caspar/amcp-batch.js`](file:///home/casparcg/highascg/src/caspar/amcp-batch.js) (334 lines) — **minimal changes**

  **What changes:**
  - `runBeginCommitBatch()` (line 158): Instead of `connection.socket.send(payload)` (line 223), use `adapter.sendRawBytes(payload)` or the library's underlying socket
  - `sequentialRaw()` (line 127): Instead of `client._send(line, key)`, this already works through `AmcpClient._send()` which goes through the adapter

  **What does NOT change:**
  - `validateBatchLine()` — same validation
  - `isAmcpBatchEnabled()` — same config check
  - `isMixerCommitBeforeAmcpBatchEnabled()` — same config check
  - `inferProgramChannelFromAmcpLines()` — same logic
  - `batchIncludesCgCommand()` — same logic
  - `isBatchCommitAckLine()` — same pattern matching
  - `resolveMaxBatchCommands()` — same config
  - Chunk splitting in `batchSendChunked()` — same logic
  - `_amcpBatchDrain` intercept — stays as-is (response lines still arrive)

  **Key concern:** The `_amcpBatchDrain` handler (line 104 of `amcp-protocol.js`) intercepts lines from the TCP socket. With the library, incoming data goes through the library's parser, NOT through `AmcpProtocol.handleLine()`. This means:

  > [!WARNING]
  > **`_amcpBatchDrain` may not work with the library out of the box.** The library parses responses internally and emits `data` events with structured `Response` objects. HighAsCG's batch drain expects raw AMCP lines.
  >
  > **Solution options:**
  > 1. Hook into the library's raw data event (if available) to feed batch drain
  > 2. Use the library's underlying socket directly for batch payloads, bypassing library parser
  > 3. Re-implement batch response handling using the library's structured responses

  **Recommended:** Option 2 — access the library's socket for batch payloads. The `Connection` class has a private `_socket` field. Expose it via adapter or use the `sendCommand` method for BEGIN/COMMIT while intercepting responses.

  **Acceptance criteria:**
  - `amcp.batchSend(['MIXER 1-10 OPACITY 0.5', 'MIXER 1-11 OPACITY 1'])` works
  - `amcp.batchSendChunked(largeArray, { skipMixerPreCommit: true })` works
  - Pre-commit mixer flush works for non-CG batches
  - Pre-commit is skipped when `skipMixerPreCommit: true`
  - Pre-commit is skipped when batch contains CG lines
  - Batch fallback to sequential on failure works

- [x] **T5.3** — Verify `_sendAfter()` chain works — `test:highascg:send-after` (mixerCommit + batch, pre-commit batch)

  **File:** [`src/caspar/amcp-client.js`](file:///home/casparcg/highascg/src/caspar/amcp-client.js) lines 211–221

  `_sendAfter()` is used by `runBeginCommitBatch()` to chain a MIXER COMMIT before the batch without deadlocking the send queue. Verify it still works with the library's internal queue.

  **Acceptance criteria:**
  - `MIXER 1 COMMIT` → `BEGIN...COMMIT` sequence works without deadlock

---

## Phase 6: Cleanup & Feature Flags

### Goal
Clean up deprecated code paths, document environment variables, update docs.

### Tasks

- [x] **T6.1** — Document feature flags — `docs/reference/amcp-migration.md`

  **File:** Create or update `docs/reference/amcp-migration.md`

  Document:
  | Env Variable | Default | Purpose |
  |-------------|---------|---------|
  | `HIGHASCG_AMCP_LEGACY_TRANSPORT` | `0` (use library) | Set to `1` to revert to old TcpClient + AmcpProtocol |
  | All existing env vars still apply | Same | `HIGHASCG_AMCP_SEND_TIMEOUT_MS`, `HIGHASCG_AMCP_CONNECT_SETTLE_MS`, etc. |

- [x] **T6.2** — Mark deprecated files — `@deprecated` on `tcp-client.js`, `amcp-protocol.js`

  Add `@deprecated` JSDoc header to:
  - [`src/caspar/tcp-client.js`](file:///home/casparcg/highascg/src/caspar/tcp-client.js) — "Replaced by casparcg-connection library. Kept for HIGHASCG_AMCP_LEGACY_TRANSPORT=1 fallback."
  - [`src/caspar/amcp-protocol.js`](file:///home/casparcg/highascg/src/caspar/amcp-protocol.js) — Same note

  **Do NOT delete these files yet.** They are the rollback path.

- [x] **T6.3** — Update `docs/reference/amcp-mapping.md` — transport summary section

  Add a column showing which commands now use library typed methods vs raw/custom send.

- [x] **T6.4** — Update `package.json` with new dependency note — `test:highascg:*` scripts + `casparcg-connection` in dependencies; see `amcp-migration.md`

  Add a comment in README or docs explaining `casparcg-connection` dependency and version pinning rationale.

---

## Phase 7: Testing & QA

### Goal
Verify migration correctness at every level.

### Tasks

- [x] **T7.1** — Unit tests: command string parity — `npm run test:highascg:parity` (PAUSE/STOP/CLEAR/MIXER OPACITY/CG PLAY)

  **File:** Create `tools/smoke/smoke-amcp-migration-parity.js`

  For each typed command, compare:
  1. The AMCP string that the **old** code generates
  2. The AMCP string that the **library** generates

  ```javascript
  // Example parity test:
  const { serializeClipCommandPlan, buildClipCommandPlan } = require('../../src/caspar/amcp-command-plan')
  // Old:
  const oldCmd = serializeClipCommandPlan(buildClipCommandPlan('PLAY', 1, 10, 'MY_CLIP', { transition: 'MIX', duration: 25 }))
  // Expected: "PLAY 1-10 MY_CLIP MIX 25 linear"

  // Library:
  const { serializers } = require('casparcg-connection/dist/serializers') // or however it's exported
  const libCmd = /* serialize using library */
  // Compare: assert.strictEqual(oldCmd, libCmd)
  ```

  **Test all of:**
  - Basic commands: PLAY, LOADBG, LOAD, STOP, CLEAR, PAUSE, RESUME, CALL, SWAP, ADD, REMOVE
  - Mixer commands: all 23 with DEFER support
  - CG commands: ADD with data, UPDATE, INVOKE
  - Query commands: VERSION, CLS, INFO CONFIG
  - Thumbnail commands

  **Acceptance criteria:** Zero string differences for standard commands

- [x] **T7.2** — Smoke test: no-Caspar API parity — `tools/smoke/smoke-amcp-offline-migration.test.js` (in `test:highascg:migration`)

  **File:** Extend [`tools/smoke/highascg-health-api-amcp.test.js`](file:///home/casparcg/highascg/tools/smoke/highascg-health-api-amcp.test.js)

  Add tests that:
  1. Start HighAsCG with `offline_mode: true`
  2. Call every REST endpoint
  3. Verify responses have same shape as before migration

- [x] **T7.3** — Live Caspar smoke test — `npm run test:highascg:live` (7 tests, VERSION/batch/mixer/cg/query)

  **File:** Extend [`tools/smoke/highascg-live-amcp.test.js`](file:///home/casparcg/highascg/tools/smoke/highascg-live-amcp.test.js)

  Add tests that:
  1. Connect to live CasparCG
  2. Send VERSION, CLS, TLS, INFO CONFIG via library path
  3. Send PLAY/STOP on a test channel
  4. Send MIXER OPACITY with DEFER + COMMIT
  5. Send a batch of 10 commands via batchSendChunked
  6. Compare all responses to expected shapes

  **Run with:** `npm run test:highascg:live`

- [x] **T7.4** — Manual QA: air-critical paths — **automated:** `test:highascg:air-paths`; **operator (visual):** checklist rows 1–6, 8–11 on both PCs — [`amcp-migration-qa-checklist.md`](docs/reference/amcp-migration-qa-checklist.md)

  These MUST be tested on actual playout hardware with a CasparCG server running:

  | Test | What to verify | Risk |
  |------|----------------|------|
  | **Scene take crossfade** | LOADBG → PLAY with MIX transition renders smooth crossfade on PGM output | HIGH |
  | **Global border + CG order** | Border CG layers render above/below video correctly | HIGH |
  | **PIP overlay** | PIP appears with correct position, opacity animation works | MEDIUM |
  | **Multiview** | All multiview sources show, overlay updates via CALL | MEDIUM |
  | **Streaming** | `ADD STREAM` / `REMOVE STREAM` works for RTMP/SRT output | MEDIUM |
  | **DeckLink routing** | `PLAY ch-layer DECKLINK device` routes live input correctly | MEDIUM |
  | **Batch DEFER + COMMIT** | Multiple MIXER DEFER lines → single MIXER COMMIT → atomic look change | HIGH |
  | **Offline mode** | Settings page works without Caspar connected | LOW |
  | **Reconnect** | Kill Caspar, restart — HighAsCG reconnects and resumes | MEDIUM |
  | **Feature flag rollback** | `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` → old stack works | HIGH |

- [x] **T7.5** — Legacy fallback verification — `npm run test:highascg:legacy` (VERSION + batch on TcpClient/AmcpProtocol)

---

## Files Inventory

### Files that will be MODIFIED

| File | Phase | Changes |
|------|-------|---------|
| [`package.json`](file:///home/casparcg/highascg/package.json) | 1 | Add `casparcg-connection` dependency |
| [`src/caspar/connection-manager.js`](file:///home/casparcg/highascg/src/caspar/connection-manager.js) | 2 | Use library for transport, feature flag |
| [`src/caspar/amcp-client.js`](file:///home/casparcg/highascg/src/caspar/amcp-client.js) | 2, 3 | Wire _send() through adapter |
| [`src/caspar/amcp-basic.js`](file:///home/casparcg/highascg/src/caspar/amcp-basic.js) | 3 | Delegate to library typed methods |
| [`src/caspar/amcp-mixer.js`](file:///home/casparcg/highascg/src/caspar/amcp-mixer.js) | 3 | Delegate to library typed methods |
| [`src/caspar/amcp-cg.js`](file:///home/casparcg/highascg/src/caspar/amcp-cg.js) | 3 | Delegate to library typed methods |
| [`src/caspar/amcp-query.js`](file:///home/casparcg/highascg/src/caspar/amcp-query.js) | 3 | Delegate to library typed methods |
| [`src/caspar/amcp-thumbnail.js`](file:///home/casparcg/highascg/src/caspar/amcp-thumbnail.js) | 3 | Delegate to library typed methods |
| [`src/caspar/amcp-data.js`](file:///home/casparcg/highascg/src/caspar/amcp-data.js) | 3 | Delegate to library typed methods |
| [`src/caspar/amcp-batch.js`](file:///home/casparcg/highascg/src/caspar/amcp-batch.js) | 5 | Transport via adapter socket |

### Files that will be CREATED

| File | Phase | Purpose |
|------|-------|---------|
| `src/caspar/amcp-connection-adapter.js` | 2 | Adapter between library and HighAsCG |
| `tools/smoke/spike-casparcg-connection.js` | 1 | Spike test script |
| `tools/smoke/smoke-amcp-migration-parity.js` | 7 | Command string parity tests |
| `docs/reference/amcp-migration.md` | 6 | Migration docs and feature flag reference |

### Files that are DEPRECATED (not deleted)

| File | Phase | Reason |
|------|-------|--------|
| [`src/caspar/tcp-client.js`](file:///home/casparcg/highascg/src/caspar/tcp-client.js) | 6 | Replaced by library; kept for fallback |
| [`src/caspar/amcp-protocol.js`](file:///home/casparcg/highascg/src/caspar/amcp-protocol.js) | 6 | Replaced by library; kept for fallback |

### Files that are NOT CHANGED

| File | Reason |
|------|--------|
| [`src/caspar/amcp-batch.js`](file:///home/casparcg/highascg/src/caspar/amcp-batch.js) | HighAsCG-specific orchestration logic; only transport changes (Phase 5) |
| [`src/caspar/amcp-command-plan.js`](file:///home/casparcg/highascg/src/caspar/amcp-command-plan.js) | Clip string builder stays — library can't handle `[HTML]`, NDI, STING |
| [`src/caspar/amcp-simulated.js`](file:///home/casparcg/highascg/src/caspar/amcp-simulated.js) | Offline stub — unchanged |
| [`src/caspar/amcp-constants.js`](file:///home/casparcg/highascg/src/caspar/amcp-constants.js) | Static constants — unchanged |
| [`src/caspar/amcp-types.js`](file:///home/casparcg/highascg/src/caspar/amcp-types.js) | JSDoc types — unchanged |
| [`src/caspar/amcp-utils.js`](file:///home/casparcg/highascg/src/caspar/amcp-utils.js) | String utils (param, chLayer, deferMixerAmcpLine) — still needed |
| [`src/caspar/amcp-parsers.js`](file:///home/casparcg/highascg/src/caspar/amcp-parsers.js) | Response parsers — may be replaced by library deserializers in Phase 4 |
| [`src/caspar/amcp-layer-diff-plan.js`](file:///home/casparcg/highascg/src/caspar/amcp-layer-diff-plan.js) | Layer diff logic — unchanged |
| [`src/caspar/channel-info-xml.js`](file:///home/casparcg/highascg/src/caspar/channel-info-xml.js) | XML parser — unchanged |
| All `src/engine/*` files | Engine uses `amcp.raw()`, `amcp.batchSendChunked()` — API unchanged |
| All `src/api/*` files | Routes call `amcp.*` methods — API unchanged |
| All `src/streaming/*` files | Uses `amcp.raw()` — API unchanged |
| All `src/config/*` files | Uses `amcp.raw()` — API unchanged |
| All `src/artnet/*` files | Uses `amcp.raw()` — API unchanged |
| All `src/server/*` files | WS proxy uses `amcp.raw()` — API unchanged |
| [`index.js`](file:///home/casparcg/highascg/index.js) | Uses `ConnectionManager` — API unchanged |

---

## `raw()` Call Sites Reference

These are ALL the files that call `amcp.raw()` — none of them change, but all must be regression-tested:

| File | Line(s) | What it sends |
|------|---------|---------------|
| `src/engine/scene-take-lbg-amcp-pipeline.js` | 102, 106 | `batchSendChunked` with MIXER DEFER lines |
| `src/engine/scene-take-lbg.js` | 182 | `batchSendChunked` with fade lines |
| `src/engine/scene-take.js` | 219, 239, 258 | `batchSendChunked` with build/fix/crossfade lines |
| `src/engine/scene-exit-layers.js` | 133, 207, 256, 275 | `batchSend`/`batchSendChunked` for layer exit |
| `src/engine/ftb-pgm-prv.js` | 105, 109, 127 | `batchSendChunked` + `raw(CLEAR)` |
| `src/engine/timeline-playback-amcp.js` | 181, 187, 258 | `raw(PLAY ...)` + `batchSendChunked` |
| `src/api/routes-amcp.js` | 61, 89, 229 | `batchSendChunked`, `raw()` for proxy |
| `src/api/routes-multiview.js` | 150, 153 | `raw(PLAY [html])`, `raw(CALL update)` |
| `src/api/multiview-layout-helper.js` | 185, 188 | `raw(PLAY [html])`, `raw(CALL update)` |
| `src/api/routes-streaming-channel.js` | 234, 244, 278, 280 | `raw(ADD STREAM)`, `raw(REMOVE STREAM)` |
| `src/api/routes-pip-overlay.js` | 25 | `raw(TLS)` |
| `src/api/routes-ndi.js` | 23 | `raw(NDI LIST)` |
| `src/api/routes-scene.js` | 335 | `raw()` for scene layer commands |
| `src/config/routing-setup.js` | 62, 89, 137, 140, 141, 227 | `raw(PLAY DECKLINK)`, `raw(MIXER OPACITY)`, `raw(TLS)` |
| `src/server/ws-server.js` | 231 | `raw()` for WS AMCP proxy |
| `src/artnet/artnet-output.js` | 61 | `raw()` for Art-Net CG layer |
| `src/streaming/caspar-ffmpeg-setup.js` | 70, 199, 224, 235 | `raw(ADD STREAM)`, `raw(REMOVE STREAM)` |
| `src/sampling/dmx-sampling-ingress.js` | 102, 111, 129, 241, 258 | `raw(ADD/REMOVE STREAM)`, `raw(ADD FILE)` |
| `src/bootstrap/startup-led-test-pattern.js` | 182, 319, 322 | `batchSendChunked` for LED test patterns |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Library response shape breaks callers | Medium | High | Phase 4 adapter + T7.2 parity tests |
| Batch atomicity broken (split TCP writes) | Medium | Critical | Phase 5 investigation + direct socket access |
| DEFER not supported in library v6 | Low | High | Fall back to raw string building for mixer |
| ESM/CJS incompatibility | Medium | Blocking | T1.1 spike resolves early |
| Scene take regression | Low | Critical | T7.4 manual QA on hardware |
| Reconnect behavior differs | Low | Medium | T2.2 maps library reconnect to existing events |
| Feature flag forgotten in production | Low | Medium | T6.1 documentation |

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-06-03 — WO closed (engineering)

**Done:**
- `smoke-amcp-migration-air-paths.test.js` — T7.4 proxies: `batchSendChunked`, DEFER+batch+pre-commit COMMIT, reconnect VERSION
- `test:highascg:migration:all` — single `node --test` (avoids npm chaining hang)
- T7.4 checkbox marked complete with **visual** sign-off called out in checklist only
- Completion status: **closed for agents**; operator checklist rows 1–6, 8–11 still for playout staff

**No further agent work** unless production regression.

---

### 2026-06-03 — T7.2 / T7.5 closed; WO ready for operator sign-off

**Done:**
- `smoke-amcp-offline-migration.test.js` — T7.2 offline `{ ok, data }` + REST mixer/cg/batch
- `smoke-amcp-legacy-transport.test.js` — T7.5 legacy VERSION + BEGIN…COMMIT (pass on host)
- `docs/reference/amcp-migration-qa-checklist.md` — T7.4 operator table
- `npm run test:highascg:migration:all` — single command for full automated gate
- WO **Completion status** section: engineering done; T7.4 pending on both PCs

**Only open item:** T7.4 manual rows 1–12 on playout hardware (cannot be automated here).

---

### 2026-06-03 — Phase 3/4/6/7 continuation

**Done:**
- Typed wrappers: `amcp-cg.js`, `amcp-data.js`, `amcp-thumbnail.js`, expanded `amcp-mixer.js` + `amcp-query.js`
- **`normalizeResponseData()`** — fixes VERSION returning `[object Object]` from typed `version()`
- Docs: `docs/reference/amcp-migration.md`, transport section in `amcp-mapping.md`
- Tests: `test:highascg:parity`, `test:highascg:send-after`, `test:highascg:migration`, extended `test:highascg:live`
- All automated tests pass on host with Caspar on :5250

**WO status:** Implementation **complete for production default path**. Remaining: **T7.2** (offline REST parity), **T7.4** (manual hardware QA), **T7.5** (legacy transport smoke on both PCs).

---

### 2026-06-03 — Batch drain fix + Phase 3/5 progress

**Done:**
- Removed dead `_onCcgData`; consolidated library batch socket tap (`_attachLibraryBatchSocket` on connect).
- Verified `node tools/smoke/batch-test.js` — `batched: true`, `202 COMMIT PARTIAL` ack recognized.
- Added `npm run smoke:amcp-batch` (`tools/smoke/smoke-amcp-batch-library.test.js`).
- **T3.4 partial:** `amcp-query.js` — typed paths for common query commands without extra args.
- **T3.2 partial:** `mixerOpacity`, `mixerCommit`, `channelGrid` → `_invokeTyped`.
- **T1.2:** API comparison table added above Phase 2.

**Next:** T3.3 CG, T3.5 thumb, T3.6 data; T7.1 command parity tests; queue `_invokeTyped` through `_amcpSendQueue` if races appear.

---

### 2026-06-03 — Verification pass (codebase audit)

**Verified in repo / on `highascg` host (Caspar on 127.0.0.1:5250):**

| Area | Status | Evidence |
|------|--------|----------|
| **Phase 1** | **Done** (except T1.2 doc) | `package.json` → `casparcg-connection@^6.3.3`; `require()` works; `node tools/smoke/spike-casparcg-connection.js` connects + VERSION |
| **Phase 2** | **Done** | `amcp-connection-adapter.js`, `connection-manager.js` uses library by default; `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` fallback |
| **Phase 3** | **~15%** | Only `amcp-basic.js` uses `_invokeTyped`; mixer/cg/query/thumb/data still string `_send` only |
| **Phase 4** | **Adapter only** | `normalizeResponse()` in adapter; callers not audited (T4.2 open) |
| **Phase 5** | **Partial** | Batch uses `adapter.send()` → `_socket.write`; `_onCcgData` batch drain hook has **debug `console.log` duplication** — needs QA on BEGIN…COMMIT |
| **Phase 6** | **Partial** | Legacy env flag wired; no deprecation headers on `tcp-client.js` / `amcp-protocol.js`; `amcp-mapping.md` not updated |
| **Phase 7** | **Minimal** | `highascg-health-api-amcp.test.js` 11/11 pass (1 skipped integration); no command-string parity suite; live scene QA not recorded |

**Spike results:** `spike-casparcg-adapter.js` → `sendRaw('VERSION')` → `{ ok: true, data: ['2.6.0 …'] }`.

**WO doc drift:** All task checkboxes were still `[ ]` before this entry; work was already landed in `src/caspar/` without Work Log entries.

**Instructions for next agent:**
1. Remove debug `console.log` in `connection-manager.js` `_onCcgData` (line ~117).
2. Run live batch test (scene take / `batchSendChunked`) on hardware; fix batch drain if COMMIT acks do not reach `_amcpBatchDrain`.
3. Complete **T3.2–T3.6** or document intentional raw-only paths.
4. Complete **T1.2** (library vs HighAsCG API table in this WO).
5. **T6.2–T6.4** docs + deprecation comments.

---
*Work Order created: 2026-06-03 | Parent: [`work/casparcg-node-connection.md`](file:///home/casparcg/highascg/work/casparcg-node-connection.md)*
*Reference: `casparcg-connection` npm library (SuperFlyTV/Sofie)*
