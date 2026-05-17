# systemd snippets for live USB

| File | Purpose |
|------|---------|
| [`home-casparcg-highascg.mount.example`](home-casparcg-highascg.mount.example) | Mount ext4 labeled **`HIGHASCG_PERSIST`** at **`/home/casparcg/highascg`**. See [**`../HIGHASCG_FOLDER_USB_PARTITION.md`**](../HIGHASCG_FOLDER_USB_PARTITION.md). |

Copy `*.example` to `/etc/systemd/system/` **without** the `.example` suffix, then `daemon-reload`, `enable`, `reboot`.
