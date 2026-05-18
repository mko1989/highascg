# WO-33b — Device view: host & Caspar enumeration (GPU, DeckLink, audio)

**Parent:** [WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** [WO-33a](./33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md) (for `GET` response `live` shape)

---

## 1. Objective

Populate the **`live` section** of `GET /api/device-view` with **actionable, generator-aligned** data so the backplane (33c) shows **the same** GPU/DeckLink **indices and labels** that will appear in the generated `casparcg.config`. Include **degraded** states when tools are missing or Caspar is offline.

---

## 2. Data sources (priority)

| Subsystem | Primary source | Fallback |
|-----------|----------------|----------|
| **GPU outputs** | Existing OS helpers: `xrandr`, nvidia-*, or DBus/Wayland (match what HighAsCG already uses in `os-config` / host stats) | Empty array + `live.warnings[]` e.g. `gpu_enum_unavailable` |
| **DeckLink** | Same enumeration path as `build-caspar-generator-config` / `decklink-config-validate` — **same order** as XML `<decklink device="N">` | From saved HighAsCG settings if OS scan disabled |
| **Audio** | ALSA/PipeWire one-liner or existing host route if any | `audio: { devices: [] }` + warning |
| **Caspar** | `ctx._casparStatus` / `INFO` or existing channel list AMCP, non-blocking timeout | `caspar: { connected: false, reason: "…" }` |

**Rule:** The inspector must not show **GPU-2** in UI while the generator will write **Screen 0** to a different physical port without an explicit **mapping** object — if physical order cannot be determined, set `connectors[].confidence: "inferred" | "user_bound" | "unknown"` (add in 33a if missing).

---

## 3. `live` payload (normative extension)

Add to `GET /api/device-view`:

```ts
live: {
  host: { hostname, platform, collectedAt: ISO8601 },
  gpu: Array<{ name: string; outputs: Array<{ id: string; edidName?: string; res?: string }> }>,
  decklink: { inputs: Array<{ index: number; model?: string; label: string }>, outputs: Array<...> },
  audio: { inputs: Array<...>, outputs: Array<...> },
  caspar: { amcpConnected: boolean, channels?: number[] },
  warnings: Array<{ code: string; message: string; detail?: string }>
}
```

- **Id stability:** `live` ids may be **recomputed** each poll — 33c links **saved** `connectors[].externalRef` to `live` rows by (kind, index, label key).
- **Cache:** short TTL in-memory (e.g. 2–5s) to avoid fork storm; `?refresh=1` to bypass.

---

## 4. Tasks (checklist)

- [ ] Audit `src/utils/os-config.js`, `routes-host-stats.js` (or equivalents) — list what already exists; **reuse** functions.
- [ ] Add `enumerateGpuDisplays(ctx)` (or name aligned with project) — **feature flag** in config: `deviceView.enumeration.enableGpu: true` default, false on unsupported OS for CI.
- [ ] Add `enumerateDecklinkForConfig(ctx)` reusing `decklink` validation / generator indices.
- [ ] Add `enumerateAudio` minimal (names only for v1).
- [ ] Merge into `GET /api/device-view` as `live`.
- [ ] **Merge rule:** if saved `connectors` exist for this host, **match** by `kind`+`index`+`label` and attach `live` stats to a **view model** DTO (could be a separate `GET` query param `?enrich=1` to keep base graph thin — document choice).
- [ ] Log warnings without failing the request.

---

## 5. Security & performance

- No shell injection: use `execFile` with fixed args, whitelist commands.
- Timeouts: total enumeration **&lt; 2s** default; on timeout, return partial `live` + warning `enum_timeout`.
- **Root:** if enumeration requires root, **document** and skip with warning (do not block API).

---

## 6. Acceptance criteria

1. On a real Linux box with `xrandr` or native API, at least one **GPU output** line appears in `live` *or* a clear `warnings` code explains absence.
2. DeckLink list length **matches** the generator’s index convention (cross-check with a generated file snippet in test or manual).
3. When Caspar AMCP is down, `GET` still **200** with `caspar.amcpConnected: false` and valid saved `graph`.
4. Unit test **mocking** `execFile` for success and failure paths.

---

## 7. Out of scope (33b)

- Graphical UI.
- EDID **comparison** to Caspar (33e).
- PixelHue live data (33d) — *optional* forward stub: `live.pixelhue: null` until 33d.

---

## 8. Dependencies in codebase (hints)

- `src/config/decklink-config-validate.js`
- `src/config/build-caspar-generator-config.js` — which props drive `<consumer>`/`<screen>`.
- `src/api/routes-tandem-device.js` — pattern for `ctx` access.

---

*End of WO-33b*
