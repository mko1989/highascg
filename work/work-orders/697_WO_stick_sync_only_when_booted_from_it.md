# WO-697 — a HighAsCG stick syncs automatically only with the box that booted from it; otherwise save / load by hand

**Status: DONE (2026-10-23, smoke-wo697 8/8, test:ci 2844/2847 (only the known pointer-confine fail), Godot 21152/0;
detection proven on .64 (Ventoy live boot → boot stick) and this installed box (never); owner QA: plug a stick into
an installed box, Load → USB stick…)**

Owner, 23.10 (on WO-696 finding 2): *"it should write by default when boot from the stick. should be available to save
to load from the stick manualy."*

## Investigation

WO-696 finding 2: this box (booted from its NVMe) mounted the owner's ISO stick's HIGHASCGEXF as `~/exfat` at 10:17
and pushed config + projects onto it; .64 booted from that stick and loaded them. Every automatic stick path keyed on
"`~/exfat` is mounted", never on "this box booted from it":

- **udev → `highascg-exfat-arrive.sh`** (and at boot every unit is `WantedBy=multi-user.target` on its own):
  mount, then `highascg-exfat-server-update` (installs the stick's `drop-update/` over `~/highascg`),
  `highascg-exfat-network-apply` (applies the stick's `network/network.conf`), DeckLink install, `highascg-exfat-sync`
  (`exfat-sync-cli.js --boot`: stick → box for `bootPrefer: exfat` pairs, then box → stick).
- **node `src/system/exfat-sync.js`**: `pushProjectConfigToExfat` after every settings save (10:18:32
  `push to volume(s) copied=138`), `runExfatSync` for the usb pairs.
- **node `src/engine/project-volume-sync.js`**: `pushProjectSlugToVolumes` on every project save (10:19–10:30
  `[project] pushed new_project_1.json → USB`), pulls of the stick's newer project / autosave, and
  `listProjectsFromVolumes`, which with a stick mounted lists the STICK's catalog instead of the box's.
- **`src/system/private-volume-sync.js`**: per-machine Tailscale / Syncthing pairing exported to `usb/.private/`.

How "booted from the stick" shows (.64, read-only, 23.10): `/proc/cmdline boot=live`; `/run/live/medium` ←
`/dev/mapper/ventoy` (iso9660); `/sys/block/dm-0` name `ventoy`, slaves `sda1`; `~/exfat` ← `/dev/sda3`
(HIGHASCGEXF) — the same disk `sda`. `/dev/mapper/` holds only `control` after switch_root, so the dm device must be
found by its sysfs `dm/name`. This box: no `/run/live/medium` (installed).

## What was done

- **`src/system/boot-stick.js`** (new): `stickState(mount)` → `{mounted, bootStick, disk, bootDisk}` from
  `/proc/self/mounts` + sysfs (dm followed to its slaves, partition to its disk, `/dev/mapper/<name>` by `dm/name`).
  **`scripts/exfat/highascg-boot-stick.sh`** (new, sourced): the shell twin `highascg_exfat_is_boot_stick`; installed
  by `install-exfat-systemd-units.sh` next to the scripts.
- **Gates** (a stick the box did not boot from is a plain drive):
  - `exfat-sync.js`: usb pairs skip `syncOnePair` and the push (`opts.manual` lifts it for Save to stick only);
  - `project-volume-sync.js` `usbAutoSync(roots)`: catalog (box's own list, not the stick's), push on save, both pulls;
  - `private-volume-sync.js`: never to a foreign stick (not even by hand);
  - `highascg-exfat-network-apply.sh`, `highascg-exfat-server-update.sh`: skip (fail closed if the helper is missing).
  - Left alone: the mount itself, media prep / media bind (read-only use of the stick's media), DeckLink install
    (acts only when a card has no driver; changes no data).
- **By hand** — `src/system/stick-transfer.js` + `GET /api/system/stick`, `POST /api/system/stick/save | /load`
  (routes-exfat-sync.js; contract doc regenerated):
  - save: every project + its autosave → `projects/`, and the settings pairs (the same push a boot stick gets);
  - load: one project → the box. A different box copy (and its autosave, which would win on load) is kept as
    `<slug>.json.before-stick-<time>` — not `.json`, so it stays out of the project list.
- **Godot**: the Load dialog shows **USB stick…** only for a stick the box did not boot from (`/api/project/list`
  `volumes.usb.bootStick`); `app/stick_dialog.gd` lists the stick's projects ("also on this box"), **Save all to
  stick** (saves the open show first) and **Load from stick** (confirm before replacing; then the normal load).

## Verified

- `tools/smoke/smoke-wo697-boot-stick.test.js` 8/8: fake sysfs/mounts of .64 (boot stick), a second stick on a live
  box and an installed box (not), mount escapes; save / load against temp dirs (projects + autosaves, kept copies,
  bad names); the gates pinned in every automatic path and the install line.
- Real hardware: the shell helper and `stickState` run on .64 (piped over SSH, read-only): `sda` / `sda` → boot
  stick; on this box `~/bridge` (nvme0n1) → not, and a faked live medium on `/` vs `/boot/efi` (same disk) → yes.
- Box: node restarted; `GET /api/system/stick` → `{mounted: false, …}` (no stick in), `/api/project/list` carries
  `bootStick`. test:ci 2844/2847 (known pointer-confine), Godot 21152/0 (+`test_stick_offer_and_rows`),
  `run-client.sh --check` OK, lint 214, format, line limit, unwired exports clean.
- NOT verified live: a real foreign stick on this box (none plugged in) — owner QA. The shell gates take effect after
  `sudo bash ~/highascg/scripts/exfat/install-exfat-systemd-units.sh` on this host (and in the next ISO).
