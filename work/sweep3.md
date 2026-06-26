# Sweep 3: server module splits + architecture doc pass

**Generated:** 2026-06-03  
**Follows:** [`sweep2.md`](sweep2.md)

## Actions taken

### Code splits (all modules now ≤ 500 lines)

| Former file | Lines before | Split into |
|-------------|-------------:|------------|
| `src/artnet/artnet-receiver.js` | 949 | `artnet-receiver.js` (350), `artnet-dmx-border.js`, `artnet-packet.js`, `artnet-slot-config.js`, `artnet-udp.js`, `artnet-runtime.js`, `artnet-output.js`, `artnet-constants.js` |
| `src/system/exfat-sync.js` | 644 | `exfat-sync.js` (223), `exfat-sync-map.js`, `exfat-sync-fs.js`, `exfat-sync-status.js` |
| `src/media/local-media.js` | 546 | `local-media.js` (50 barrel), `local-media-paths.js`, `local-media-api.js` |
| `src/config/defaults.js` | 543 | `defaults.js` (23 barrel), `defaults-core.js`, `defaults-caspar-server.js` |

**Dead code removed:** `_loadGlobalBordersArray()` and unused `fs`/`path` imports in Art-Net receiver (never called).

### Documentation

| File | Change |
|------|--------|
| [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) | **Updated** — unified playout: API + `dist-web/` on `:4200` |
| [`README.md`](../README.md) | Bridge role; `client/`/`work/` not on server |
| [`docs/README.md`](../docs/README.md) | Links ARCHITECTURE; not-shipped paths |
| [`docs/PLAN_SERVER_CLIENT_SPLIT.md`](../docs/PLAN_SERVER_CLIENT_SPLIT.md) | Bridge wording |
| [`docs/ISO_CONTENTS.md`](../docs/ISO_CONTENTS.md) | Stack + exclude list |
| [`work/BACKEND_AND_CLIENT_SPLIT.md`](work-orders/BACKEND_AND_CLIENT_SPLIT.md) | Electron client, exclusions |

## App surface LOC check (server `src/` only)

Run after changes:

```bash
find src -name '*.js' -exec wc -l {} + | awk '$1 > 500 {print}' | sort -rn
```

Expected: **no output** for the four formerly-over-limit modules.

## Still excluded from server audits

- `client/` — legacy UI + electron launcher (operator machine)
- `client/tools/electron-launcher/` — not on playout
- `work/`, `work/references/` — engineering only
