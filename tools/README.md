# Backend tools (minimal)

Production playout host and **eggs ISO build**. Operator UI is **`dist-web/`** on playout (`:4200`), built from in-repo **`client/`** (`npm run build:client`).

Optional [**highascg-client**](https://github.com/mko1989/highascg-client) Electron packaging (simulator, multiserver, modules) is extracted from `client/tools/electron-launcher/` — **not** the canonical UI source tree.

| Path | Purpose |
|------|---------|
| [`runtime/`](runtime/) | Playout helpers shipped in server releases (`exfat-sync-cli`, Caspar staged start) |
| [`eggs/`](eggs/) | penguins-eggs / live USB (`live-usb/build-highascg-egg.sh` — **one** `HIGHASCG_NVIDIA_DRIVER` per ISO) |
| [`release/`](release/) | `release:github-server` — server + `dist-web/` tarball |
| [`smoke/`](smoke/) | HTTP/AMCP/unit smoke tests (`npm run smoke`, `npm run test:*`) |

**Deprecated:** [`../deprecated/`](../deprecated/)

```bash
npm run build:client      # client/ → dist-web/
npm run verify:structure
npm run eggs:prepare    # sudo — WO-47 clone prep on build host
npm run eggs:build      # sudo HIGHASCG_NVIDIA_DRIVER=595 — single-driver ISO
npm run release:github-server
```
