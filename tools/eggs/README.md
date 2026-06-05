# Eggs / live ISO build

Build-host scripts for a **minimal squashfs** + exFAT operator payload (WO-47).

| Path | Purpose |
|------|---------|
| [`live-usb/`](live-usb/) | `prepare-eggs-clone-with-exfat.sh`, `build-highascg-egg.sh`, exclude merge, flash/persist |
| [`verify-w02-structure.js`](verify-w02-structure.js) | `npm run verify:structure` |
| [`prepare-eggs-minimal.sh`](prepare-eggs-minimal.sh) | Optional host purge before imaging |

```bash
npm run clean:eggs-host
sudo npm run eggs:prepare
sudo npm run eggs:build
```

Mac/Windows stick imaging: [`../../client/tools/live-usb/`](../../client/tools/live-usb/).
