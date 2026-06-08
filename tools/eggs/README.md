# Eggs / live ISO build

Build-host scripts for a **minimal squashfs** + exFAT operator payload (WO-47).

| Path | Purpose |
|------|---------|
| [`live-usb/`](live-usb/) | Produce, flash, verify, branding — see [live-usb/README.md](live-usb/README.md) |
| [`verify-w02-structure.js`](verify-w02-structure.js) | `npm run verify:structure` |
| [`unused/prepare-eggs-minimal.sh`](unused/prepare-eggs-minimal.sh) | Optional host purge (not in default pipeline) |

```bash
npm run clean:eggs-host
sudo npm run eggs:prepare    # work/run-eggs-prepare-safe.sh → prepare-eggs-clone-with-exfat.sh
sudo npm run eggs:build      # work/run-eggs-produce-from-host.sh → build-highascg-egg.sh
```

Mac/Windows stick imaging: [**highascg-client**](https://github.com/mko1989/highascg-client) live-usb tools.
