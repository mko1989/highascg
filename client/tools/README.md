# Client and operator tools

Browser UI dev/simulation, desktop launchers, and **client** GitHub releases. Not required on a headless playout server.

| Path | Purpose |
|------|---------|
| [`portable-desktop/`](portable-desktop/) | `npm run portable:sim` — local/exFAT simulation |
| [`electron-launcher/`](electron-launcher/) | `npm run launcher` |
| [`operator-desktop/`](operator-desktop/) | `npm run operator-kit` — ISO + stick prep (macOS/Windows) |
| [`stick-tools/`](stick-tools/) | `npm run stick-studio` — Stick Studio GUI |
| [`live-usb/`](live-usb/) | macOS/Windows stick scripts (exFAT + ISO write) |
| [`release/`](release/) | `npm run release:github-client` → `dist-web/` tarball |

Server deploy (`dev-push.sh`) is under [`../../not-needed/client-scripts/`](../../not-needed/client-scripts/).
