# AMCP migration — manual QA checklist (T7.4)

Run on **each playout PC** with CasparCG and HighAsCG on the build that includes `casparcg-connection` (default transport). Record date, machine, and pass/fail.

**Automated preflight (on the machine):**

```bash
cd ~/highascg
npm run test:highascg:migration:all
npm run test:highascg:air-paths    # batchSendChunked, DEFER batch, reconnect (no PGM check)
HIGHASCG_AMCP_LEGACY_TRANSPORT=1 node --test tools/smoke/smoke-amcp-legacy-transport.test.js
```

## Default transport (`casparcg-connection`)

| # | Test | Pass | Notes |
|---|------|------|-------|
| 1 | Scene take crossfade (LOADBG → PLAY, MIX) smooth on PGM | ☐ | |
| 2 | Global border + CG layer order correct | ☐ | |
| 3 | PIP overlay position + opacity animation | ☐ | |
| 4 | Multiview sources + CALL update | ☐ | |
| 5 | Streaming ADD/REMOVE STREAM | ☐ | |
| 6 | DeckLink PLAY routing | ☐ | |
| 7 | Batch: multiple MIXER DEFER → COMMIT → atomic look | ☐ | |
| 8 | Offline mode: UI/settings without Caspar | ☐ | |
| 9 | Reconnect: restart Caspar, HighAsCG recovers VERSION | ☐ | |

## Rollback (`HIGHASCG_AMCP_LEGACY_TRANSPORT=1`)

| # | Test | Pass | Notes |
|---|------|------|-------|
| 10 | `systemctl restart highascg` with env in drop-in or unit | ☐ | |
| 11 | Scene take still works on legacy transport | ☐ | |
| 12 | `npm run test:highascg:legacy` passes on host | ☐ | |

## Sign-off

| Role | Name | Date |
|------|------|------|
| Operator / playout | | |
| Engineering | | |

When rows 1–12 pass on **both** production PCs, mark WO-52 migration **T7.4** complete in [`WO_CASPARCG_CONNECTION_MIGRATION.md`](../../work/WO_CASPARCG_CONNECTION_MIGRATION.md).
