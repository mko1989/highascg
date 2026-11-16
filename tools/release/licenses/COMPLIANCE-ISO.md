# ISO shipping — third-party licence compliance

**Status:** engineering guidance, not legal advice. Source: `tools/release/licenses/COMPLIANCE-ISO.md` in the
HighAsCG repo. `tools/release/collect-third-party-licenses.sh` copies it here, so edit the source, never this copy.
Rules: WO-1095 (audit) and WO-1096 (fixes). Owner, 16.11.26: *"we cant bake anything into iso that i have no right
to distribute"* and *"nothing will be sold. everything is free open source"*.

HighAsCG itself is **AGPL-3.0-or-later** (`third-party/highascg-AGPL-3.0.txt`). That does not grant rights to
redistribute anything else on the image. Each component keeps its own licence, listed in `INDEX.md` /
`manifest.json`. `SOURCES.md` is the written source offer for every GPL/LGPL/MPL component.

---

## Summary

| Component | On the ISO? | What the licence requires, and how the image meets it |
|-----------|-------------|--------------------------------------------------------|
| **NVIDIA driver** | **Yes** (one branch per ISO) | Unmodified binaries + the NVIDIA Driver License Agreement given to every recipient: `third-party/nvidia-driver.NOTICE` and the dpkg `copyright` files; the build verifier asserts both |
| **NDI runtime** (`libndi.so.6`) | **Yes**, only as `~/highascg/lib/libndi.so.6` | NDI SDK License Agreement (PDF here); "NDI® is a registered trademark of Vizrt NDI AB" plus a link to https://ndi.video/ next to NDI in both clients; no system-path copy; no NDI Tools; an SDK less than 30 days old at release if there is one |
| **Blackmagic Desktop Video** (DeckLink) | **No** | The EULA forbids copying ("You may not … copy the Software"). Excluded since WO-92/WO-430; installed per box from the stick's exFAT partition (`decklink-install-from-exfat.sh`). The EULA text below is kept for reference only |
| **ChamSys MagicQ** | **No** | EULA: one copy on one computer. Excluded; installed per box from exFAT |
| CasparCG Server, CEF/Chromium, Godot, libretro cores, Companion, WayVR, penguins-eggs, casparcg-scanner | Yes | Licence texts in `third-party/`; source offer in `SOURCES.md` |
| Ubuntu packages | Yes | Each package's `/usr/share/doc/<pkg>/copyright`; versions in `third-party/ubuntu-packages.tsv`; sources per `SOURCES.md` |

---

## NVIDIA graphics drivers

**Licence:** `/usr/share/doc/nvidia-driver-*/copyright` → `third-party/nvidia-driver.NOTICE`.

The NVIDIA Driver License Agreement allows you to:

> **d.** Distribute the SOFTWARE provided for use with operating system kernels distributed under the terms of an
> OSI-approved open source license … provided that (i) the binary files thereof are **not modified** … and (ii)
> **this Agreement is provided to each SOFTWARE recipient**.

To meet that:

1. Driver packages come from NVIDIA's CUDA repo or from Ubuntu. Never patch the `.ko` or `.so` files.
2. The licence ships in this tree and in `/usr/share/doc/libnvidia-*/copyright`. `verify-iso-redistribution.sh`
   fails the build without it.
3. `/etc/highascg/nvidia-iso-driver` names the branch on the ISO.

---

## NDI runtime (`libndi`)

**Licence:** the NDI SDK License Agreement (`third-party/ndi-sdk-license-agreement.pdf`) and
https://docs.ndi.video/all/developing-with-ndi/sdk/licensing. NDI is royalty-free but not open source.

- **§2(a):** you may distribute only the object code included in the SDK, as used by your product. We ship
  `libndi.so.6` (and the `.6.3.2` file it points to) in `~/highascg/lib/`. Caspar loads it from there, via
  `RUNPATH $ORIGIN/../lib` and `run.sh`.
- **No system-path copy.** NDI's documentation says "Please do not install your NDI DLLs into the system path".
  `/usr/lib/x86_64-linux-gnu/libndi.so*` is excluded, and the verifier fails a build that carries it.
  `scripts/setup/04-ndi.sh` still installs it there on a dev host as a convenience.
- **Attribution.** "NDI® is a registered trademark of Vizrt NDI AB" and a link to https://ndi.video/ appear next to
  NDI in both clients:
  - web: `client/lib/ndi-attribution.js`;
  - Godot: `godot/client/features/devices/stream_record_model.gd`.

  A curated smoke asserts both.
- **No NDI Tools.** Do not redistribute NDI Tools; link to https://ndi.video/tools/ instead.
- **§2(b):** "If you are making a product release you must use a version of the SDK that is less than thirty (30)
  days old if there is one." On 16.11.26 the box carries SDK 6.3.2 (installed 07.06). NDI's release notes list 6.3.2
  (2026-04-13) as the newest SDK. Re-check before each release.
- **§1(b)** limits use in hardware Products sold. Nothing is sold, so it does not apply.

---

## Blackmagic Desktop Video (DeckLink) — not on the ISO

- The Blackmagic Design License Agreement forbids copying the software.
- `desktopvideo`, its DKMS module, its icons, `/etc/blackmagic`, dracut/rc/systemd leftovers and
  `~/.config/Blackmagic Design` are all excluded:
  - `penguins-eggs-exclude-decklink.list`;
  - `penguins-eggs-exclude-redistribution.list`.
- Both verifiers fail a build that carries any of it:
  - `verify-iso-squashfs-excludes.sh`;
  - `verify-iso-redistribution.sh`.
- **Per-box install:** the operator copies Blackmagic's own installer to the stick's exFAT partition, then
  `decklink-install-from-exfat.sh` runs `dpkg -i`. The operator accepts Blackmagic's EULA on that box.
- `third-party/blackmagic-desktopvideo-EULA.txt` is the EULA text from the build host's package, kept for
  reference. It does not mean the software is on the image.

**Trademarks:** *DeckLink* and *Blackmagic Design* are trademarks of Blackmagic Design Pty. Ltd.

---

## Not ours to ship (excluded; verifier-asserted)

- Shutter Encoder.
- MagicQ, NoMachine and Zoom leftovers.
- The unused `/usr/lib/cef` duplicate.
- The noble compat libs.
- Client show data and backups.
- `root`'s home.
- NetworkManager history, the PulseAudio cookie, exfat-sync backups.

The lines are in `penguins-eggs-exclude-redistribution.list` (WO-1096).

**Deliberately shipped (owner decision, 16.11.26):**

- `~/.highascg/gdtf-share.json`, the project's GDTF Share login.
- Owner: *"i wanted to leave the highascg login, so getting the gdtf files would be easier, streamlined"*.
- For the record: GDTF Share's terms (§5) ask users to keep their login details confidential.
- The downloaded GDTF files themselves do not ship.

---

## AGPL HighAsCG + proprietary components

The AGPL covers HighAsCG's source, not NVIDIA's or NDI's binaries. A combined system image is fine when each
component meets its own licence. The AGPL does not require opening NVIDIA's or NDI's libraries.

---

## Before `eggs produce`

```bash
bash tools/release/collect-third-party-licenses.sh      # regenerates this tree (build-highascg-egg.sh runs it)
sudo bash scripts/setup/15-licenses-install.sh          # installs it to /usr/share/doc/highascg/licenses
bash tools/eggs/live-usb/verify-iso-redistribution.sh /home/eggs/highascg-*.iso   # after the produce
```

## Related

- [`INDEX.md`](INDEX.md) — component list.
- [`manifest.json`](manifest.json) — machine-readable.
- [`SOURCES.md`](SOURCES.md) — source offer.
- WO-90, WO-1095, WO-1096 in the HighAsCG repo (`work/work-orders/`).
