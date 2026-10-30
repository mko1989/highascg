# WO-870 — penguins-eggs 26.10 rewrite: `produce` is gone (`remaster`), theme/basename/max/calamares flags removed — migrate the ISO pipeline

**Area:** os-iso
**Status: IN PROGRESS (30.10) — Phases 0.2(b), 1, 2, 3, 4 done offline; dry runs 1-3 clean (owner, initrd verified); Phase 5 open; next: re-apply config, then the first full build (Phase 7); blocks the next ISO build**
**Source:** WO-832 owner host checks 30.10: `eggs produce --help` → `unknown command "produce"`; `eggs` is now v26.10.25, a Go/C rewrite; the verify also reports `missing /etc/calamares`.
**Related:** WO-832 (post-26.04 remnants; its "unverifiable here" note is resolved by this WO), WO-430 (merged-usr exclude twin lines), WO-431 (phantom dpkg entries / payload gates), WO-464 (liveroot bind-mount guard), WO-462 (torn-ISO copy race), WO-481/WO-475 (Calamares bridge release), WO-148 (installer branding), WO-168 / WO-429 (exclude fragments, credentials), WO-47 (exFAT).

Nothing was run except `--help`, `version`, reads of installed files, reads of the 26.10.x upstream source (GitHub, untrusted data kept under the scratchpad) and `dpkg-deb -I/-c/-x` on a downloaded package. No eggs command that mounts, builds or deletes was run; no code changed; no build.

## 0. Summary for the owner

1. **Every old flag has a new home, but not on the command line.** Only `--clone`, `--compression`, `--path`, `-t`, `--stop-after` survive. ISO name, compression level, live user/password, RAM entry and installer choice live in `/etc/penguins-eggs.d/custom.yaml`; exclusions in `/etc/penguins-eggs.d/custom.exclude.list`; boot menus/splash in `/etc/penguins-eggs.d/branding/`.
2. **The theme route is simpler than before and our theme already fits it.** Our `highascg-eggs-theme/theme/livecd/{grub.main.cfg,isolinux.main.cfg,*.theme.cfg,splash.png}` uses exactly the mustache dialect the new `generate-menus.sh` renders. Copy it to `/etc/penguins-eggs.d/branding/livecd/`. One trap: `{{{devicetree}}}` is not rendered any more (see 1.4-F3).
3. **Calamares is not baked on the build host any more.** `eggs sysinstall calamares` generates `/etc/penguins-eggs.d/installer.d/` on the *live* system at install time, wiping any prior tree. `/etc/calamares` is unused, so "missing /etc/calamares" is expected. Our branding and module overrides go in `/etc/penguins-eggs.d/branding/calamares/{branding,modules}`; our shellprocess patches and `shellprocess@release_bridge` can no longer be injected (fixed module sequence) — the launcher has to do that work.
4. **Hard blocker found that nobody asked about: the new disk-space pre-check will refuse this box.** It estimates the ISO from `statfs("/")` (849 GiB used, 730 GiB of it is `~/highascg/media`) and does not honour the excludes: predicted need ~263 GiB (xz) vs 40.9 GiB free → `Fatal: Not enough space`. No flag skips it (see 1.4-F1). Production-layout boxes (media on exFAT) pass; this dev box does not.
5. **Rollback exists, and it is not the old .deb.** The 26.6.2 `.deb` is gone (not in `/var/cache/apt/archives`, not on disk, 404 in the repo pool, apt source disabled). The same TypeScript tool is published as **`penguins-eggs-legacy` 26.9.29-1** in the same apt repo: binary `/usr/bin/eggs-legacy`, config `/etc/penguins-eggs-legacy.d/`, files under `/usr/lib/penguins-eggs-legacy`, no Conflicts with `penguins-eggs`. It installs alongside (details 1.6). Untested on 26.04 — treat as a fallback, not a guarantee.
6. Plan: version-gate the scripts (Phase 1), move config into repo-managed files that the build re-applies on every run (the package overwrites them on upgrade), then do a three-step `--stop-after` dry run starting with a run that is *predicted to stop at the space check before mounting anything*.

## 1. Investigation

### 1.1 What is installed (evidence)

```
$ eggs version                    -> [coa] eggs v26.10.25 - The "master" of remaster
$ readlink -f $(which eggs)       -> /usr/bin/coa      (21 MB Go binary; /usr/bin/oa = 70 KB C engine)
$ apt-cache policy penguins-eggs  -> Installed 26.10.25-1, Candidate 26.10.25-1, only source /var/lib/dpkg/status
$ dpkg.log                        -> 2026-06-07 install 26.6.2-1; 2026-10-25 15:01 upgrade 26.6.2-1 -> 26.10.25-1 (apt-get upgrade)
$ /etc/apt/sources.list.d/penguins-eggs-repos.list.disabled   (migration of the .list failed during the 26.04 upgrade; line is
   "deb [signed-by=/usr/share/keyrings/penguins-eggs-repos.gpg] https://penguins-eggs.net/repos/deb stable main")
$ upstream: v26.10.30 released today (packages 26.10.30-1 are in that repo)
```

The rewrite is the former `oa-tools` repo now living under the name `pieroproietti/penguins-eggs` (AGENTS.md there: "NOT a partial variant of the legacy TypeScript version"). The TypeScript line moved to `pieroproietti/penguins-eggs-legacy`.

Commands (`eggs --help`): `adapt coexist config destroy export kill mcp remaster sysinstall tools version wizard`. Sub-commands: `tools {build clean grub40 repo skel}`, `sysinstall {calamares krill}` (flags `--anonymous --coexist --fstype`), `coexist {init info install}`, `export {iso log pkg}`, `mcp {enable disable start status stop}`. `eggs remaster --help` flags: `--anonymous --clone --compression --crypted --debug --fdt --path (default /home/eggs) --stop-after -t/--target-dir -w/--wizard`. Full `--help` captures: scratchpad `wo870/help.txt`, `help2.txt`.

Files owned by the new package (`dpkg -L`): `/etc/penguins-eggs.d/{brain.d/,branding.default/,custom.yaml,custom.exclude.list,scripts/}`, `/usr/bin/{coa,oa}` (+ `eggs` symlink), completions, man pages, `/usr/share/penguins-eggs/spacemit`. **No conffiles, no postinst** — a later `dpkg -i`/`apt upgrade` silently overwrites `custom.yaml`, `custom.exclude.list`, `brain.d`, `scripts` (relevant to the plan, Phase 2).

Dead files from the old package, still on disk and read by nothing in the new tool: `/etc/penguins-eggs.d/eggs.yaml` (our theme path, `snapshot_basename: highascg-nvidia-595`, `vmlinuz: …6.8.0-117…`), `exclude.list` (0600), `exclude.list.d/`, `derivatives*.yaml`, `distros/noble/…` (WO-832 already pointed `fix-calamares-shellprocess.sh` at that now-orphaned tree), `init/`, `krill*`, `love.yaml` (contains `eggs produce --addons adapt`), `tools.yaml`, `yolk.yaml`, `README.md` (Jun 7). Also `/etc/sudoers.d/99-eggs-calamares` (legacy `eggs calamares --install` leftover).

### 1.2 How the new tool works (one page; source read: upstream `main` = v26.10.30, binary strings checked against the installed 26.10.25)

`eggs remaster` (Go, `coa`) = parser → planner → C engine `oa`:

1. **Parser** renders the *Brain* (`/etc/penguins-eggs.d/brain.d/base.yaml.tmpl` + `modules/debian/*.tmpl`, picked by `index.yaml` via os-release ID / ID_LIKE; Ubuntu → `debian`) into a step list, then overlays `settings.remaster` from `custom.yaml` (system file, then `~/.config/penguins-eggs/custom.yaml` of `SUDO_USER`; Viper; unknown keys ignored).
2. **Planner** writes `/tmp/coa/excludes.list`, runs the **disk-space check**, expands steps into `/tmp/coa/oa-plan.json`. `--stop-after <step-name>` drops every later step.
3. **`oa`** runs the plan; `bootstrap-liveroot.sh` (step 1 `mount-logic`) builds `/home/eggs/liveroot`: `cp -a /etc /boot` (physical copy), bind mounts of `/opt /root /srv` (symlinks recreated for `/bin /sbin /lib /lib64`), overlayfs for `/usr` and `/var`, `/proc /sys /dev /run`, tmpfs `/tmp`, and for `--clone` a **read-only non-recursive bind of `/home`**. Then, in order: `bootloader-copy`, `generate-efi.img`, `boot-assets`, `generate-boot-menus`, `inject-efi-grubcfg`, `identity` (skipped in clone), `sanitize-system-files`, `initramfs`, `copy-kernel-initrd`, `conf-live-sudoers`, `polkit-policy/-rules`, `create-live-launcher`, `trust-agent-*`, `autologin-gui`, `eggs-icon`, `mksquashfs`, `xorriso`.
4. **Teardown is automatic.** `oa` runs `perform_safety_teardown` (reads `/proc/mounts`, unmounts everything under `/home/eggs` deepest-first, blocking umount with EBUSY retries, lazy `MNT_DETACH` only as a last resort) after success, after a failed step, and after a `--stop-after` breakpoint (binary strings: "Handing over the area to the decontamination team", "Site successfully dismantled"). Upstream docs say `--stop-after` "leaves the chroot mounted"; the code says it unmounts — **verify with `findmnt` after the first dry run** (6.1).
5. `eggs destroy` (= `eggs kill`): `oa cleanup` first; **if that fails it refuses to remove anything** ("refusing to remove the workspace while mounts may still be attached"); only then `rm -rf /home/eggs` (the whole workspace, **including the finished ISO**, since it lives in `/home/eggs`), plus `/var/log/penguins-eggs.log`.

Layout: `/home/eggs/{liveroot,.overlay,isodir,<name>.iso}` (the old `mnt/iso`, `bin/mkisofs`, `ovarium` are gone). ISO volume id `OA_LIVE`; the EFI trampoline searches `--label OA_LIVE`. Boot files are `isodir/live/vmlinuz` and `live/initrd.img` (unversioned); EFI trampoline at `EFI/BOOT/grub.cfg` (old ISO: `EFI/ubuntu/`, `live/vmlinuz-6.8.0-117-generic`, volume id HIGHASCG; see `bsdtar -t` of `~/iso-backup/highascg-nvidia-595_amd64_2026-10-22_1924.iso`, squashfs 3.46 GB).

### 1.3 Feature map: old → new

| Old feature (`eggs produce …`) | New | Notes / evidence |
|---|---|---|
| `--theme <dir>` / `eggs.yaml theme:` (GRUB + isolinux + Calamares branding) | **No flag.** Drop-in dir `/etc/penguins-eggs.d/branding/` overrides `branding.default/` file by file: `livecd/{splash.png,grub.main.cfg,isolinux.main.cfg,grub.theme.cfg,isolinux.theme.cfg,unicode.pf2}`, `applications/install-system.desktop.tmpl`, `artwork/install-system.png`, `calamares/branding/*`, `calamares/modules/*.{yaml,conf}` | `base.yaml.tmpl` steps `boot-assets`, `create-live-launcher`, `eggs-icon`; `generate-menus.sh` (renders `grub.main.cfg` + `isolinux.main.cfg` only if **both** exist, else falls back to a generic menu); `branding-desc.go` |
| `--basename NAME` → `NAME_amd64_<date>.iso` | `custom.yaml`: `remaster: iso_prefix: NAME` → `NAME-<YYYY-MM-DD_HHMM>.iso` (`.img` on riscv64). Unset: `egg-of-<distro>-<codename>-<hostname>[-clone]-<arch>-<date>.iso`. Set by `eggs config` (TUI) or by writing the YAML | `remaster.go`, `distro.go GetISOName`. Separator changes `_amd64_` → `-`; no arch in the name. The hostname (`hostnamectl set-hostname highascg-nvidia-NNN` in `build-highascg-egg.sh`) is a separate matter: `src/engine/project-hardware-config.js:77` keys on that hostname, so keep it |
| `--max` | `custom.yaml`: `remaster.compression.algorithm: xz` (level ignored: 1M blocks, 1M dict, x86 BCJ) or one-off `--compression xz`. Default `zstd` level 3. No CLI level flag | `squashfs-args.go`; installed `custom.yaml` comment confirms. Squashfs is built with `-no-xattrs` (F6) |
| `--clone` | `--clone` (same name). Users and `/home` kept; `identity` step skipped; `/home` bound read-only into liveroot; polkit AUTH_ADMIN applies only via pkexec, `sudo` is fine. Mutually exclusive with `--crypted` | `generate-plan.go`, `bootstrap-liveroot.sh` |
| `--nointeractive` | Not needed: `remaster` is non-interactive unless `-w/--wizard` or `--crypted` (passphrase TUI; `EGGS_LUKS_PASSPHRASE` for automation). Do not pass `-i`/`-w` | `remaster.go` |
| `--excludes static` + `/etc/penguins-eggs.d/exclude.list` (+ our fragments merged into it) | Built-in dynamic list (Go, `create-exclude-list.go`) **+ `/etc/penguins-eggs.d/custom.exclude.list`** (lines trimmed, `#` full-line comments skipped, leading `/` stripped, **no inline-comment stripping**) → `/tmp/coa/excludes.list` → `mksquashfs -wildcards -ef`. `exclude.list`, `exclude.list.d/` ignored | Twin-line rule (WO-430) **still applies**: `bootstrap-liveroot.sh` recreates `/lib` etc. as symlinks, patterns are anchored at the liveroot, so `lib/…` matches nothing and needs a `usr/lib/…` twin. Built-in list already covers `dev proc sys run tmp var/tmp mnt media`, `etc/fstab`, `etc/machine-id`, `etc/ssh/ssh_host_*`, NetworkManager connections, `etc/resolv.conf`, `etc/X11/xorg.conf.d/20-{nvidia,intel,radeon,amd}.conf`, apt/pacman/dnf caches, `var/log/*` (except apache2/clamav/libvirt/journal/samba dirs), `boot/grub/!(themes|unicode.pf2)`, `boot/efi/EFI`, `boot/oa-initrd.img`, census files, and in non-clone `root/*`; in clone `home/*/.cache/*`, shell histories, trash etc. Not covered and still needed from the old template: `*.cache`, `lib/live/*`, `var/lib/live/config/*`, `home/*/.local/share/yay`, `etc/blkid.tab*`, `etc/fstab.d/*`, `persistence.conf`, `.snapshots/*`, `timeshift`, `var/backups/*`, `var/lib/dhcp/*`, `etc/skel/…` entries |
| Kernel: `eggs.yaml vmlinuz:/initrd_img:`, `/etc/highascg/pinned-kernel` | **Always the running kernel** (`uname -r` in the Debian module; if `/lib/modules/$(uname -r)` is missing in liveroot it falls back to the first entry of `/lib/modules`). The initrd is built fresh in the liveroot chroot (`mkinitramfs -o /boot/oa-initrd.img $(uname -r)`, honours our `/etc/initramfs-tools/{hooks,modules,conf.d}` because `/etc` is copied) and copied to `isodir/live/{vmlinuz,initrd.img}`. `eggs.yaml` is never read | `remaster.bash.tmpl`. The pin becomes an **assertion** (running kernel == pin), not a setting. The pin file is currently fine: `7.0.0-38-generic` = `uname -r` |
| `eggs calamares --install/--policies/--theme` + `/etc/calamares` baked on host + `force_installer` | Gone. Calamares only needs the `calamares` package on the build host (present: 3.3.14); `eggs remaster` just notes `HasCalamares` for the launcher (`Terminal=false`). On the live system `pkexec eggs sysinstall` → Calamares if present + display, else Krill TUI. `eggs sysinstall calamares` (live only, `IsLive()` else fatal) regenerates `/etc/penguins-eggs.d/installer.d/` from embedded assets + our overlay and runs `calamares -d -D 8 -c /etc/penguins-eggs.d/installer.d/`. `custom.yaml remaster.installer: calamares` makes `remaster` fatal if the package is missing | `sysinstall_calamares.go`, `setup/orchestrator.go` |
| `eggs kill` | `eggs destroy`/`eggs kill` (alias): `oa cleanup` then `rm -rf /home/eggs` and delete the log (see 1.2-5). The memory note "produce rm -rf's `mnt` + `liveroot`, umount errors ignored" is **no longer true for `remaster`**: `remaster` removes nothing; only `destroy` deletes, and it aborts if the unmount step failed. Lazy-detach success still counts as success, so the reboot-before-retry rule stays | `destroy.go`, `eternit.c` |
| `--path` / snapshot_dir | `--path` (default `/home/eggs`) = liveroot/overlay/isodir/ISO base; `-t/--target-dir` (or `remaster.target_dir`) moves `isodir` + ISO elsewhere and symlinks the ISO into `--path`. `destroy` only knows `custom.yaml remaster.work_dir`, not `--path` | |
| `--release`, `--addons`, `eggs dad`, `--standard` | Removed (`dad` is used by `work/setup-boot-branding-phase1.sh:83`, `--release/--standard` by the `unused/` script) | |
| Live user | `custom.yaml remaster.user/password` (default `live`/`evolution`) only in standard mode. In clone mode real users stay as on the host (casparcg) | `generate-plan.go`: "Mode 'clone': real users cloned from /home, skipping 'users' module" |
| Output location | `/home/eggs/<name>.iso` only (no `/home/eggs/mnt/`) | |
| Non-interactive census | Anonymous telemetry POST to penguins-eggs.net after a successful remaster. `--anonymous` or `custom.yaml anonymous: true` or `EGGS_ANONYMOUS=1` opts out | box is a shop machine: set it |

### 1.4 Findings that are not on the owner's list

**F1 — Disk-space pre-check refuses this box (hard blocker, predicted).** `RunRemasterFlight` runs `planner.CheckDiskSpace` before planning (so also with `--stop-after`/`--debug`; `isGitHubAction` skips it, but faking `/home/runner/work` also strips `usr var opt` from the ISO — never do that). It takes `statfs("/")` used space and subtracts an "excluded" estimate that **ignores every line containing `*` or `!`** and, for same-filesystem directories, sums only the directory *entries'* inode sizes (a few KiB). Measured on this box:

```
rootUsed 849.0 GiB (730 GiB = /home/casparcg/highascg/media on the root fs), avail 40.9 GiB
estimated ISO: xz 263 GiB | zstd 297 GiB | gzip 314 GiB | lz4 442 GiB ; same partition needs 2x
-> report.FreeSnapshotKiB < report.CompressedKiB  =>  utils.Fatal("Not enough space on /home/eggs: need 263 GiB, have 40.9 GiB")
```

The string "Not enough space on" is in the installed binary. Fails before any mount (safe), but it blocks the build. Options in 3.3 (Phase 0). The true squashfs input is ~10 GiB-class (old ISO squashfs 3.46 GB).

**F2 — Config files are overwritten by package upgrades and the old ones are dead.** See 1.1. All HighAsCG config for eggs must live in the repo and be re-applied (idempotently) by the build every time; verifiers must compare content, not just existence.

**F3 — `{{{devicetree}}}` is not rendered.** The new `generate-menus.sh` substitutes only `{{{fullname}}} {{{kernel}}} {{{vmlinuz}}} {{{initrdImg}}} {{{kernel_parameters}}} {{{rmModules}}}`. Our `grub.main.cfg` has `{{{devicetree}}}` in all four entries; it would land literally in `grub.cfg` as an unknown command and abort the entry when it is booted. Remove it (x86 only). `isolinux.main.cfg` has none.

**F4 — Kernel command line changes.** Old ISO (`bsdtar -xOf … boot/grub/grub.cfg`): `boot=live components locales=C.UTF-8 cow_spacesize=2G` + our extras, `linux /live/vmlinuz-6.8.0-117-generic`. New `{{{kernel_parameters}}}` = `boot=live components cow_spacesize=2G audit=0 splash quiet loglevel=3 systemd.show_status=auto udev.log_priority=3 locales=<host LANG>`, `linux /live/vmlinuz`. Our entries then append `nosplash loglevel=7 …` (last `loglevel` wins; `splash` + later `nosplash` both present — plymouth's initramfs script decides; **must be proven on glass**). Option if it misbehaves: write the literal `boot=live components cow_spacesize=2G …` into our own templates instead of `{{{kernel_parameters}}}`. The "RAM mode" entry is only generated by the fallback menu; our templates replace the menu so `ram_mode` is moot.

**F5 — Calamares model change.** Installer config is generated at install time and the module sequence is embedded (`welcome locale keyboard partition users summary` / `partition mount unpackfs removeuser machineid fstab locale keyboard localecfg users displaymanager shellprocess@live-cleanup shellprocess@krill-chroot-runner umount`). The distro `install:` steps from the Brain (`install-initramfs`, `install-bootloader`, `enable-network-services`) run inside `krill-chroot-runner`. Consequences: (a) our `shellprocess@{mkinitramfs,boot_reconfigure,boot_deploy,release_bridge,…}` patches in `fix-calamares-shellprocess.sh`/`patch-iso-squashfs-calamares.sh` and the squashfs unpack/repack are obsolete or must be redone as module-conf overlays; (b) `shellprocess@release_bridge` (WO-481) is not in the sequence — `launch-calamares.sh` already releases the bridge (WO-475) and must stay the only entry point; (c) the overlay `branding/calamares/modules/<name>.{yaml,conf}` is copied to `installer.d/modules/<name>.conf` after the generated ones, so our `locale.yaml partition.yaml users.yaml` map 1:1 and `shellprocess_live-cleanup.conf` can be replaced (copy the stock content and extend it); (d) branding name inside the tree is `eggs` (`branding: eggs`, `installer.d/branding/eggs/`), no longer `highascg-eggs-theme`; our `branding.desc` can be a `branding.desc.tmpl` (rendered with `ProductName` etc.) and the logo-name mismatch workaround (`fix-calamares-branding.sh`, `highascg-calamares-branding.service`) probably dies; (e) `eggs sysinstall calamares` refuses on a non-live system, so the "install-to-disk from an installed playout host" path of `launch-calamares.sh` (comment "live ISO or installed playout host") loses its engine; (f) upstream open issue #145 (extra `live` user after installing a remastered ISO) is the clone/Calamares interaction to watch.

**F6 — `mksquashfs -no-xattrs`.** File capabilities do not survive. On this box: `/usr/bin/ping cap_net_raw=ep`, `/usr/bin/wivrn-server cap_sys_nice=ep`, `/opt/magicq/bin/mqqt cap_net_raw=ep`. Check `ping` as casparcg on the stick (Ubuntu normally has `ping_group_range` set).

**F7 — Live sudoers.** Step `conf-live-sudoers` writes `/etc/sudoers.d/00-live` with `%sudo` and `%wheel` `NOPASSWD:ALL` into the ISO (removed only on install by `shellprocess@live-cleanup`). Hard-coded in the Brain; check the stick's sudo policy against WO-832/`12-passwordless-sudo.sh` expectations and decide (owner question, 5).

**F8 — Old nest remnants get swept in.** The clone binds all of `/home`. The built-in excludes cover `home/eggs/{.overlay,isodir,*.iso,liveroot}` but **not** `home/eggs/mnt`, `bin`, `ovarium`, `tmp` from old runs (an old `mnt/iso/live/filesystem.squashfs` would be packed into the new one). Add the single line `home/eggs` to `custom.exclude.list`. (Not inspected: I did not look under `/home/eggs`.)

**F9 — Bootloaders are downloaded at run time in 26.10.25.** `EnsureBootloaders` fetches `penguins-bootloaders v26.1.16 bootloaders.tar.gz` from GitHub into `/tmp/coa/bootloaders` (tmpfs, lost on reboot); installed `base.yaml.tmpl` still points at `/tmp/coa/bootloaders`. 26.10.30 bundles them in the package (`/usr/share/penguins-eggs/bootloaders`, diff vs installed base template is exactly those two lines) → offline, reproducible builds. Another reason to take 26.10.30 first. EFI loader is the monolithic `grubx64.efi` as `BOOTX64.EFI` — **Secure Boot behaviour unknown** (open question).

**F10 — `--debug` is not a no-op.** It runs after `mkdir -p /home/eggs/isodir/live` + `parent_id` writes, `EnsureBootloaders` (download), `GenerateExcludeList`, the space check and — as confirmed in `RunRemasterFlight` — only then prints the plan; this is why it was not run.

**F11 — Other items.** `autologin-gui` only touches sddm/lightdm/gdm/mdm/lxdm/slim/greetd; none installed here (nodm is not touched). `.disk/` metadata is generated. `work/setup-boot-branding-phase1.sh:83` `eggs dad -d` no longer exists; `:37-39` writes the apt source `penguins-eggs-repos.list` and installs "latest" (now the rewrite). Hostnames: keep the `hostnamectl set-hostname` step. The census opt-out should be in the managed `custom.yaml`.

### 1.5 What could not be verified without running eggs

Actual `--stop-after` mount/unmount behaviour on this box; exact stdout of the space check on 26.10.25 (inferred from source + binary strings + measured numbers); whether our theme renders as expected; Plymouth/NVIDIA in the new initrd; Secure Boot; `-no-xattrs` consequences; whether Calamares starts from the generated `installer.d` with our overlay and the clone's users.

### 1.6 Rollback / pinning

* **Old `.deb` 26.6.2-1:** not in `/var/cache/apt/archives`, `find / -name 'penguins-eggs*.deb'` empty, `apt-cache policy` shows only the installed version, the repo pool has no `penguins-eggs_26.6.*` (HTTP 404 for `penguins-eggs_26.6.2-1_amd64.deb`; pool holds `0.9.x` and `26.7.18…26.10.30` of the *rewrite*). Not recoverable.
* **`penguins-eggs-legacy` 26.9.29-1** (pool: 26.6.26, 26.6.27, 26.6.30, 26.7.17, 26.7.18, 26.7.29, 26.8.29, 26.9.29; also GitHub releases of `pieroproietti/penguins-eggs-legacy`). Downloaded and inspected (scratchpad `wo870/legacy-deb/`, sha256 `9feb0e51d84585b9c54e1f1005e8a2edce16ba709066dc0de4330eed7fe7557e`): `Conflicts: calamares-settings-debian, calamares-settings-ubuntu` only; ships `/usr/bin/eggs-legacy -> ../lib/penguins-eggs-legacy/bin/run.js`, its own theme tree under `/usr/lib/penguins-eggs-legacy/addons/eggs/theme`, config dir `/etc/penguins-eggs-legacy.d/` (created at first run; exclude list `/etc/penguins-eggs-legacy/exclude.list` is also referenced), `Depends` nodejs>=20, live-config-systemd, live-tools, isolinux, syslinux, pxelinux, ipxe, sshfs, jq, lvm2, … (several already present from the 26.6.2 install). Same CLI family as 26.6.2 (`produce --nointeractive --clone --max --basename --theme --excludes`) — **presumed**, check with `eggs-legacy produce --help` after install. Shares the `/home/eggs` nest with the new tool — never run both at once.
* **Last good artefact:** `~/iso-backup/highascg-nvidia-595_amd64_2026-10-22_1924.iso` (+ `.sha256`, 3.4 GB) and the 09-03 one. Also the baseline for diffing a new ISO (`bsdtar -t`, `unsquashfs -l`).
* **Hold:** after settling a version, `apt-mark hold penguins-eggs` so `apt upgrade` cannot swap the CLI or overwrite the managed config under a build.

## 2. Call-site map

`rg -n "eggs " tools scripts work/install-eggs-host-prereqs.sh` has 337 hits; below are the ones that execute eggs or depend on its layout/config. Pure comments/echo text that only says "eggs produce" (≈70 lines, e.g. `scripts/nvidia/disable-nvidia-multi-driver-boot.sh:3,34`, `tools/release/collect-third-party-licenses.sh:4`, `strip-host-swap-for-live-iso.sh:4-5`, `stop-and-unmount-wo47-for-eggs-produce.sh`, `tools/eggs/companion/prepare-companion-for-eggs-clone.sh`) just need renaming to "eggs remaster" in Phase 5; they are listed in 2.4. Paths are relative to `tools/eggs/live-usb/` unless stated.

### 2.1 Direct eggs invocations

| file:line | old call | new call / workaround |
|---|---|---|
| `build-highascg-egg.sh:169` | `eggs produce --nointeractive --clone --max --excludes static --basename "${BASENAME}" --theme "${THEME_ABS}"` | `eggs remaster --clone --anonymous` after the managed config is applied (`iso_prefix`=BASENAME, `compression.algorithm: xz`, branding dir, `custom.exclude.list`). Gate on `highascg_eggs_flavor` (Phase 1). `--max/--excludes/--nointeractive/--basename/--theme` must not be passed (cobra: unknown flag) |
| `work/run-eggs-produce-clone-only.sh:55-56` | same, with `--theme` | same wrapper function (do not duplicate the command; source the lib) |
| `prepare-eggs-clone-with-exfat.sh:211` | echo of the old command | print the new command |
| `install-eggs-live-grub-theme.sh:117-119` | echo "eggs produce ignores eggs.yaml theme unless --theme" | obsolete text; new text: branding dir |
| `merge-penguins-eggs-exclude-highascg.sh:6,122` | echo of `--excludes static` | new command |
| `install-eggs-calamares.sh:82` | `eggs calamares --policies --verbose --theme=…` | removed. Replace the whole script's job (see 3.3 Phase 4) |
| `install-eggs-calamares.sh:86` | `eggs calamares --install --verbose --theme=…` (installs packages, writes `/etc/calamares`, polkit) | `apt-get install calamares` (already installed 3.3.14) + install the overlay into `/etc/penguins-eggs.d/branding/calamares/`; polkit policy comes from the calamares package |
| `install-eggs-calamares.sh:150` | `eggs calamares --help` as CLI probe | `eggs sysinstall calamares --help` |
| `verify-calamares-installed.sh:83` | `eggs calamares --help` | `eggs sysinstall calamares --help` |
| `audit-eggs-clone-host.sh:217` | `eggs calamares --help` | same |
| `work/setup-boot-branding-phase1.sh:83` | `eggs dad -d` (create eggs.yaml) | delete; config is repo-managed. Lines 23-39/45-60 install "latest" penguins-eggs → pin the version / `apt-mark hold` |
| `tools/eggs/unused/prepare-eggs-minimal.sh:112` | `eggs produce --nointeractive --release --standard` | unused; delete or leave with a "legacy" header |
| `src/api/routes-system-setup.js:271` | error text "Run eggs calamares --install on the build host" | text only: "install the calamares package"; WO-721 smoke pins neighbouring text, repoint if needed |
| `tools/runtime/launch-calamares.sh:143` (text), `:186` `"${CALAMARES_BIN}" -d` | starts `calamares -d` with `/etc/calamares` | `eggs sysinstall calamares` (needs live system); keep bridge release/restore, display wait, `systemd-run` scope. Sudoers `scripts/setup/12-passwordless-sudo.sh:43` `NOPASSWD: /usr/bin/calamares -d` → add the `eggs sysinstall calamares` form (root already; the launcher runs as root) and `:65` comment |

### 2.2 Config / layout dependencies

| file:line | dependency | new equivalent / workaround |
|---|---|---|
| `install-eggs-live-grub-theme.sh:20,39-41,100-104,115` | reads/writes `/etc/penguins-eggs.d/eggs.yaml` `theme:` | rename role to "install branding": copy theme into `/etc/penguins-eggs.d/branding/`; drop yaml edits |
| `install-eggs-live-grub-theme.sh:77-79` | symlinks `theme/{applications,artwork}` → eggs theme dir (dangling since 26.10; WO-832) | copy (not symlink) `applications/` and `artwork/` into branding or omit (defaults apply) |
| `install-eggs-live-grub-theme.sh:95-97` | copies stock `calamares/modules/*.yaml` (the dir does not exist in `branding.default`) | drop; our `theme/calamares/modules/{locale,partition,users}.yaml` are the source |
| `eggs-theme-lib.sh` | finds the stock theme dir | keep (finds `branding.default`); add `highascg_eggs_branding_dir` = `/etc/penguins-eggs.d/branding` |
| `finalize-boot-branding-for-eggs-produce.sh:19,59-61,79` | asserts `eggs.yaml` `theme:` == ours | assert the files in `/etc/penguins-eggs.d/branding/livecd/` equal the repo theme (cmp) |
| `finalize-boot-branding-for-eggs-produce.sh:22,76` | resolves kernel, rebuilds host initramfs | keep resolve (assertion), host initramfs rebuild stays useful for the host only (the ISO initrd is built fresh) |
| `sync-eggs-kernel-and-purge-stale.sh:19-21,42-53` | rewrites `vmlinuz:`/`initrd_img:` in `eggs.yaml` | skip the yaml part under the new flavor; keep purge logic; add `uname -r == pin` hard assertion |
| `eggs-kernel-lib.sh:82` | WARN "running kernel is X; eggs ISO will use KVER" | becomes FAIL for the new flavor (ISO uses the running kernel) |
| `inject-iso-boot-branding.sh:19-21,54-62,160-168` | `eggs.yaml vmlinuz`, `/home/eggs/mnt/iso`, `/home/eggs/bin/mkisofs`, patches `-V highascg` | obsolete: no staging tree to patch, no mkisofs helper. Replace by `verify-` only; splash/theme/font come from the branding dir, initrd is built in the chroot. Keep `prepare-branding-assets.sh` |
| `ensure-iso-grub-gfx-theme.sh:8`, `patch-iso-grub-kernel-cmdline.sh:7,44-46` | patch `mnt/iso/boot/grub/grub.cfg`, `EFI/ubuntu/grub.cfg` | obsolete (the theme templates carry the preamble and cmdline); fold any missing preamble into `grub.main.cfg` |
| `patch-iso-squashfs-calamares.sh:20-21` | unpack/repack `mnt/iso/live/filesystem.squashfs` (≈15 min, xz) | delete from the flow (F5) |
| `fix-calamares-shellprocess.sh` (whole), `fix-calamares-branding.sh`, `calamares-l10n-helper.sh`, `calamares-logs-helper.sh` | patch `/etc/calamares/modules/*`, `/usr/libexec/calamares/*` | re-evaluate each patch against the generated modules (the mkinitramfs/boot_reconfigure patches target modules that no longer exist). Needed ones → module overlays in `branding/calamares/modules/` |
| `verify-calamares-installed.sh:44-61,118-140` | `/etc/calamares`, `…/branding/highascg-eggs-theme`, patched `shellprocess@mkinitramfs.conf`, helpers | check `branding/calamares/` overlay in `/etc/penguins-eggs.d/`; polkit policy; launcher; drop `/etc/calamares` and mkinitramfs checks |
| `verify-eggs-prepare-host.sh:21,123-124,129-134,145-156` | `EXCLUDE=/etc/penguins-eggs.d/exclude.list`; `eggs.yaml theme:`; `/etc/calamares` | `custom.exclude.list` content check; branding files check; calamares pkg only |
| `audit-eggs-clone-host.sh:19,47-70,95-96,136-145,166-174,198-203,259-266` | same exclude path and `grep` needles | point `EXCLUDE` at `custom.exclude.list` |
| `merge-penguins-eggs-exclude-highascg.sh:8-12,60-100` | target `exclude.list`, template fallback `exclude.list`, MARKER/`--replace` | target `custom.exclude.list`; do **not** seed from the old refractasnapshot template; generate: header + `home/eggs` + fragment(s) + twin lines; replace the whole file (file is ours) instead of marker blocks; strip inline comments |
| `prepare-eggs-clone-with-exfat.sh:73-74,86,89,177-188` | calls theme install, `install-eggs-calamares.sh`, grub packages, merge | same calls with the new meaning |
| `eggs-liveroot-safety.sh:19,83` | `/home/eggs/liveroot`; `pgrep -f 'eggs produce\|mksquashfs.*/home/eggs/liveroot'` | add `eggs remaster\|coa remaster\|oa /tmp/coa/oa-plan.json`; keep the bind-mount guard (WO-464) |
| `pre-produce-preflight.sh:24,30,61,67` | texts, runs `fix-calamares-shellprocess.sh` and `verify-calamares-installed.sh` | drop the calamares fixes; keep guard, WO-47 umount, swap strip, launcher refresh |
| `verify-iso-boot-branding.sh:51-54,92,106,132,202,225-256,291` | stock penguin splash cmp, `EFI/ubuntu/grub.cfg`, versioned `initrd.img-*`, `EGGS_ISO_WORK=/home/eggs/mnt/iso`, `etc/calamares/branding/highascg-eggs-theme/show.qml` | `EFI/BOOT/grub.cfg`, `live/initrd.img`, read from the ISO only, look for `…/branding/calamares/branding/show.qml` in squashfs or `etc/penguins-eggs.d/branding/…` |
| `verify-iso-squashfs-excludes.sh:8,272-295,342,394,426,445` | `mnt/iso/live/filesystem.squashfs` default, `etc/calamares/…`, `shellprocess@mkinitramfs`, `usr_N` duplicates | default `SQ` = path from the built ISO (extract) or `/home/eggs/isodir/live/filesystem.squashfs`; calamares needles → new paths. The DeckLink/secret/twin needles stay |
| `flash-stick-common.sh:16-35`, `build-produce-flash-stick.sh:31,82,108-110`, `build-highascg-egg.sh:259,266`, `recover-host-usr-from-eggs-artifact.sh:61-65`, `discover-recovery-sources.sh:6-11`, `preview-live-iso-qemu.sh:19`, `work/run-eggs-produce-clone-only.sh:93`, `legacy-persistence/build-flash-and-persist.sh` | glob `${BASENAME}_*.iso` / `highascg-nvidia-595_amd64_*.iso`, dirs `/home/eggs`, `/home/eggs/mnt` | accept `${BASENAME}-*.iso` and `${BASENAME}_*.iso` (both flavors), `/home/eggs` only for new; fix the nvidia branch literal 595 → detected |
| `create-operator-stick-from-dd.sh:59`, `verify-stick-iso.sh:15` | ISO under `/home/eggs/`; message mentions `linux /live/vmlinuz-*` | unchanged paths; text only |
| `install-initramfs-eggs-build-conf.sh`, `etc-initramfs-tools-hooks-highascg.sh`, `install-plymouth-nvidia-initramfs.sh`, `install-storage-drivers-for-iso.sh` | `/etc/initramfs-tools/*` on the host | keep: `/etc` is copied into liveroot and the initrd is built there |
| `write-iso-default-config.js`, `reset-iso-operator-config.sh`, `install-iso-defaults.sh` | bake factory config before clone | unchanged |
| `tools/startup/verify-live-stick.sh:46-48,137-141,190` | texts "rebuild ISO with eggs produce --theme"; `/etc/calamares/branding/highascg-eggs-theme` | update texts/paths; initrd glob already generic |
| `scripts/systemd/highascg-calamares-branding.service` + `install-eggs-calamares.sh:158-163` | boot-time logo repair for `/etc/calamares/branding/highascg-eggs-theme` | retire if the overlay path works; otherwise repoint |
| `.../verify-startup-on-host.sh`, `ensure-empty-live-usb-dirs.sh`, `strip-host-swap-for-live-iso.sh`, `stop-and-unmount-wo47-for-eggs-produce.sh` | pre-clone hygiene | keep (the `/home` bind is non-recursive so submounts are hidden anyway, but keep unmounts for the sync) |

### 2.3 Smoke tests that pin the old text (repoint, never weaken)

`tools/smoke/smoke-eggs-produce-build-stamp.test.js:31` (`startsWith('eggs produce ')`), `smoke-wo465-build-restores-dev-deps.test.js:37` (`at('eggs produce --nointeractive')`), `smoke-wo464-liveroot-guard-runs-first.test.js:40` (`'eggs produce --nointeractive'`), `smoke-eggs-exclude-lists.test.js` (merge script target/markers), `smoke-wo832-iso-remnants.test.js` (theme lib, 35 tests), `smoke-wo462-iso-copy-race-guard.test.js` (comment/glob), `smoke-wo721-install-to-disk.test.js` (`eggs calamares --help`), `smoke-wo429-iso-secrets-excluded.test.js`. Concat pattern for any new pins. Add the new test file to `tools/ci/offline-test-files.js`.

### 2.4 Text-only mentions (rename in Phase 5)

`scripts/boot/install-host-boot-branding.sh:13`, `scripts/exfat/highascg-exfat-remount-sync.sh:4`, `scripts/nvidia/disable-nvidia-multi-driver-boot.sh:3,34`, `tools/release/collect-third-party-licenses.sh:4`, `tools/eggs/companion/prepare-companion-for-eggs-clone.sh:3,34,66`, `strip-host-swap-for-live-iso.sh:4-5`, `stop-and-unmount-wo47-for-eggs-produce.sh`, `install-kernel-headers-for-dkms-iso.sh:47`, `install-grub-for-calamares-iso.sh:33`, `install-highascg-plymouth-theme.sh:2`, `install-iso-defaults.sh:2`, `reset-iso-operator-config.sh:3`, `write-iso-default-config.js:3`, `audit-eggs-clone-host.sh:126,128,298`, docs `BUILD_AND_FLASH.md`, `EGGS_EXCLUDE_LIST.md`, `branding/README.md`, `HOW_TO_BUILD_AND_FLASH_EGGS.md`, `EXFAT_DATA_ZERO_TOUCH.md`, `RECOVER_DESTROYED_USR.md`, `scripts/README.md`, `tools/README.md`, `MANUAL_INSTALL.md`.

## 3. Migration plan

Principles: no change to a script that the owner's current build depends on until the version gate exists; every new step has a check-only twin; nothing runs eggs without the liveroot guard; one remaster per boot stays the rule until teardown has been proven on this box.

### Phase 0 — Decisions and the space blocker (before any code)

* **0.1 Choose the engine.** Recommended: native `eggs remaster` as target, `penguins-eggs-legacy` as the fallback while the blockers below are open. Upgrade to **26.10.30** first (offline bootloaders, F9) and `apt-mark hold`.
* **0.2 Solve F1 (space check).** Options, in order of preference:
  (a) **Upstream**: file an issue/PR at `pieroproietti/penguins-eggs` ("space estimate ignores excludes; fatal on hosts where an excluded tree dominates root usage"; ask for `--skip-space-check` or a real excluded-size scan). Not in our control, no ETA.
  (b) **Local build with a one-line patch** (env `EGGS_SKIP_SPACE_CHECK` in `coa/pkg/cmd/remaster.go`), built with `eggs tools build` (needs Go ≥ 1.25 — not installed; `golang-go` candidate 2:1.26~1, gcc/make present), installed as `26.10.30+highascg1`, held. Maintenance cost on every upstream bump.
  (c) **Move the 730 GiB of media off the root filesystem** (separate disk/partition, mounted at `~/highascg/media`). Then `rootUsed` ≈ 119 GiB → xz estimate ≈ 37 GiB, but `SamePartition` doubles it (≈74 GiB) vs 40.9 GiB free → still fails unless `-t/--target-dir` points at another disk with ≥ 74 GiB (and `/home/eggs` ≥ 37 GiB). Only practical with a second disk.
  (d) Use the production-layout box (media on exFAT) for real builds; the dev box only for dry runs of the steps after the check — not possible, the check comes first.
  (e) Fall back to `eggs-legacy` on this box until (a)/(b).
  Owner decision needed (5.1).
* **0.3 Capture a baseline** of the last good ISO for diffing: `bsdtar -tf ~/iso-backup/…1924.iso > work/notes/iso-1924-files.txt`; `unsquashfs -ll` listing; kernel cmdline from `boot/grub/grub.cfg` (done above).

### Phase 1 — Adapt the scripts behind a version check

1. New `eggs-cli-lib.sh`: `highascg_eggs_flavor` prints `new` (`eggs --help` mentions `remaster`, or `readlink -f $(command -v eggs)` ends in `/coa`), `legacy` (`eggs-legacy` present and used via `EGGS_BIN=eggs-legacy`, or old `eggs` with `produce`), or `none`. `highascg_eggs_bin`, `highascg_eggs_conf_dir` (`/etc/penguins-eggs.d` vs `/etc/penguins-eggs-legacy.d`), `highascg_eggs_nest` (`/home/eggs`), `highascg_eggs_iso_glob BASENAME`. Cheap probe only (`--help`), never `produce`/`remaster` flags.
2. New `eggs-run-lib.sh`: `highascg_eggs_build_iso` — `new`: apply managed config (Phase 2) then `eggs remaster --clone --anonymous`; `legacy`: the old command with `eggs-legacy`. `build-highascg-egg.sh:169` and `work/run-eggs-produce-clone-only.sh` both call it. Add `set -o pipefail` aware exit handling and a trap that runs the bind-mount check after failure and prints "reboot, do not rm".
3. Kernel: under `new`, `sync-eggs-kernel-and-purge-stale.sh` skips yaml edits; `highascg_assert_pin_valid` + new `highascg_assert_running_is_pin` (hard FAIL); purge of non-pinned kernels kept (keeps `/boot`, `/usr/lib/modules` small).
4. Smokes updated in the same commits; new `smoke-wo870-eggs-flavor.test.js` with a stub `eggs` (cobra-style `unknown flag` for removed flags; asserts the new command line contains none of `--nointeractive --max --excludes --basename --theme`, and that the legacy line is unchanged).

### Phase 2 — Managed config (replaces `eggs.yaml`, `exclude.list`, `eggs dad`)

`install-eggs-config.sh` (new; idempotent; run by the build and by prepare; check-only twin `verify-eggs-config.sh`):

* `/etc/penguins-eggs.d/custom.yaml` generated from the repo, not edited by hand:
  ```yaml
  anonymous: true
  remaster:
    iso_prefix: highascg-nvidia-<BR>      # replaces --basename (BR from nvidia-branch.sh)
    compression: { algorithm: xz }        # replaces --max
    # installer: calamares                # only after the launcher route is proven (makes remaster fatal if calamares missing)
  ```
  Leave `user/password` at defaults (unused in clone). `ram_mode` is irrelevant with our menu templates.
* `/etc/penguins-eggs.d/custom.exclude.list` = generated: header, `home/eggs` (F8), the embed-server (or WO-47) fragment, the DeckLink fragment, the old-template items not covered by the built-ins (1.3), and **a twin `usr/…` line for every `lib/…` line** (WO-430; generate them mechanically and let `smoke-eggs-exclude-lists` assert the pairing). Inline comments stripped (the new parser does not). `merge-penguins-eggs-exclude-highascg.sh` becomes the generator (`--replace` semantics always).
* Re-apply on every build because package upgrades overwrite both files (F2); verifiers compare hash with the generated content.
* Branding (3.2) and Calamares overlay (3.3) are installed by the same script into `/etc/penguins-eggs.d/branding/`.
* Parity check once, after the first dry run: `/tmp/coa/excludes.list` vs the old effective list (`sort -u` both, `comm`) — every line of the old effective list must be present or deliberately dropped, listed in this WO.

### Phase 3 — Theme / branding route

* Source of truth stays `tools/eggs/live-usb/highascg-eggs-theme/theme/livecd/`; `install-eggs-live-grub-theme.sh` becomes "install branding": copy (never symlink) to `/etc/penguins-eggs.d/branding/livecd/`: `grub.main.cfg`, `isolinux.main.cfg`, `grub.theme.cfg`, `isolinux.theme.cfg`, `splash.png` (`splash.jpg` is not copied by `boot-assets`; our `isolinux.theme.cfg:38` and `grub.theme.cfg:7` reference `splash.png` — good), optionally `unicode.pf2` (else `/usr/share/grub/unicode.pf2`, 2.4 MB Unifont, is used and matches the theme's "GNU Unifont Regular 16"; the old ISO shipped a 4 KB `/boot/grub/font.pf2` — check text rendering).
* Remove `{{{devicetree}}}` (4 lines) from `grub.main.cfg` (F3). Both main cfgs must exist or the generic menu is generated and our theme silently ignored — the verifier must assert both.
* Decide `kernel_parameters` handling (F4) after the first menus are rendered in the dry run.
* The mustache placeholders `{{{vmlinuz}}}`/`{{{initrdImg}}}` now render `/live/vmlinuz` and `/live/initrd.img`.
* Plymouth/initrd: nothing to inject — `mkinitramfs` runs in the liveroot with our hooks; verify on the produced `live/initrd.img` (`lsinitramfs | grep -E 'plymouth|highascg|nvidia'`).
* `inject-iso-boot-branding.sh`, `ensure-iso-grub-gfx-theme.sh`, `patch-iso-grub-kernel-cmdline.sh` are retired from the new flow (kept for `legacy`).

### Phase 4 — Calamares route

* Build host: only the `calamares` package (present). `install-eggs-calamares.sh` shrinks to: assert package, install overlay `theme/calamares/branding/*` → `/etc/penguins-eggs.d/branding/calamares/branding/` (use `branding.desc.tmpl`; drop the stock `[1-7]-*.png` slides — `copyBrandingOverlay` merges over the default branding, so stock slide PNGs would remain unless `show.qml` no longer references them; check) and `theme/calamares/modules/*.yaml` → `…/branding/calamares/modules/`.
* Launcher: `launch-calamares.sh` calls `eggs sysinstall calamares` instead of `calamares -d`; the `--release-bridge` entry and the `restore_bridge` trap stay. Re-add the effect of `shellprocess@release_bridge` by launcher only (sequence is fixed). Test on the stick with the real bridge partition mounted (WO-481 scenario).
* Re-derive which `fix-calamares-shellprocess.sh` patches still matter (offline `check-language-support` / l10n and logs helpers, chroot PATH) by reading the *generated* `installer.d/modules` on the first stick (`/etc/penguins-eggs.d/installer.d/` after one launch) — decide per patch: overlay file, launcher pre-step, or drop.
* The WebUI "Install to disk" path (`routes-system-setup.js`, WO-721) still goes through `launch-calamares.sh`; its availability probe must stop checking `/etc/calamares`.
* Remove `/etc/sudoers.d/99-eggs-calamares` after reading it.

### Phase 5 — Verify scripts and names

Update per 2.2: `verify-eggs-prepare-host.sh` (flavor-aware: `new` checks branding files + `custom.yaml` + `custom.exclude.list` content + calamares package + `eggs sysinstall calamares --help`; `legacy` keeps today's checks), `audit-eggs-clone-host.sh`, `verify-calamares-installed.sh`, `verify-iso-boot-branding.sh` (reads only the ISO), `verify-iso-squashfs-excludes.sh` (path by flavor), `flash-stick-common.sh` globs, text-only renames (2.4), docs (`BUILD_AND_FLASH.md` etc.), `work/setup-boot-branding-phase1.sh`, `eggs-liveroot-safety.sh` pgrep. Also add new verifier assertions: `ISO volume id` accepted as `OA_LIVE` (or HIGHASCG), `EFI/BOOT/BOOTX64.EFI` present, `boot/grub/grub.cfg` has no `{{{`, `isolinux/isolinux.cfg` has no `{{{`, `live/vmlinuz` + `live/initrd.img` present and the kernel release inside equals the pin.

### Phase 6 — Dry run (cheap steps first, each one proving something)

Preconditions: reboot done after any earlier interrupted run; `findmnt -R /home/eggs` empty; managed config applied; the liveroot guard script passes; WO-47 volumes unmounted via `pre-produce-preflight.sh`; owner present (no pointer automation, no show).

1. **`sudo eggs remaster --clone --stop-after mount-logic`** — safe *today* because it is predicted to die at the disk-space check before anything is mounted (F1): side effects are `/home/eggs/isodir/{parent_id,live/}`, the bootloader fetch/extract, and `/tmp/coa/excludes.list` (mode 0644 — read it, it is the parity check input). Expected last lines: `Space estimate: … Estimated ISO: ~263 GiB … Fatal: Not enough space`. If it unexpectedly passes (e.g. after Phase 0), the run executes only the bootstrap step and tears down; then check `findmnt -R /home/eggs` is empty and `/usr/bin/bash` etc. intact. Why `mount-logic` is the right first breakpoint: it is the earliest step, it exercises exactly the part that once destroyed `/usr` (mounts + teardown) with seconds of work and no squashfs/initramfs.
2. **`--stop-after inject-efi-grubcfg`** (after Phase 0): bootstrap + bootloader copy + EFI image + boot assets + menus. Inspect `/home/eggs/isodir/boot/grub/grub.cfg`, `isolinux/isolinux.cfg`, `EFI/BOOT/grub.cfg`, `boot/grub/{theme.cfg,splash.png,font.pf2}`: our entries present, no `{{{`, correct `linux /live/vmlinuz …`. No kernel/initrd/squashfs yet; a few minutes.
3. **`--stop-after copy-kernel-initrd`**: adds `mkinitramfs` in the chroot (2–8 min). Inspect `isodir/live/{vmlinuz,initrd.img}`: `lsinitramfs`, plymouth theme, nvidia modules, `file vmlinuz` release == pin.
4. Full `eggs remaster --clone` only after 1-3 left `findmnt -R /home/eggs` empty each time. Do **not** use `eggs destroy` to "clean" between runs: it deletes the nest including a finished ISO; staging is overwritten anyway and `home/eggs` is excluded.

### Phase 7 — First real build and what to check on the stick

Build via `build-highascg-egg.sh` (new flavor; `HIGHASCG_ISO_EMBED_CALAMARES` stays on). Afterwards:

* ISO size and squashfs size vs 3.46 GB baseline (±10 %); `unsquashfs -ll` diff against the 1924 listing: nothing in `home/eggs`, no `media/` content, no `.private`, no SSH host keys, no `usr/lib/modules/*/updates/dkms/blackmagic*` (WO-430), no `/home/casparcg/.config` secrets (WO-429/168), `etc/penguins-eggs.d/custom.*` fine.
* Completion sidecar `.sha256` (WO-462) written after the ISO is final — the new flow never re-packs, so the sidecar can be written immediately after `remaster` returns and the "torn ISO" window disappears; keep the rule anyway.
* Stick boot (UEFI **and** BIOS, with and without Secure Boot on the actual target hardware): GRUB menu themed, default entry boots, Plymouth/`nosplash` behaviour (F4), NVIDIA 615 modeset, kiosk/openbox + nodm autologin as casparcg, `highascg.service`, Caspar, exFAT `HIGHASCGEXF` mount, bridge partition.
* Identity: hostname `highascg-nvidia-NNN` → the MAC-derived rename works (`project-hardware-config.js`), machine-id regenerated, SSH host keys regenerated, `getcap` list (F6), `sudo -l` as casparcg (F7), kernel `uname -r` == pin.
* Install to disk through the WebUI button → `launch-calamares.sh` → `eggs sysinstall calamares`: HighAsCG slideshow, bridge released, no extra `live` user (#145), installed system boots, `/etc/penguins-eggs.d/installer.d` residue.
* Post-build host state: `findmnt -R /home/eggs` empty, `casparcg-server`/companion restarted by the existing tail of `build-highascg-egg.sh`, `npm install --include=optional` restore.

## 4. Owner commands (sudo) — to be run by the owner, not by an agent

Nothing below was run. Order matters; stop after each block and report.

```bash
# A. Take eggs 26.10.30 from the official pool (verify the hash first; no apt source needed).
cd ~/Downloads
curl -fLO https://penguins-eggs.net/repos/deb/pool/main/penguins-eggs_26.10.30-1_amd64.deb
echo "dc29749e3d0c66876ca38b6018678cce0cfbf2929b7f930a21c4e64bea17d90f  penguins-eggs_26.10.30-1_amd64.deb" | sha256sum -c -
sudo apt install ./penguins-eggs_26.10.30-1_amd64.deb      # overwrites /etc/penguins-eggs.d/{custom.*,brain.d,scripts}: fine, nothing of ours lives there yet
sudo apt-mark hold penguins-eggs
eggs version                                               # expect v26.10.30
ls /usr/share/penguins-eggs/bootloaders | head             # expect ISOLINUX, grub/, syslinux/ (offline bootloaders)

# B. (Rollback option, only if the owner picks engine = legacy for now.) Install the TypeScript line alongside.
curl -fLO https://penguins-eggs.net/repos/deb/pool/main/penguins-eggs-legacy_26.9.29-1_amd64.deb
echo "9feb0e51d84585b9c54e1f1005e8a2edce16ba709066dc0de4330eed7fe7557e  penguins-eggs-legacy_26.9.29-1_amd64.deb" | sha256sum -c -
sudo apt install ./penguins-eggs-legacy_26.9.29-1_amd64.deb
eggs-legacy produce --help | grep -E -- '--(theme|basename|nointeractive|clone|max|excludes)'   # read-only; proves the flags exist
# Its config is /etc/penguins-eggs-legacy.d/ (copy eggs.yaml + exclude.list over from /etc/penguins-eggs.d/ once; adjust theme: path).

# C. Only if option 0.2(b) (local patched build) is chosen:
sudo apt install golang-go                                 # Go >= 1.25 needed; candidate is 2:1.26~1
# (build as casparcg, not root: `eggs tools build` refuses root; patch + build is a separate WO step)

# D. Clean the dead 24.04-era bits once the repo-managed config is in place (read first, then remove):
sudo cat /etc/sudoers.d/99-eggs-calamares
sudo rm -i /etc/sudoers.d/99-eggs-calamares
# Do NOT: rm -rf /home/eggs, umount -R under /home/eggs, eggs destroy before copying the ISO.

# E. Inspect (read-only) what old runs left in the nest, so the exclude decision is informed:
sudo du -xsh /home/eggs/* /home/eggs/.[a-z]* 2>/dev/null
findmnt -R /home/eggs || echo "no mounts under /home/eggs"

# F. Dry run 1 (predicted to stop at the disk-space check; nothing mounted). Run in a tmux, after `sudo bash …/pre-produce-preflight.sh`:
sudo eggs remaster --clone --anonymous --stop-after mount-logic
findmnt -R /home/eggs || echo "clean"                      # must print "clean"
cat /tmp/coa/excludes.list | wc -l                         # the merged exclude list (input for the parity check)
```

Dry runs 2 and 3 (`--stop-after inject-efi-grubcfg`, `--stop-after copy-kernel-initrd`) and the full build are only given to the owner after Phase 0-5 land; commands are in 3 / Phase 6.

## 5. Open questions

1. **Owner decision (blocker F1):** which of 0.2 (a)-(e)? Is the dev box expected to build production ISOs, or only the production-layout machine? Is a local patched `coa` acceptable?
2. 26.10.25 or 26.10.30 (recommended, bundled bootloaders)? OK to `apt-mark hold`?
3. Engine for the interim: install `penguins-eggs-legacy` (B) so a build is possible this week while the native route is finished? (Untested on 26.04.)
4. Secure Boot on target hardware: the new `BOOTX64.EFI` is a monolithic GRUB from `penguins-bootloaders`; the old ISO had `EFI/ubuntu` + `efi.img`. Do the shop machines need Secure Boot? (`mokutil --sb-state` on one.)
5. Live-session `sudoers` (`%sudo`/`%wheel NOPASSWD:ALL`, F7) is hard-coded by the Brain: acceptable on the stick, or should we carry a local Brain override (lost on upgrade) / patched build?
6. ISO volume id changes `HIGHASCG` → `OA_LIVE` (and the trampoline searches that label): any consumer (Ventoy entries, `verify-stick-iso.sh`, field docs) keyed on the old label?
7. Calamares: which of the `fix-calamares-shellprocess.sh` patches (offline `check-language-support`, logs helper, chroot PATH) are still needed with the generated modules? Needs one look at a generated `installer.d` on a stick. And: do we still need "install to disk from an installed playout host" (engine now refuses non-live)?
8. `-no-xattrs`: any capability we depend on besides `ping`? (`getcap -r /` on the box showed only ping, wivrn-server, magicq.)
9. `kernel_parameters` (F4): keep `{{{kernel_parameters}}}` with the extra `audit=0 splash quiet loglevel=3 …` or hard-code `boot=live components cow_spacesize=2G` in our templates? Decide after glass test.
10. Does the clone path (`/home` read-only bind) change anything for files written by `reset-iso-operator-config.sh` / `write-iso-default-config.js` (they run before; the squashfs reads the final state) — expected no, to be confirmed by the squashfs listing diff.
11. Census: `anonymous: true` is set by us; confirm the owner wants that default for shop builds.
12. Memory notes to update once verified: "eggs produce own rm points" (now `destroy` only), "eggs produce prunes node_modules" (our own `install-iso-defaults.sh`, unchanged), "eggs excludes vs merged-usr" (rule stays; target file renamed to `custom.exclude.list`).

## Owner decisions (30.10)

- **0.2 / Q1 space blocker:** "Need a fix for the eggs ignore so it won't take the media". Route (b), done properly: a
  local `coa` build whose space estimate subtracts the excluded trees (not a blind skip), offered upstream as a PR.
- **Q2:** 26.10.30, then `apt-mark hold`.
- Q3–Q12 are open until the first dry run.

### Phase 0.2(b) — patched coa (30.10)

**Investigation** (upstream `pieroproietti/penguins-eggs` tag `v26.10.30` = commit `0b5e7fa0c5ce94a57c11711c0b8ccc4c7b5b8447`, the same version string as the installed `eggs version` → `v26.10.30`; the Go code is `coa/`, module `coa`, built upstream as `cd coa && go build -ldflags "-X 'coa/pkg/cmd.AppVersion=…'" main.go` (`Makefile:36`; `go version -m /usr/bin/coa` shows the same flags, go1.25.0, CGO on)):

* `coa/pkg/cmd/remaster.go:301` writes the list (`GenerateExcludeList`), `:308-310` runs `planner.CheckDiskSpace` unless GitHub Actions, `:314` logs "Space estimate", `:332`/`:338` are the `Not enough space` / `same partition` fatals.
* `coa/pkg/planner/space-check.go:64` `CheckDiskSpace` = `statfs("/")` used − `estimateExcludedKiB` (`:136`). `:152` skips every line with `*` or `!`; `dirSizeKiB` (`:169`) sums only the directory's entry sizes on the root fs (`:191-203`), and for a directory on another fs subtracts that fs's whole used space (`:185`), which is not part of the root figure.
* The list is consumed by `coa/pkg/worker/mksquashfs.go:87,93` (`-wildcards -ef`). squashfs-tools 4.7.5 `mksquashfs.c`: `process_exclude_file` (5718: leading whitespace, `#`, one leading `\`), `add_exclude`/`add_path` (5635/5565: `/`-split components, `... ` = non-anchored), `excluded_match` (5663-5672: `fnmatch(FNM_PATHNAME|FNM_PERIOD|FNM_EXTMATCH)`, leaf match excludes the subtree). Built-in extglob lines: `create-exclude-list.go:99` `boot/grub/!(themes|unicode.pf2)`, `:160` `var/log/!(…)`.
* Our media line is `home/casparcg/highascg/media/*` (embed-server and WO-47 fragments), a `*` line, so it was never subtracted. Also: the **stock** `custom.exclude.list` (all that is installed today) does not exclude the media at all.

**What was done** (patch `scripts/eggs/patches/wo870-coa-space-estimate-honours-excludes.patch`, format-patch style like `caspar/patches/`; 4 files, +631/−50):

* `coa/pkg/planner/exclude-match.go` (new): the list parser with mksquashfs rules, and an fnmatch with `FNM_PATHNAME|FNM_PERIOD|FNM_EXTMATCH` semantics (`* ? [...] \` + `?() *() +() @() !()`, leading-dot rule, glibc quirks). `... ` lines are not subtracted (that keeps the estimate on the safe side and the scan bounded).
* `space-check.go`: `estimateExcludedKiB` → `measureExcludedKiB("/", list)`. It walks only the directories a pattern can still reach. Each excluded entry adds `st_blocks` of itself and its subtree (`lstat`, no symlink following, same `st_dev` only, hard links once, no descent below an excluded entry, so nested excludes count once). `SpaceReport.ExcludedScan` is added, and the existing line now reads `Excluded: N MiB (measured in 870ms)`.
* Tests in upstream style: `exclude-match_test.go`, which includes the built-in list's patterns and the glibc corner cases, and `space-check_test.go`, which uses temp trees for wildcards, extglob, the leading dot, a nested exclude, a hard link, a symlink, `/proc` as another fs, and the report line.
* `scripts/eggs/build-patched-coa.sh` reproduces the build. It clones the tag, refuses anything but the pinned commit, applies the patch, runs the planner tests, builds with the upstream flags as `v26.10.30+highascg1`, and checks the official deb's sha256. It then repacks the deb under fakeroot with only `usr/bin/coa` and `Version:` changed, verifies the file list, control and payload, and prints the owner commands. It never uses sudo. Pinned by `tools/smoke/smoke-wo870-coa-patch.test.js`, which is curated in `tools/ci/offline-test-files-3.js`.

**Verified**

* Go: `go vet` clean; `go test ./pkg/planner/` 8/8 (2 upstream + 6 new). Matcher vs glibc 2.43 `fnmatch(3)` (C helper, same flags): 0 differences on 244,480 pairs (4,480 curated, 240,000 random fuzz).
* The patch applies to a pristine `git archive` of the tag and reproduces the tree exactly. The build script ran end to end twice (11 s); `coa version` → `[coa] eggs v26.10.30+highascg1`; module deps are identical to the official binary.
* Measured on this box, read-only, by calling `planner.GenerateExcludeList` (clone mode, list written to the scratchpad) + `planner.CheckDiskSpace` in-process. The harness ran as casparcg, so root-only dirs are unreadable and count as kept. The 5-6 `home/eggs…` lines were not walked (the nest is untouched). Both caveats only make the numbers larger. Root used 849.6 GiB, free 40.2 GiB, same partition (needs 2× ISO):

  | exclude list | old excluded → ISO (xz) | new excluded → ISO (xz / zstd) | 2× ISO vs 40.2 GiB |
  |---|---|---|---|
  | today (built-ins + stock `custom.exclude.list`, 112 lines) | 8.0 GiB → 260.9 GiB | 18.2 GiB → 257.7 / 291.0 GiB | FAIL (no media line) |
  | Phase 2 (+ `home/eggs` + embed-server + DeckLink fragments, 382 lines) | 50.2 GiB → 247.8 GiB | 811.2 GiB → **11.9 / 13.4 GiB** | **PASS** (23.8 / 26.9 GiB) |

  Scan time 0.87 s (Phase 2 list; 0.05 s for today's list). The 11.9 GiB estimate is still above the real squashfs class (old ISO 3.46 GB), since the 31 % factor is generic.
* **Consequence:** the patch alone does not unblock the dry run. `/etc/penguins-eggs.d/custom.exclude.list` must carry the media line first. That means Phase 2's generated list, or at minimum `home/eggs` and `home/casparcg/highascg/media/*`.
* Not verified: an actual `eggs remaster` with the patched binary (owner dry run F, after install); the scan as root on the full list including `/home/eggs`; the upstream PR (not filed).

**Owner install** (artefact `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo870/pkg/penguins-eggs_26.10.30+highascg1_amd64.deb`, sha256 `cce86e3ce91d42158cd2d48555ba3283ba1e9fe2efa1ffd3df01eb7775e21d15`. That path is in `/tmp`, so install before a reboot or rebuild with `bash scripts/eggs/build-patched-coa.sh`, which prints the same block for its own output dir):

```bash
cd /tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo870/pkg
sha256sum -c penguins-eggs_26.10.30+highascg1_amd64.deb.sha256
sudo apt-mark unhold penguins-eggs
sudo apt install ./penguins-eggs_26.10.30+highascg1_amd64.deb
sudo apt-mark hold penguins-eggs
eggs version        # expect: [coa] eggs v26.10.30+highascg1 - The "master" of remaster
```

### Phase 2 — managed exclude list + custom.yaml (30.10)

**Investigation**

* Installed today (read-only): `/etc/penguins-eggs.d/custom.exclude.list` is the stock 25-line file (docker/containerd, podman/lxc/lxd/machines, snapd; no media line, no `home/eggs`); `/etc/penguins-eggs.d/custom.yaml` is all comments except `remaster.compression.algorithm: "zstd"`, `level: 3`. Both are world-readable, so a non-root verifier works.
* The coa parser keeps inline comments (only whole-line `#` is skipped) and the liveroot has `/lib /bin /sbin /lib64` as symlinks into `usr/`, so anchored `lib/…` lines need `usr/lib/…` twins (WO-430, 1.3 table). Our fragments mix both: `penguins-eggs-exclude-decklink.list` already carries hand-written twins, the old template items (`lib/live/*`) do not.
* The branch logic for `iso_prefix` is `build-highascg-egg.sh:22-40` (`HIGHASCG_NVIDIA_DRIVER`, else `highascg_installed_nvidia_branch` from `scripts/lib/nvidia-branch.sh`; currently driver 615.71.09 → `highascg-nvidia-615`).
* The embed-server fragment is the default ISO mode (`HIGHASCG_ISO_EMBED_SERVER` defaults to 1 in `prepare-eggs-clone-with-exfat.sh:50`); its media line is `penguins-eggs-exclude-highascg-embed-server.list:76` `home/casparcg/highascg/media/*`. `merge-penguins-eggs-exclude-highascg.sh` appends to the legacy `exclude.list` and is left untouched for the legacy engine path; the new route does not use it.

**What was done** (all under `tools/eggs/live-usb/` unless noted)

* `generate-eggs-config.js` (new, 152 lines, pure function of the repo): `exclude [--embed 0|1]` and `yaml --branch NNN` on stdout; also `require()`able (`buildExcludeList`, `buildCustomYaml`). Output order: header (generated / do not edit / source files), stock list, old-template items, `home/eggs` (F8), embed-server fragment (or the WO-47 fragment with `--embed 0`), DeckLink fragment. Inline comments stripped (`cleanLine`, `:34`), leading `/` stripped, duplicates dropped in first-seen order, and `usr/` twin inserted right after every `lib|lib32|lib64|libx32|bin|sbin` line (`MERGED_USR_RE`, `:31`). Section comments are whole-line only. `home/eggs/*` was not added: `home/eggs` as a directory pattern excludes the subtree (mksquashfs leaf match), which is what the F8 text asks for ("the single line `home/eggs`").
* Vendored fragments (new): `penguins-eggs-exclude-stock-custom.list` (verbatim copy of the installed stock file, so the output never depends on `/etc`) and `penguins-eggs-exclude-old-template.list` (the 1.3 "not covered by the built-ins" items: `*.cache lib/live/* var/lib/live/config/* persistence.conf etc/blkid.tab{,.old} etc/fstab.d/* home/*/.local/share/yay .snapshots/* timeshift var/backups/* var/lib/dhcp/* etc/skel/{.config/Code,.local/share/baloo/*,.ZAP/*}`).
* `custom.yaml`: `anonymous: true`, `remaster.iso_prefix: highascg-nvidia-<BR>`, `remaster.compression.algorithm: "xz"`; the stock `level: 3` is kept with a comment (zstd-only, ignored by xz); `installer: calamares` stays a comment (not enabled); user/password untouched.
* `install-eggs-config.sh` (new): default `--out DIR` writes both files (no root). `--apply` installs into `${EGGS_CONF_DIR:-/etc/penguins-eggs.d}`; a file whose bytes already match is left alone (`cmp -s`, `:82`), a differing one is copied to `<file>.bak-<timestamp>` first (`:87`), then `install -m 0644`. Refuses with a message if the directory is not writable. Branch via `--branch`/`HIGHASCG_NVIDIA_DRIVER`/detection; `--embed`/`HIGHASCG_ISO_EMBED_SERVER`.
* `verify-eggs-config.sh` (new, check-only): regenerates via `install-eggs-config.sh --out`, compares sha256 per file (`:20`, `:27`), prints `PASS|FAIL <file>: <reason>`, exit 1 on any mismatch.
* `tools/smoke/smoke-wo870-eggs-config.test.js` (new, 13 tests) + one appended line in `tools/ci/offline-test-files-3.js`.
* Not done here (later phases): wiring the install script into `build-highascg-egg.sh`/`prepare` (Phase 1 `eggs-run-lib.sh`), branding install (Phase 3), the one-time parity check `/tmp/coa/excludes.list` vs old effective list (needs the first dry run).

**Verified**

* `node --test tools/smoke/smoke-wo870-eggs-config.test.js`: 13/13. `node --test tools/smoke/smoke-eggs-exclude-lists.test.js`: 39/39 (unchanged, fragments untouched). `node tools/ci/check-max-file-lines.js`: 0 files over 500. `bash -n` on both scripts clean (also a test).
* Output: 306 lines, 291 patterns, deterministic (two runs `cmp` equal), contains `home/casparcg/highascg/media/*`, `home/eggs`, 0 inline comments.
* Measure harness (scratch copy of `measure/main.go` taking a list file; as casparcg, read-only; built-ins + generated list): Phase 2 row **excluded 811.3 GiB, xz ISO estimate 11.9 GiB (need 23.8 GiB vs 40.1 GiB free) PASS; zstd 13.4 GiB (26.9) PASS**; scan 0.60 s. Reference row was 811.2 / 11.9 / PASS; the +0.1 GiB comes from the 15 extra lines below plus normal drift of the live box (rootUsed 849.6 → 849.7 GiB). "Today" row unchanged (18.3 GiB, FAIL as before).
* Diff vs `measure/excludes.phase2.list` (set compare after cleaning): generated list has 291 unique patterns, the reference 373. Reference-only: 97, all of them Go built-ins (coa adds them itself, so they are intentionally not in the managed file). Generated-only: 15 = the old-template items (`*.cache`, `lib/live/*` + its twin `usr/lib/live/*`, `var/lib/live/config/*`, `persistence.conf`, `etc/blkid.tab`, `etc/blkid.tab.old`, `etc/fstab.d/*`, `home/*/.local/share/yay`, `.snapshots/*`, `timeshift`, `var/backups/*`, `etc/skel/.config/Code`, `etc/skel/.local/share/baloo/*`, `etc/skel/.ZAP/*`). Everything else (stock, `home/eggs`, embed-server, DeckLink) is identical; no twin was missing from the DeckLink/embed fragments except `usr/lib/live/*`.
* Scratch `--apply` (`EGGS_CONF_DIR` in the scratchpad): first run installed both files and backed up the pre-existing yaml; second run printed `unchanged:` for both and made no backup; `verify-eggs-config.sh` there: PASS/PASS; with `--embed 0`: FAIL exclude list (291 vs 288 patterns), PASS yaml.
* Verifier against the real `/etc` (expected FAIL, not applied yet):

  ```
  FAIL custom.exclude.list: installed list has no home/casparcg/highascg/media/* line; sha256 564d4258cd13 != 6c4c8e84c36e
  FAIL custom.yaml: differs from generated (installed file has no iso_prefix); sha256 7402b7a52660 != 28f0ac631d02
  ```
* Not verified: an actual `eggs remaster` reading the file (owner dry run F); the scan as root including `/home/eggs`. (Source-checked on tag v26.10.30: top-level `anonymous` is `Settings.Anonymous`, `coa/pkg/parser/types.go:46`, merged at `parser.go:241` and read by `census/census.go:32` `cfg.Anonymous || cfg.Remaster.Anonymous`.) Old-template items are an addition beyond the three fragments the harness used; drop `penguins-eggs-exclude-old-template.list` from `SOURCES` if the parity check shows a problem.

**Owner commands (apply and check)**

```bash
cd ~/highascg
sudo bash tools/eggs/live-usb/install-eggs-config.sh --apply     # backs up the old custom.* with a timestamp
bash tools/eggs/live-usb/verify-eggs-config.sh                   # expect PASS PASS
```

### Phase 1 — version-gated scripts (30.10)

**Investigation**

* Two call sites ran eggs: `build-highascg-egg.sh:169` and `work/run-eggs-produce-clone-only.sh:55-56` (both `eggs produce --nointeractive --clone --max --excludes static --basename … --theme …`). Both would die on the installed coa with cobra's unknown-flag/unknown-command error. Behind them, the post-produce steps of the build script (`patch-iso-squashfs-calamares.sh`, `inject-iso-boot-branding.sh`, `verify-iso-squashfs-excludes.sh`, `verify-iso-boot-branding.sh`) and the clone-only wrapper's inject/verify all work on the legacy nest layout (`/home/eggs/mnt/iso`, mkisofs helper, `/etc/calamares`), which `remaster` does not create (1.2, 2.2).
* `sync-eggs-kernel-and-purge-stale.sh` demanded `eggs.yaml` and rewrote `vmlinuz:`/`initrd_img:`; coa never reads it (1.3, kernel row), and `eggs-kernel-lib.sh` only WARNed when the selected kernel was not the running one, though the new tool always ships the running kernel.
* Smokes pinning the moved text: `smoke-eggs-produce-build-stamp.test.js:31`, `smoke-wo465-build-restores-dev-deps.test.js:37`, `smoke-wo464-liveroot-guard-runs-first.test.js:40` (all keyed on the literal `eggs produce` line), and `smoke-wo832-iso-remnants.test.js` host() (its sync tests exercise the `eggs.yaml` route and would flip to the new route on this box, where the real eggs is coa).
* Flavor probe facts: `readlink -f /usr/bin/eggs` is `/usr/bin/coa`; the new `--help` command list has `remaster`, the old one `produce`; `eggs-legacy` is a different binary name. So the probe needs no eggs invocation at all for the installed case.

**What was done** (all under `tools/eggs/live-usb/` unless noted)

* `eggs-cli-lib.sh` (new, 94 lines): `highascg_eggs_bin` (`HIGHASCG_EGGS_BIN`, then `EGGS_BIN`, then `eggs`, then `eggs-legacy`; prints the resolved path), `highascg_eggs_flavor` → `new|legacy|none` (`:30`; `HIGHASCG_EGGS_FLAVOR` forces it; a realpath ending in `/coa` is `new` without running anything; a binary named `eggs-legacy` is `legacy`; anything else is asked `--help` only and classified by its command list; unknown output is `none`), `highascg_eggs_conf_dir` (`:67`; `EGGS_CONF_DIR` wins, `/etc/penguins-eggs-legacy.d` only for the `eggs-legacy` binary, since an old `eggs` keeps `/etc/penguins-eggs.d`), `highascg_eggs_nest` (`:82`), `highascg_eggs_iso_glob BASENAME` (`:88`; `BASENAME-*.iso` new, `BASENAME_*.iso` legacy, both lines for none).
* `eggs-run-lib.sh` (new, 104 lines): `highascg_eggs_build_argv` builds the argv (new: `remaster --clone --anonymous` [+ `--stop-after $HIGHASCG_EGGS_STOP_AFTER`], `:31`; legacy: today's line verbatim, `:41`; `STOP_AFTER` under legacy is refused with rc 2 rather than silently running a full build). `highascg_eggs_build_iso BASENAME THEME` (`:61`) under `new` first runs `install-eggs-config.sh --apply` and `verify-eggs-config.sh` (a failure of either stops before eggs; seams `HIGHASCG_EGGS_INSTALL_CONFIG`/`HIGHASCG_EGGS_VERIFY_CONFIG`), prints the command line, then runs it with `pipefail` forced on (restored after) so an optional `HIGHASCG_EGGS_LOG` tee does not mask eggs' status. An INT/TERM trap (`:88`) and any non-zero exit call `highascg_eggs_failure_report` (`:47`), which lists mounts under the nest and, if there are any, prints "reboot, do not rm" (otherwise "no mounts left"). The nest check filters `findmnt -rn` by prefix (like `eggs-liveroot-safety.sh`) and prints `findmnt -R` as the listing. BASENAME and THEME are not passed on the new route (they live in `custom.yaml` `iso_prefix` and the branding dir); a mismatch with `HIGHASCG_NVIDIA_DRIVER` warns.
* `build-highascg-egg.sh`: sources the run lib next to the liveroot guard (`:48-52`), calls `highascg_eggs_build_iso "${BASENAME}" "${THEME_ABS}"` at `:174`; the calamares squashfs patch, `inject-iso-boot-branding.sh`, `verify-iso-squashfs-excludes.sh` and `verify-iso-boot-branding.sh` run only for `legacy` and print a skip/WARN line otherwise (they target the legacy nest; ports are Phases 3-5, so under `new` the ISO is built but NOT branding-verified, said loudly).
* `work/run-eggs-produce-clone-only.sh`: same call via the lib (`:69`), exports `HIGHASCG_NVIDIA_DRIVER` only when `/etc/highascg/nvidia-iso-driver` exists (the config generator needs a real branch, not the 595 fallback), inject/verify only for `legacy`.
* `eggs-kernel-lib.sh`: new `highascg_assert_running_is_pin` (`:43`; pin file present and != `uname -r` is a hard FAIL with the owner fix, no pin file passes); `highascg_resolve_eggs_kernel` turns the "running kernel is X; ISO will use Y" WARN into an error under `new` (`:102`). `highascg_assert_pin_valid` and the purge refusals are unchanged.
* `sync-eggs-kernel-and-purge-stale.sh`: under `new` it does not require or touch `eggs.yaml`, runs `highascg_assert_pin_valid` + `highascg_assert_running_is_pin` before anything else, and keeps the purge logic (`:19-35`, yaml block now `else`-branch of the flavor test).
* Smokes: `smoke-wo870-eggs-flavor.test.js` (new, 25 tests; one line appended to `tools/ci/offline-test-files-3.js`). Repointed, assertions unchanged in strength: build-stamp (`startsWith('highascg_eggs_build_iso ')`), wo465 and wo464 (`highascg_eggs_build_iso "${BASENAME}"` is the "eggs ISO step" marker), wo832 `host()` env gets `HIGHASCG_EGGS_FLAVOR: 'legacy'` so its legacy-route cases stay legacy-route cases.
* Why a flavor lib rather than `if`s in each script: every later phase (verify, audit, flash globs, 2.2) needs the same answer; the probe is cheap and overridable. Why `HIGHASCG_EGGS_FLAVOR`: tests and the owner can pin a flavor without PATH tricks.

**Verified**

* `node --test tools/smoke/smoke-wo870-eggs-flavor.test.js`: 25/25. They run bash with `PATH=<stub dir>:<temp dir of tool symlinks>` (the real `/usr/bin/eggs` is unreachable) and assert `command -v eggs` is the stub first. The stub is cobra-like: `Error: unknown flag: --max` (and the other four) on `remaster`, `unknown command "remaster"` for the legacy stub. Covered: flavor new/legacy/none/odd-help, coa-symlink without execution, `EGGS_BIN=eggs-legacy`, conf dir/nest/globs; new argv exactly `remaster --clone --anonymous`, none of `--nointeractive --max --excludes --basename --theme`; order install, verify, eggs; `--stop-after mount-logic` passthrough; failed verify stops before eggs; exit 7 survives the tee log with "reboot, do not rm" when the findmnt stub reports mounts, and no such advice when clear; none refuses; legacy argv equals the original line text and does not apply the config; `STOP_AFTER` refused on legacy; the legacy literal appears once in the lib; both call sites contain no direct eggs line or removed flag; kernel assertion (pass/fail/no pin) and the sync script under `new` (no `eggs.yaml` created, old image purged, running kernel never) and under `legacy` (still needs `eggs.yaml`).
* `node --test` on the touched smokes (wo832, wo462, wo464, wo465, wo724, build-stamp, eggs-exclude-lists): all pass. `bash -n` clean on all 6 edited scripts and both new libs. `node tools/ci/check-max-file-lines.js`: 0 over 500. `node tools/ci/run-offline-tests.js`: 4919 tests, 4914 pass, 0 fail, 5 skipped.
* Real probe (read-only, sourcing the lib against the installed eggs): `highascg_eggs_bin` → `/usr/bin/eggs`, `highascg_eggs_flavor` → `new` (via `readlink -f` → `/usr/bin/coa`, no eggs process started), conf dir `/etc/penguins-eggs.d`, nest `/home/eggs`, glob `highascg-nvidia-615-*.iso`.
* Not verified: any actual `eggs remaster` run (owner dry run F); the scripts themselves (`build-highascg-egg.sh`, clone-only wrapper, sync script against real apt) were not executed, only unit-sourced with stubs and the sync script with mocked dpkg/apt/uname; the INT/TERM trap path with a real signal; `legacy` against a real `eggs-legacy` (not installed).
* Left for later phases: `flash-stick-common.sh` `find_latest_iso` still globs `_*.iso`, so the end-of-build sidecar/"Done. ISO:" lookup will not find a new-flavor ISO until the Phase 5 glob change (use `highascg_eggs_iso_glob`); `eggs-liveroot-safety.sh` `eggs_liveroot_produce_in_progress` pgrep does not yet match `eggs remaster`/`oa-plan.json`; `pre-produce-preflight.sh` still runs the calamares fixes.

### Phase 6 — dry run 1 (30.10, run by the owner)

Commands: §4 F after `install-eggs-config.sh --apply` (backups `custom.*.bak-20261030-185336`), `verify-eggs-config.sh` PASS/PASS,
`pre-produce-preflight.sh`, then `sudo eggs remaster --clone --anonymous --stop-after mount-logic` in tmux.
Copies of `/tmp/coa/{excludes.list,oa-plan.json}` are in `scratchpad/wo870dry/`.

**Result.**
- **Space check passed:** root used 870326 MiB, excluded 848125 MiB (841 ms), estimated ISO 6882 MiB, 39.91 GiB free.
  The check needs about 2× the ISO size, roughly 13.4 GiB.
- **Run:** one task ("Bootstrap ambiente liveroot", `bootstrap-liveroot.sh /home/eggs false clone …`), then the
  breakpoint.
- **Teardown happens at a `--stop-after` breakpoint**, against the upstream docs: `[eternit] … Found 16 mount points in
  /home/eggs` → "Area secured", "Successes: 1, Errors: 0". Afterwards `findmnt -R /home/eggs` printed `clean`, so §1.2
  item 4 is settled. `/home/eggs/liveroot` is left as a 425 MiB plain directory (the `cp -a /etc /boot` copies), with
  no mounts.

**Plan settings** (`oa-plan.json`): user `live` / `evolution` (unused in clone, §1.3), installer `krill` (calamares waits for
Phase 4), xz level 3, `iso_prefix highascg-nvidia-615`. These are as generated.

**The merged list.**
- 388 unique lines: all 291 of ours (0 missing) plus coa's built-ins.
- Built-ins worth knowing:
  - `etc/X11/xorg.conf` and `etc/X11/xorg.conf.d/20-{amd,intel,nvidia,radeon}.conf` (the box has no xorg.conf;
    our `99-highascg-force-composition.conf` is not matched);
  - `etc/NetworkManager/system-connections/*`, `etc/fstab`, `etc/machine-id`, `var/lib/apt/lists/*`,
    `var/log/!(…)`, `media`, `mnt`, `home/*/.cache/*`, `root/.bash_history`.
- The patterns are anchored at `/` (`exclude-match.go`, mksquashfs `-wildcards` semantics), so the stock-fragment line
  `*.cache` only matches top-level names.

**Why the estimate beats the Phase 2 harness (12184 → 6882 MiB).**
- The harness left the `home/eggs` lines out of its walk on purpose. The nest is not empty: `/home/eggs/mnt` is 17 GiB,
  holding the last ISO `highascg-nvidia-595_amd64_2026-10-23_1946.iso` (3.6 GiB, sha256 `551ff7ec…`) and an old
  `squashfs-calamares-patch-root`.
- Reproduced with the patched estimator on the real list (`scratchpad/wo870dry/est`): 847943 MiB excluded with the
  nest lines, 830766 MiB without.
- Both agree with coa and the harness within live drift, so the estimate is right and the harness was conservative.

**Not done.** `/etc/sudoers.d/99-eggs-calamares` is still present: §4 D's `rm -i` prompt got an empty answer, which means no.
Its content is `live ALL=(ALL) SETENV: NOPASSWD: /usr/bin/calamares`.

**Before the first full build (Phase 7).** Copy the Oct 23 ISO out of `/home/eggs/mnt` (only the Sept 3 ISO is in
`~/iso-backup`). *Done 30.10 after dry run 2:* copied with its sidecar to `~/iso-backup/`, `sha256sum -c` OK
(`551ff7ec…`). `home/casparcg/iso-backup` is in the merged list (`/tmp/coa/excludes.list:346`), so the backups stay out of
the squashfs. Free space on `/` afterwards is 33 GiB, against about 13.4 GiB needed. Legacy eggs `rm -rf`'d `mnt`/`liveroot` on produce. Whether `remaster` does too is unverified.


### Phase 6 — dry run 2 (30.10, run by the owner)

Command: `sudo eggs remaster --clone --anonymous --stop-after inject-efi-grubcfg`. Ran on the patched coa with the Phase 2
config applied, before Phase 3, so the menus are the generic ones. That gives the baseline for Phase 3.

**Result.**
- Six tasks ran: bootstrap, `bootloader-copy`, `generate-efi.img`, `boot-assets`, `generate-boot-menus` and
  `inject-efi-grubcfg`. The log ends "Successes: 6, Errors: 0" and "Breakpoint reached and environment safely
  unmounted". Teardown again found 16 mounts, and `findmnt` under `/home/eggs` lists 0 afterwards.
- `/home/eggs/isodir` holds 73 files (19 MiB). `EFI/BOOT/{BOOTX64.EFI,efi.img,grub.cfg}`; `mdir` of `efi.img` shows
  `::/EFI/BOOT/BOOTX64.EFI` and the injected `grub.cfg`. The trampoline is `search --set=root --label OA_LIVE`,
  `set prefix=($root)/boot/grub`, `configfile`. `boot/grub/{grub.cfg,splash.png (640x480 stock),font.pf2}`, where
  `font.pf2` is byte-identical to `/usr/share/grub/unicode.pf2` ("GNU Unifont Regular 16", what our `grub.theme.cfg`
  names). `isolinux/` has `isolinux.bin`, `isohdpfx.bin`, `vesamenu.c32` and the rest of the `.c32` set.
- The generic menu has 0 `{{{` and the kernel line is `linux /live/vmlinuz boot=live components cow_spacesize=2G audit=0
  splash quiet loglevel=3 systemd.show_status=auto udev.log_priority=3 locales=C.UTF-8`, as F4 predicted.
  `set default=2` sits behind two dummy header entries.
- `/etc/sudoers.d/99-eggs-calamares` is gone. `/etc/sudoers.d` mtime is 19:15, and the owner's later `rm -i` answered "No such file".

**How coa picks the branding** (read from the box, `/etc/penguins-eggs.d/scripts/generate-menus.sh` and the
`boot-assets` command in `/tmp/coa/oa-plan.json`):
- `generate-menus.sh` uses `/etc/penguins-eggs.d/branding/livecd/` when that directory exists, else
  `branding.default/livecd/`. It renders our templates only when **both** `grub.main.cfg` and `isolinux.main.cfg` are
  there; otherwise it writes the generic menu.
- `boot-assets` falls back to `branding.default` for everything (`splash.png`, `grub.theme.cfg` → `boot/grub/theme.cfg`,
  `isolinux.theme.cfg`) unless `branding/livecd/splash.png` exists.
- The Calamares overlay (`pkg/sysinstall/setup/branding-desc.go`) applies only when `branding/calamares[/branding]`
  exists, so a livecd-only `branding/` leaves the installer alone.
- F4 answered from `/usr/share/initramfs-tools/scripts/init-premount/plymouth`: it loops over `/proc/cmdline` and
  the **last** `splash*` / `nosplash*` token wins. So `{{{kernel_parameters}}}`' `splash` is overridden by a later
  `nosplash`. The kernel's `loglevel=` and systemd's `systemd.show_status=` are also last-wins.

### Phase 3 — branding route (30.10)

**What was done**
- `theme/livecd/grub.main.cfg`:
  - removed the 4 `{{{devicetree}}}` lines (F3);
  - the Text Mode entry gets `nosplash`, because `{{{kernel_parameters}}}` now carries `splash` and the entry
    would otherwise start plymouth where the old ISO did not;
  - a comment explains the last-token rule.
  - Live (`… nosplash loglevel=7`), Plymouth and Safe Mode keep their old behaviour without edits. The legacy engine
    reads the same file; the change is a no-op there.
- `install-eggs-config.sh`:
  - also writes `branding/livecd/{grub.main.cfg,isolinux.main.cfg,grub.theme.cfg,isolinux.theme.cfg,splash.png}`,
    copied from `highascg-eggs-theme/theme/livecd/`;
  - `--apply` installs them with `install -D` and the same unchanged/backup rule as `custom.*`;
  - `{{{fullname}}}` is filled in as `HIGHASCG NVIDIA <branch>`. coa renders it from the build host's os-release
    (`Ubuntu 26.04.1 LTS`), while the Sept ISO's menus read `HIGHASCG NVIDIA 595 Live`.
  - Why the managed-config script and not `install-eggs-live-grub-theme.sh`: the build already runs
    install + verify before every eggs call (Phase 1 `eggs-run-lib.sh`), so a package upgrade or a missing file can't
    silently drop the theme. The old script stays for the legacy flavor.
- `verify-eggs-config.sh` compares every file the generator writes (`find` over its `--out` dir), with a
  branding-specific FAIL reason.
- `smoke-wo870-eggs-config.test.js` grows from 13 to 16 tests:
  - `--out` writes the 5 files: the theme ones byte-equal to the repo, `*.main.cfg` with only `{{{fullname}}}` filled;
  - verify PASSes them, then FAILs when `splash.png` is missing;
  - all 5 theme files exist;
  - the templates use only the placeholders `generate-menus.sh` renders;
  - per GRUB entry, the plymouth last-token rule applied to the rendered cmdline gives
    Live off / Plymouth on / Safe on / Text off, and Live stays `loglevel=7`.

**Verified**
- `node --test tools/smoke/smoke-wo870-eggs-config.test.js`: 16/16. The flavor, wo832 and exclude-lists smokes: 99/99.
- Mutation: with the HEAD `grub.main.cfg` the suite fails 2 tests, "`{{{devicetree}}}` is not rendered" and
  `'Text Mode': true`.
- **Render on coa's own script.** I copied the box's `generate-menus.sh` with only its branding path changed (`diff`
  shows nothing else), then ran it on `install-eggs-config.sh --out` output with the plan's real args
  (`"boot=live components cow_spacesize=2G" 1`):
  - it printed "Menu di branding generati con successo";
  - 0 `{{{` in `grub.cfg` and `isolinux.cfg`;
  - entries read `HIGHASCG NVIDIA 615 Live / Live (Plymouth splash) / Safe Mode / Text Mode / Boot from local disk`;
  - `linux /live/vmlinuz …`, `initrd /live/initrd.img`;
  - `grub-script-check` OK.
- `verify-eggs-config.sh` against the real `/etc`: PASS `custom.*`, FAIL ×5 `branding/livecd/*` missing (expected,
  not applied yet).

**Not verified (owner run / stick)**
- Dry run 3 with the branding applied: themed `boot/grub/theme.cfg` + 1920×1080 splash in `isodir`.
- The menus on glass, UEFI and BIOS. `isolinux.theme.cfg` puts the 1920×1080 `splash.png` behind `vesamenu`, as the
  old ISO did; whether vesamenu shows it at that size is a Phase 7 stick check.

### Phase 6 — dry run 3 (30.10, run by the owner)

Run after `install-eggs-config.sh --apply` (`verify-eggs-config.sh`: 7× PASS, incl. `branding/livecd/*`):
`sudo eggs remaster --clone --anonymous --stop-after copy-kernel-initrd`.

**Result.**
- 9/9 tasks, "Successes: 9, Errors: 0". Teardown found 17 mounts, and 0 are left under `/home/eggs`.
- `mkinitramfs` ran in the liveroot chroot for `7.0.0-38-generic`, which equals `uname -r` and `/etc/highascg/pinned-kernel`.
  Two messages are chroot noise, not failures: `cryptsetup: ERROR: Couldn't resolve device overlay` (the cryptsetup hook
  cannot map the liveroot's overlay root to a block device) and systemd's "fstab has been modified" hint.
- `isodir/live/{vmlinuz (17.3 MB), initrd.img (206 MB)}`, both mode 0600 root. The Oct 23 ISO had
  `initrd.img-6.8.0-117-generic` at 183 MB and `vmlinuz` at 15 MB, and the file names are now unversioned as planned.
- **Theme on the real run:** `boot/grub/theme.cfg` and `isolinux/isolinux.theme.cfg` are byte-equal to the repo,
  `splash.png` is ours (1920×1080), and `grub.cfg` has `set theme=/boot/grub/theme.cfg`. Entries read `HIGHASCG NVIDIA 615
  Live / Live (Plymouth splash) / Safe Mode / Text Mode / Boot from local disk`. 0 `{{{` in either menu,
  `grub-script-check` OK, `efi.img` still carries the trampoline.

**Calamares, clarified for the owner** (asked 30.10):
- 26.10 still uses Calamares. What went away is the build-time handling: the `produce` flags and the `/etc/calamares`
  patching in the squashfs.
- The ISO ships the `calamares` package. On the stick, `eggs sysinstall calamares` generates the config and starts it.
- The plan's `installer: krill` default stays until Phase 4 points `launch-calamares.sh` at it (F5).

**initrd, verified from the owner's listing** (`file` + `lsinitramfs`, 30.10, 2742 entries):
- `vmlinuz` is `7.0.0-38-generic`, the same as the pin.
- Plymouth: theme `highascg`, and `default.plymouth` points at it (`Theme=highascg`).
- NVIDIA: `nvidia`, `nvidia-modeset`, `nvidia-drm` and `nvidia-uvm` (`.ko.zst`) plus `firmware/nvidia/615.71.09/gsp_*.bin`.
- Live boot: `overlay`, `exfat` and `isofs` are modules; `squashfs` and `loop` are built into the kernel
  (`CONFIG_SQUASHFS=y`, `BLK_DEV_LOOP=y`).
- Our files: `conf/conf.d/highascg-live-iso-build.conf`, `etc/modprobe.d/highascg-nvidia-plymouth.conf`,
  `highascg-storage-block.conf` and the 99-highascg udev rules.

Dry run 3 is clean end to end; nothing is open from it.

### Phase 4 — Calamares route (30.10)

**Investigation** (coa 26.10.30 source, `pkg/sysinstall/setup/*`, `pkg/cmd/sysinstall_calamares.go`):
- **Preconditions.** `eggs sysinstall calamares` needs root and `utils.IsLive()`, meaning one of `/run/live/medium`,
  `/lib/live/mount/medium`, `/run/archiso/bootmnt`, `/run/miso/bootmnt` or `/run/initramfs/live` must exist. It also needs
  the live squashfs. Otherwise it fails with "can only be run on a live system".
- **What it does.** `BuildInstaller` wipes `/etc/penguins-eggs.d/installer.d` and extracts the stock tree. That tree has a
  **fixed** `settings.conf` exec sequence: `partition mount unpackfs removeuser machineid fstab locale keyboard localecfg
  users displaymanager shellprocess@live-cleanup shellprocess@krill-chroot-runner umount`. Then:
  - `brandingDesc` copies `branding.default/calamares/branding` into `installer.d/branding/eggs` and renders the stock
    `branding.desc.tmpl`.
  - It copies the **vendor overlay** `/etc/penguins-eggs.d/branding/calamares/branding` over that (`copyBrandingOverlay`
    skips `modules/`), and renders the vendor `branding.desc.tmpl` with Go `text/template` (`BrandingConfig`: ProductName …
    ReleaseNotesUrl).
  - It writes the module confs.
  - `calamaresModulesOverlay` copies `…/branding/calamares/modules/*.yaml|.conf` **over whole files**. It runs after
    `partitionConf`/`userConf`.
  - It runs `calamares -d -D 8 -c /etc/penguins-eggs.d/installer.d/` and waits; the log is `/var/log/calamares-install.log`.
- **Census.** Sent after the install unless `--anonymous`, `EGGS_ANONYMOUS=1` or custom.yaml `anonymous` is set.
- **Bootloader and initramfs.** These moved out of Calamares into the brain's `krill-chroot-runner`
  (`install.bash.tmpl`):
  - `update-initramfs -u -k all`;
  - EFI: `grub-install --target=x86_64-efi` with the removable fallback (shim if present);
  - BIOS: `grub-install --target=i386-pc "$TARGET_DISK"`;
  - then `update-grub`.

  The host has `grub-pc 2.14-2ubuntu2.1`, `/usr/lib/grub/{i386-pc,x86_64-efi}`, `shim-signed` and
  `grub-efi-amd64-signed`, so the clone carries both targets.
- **Branding dir name.** It is always `eggs`, so `componentName` must be `eggs`. Our theme's `branding.desc` is a
  stub (`# this is only a stub`) and must not ship. The Oct 23 ISO's shipped desc (read from its squashfs) had
  `componentName: highascg-eggs-theme`, our logo/welcome/`show.qml`, Ubuntu URLs and "HIGHASCG NVIDIA 595".
- **`remaster.installer: calamares`** in custom.yaml (`Remaster.Installer`, remaster.go:142) only makes remaster fatal
  when the calamares binary is missing. The brain's `HasCalamares` launcher is independent of it.

**Old patches, decided one by one:**
- **`shellprocess@release_bridge`** (WO-481): the sequence is fixed and cannot take a new step, so the bridge is
  released by the launcher only. *Residual risk:* the brain's own `install-system.desktop` (`pkexec eggs sysinstall`)
  bypasses the launcher. Our live session is the HighAsCG GUI, not a desktop, so the Web/Godot button is the path in
  practice.
- **mkinitramfs / boot_deploy / boot_reconfigure / before_bootloader (grub-pc) / bootloader.conf paths**: dropped.
  Those modules are not in the sequence; the brain does it (above).
- **l10n helper / install_translations / logs helper**: dropped, because neither is in the new sequence.
  `nomodeset`: dropped; `update-grub` uses the clone's `/etc/default/grub`.
- **Module overlays** (`theme/calamares/modules/{locale,partition,users}.yaml`): **not shipped**. They would replace coa's
  generated `partition.conf` (efi block, partitionLayout, table type) and `users.conf` (password rules, hostname,
  sudoers group) as whole files. `locale.yaml` only moved the default zone from Rome to Madrid, which was never an owner
  choice.
- The fix scripts stay for the legacy flavor; under `new`, the preflight no longer runs them.

**What was done:**
- `theme/calamares/branding/branding.desc.tmpl` (new):
  - `componentName: eggs`, our logo/welcome/`show.qml`, the stock sidebar colours;
  - strings `HIGHASCG NVIDIA @BRANCH@` and the GitHub repo URLs;
  - `bootloaderEntryName` from `{{ .BootloaderEntryName }}`.
- `install-eggs-config.sh` installs the overlay `branding/calamares/branding/{branding.desc.tmpl, show.qml,
  highascg-eggs-theme-logo.png, highascg-mascot.png, welcome.png}` and fills `@BRANCH@`.
  - `verify-eggs-config.sh` covers it through its generated-file loop; the header and FAIL reason were updated.
  - The stock `[1-7]-*.png` slides stay in the merged dir, but our `show.qml` references none of them.
- `generate-eggs-config.js`: `remaster.installer: calamares`.
- `launch-calamares.sh`:
  - `eggs_sysinstall()` is true when `/usr/bin/eggs` resolves to `coa`; `HIGHASCG_EGGS_FLAVOR` overrides it.
  - `is_live()` checks coa's IsLive dirs (`HIGHASCG_LIVE_DIRS` for tests).
  - The overlay is checked instead of `/etc/calamares` (`branding.desc.tmpl`).
  - `--check` adds the live test.
  - Off a live session the launcher exits before anything is stopped.
  - The launch runs `eggs sysinstall calamares --anonymous` inside the unchanged stop → release → installer → restore
    envelope. The legacy `calamares -d` branch is kept.
- `routes-system-setup.js`:
  - status gains `liveOnly` (eggs is coa and no live dir), and `binary` reads `… sysinstall calamares`;
  - launch answers 409 "Install to disk runs from the live stick …" before the sudo spawn;
  - the stale "eggs calamares --install" advice is gone.
- `nuclear_pane.gd`: the button is disabled on `liveOnly`, with the reason on screen.
- Made flavor-aware:
  - `verify-calamares-installed.sh` (new: overlay, `eggs sysinstall calamares --help`, launcher has `sysinstall
    calamares`; legacy-only: `/etc/calamares`, cleanup.sh, mkinitramfs, l10n/logs);
  - `pre-produce-preflight.sh` (no fix-calamares-shellprocess under new; the WO-481 launcher refresh stays);
  - `install-eggs-calamares.sh` (new: apt package if missing, `install-eggs-config.sh --apply`, then verify; the legacy
    sync never copies the `.tmpl`).
- `12-passwordless-sudo.sh`: comment only, no new rule. The launcher already runs as root.

**Verified (offline, 30.10):**
- The template was rendered with Go's real `text/template` (the same `BrandingConfig` shape). Parsed as YAML:
  `componentName eggs`, our images, `productName HIGHASCG NVIDIA 615`.
- Launcher `--check` with `HIGHASCG_EGGS_FLAVOR=new`: live dir + overlay → 0; no live dir → 1 "not a live session"; logo
  removed → 1. On the box itself (coa, installed system) → 1, as intended.
- `GET` status on the box: `liveOnly: true`, `binary: /usr/bin/eggs sysinstall calamares`.
- The verifier, run against the box with the root gate stripped (scratch copy):
  - OK: calamares binary, dpkg, polkit, `eggs sysinstall calamares --help`, launcher `--release-bridge`, sudo rule;
  - FAIL as expected until the owner re-applies: the overlay is not installed yet, and `/usr/local/bin/launch-calamares.sh`
    predates WO-870 (the preflight refreshes it).
- Smokes:
  - new `smoke-wo870-calamares-sysinstall.test.js` (11, curated): overlay, Go field names, `--out` content, no modules
    dir, launcher envelope order + live guard before the stop loop, `--check` executed, route 409 + `liveOnly` with
    stubs, Godot text;
  - the WO-870 config smoke now pins `installer: calamares` under `remaster:`;
  - the WO-475/481, WO-423 and WO-721 smokes pass unchanged.
- Godot `run_tests.gd`: 23890 passed, 0 failed. `run-client.sh --check` boots clean.

**Owner QA on the first stick** (Phase 7; it cannot be proven before a build):
- the installer starts from the GUI button with the bridge mounted (WO-481 scenario);
- the branding shows (logo, HighAsCG slideshow, "HIGHASCG NVIDIA 615");
- after install, both UEFI and BIOS boot the disk;
- `/etc/penguins-eggs.d/installer.d/modules/` is copied off for the record.
