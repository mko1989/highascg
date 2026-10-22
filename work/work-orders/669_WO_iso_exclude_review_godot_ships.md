# WO-669 — ISO exclude review: the Godot GUI binary was excluded; credentials and dev leftovers now are

**Status: DONE in repo (22.10, two rounds; list simulation + smoke 39/0 + test:ci); proven on the next `eggs produce`
by `verify-iso-squashfs-excludes.sh` — owner 22.10: "we are not doing the iso yet. just a prepare for later"**

Owner, 22.10: *"lets also review the iso production and eggs excluded list and make sure nothing not needed is not
making it to the iso."*

## Investigation

- **How the list is built.** `prepare-eggs-clone-with-exfat.sh:152-163` merges one HighAsCG fragment into
  `/etc/penguins-eggs.d/exclude.list` with `--replace`:
  - `penguins-eggs-exclude-highascg-embed-server.list` when `HIGHASCG_ISO_EMBED_SERVER=1` (the standalone ISO);
  - `penguins-eggs-exclude-highascg-fragment.list` otherwise (WO-47, the server comes from exFAT);
  - then `penguins-eggs-exclude-decklink.list`.
  - The live `/etc` copy is root 0600 and was not read. Every produce re-merges it from the repo, so the repo lists
    are the truth.
- **Method.** Each top-level entry of `~`, `~/.highascg` and `~/.config` was matched against fragment +
  `exclude.list` (glob per path prefix, like mksquashfs `-wildcards`), plus `du` on everything large.
- **Finding 1 (load-bearing): the operator GUI did not ship.**
  - Both fragments had `home/casparcg/.local` + `home/casparcg/.local/*`.
  - `~/.local/opt/godot/godot` (140 MB) is the binary `scripts/setup/09-openbox-autostart.sh:146-162` launches for the
    GUI.
  - Since the kiosk went (WO-646), it is the only on-box operator GUI. A fresh install would boot to a desktop whose
    "Start operator here" has nothing to start.
  - No setup script installs Godot.
- **Finding 2: a personal credential shipped.** `~/.highascg/gdtf-share.json` (WO-637's GDTF Share login, 0600) had
  no exclude line. Also shipping:
  - `~/.highascg/cache`, `log`, `run` (the WO-638 `caspar-screens-ready` flag), and the 67 MB
    `firefox-operator-alt1` profile (only `firefox-operator` was listed).
- **Finding 3: dev build output shipped.**
  - `godot/extensions/hshm/build` (238 MB CMake tree; only `bin/` 1.6 MB is used);
  - three Caspar rollback binaries `bin/casparcg.{prev,253c16c,v1-shm}` (27 MB; the source mentions of `253c16c` are
    comments);
  - home leftovers: a 9984×1536 scrot, `procprobe.gd`, `rates.jsonl`, `package-lock.json`,
    `highascg-mirror-push.log`, `highascg-wiki-map` (5.6 MB), `0x200014`;
  - session files `.Xauthority`, `.xsession-errors`, `.lesshst`, `.wget-hsts`, `.sudo_as_admin_successful`;
  - `.dotnet`, `.copilot`, `.config/{Ultralytics,google-chrome-for-testing,zoom,zoom.conf}`.
- **The embed list missed `home/casparcg/bridge`; the fragment list had it.** `~/bridge` is a mountpoint (the
  exFAT bridge partition, 5.5 GB including Desktop Video 1.5 GB).
- **Refuted from the review agent's report:**
  - `/var/log/journal` (1.9 GB) is not shipped. The template's `var/log/*/*` matches the `journal/<machine-id>`
    directory, and excluding a directory drops everything below it.
  - `~/companion` (909 MB) is deliberately shipped on the embed ISO (its comment: "production tarball is ~/companion
    only"), so it was left alone.

## What was done

- **Both fragments: `~/.local` dropped piece by piece.**
  - Excluded: `bin/` (the Claude CLI), `lib/`, `state/`, `share/*`, and the Godot download archive `opt/godot/dl`.
  - `opt/godot/godot` now ships.
- **Both fragments: one WO-669 block for the findings above.**
  - The `~/.highascg/log` and `run` directories stay (their contents go): autostart redirects into
    `~/.highascg/log/godot-client.log` and would fail without the directory.
  - `home/casparcg/bridge` is added to the embed list.
- **`tools/smoke/smoke-eggs-exclude-lists.test.js`:** a WO-669 suite. It matches each list the way mksquashfs does
  (`*` within one segment, a directory excludes its subtree) and checks:
  - the Godot binary ships;
  - the credential, caches, rollback binaries and hshm build are excluded;
  - the runtime dirs, `bin/casparcg`, hshm `bin/` and `.config/openbox` ship.
  - Prettier reformatted the file's older cases as well.
- **`verify-iso-squashfs-excludes.sh`:** after a produce it requires `.local/opt/godot/godot` to be present and
  `gdtf-share.json` and the hshm build to be absent.

## What was VERIFIED

- Simulation of both new lists: the Godot binary ships; downloads, `share/`, `bin/claude`, the credential, logs, the
  rollback binaries and the hshm build are excluded; `.highascg/log` / `run` dirs, `bin/casparcg`, hshm `bin/`, and
  `.config/openbox` ship.
- The guard on the OLD embed list reports `godot excluded = true` and `gdtf creds excluded = false`, so it catches
  this regression.
- Smoke 39/0; `npm run test:ci` 2752/0; `format:check` clean; `bash -n` on the verifier.
- Not run: `eggs produce` (needs sudo and a stick session). The squashfs verifier proves it on the next produce.

## Round 2 — owner answers, 22.10

Owner:
1. Tracking venv + models: *"lets wait for qc with this"*. They stay excluded until the rig QA (checklist 22.10 §A).
2. Companion: *"clean"*.
3. SSH host keys: *"yes and if there are no secrets and logins shiped. one exception, i think we should ship with the
   gdtf login … the login password itself are not real secrets."*
4. *"user and password of the server itself cant be secrets they need to be out in the open with a note to change them
   yourselfs with a small how to in terminal. user casparcg password highascg"*

### Investigation

- **SSH host keys ship as-is.** penguins-eggs `edit-live-fs.js` edits `sshd_config` (PasswordAuthentication) but never
  touches `/etc/ssh/ssh_host_*`. Neither the template nor the fragments exclude them, and no setup script regenerates
  them. So every clone would share this box's host identity (keys dated 07.06).
- **No users step in the installer.** The Calamares `sequence` (`/etc/calamares/settings.conf`) has no `users` page,
  and `removeuser` deletes only `live`. The installed system keeps the build box's `casparcg` account and password
  hash, so "casparcg / highascg" holds only if that is the build box's password at produce time.
  - The password was not tested from this session: an attempt to validate it with `sudo -S -v` was blocked by the
    permission classifier.
- **The live session account** is from `/etc/penguins-eggs.d/eggs.yaml`: `live` / `evolution`, root `evolution`,
  `ssh_pass: false`.
- **Shipped config holding secrets, after the factory reset.** `write-iso-default-config.js` deletes `config/*.json`
  (security, replication, tailscale and identity files go). It leaves:
  - `config/*.json.corrupt-*` (14 old copies from 04.09, including `security.json.corrupt-…`);
  - `config/casparcg.config.tmp`;
  - `config/certs/highascg-key.pem`, the HTTPS proxy's TLS private key with this box's IPs as SANs.
    `tools/runtime/highascg-https-proxy.js:55-61` regenerates it when it is missing.
- **Dotfiles that ship were scanned** for token / secret / password strings: `.bashrc`, `.profile`, `.xsession`,
  audio rc files, `/etc/environment`, `~/.config/{highascg,openbox,xfce4,Thunar,Blackmagic Design}`. None found.
  - `~/.gitconfig` holds only the `gh` credential helper (the token is in `~/.config/gh`, already excluded) and the
    owner's git identity.
- **Already excluded:** `~/.ssh`, `~/.config/gh`, `~/.config/syncthing`, Tailscale state, `.private/` (API token),
  `.env`, keyrings, `~/.claude*`.

### What was done

- **Both fragments:**
  - `gdtf-share.json` ships again; a comment records why;
  - excluded: `~/.config/companion`, `~/.gitconfig`, `config/certs/*`, `config/*.corrupt-*`, `config/*.tmp`,
    `etc/ssh/ssh_host_*`.
- **`systemd/ssh.service.d-05-host-keys.conf.example`** (`ExecStartPre=/usr/bin/ssh-keygen -A`) is installed by
  `prepare-eggs-clone-with-exfat.sh`. Each live boot and each install makes its own keys the first time sshd starts;
  `-A` creates only missing keys.
- **`prepare-eggs-clone-with-exfat.sh`** warns when `casparcg`'s hash is not `crypt("highascg")`. Perl's `crypt`
  handles the box's yescrypt `$y$` hashes (checked with a known salt).
- **`docs/DEFAULT_LOGINS.md`** (new):
  - the three logins in the open;
  - what does not ship;
  - `passwd` how-to;
  - the `curl` to set your own GDTF Share account;
  - notes for the ISO builder.
- **Links to it:** a "Default login" section in `README.md`, and step 5 in `docs/CALAMARES_INSTALL_TO_DISK.md`. Step 3
  there also now describes the WO-645 start-up window instead of the old autostart.
- **Smoke:** `gdtf-share.json` must ship; host keys, the TLS key, a `.corrupt` copy, the Companion DB and `.gitconfig`
  must not.
- **Squashfs verifier:** requires the host key, the TLS key and the Companion config to be absent.

### What was VERIFIED

- Smoke 39/0 (cases above, matched the mksquashfs way); `bash -n` on both scripts; perl yescrypt check.
- Not run: `eggs produce`, the prepare script (needs root), and sshd starting without keys. All three are proven on the
  next produce by the verifier and the checklist §D.

## Owner decisions (round 1, answered above)

1. **Tracking detection on fresh installs.** The venv (306 MB) and models (69 MB) under `~/.local/share/highascg` are
   still excluded. Without them, detection on a new box needs `tools/tracking-detect/setup-venv.sh` +
   `export-models.sh` (network). Ship them (+375 MB ISO), or keep provisioning by hand?
2. **`~/.config/companion`** (4.4 MB, the dev box's Companion database) ships with the Companion app. Starter buttons
   for every new box, or exclude for a clean Companion?
3. **SSH host keys:** not checked whether eggs regenerates `/etc/ssh/ssh_host_*` per install. If not, every clone
   shares host keys.

## Round 3 (22.10): round 2's Companion exclude failed the clone audit

### Investigation

- The owner's first produce stopped in `build-highascg-egg.sh` at the clone audit, before `eggs produce`:
  `Audit FAILED (1 error(s), 6 warning(s))`.
- Reproduced without root: a copy of `audit-eggs-clone-host.sh` run against a scratch `exclude.list` built from the
  template plus the same two merges that prepare does (embed-server `--replace`, then DeckLink). Same counts.
- The error: `exclude.list omits .config/companion but HIGHASCG_ISO_EMBED_COMPANION=1`. Round 2 excluded the whole
  `~/.config/companion`, and the HighAsCG module ships in that folder (`modules/highpass-highascg/main.js`), which
  `verify-iso-squashfs-excludes.sh` also requires. Had the build gone through, new boxes would have had Companion
  without the HighAsCG module.
- The "clean" part is `v5.0/` (`db.sqlite`: buttons and connections; `cache.sqlite`; `backups/`), plus `machid`, which
  is this box's id and Companion makes a new one. `modules/` (1.8 MB), `udev-rules/`, `surfaces/` and `README.txt`
  are not this box's state.

### What was done

- Both fragments: `home/casparcg/.config/companion{,/*}` → `.config/companion/v5.0{,/*}` + `.config/companion/machid`.
- `audit-eggs-clone-host.sh`: fails only when the folder itself, `/*`, or `modules/` is excluded. It no longer
  fires on any line under the folder.
- `verify-iso-squashfs-excludes.sh`: requires `v5.0` and `machid` absent, not the whole folder.
- Smoke: `v5.0/db.sqlite` and `machid` are excluded; `modules/highpass-highascg/main.js` ships.

### What was VERIFIED

- `smoke-eggs-exclude-lists.test.js` 39/0.
- Scratch merge + audit copy: `Audit passed (6 warning(s))`. The 6 warnings are the same non-fatal set as the owner's
  run: swap active but excluded, two bridge mounts, cuda-drivers, two IDE servers on the host.
- Negative case: appending `home/casparcg/.config/companion` still fails the audit.
- Not yet run: the owner's re-run of the build. The squashfs verifier checks the module after produce.

## Round 4 (22.10): first produce with these lists

### Investigation

- The ISO is `highascg-nvidia-595_amd64_2026-10-22_1832.iso`: 7058 MB, checksum OK. `verify-iso-squashfs-excludes.sh` passed,
  with one warning: the squashfs is 6516 MiB.
- Compared per directory against the Sep 3 squashfs (extracted with `xorriso -osirrox`):
  - +3254 MiB `home/casparcg/iso-backup`: the session's protective copy of the Sep 3 ISO. Eggs runs `rm -rf /home/eggs/mnt`
    at the start of produce, so the copy was moved out of the nest, into `/home/casparcg`. The embed clone takes all of home.
  - The rest (+745 MiB raw) is expected: the Godot binary (+140, this WO), `usr/lib/python3` +202, snapd +190, system
    libs +149, nmap.
- Contents confirmed in the squashfs:
  - the Godot binary, the hshm addon `godot/client/addons/hshm/bin/libhshm…so`, `bin/casparcg`, `node_modules`,
    `dist-web`;
  - Companion + `modules/highpass-highascg` (no `v5.0` DB, no `machid`);
  - the highascg + companion units enabled; the Openbox autostart launches Godot;
  - nvidia 595 dkms modules for 6.8.0-117; `BUILD_STAMP` 2026-10-22_182737;
  - factory `screen_destinations.json` = `videoOutput: shm`, `shmName: opgui`, no `guiUrl` (WO-684).
- `docs/` is excluded, so `docs/DEFAULT_LOGINS.md` does not ship. README.md (with its "Default login" section) does.
- Host after the build:
  - same boot; no mounts under /home/eggs; `/bin` and `/sbin` intact;
  - hostname back to `highascg7580`; swap and bridge mounts back; node restarted; Caspar and Godot running.
  - **Companion stayed stopped.** The squashfs step stops it, and nothing in the script started it again.
  - `config/replication-local-identity.json` was rewritten by root at 18:38 when the hostname was set back (0644 root).

### What was done

- Both fragments exclude `home/casparcg/iso-backup{,/*}` and `home/casparcg/*.iso`.
  The single `*` does not reach `highascg/config/casparcg.config.iso`.
- `verify-iso-squashfs-excludes.sh` fails on any `.iso` under `home/` except that config.
- `build-highascg-egg.sh` starts `companion.service` again after the remount step, when it is enabled.
- Smoke: the backup ISO and a stray `~/x.iso` are excluded; `casparcg.config.iso` is kept.

### What was VERIFIED

- Smoke 39/0.
- The new guard fails today's squashfs (it names `iso-backup/…1533.iso`) and passes the Sep 3 one.
- Scratch merge + audit copy still pass (6 warnings).

### Round 4 rebuild VERIFIED (22.10, `highascg-nvidia-595_amd64_2026-10-22_1924.iso`)

- 3684 MB ISO, checksum OK; squashfs 3300 MiB (9323 MiB raw).
- `verify-iso-squashfs-excludes.sh` passed with no warnings. That includes the new disk-image guard.
- Per-directory diff against the first build: the only change over 5 MiB is −3254 MiB `iso-backup`.
- Contents re-checked:
  - Godot + hshm addon, `bin/casparcg`, node_modules, dist-web, README;
  - Companion + module (no DB / machid), GDTF login, no SSH host keys;
  - all highascg / companion / casparcg-server units enabled;
  - nvidia 595 dkms for 6.8.0-117, Calamares;
  - factory operator destination = shm/opgui (WO-684); WO-683 `portaudio-output.js` present.
- Host: Companion restarted by the build itself (19:29:12; the round 4 fix). Hostname, swap, bridge mounts, node,
  Caspar, Godot and `/bin` / `/sbin` were all as before.
- `config/replication-local-identity.json` is root-owned again: root rewrites it when the hostname is set back.
  `highascg-fix-config-permissions.service` chowns `config/` at every boot.
- The rebuild ran in the same boot as the first produce, without the reboot the docs ask for. The bind-mount guard
  found nothing left behind, and the host came through intact.
