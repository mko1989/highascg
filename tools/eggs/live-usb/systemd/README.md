# systemd snippets for live USB

| File | Purpose |
|------|---------|
| [`home-casparcg-highascg.mount.example`](home-casparcg-highascg.mount.example) | Mount ext4 labeled **`HIGHASCG_PERSIST`** at **`/home/casparcg/highascg`**. See [**`../HIGHASCG_FOLDER_USB_PARTITION.md`**](../HIGHASCG_FOLDER_USB_PARTITION.md). |
| [`home-casparcg-exfat.mount.example`](home-casparcg-exfat.mount.example) | **Superseded** on installed hosts by **`scripts/install-exfat-systemd-units.sh`** (mounts **`LABEL=HIGHASCGEXF`**). Example kept for reference. |
| [`highascg-exfat-sync.service.example`](highascg-exfat-sync.service.example) | **Superseded** by the same installer. See **[`../EXFAT_DATA_ZERO_TOUCH.md`](../EXFAT_DATA_ZERO_TOUCH.md)** for the full procedure. |
| **(generated, not `.example`)** | **`scripts/install-exfat-systemd-units.sh`** also writes **`highascg-exfat-media-prep.service`** and **`home-casparcg-highascg-media-exfat.mount`**. **`scripts/write-highascg-systemd-unit.sh`** aligns **`highascg.service`** with those units. **WO-52:** client + server on same playout machine; server serves **`dist-web/`** on `:4200`. **`10-headless.conf`** only when **`HIGHASCG_INSTALL_HEADLESS=1`**. See [`highascg.service.d-10-headless.conf.example`](highascg.service.d-10-headless.conf.example). |
| **`../prepare-eggs-clone-with-exfat.sh`** | Run on the Eggs **`--clone`** build host **before** `eggs produce` so the squashfs includes all of the above (plus Eggs exclude merge); **`build-highascg-egg.sh`** runs it automatically. |

Copy `*.example` to `/etc/systemd/system/` **without** the `.example` suffix, then `daemon-reload`, `enable`, `reboot`. Prefer **`sudo bash scripts/install-exfat-systemd-units.sh [user]`** (and **`prepare-eggs-clone-with-exfat.sh`** for imaging hosts) rather than copying examples by hand.
