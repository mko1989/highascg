# WO-669 — ISO exclude review: the Godot GUI binary was excluded; credentials and dev leftovers now are

**Status: DONE in repo (22.10, list simulation + smoke 39/0 + test:ci 2752/0); proven on the next `eggs produce` by
`verify-iso-squashfs-excludes.sh`**

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

## Owner decisions (not done)

1. **Tracking detection on fresh installs.** The venv (306 MB) and models (69 MB) under `~/.local/share/highascg` are
   still excluded. Without them, detection on a new box needs `tools/tracking-detect/setup-venv.sh` +
   `export-models.sh` (network). Ship them (+375 MB ISO), or keep provisioning by hand?
2. **`~/.config/companion`** (4.4 MB, the dev box's Companion database) ships with the Companion app. Starter buttons
   for every new box, or exclude for a clean Companion?
3. **SSH host keys:** not checked whether eggs regenerates `/etc/ssh/ssh_host_*` per install. If not, every clone
   shares host keys.
