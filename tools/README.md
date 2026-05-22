# Backend tools (minimal)

Production playout host and **eggs ISO build** only. Operator UI and launchers live in [**highascg-client**](https://github.com/mko1989/highascg-client).

| Path | Purpose |
|------|---------|
| [`runtime/`](runtime/) | Playout helpers shipped in server releases (`exfat-sync-cli`, Caspar staged start) |
| [`eggs/`](eggs/) | penguins-eggs / live USB image prep (`live-usb/`, `verify-w02-structure.js`) |
| [`release/`](release/) | `release:github-server` — backend tarball |
| [`smoke/`](smoke/) | HTTP/AMCP/unit smoke tests (`npm run smoke`, `npm run test:*`) |

**Deprecated:** [`../deprecated/`](../deprecated/)

```bash
npm run verify:structure
npm run eggs:prepare    # sudo — WO-47 clone prep on build host
npm run eggs:build      # sudo — eggs produce
npm run release:github-server
```
