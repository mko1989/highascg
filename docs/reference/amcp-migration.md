# AMCP transport: `casparcg-connection` migration

HighAsCG uses the [casparcg-connection](https://www.npmjs.com/package/casparcg-connection) npm package (v6.x, CommonJS) as the default AMCP transport. The public API (`appCtx.amcp.*`, REST, WebSocket) is unchanged.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `HIGHASCG_AMCP_LEGACY_TRANSPORT` | unset (`0`) | Set to `1` to use legacy `TcpClient` + `AmcpProtocol` instead of the library |
| `HIGHASCG_AMCP_SEND_TIMEOUT_MS` | `15000` | Short AMCP reply timeout |
| `HIGHASCG_AMCP_LONG_RESPONSE_MS` | `120000` | Long replies (CLS, INFO CONFIG, thumbnails, …) |
| `HIGHASCG_AMCP_CONNECT_SETTLE_MS` | `600` | Delay before first VERSION after TCP connect |
| `HIGHASCG_AMCP_HEALTH_MS` | `0` | Periodic VERSION health interval (`0` = off) |

## Architecture

- **Default:** `ConnectionManager` → `CasparCG` (library TCP only) → `AmcpConnectionAdapter` → `AmcpClient` + `AmcpProtocol`
- **Plain AMCP:** The adapter writes normal command lines (`MIXER 1-10 …`) on the library socket. It does **not** use `sendCustom()` / `REQ <id>` (Caspar logs those as `400 ERROR` on standard builds). Incoming lines are parsed by `AmcpProtocol`, not the library’s REQ/RES deserializer (`_processIncomingData` is disabled after connect).
- **Batch:** `BEGIN…COMMIT` payloads use one raw `socket.write` via `adapter.send()`; replies are drained from the same socket tap (so `202 COMMIT PARTIAL` is recognized)
- **Rollback:** `HIGHASCG_AMCP_LEGACY_TRANSPORT=1` restores the pre-migration stack

## What stayed in HighAsCG

| Module | Reason |
|--------|--------|
| `amcp-batch.js` | CG-aware pre-commit, chunking, DEFER/COMMIT orchestration |
| `amcp-command-plan.js` | `[HTML]`, NDI, STING, route clips |
| `amcp-simulated.js` | Offline mode |
| Engine `raw()` / `batchSendChunked` | Unchanged call sites |

## Typed vs raw commands

See [amcp-mapping.md](amcp-mapping.md) (Transport column). All production commands go through `_send()` (plain AMCP). Library typed methods are opt-in only (`useLibraryTyped` on the adapter, not enabled by default).

## Batch transport (T5.1)

The library exposes `begin()` / `commit()` / `discard()`, but HighAsCG keeps **`amcp-batch.js`** and sends one raw `BEGIN\r\n…\r\nCOMMIT\r\n` payload via `adapter.send()`. Replies are read from the underlying TCP socket so `202 COMMIT PARTIAL` is not dropped by the library’s `RESPONSE_REGEX`.

## Tests

```bash
npm run test:highascg:migration      # Parity + batch + send-after + offline REST (no Caspar)
npm run test:highascg:live           # Live Caspar (library transport)
npm run test:highascg:legacy         # Live Caspar (HIGHASCG_AMCP_LEGACY_TRANSPORT=1)
npm run test:highascg:migration:all  # Full automated gate (one node --test run)
npm run test:highascg:air-paths      # T7.4 proxies: chunked batch, DEFER batch, reconnect
```

Manual playout QA: [amcp-migration-qa-checklist.md](amcp-migration-qa-checklist.md).

## Work order

Full task list: [`work/WO_CASPARCG_CONNECTION_MIGRATION.md`](../../work/WO_CASPARCG_CONNECTION_MIGRATION.md).
