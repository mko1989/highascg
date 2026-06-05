# systemd snippets for live USB

| File | Purpose |
|------|---------|
| [`home-casparcg-highascg.mount.example`](home-casparcg-highascg.mount.example) | Mount ext4 labeled **`HIGHASCG_PERSIST`** at **`/home/casparcg/highascg`**. See [**`../HIGHASCG_FOLDER_USB_PARTITION.md`**](../HIGHASCG_FOLDER_USB_PARTITION.md). |
| [`home-casparcg-exfat.mount.example`](home-casparcg-exfat.mount.example) | **Superseded** on installed hosts by **`scripts/install-exfat-systemd-units.sh`** (mounts **`LABEL=HIGHASCGEXF`**). Example kept for reference. |
| [`highascg-exfat-sync.service.example`](highascg-exfat-sync.service.example) | **Superseded** by the same installer. See **[`../EXFAT_DATA_ZERO_TOUCH.md`](../EXFAT_DATA_ZERO_TOUCH.md)** for the full procedure. |
| **(generated, not `.example`)** | **`scripts/install-exfat-systemd-units.sh`** also writes **`highascg-exfat-media-prep.service`** (creates **`~/exfat/media`**) and **`home-casparcg-highascg-media-exfat.mount`** (bind `~/exfat/media` → `~/highascg/media/exfat`). **`scripts/write-highascg-systemd-unit.sh`** aligns **`highascg.service`** with those units when present and installs **`highascg.service.d/10-headless.conf`** (`HIGHASCG_HEADLESS=true`). See [`highascg.service.d-10-headless.conf.example`](highascg.service.d-10-headless.conf.example). |
| **`../prepare-eggs-clone-with-exfat.sh`** | Run on the Eggs **`--clone`** build host **before** `eggs produce` so the squashfs includes all of the above (plus Eggs exclude merge); **`build-highascg-egg.sh`** runs it automatically. |

Copy `*.example` to `/etc/systemd/system/` **without** the `.example` suffix, then `daemon-reload`, `enable`, `reboot`. Prefer **`sudo bash scripts/install-exfat-systemd-units.sh [user]`** (and **`prepare-eggs-clone-with-exfat.sh`** for imaging hosts) rather than copying examples by hand.
