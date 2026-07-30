# WO-396 — Devices view loads in 1–2 s: cold GET /api/device-view burns ~1.7 s on DeckLink re-probing

**Status: DONE (2026-07-30 — suite 1745/0/2; live: cold GET 2.47 s → 0.455 s, warm 54 ms, connectors intact via caspar_log; measurements below)**
**Source:** `work/work-orders/todos30.07.26` §"i need to work on the performance of the devices view tab. it loads between a 1s-2s."
**Related:** WO-202 (progressive render + ETag/304 — client side, still in place), WO-309 (async device-view probes), WO-391 (xrandr caching — display probe is 388 ms cold, 0 ms warm, left alone).

---

## 1. Investigation (2026-07-30, measured live on the box)

`GET /api/device-view`: **2.47 s cold, 0.04 s warm** (ETag/304 path). `/api/settings` 6 ms,
`/api/state` 39 ms — the tab's load time IS this endpoint's cold path. Cold-path breakdown
(each stage timed in isolation):

| stage | time | result |
|---|---|---|
| `getDisplayDetailsAsync()` (xrandr) | 388 ms cold / 0 warm | 2 displays (has own cache, WO-391) |
| `probeDecklinkHardware({timeoutMs:1200})` (ffmpeg) | ~1.2 s | **always fails** — Caspar holds the DeckLink cards open (single-open hw) |
| `probeDecklinkFromCasparLog({4 MB})` | 459 ms | **4 connectors found** |
| `listPortAudioDevices()` | 23 ms | 8 devices |

Two root causes in `device-view-snapshot.js:buildLiveSnapshot`:

1. **The inventory short-circuit never fires.** `/tmp/highascg-system-inventory.json` is fresh
   but `decklink.connectors` is `[]`: the collector (`system-inventory-file.js:
   collectDecklinkFromCasparLog`) reads **only today's** log
   (`caspar_<today>.log`), while Caspar's "Decklink devices found:" block is written at its
   LAST START — 2026-07-28 on this box. The snapshot's own fallback
   (`decklink-enum.js:probeDecklinkFromCasparLog`) scans recent days and finds it; the
   collector's bespoke single-day parser cannot.
2. **Probe order is worst-case on a playout box:** the 1.2 s live ffmpeg probe (guaranteed to
   fail while Caspar runs) executes BEFORE the 459 ms log parse that succeeds. And nothing
   caches the resolved result — every cold tab-open repays ~1.7 s.

## 2. What was done

- `src/bootstrap/system-inventory-file.js`: the collector now delegates to
  `probeDecklinkFromCasparLog` (multi-day scan); the single-day parser/tail-reader deleted.
  The inventory file therefore carries real connectors and the snapshot's first branch hits.
- `src/api/device-view-snapshot.js`: fallback resolution reordered **log-parse → live probe**
  (probe is now last resort), and the resolved DeckLink hardware summary is cached in-process
  for 10 min (`invalidateDecklinkHwCache()` exported; the route's `fresh=1`/`freshGpu=1`
  clears it alongside the xrandr cache).
- `tools/smoke/smoke-wo396-decklink-cold-path.test.js`: multi-day collector guard + probe-order
  source guard + cache invalidation unit.

## 3. What was VERIFIED

- Suite **1745 pass / 0 fail / 2 skip** (incl. new smoke-wo396: collector delegation guard,
  probe-order guard, cache invalidator export + route wiring).
- Live on the box after service restart:
  - `GET /api/device-view` **cold 0.455 s** (was 2.47 s), **warm 0.054 s**,
    `?fresh=1` (deliberate full re-probe) 0.875 s.
  - Payload intact: `live.decklink.hardware = { source: "caspar_log", connectors: [DeckLink
    8K Pro 1..4] }`, `warnings: []` — no ffmpeg probe ran, no probe-failure warnings.
- Remaining cold cost is the xrandr display probe (~0.4 s, own cache + RandR-event
  invalidation per WO-391) — subsequent tab opens ride the ETag/304 path at ~50 ms.
- Owner QA: open the Devices tab twice — first open ≲0.5 s, second ~instant.
