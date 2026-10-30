# WO-848 — Installation: Caspar-only CEF (block generic, sync, symlinks, loader safety)

**Area:** os-iso, caspar-build
**Status: IN PROGRESS (30.10) — check script, hash-verified installer and the $ORIGIN/../lib RUNPATH build are done; the build runs live since 16:41 (check-cef-caspar.sh OK, 0 warn). Left: acceptance on a fresh install from a clean ISO, which waits on WO-870 (the eggs 26.10 rewrite)**
**Scope:** HighAsCG installer (`scripts/install-*.sh`) + optional `apt` / packaging policy on deployment hosts.  
**Problem:** Distro or generic **Chromium CEF** packages can install **`libcef.so`** (and friends) under `/usr/lib/cef/<ver>/…`. CasparCG’s **HTML/template** stack expects the **Caspar-patched** CEF build shipped in **`casparcg-cef-*`** `.deb`. Loading the wrong `libcef.so` causes subtle failures (wrong CEF version, missing patches).

**Current baseline in repo:** `sync_caspar_cef_into_system()` in `scripts/install-helpers.sh` **copies** key files from `/usr/lib/casparcg-cef-*` into the system CEF layout and runs `ldconfig`. This WO tightens policy and optional symlinks.

---

## Investigation (2026-10-30)

The draft assumes a `casparcg-server-2.5` .deb plus a `casparcg-cef-*` .deb and a distro CEF package. None of the
three exist on this box model:

- **What Caspar loads.** `~/highascg/run.sh` exports `LD_LIBRARY_PATH=~/highascg/lib`. The live Caspar maps
  `/home/casparcg/highascg/lib/libcef.so` (`/proc/<pid>/maps`). That file is the pinned owner build of CEF 142.0.17:
  sha256 `fa0993fa…ed57`, md5 `a9062054…fe66`.
- **The deployed binary's RUNPATH is fragile.** It is `/home/casparcg/caspar-build/build-26/cef-prefix/src/cef/Release:`.
  That is the build tree, plus a trailing empty entry, which means the working directory. Started without `run.sh`, it
  takes the build tree's CEF, or nothing on a fresh ISO. It is correct today only because of `run.sh`.
- **Other copies.** `/usr/lib/cef/142.0.17/x86_64-linux-gnu/` holds a root-owned, md5-identical copy (about 600 MB)
  that nothing loads. `/usr/lib/casparcg-cef-142.0.17` is a symlink to `~/highascg/lib`. No libcef is in
  `ldconfig -p`, and `dpkg -S libcef.so` finds nothing. Zoom ships a private `/opt/zoom/cef/libcef.so`, which only
  Zoom loads.
- **Nothing to pin in apt.** `apt-cache search` on Ubuntu 26.04.1 finds no CEF package (no `libcef`, no
  `chromium-cef`), so Phase C (pins, `apt-mark hold`) has no target. A generic CEF could only arrive inside another
  app's private directory, which is not on Caspar's loader path.
- **`sync_caspar_cef_into_system` is dead code.** It had no callers (the 29.10 sweep flagged it). The draft's
  `scripts/install-helpers.sh` and `install-phase3.sh` references are stale; the CEF install is
  `install_highascg_cef_binary` in `scripts/lib/install-helpers-binaries.sh`, run by `scripts/setup/08-caspar-cef-scanner.sh`
  and `reinstall-cef.sh`.
- **The installer had no safety net.** `install_highascg_cef_binary` downloaded to fixed `/tmp` paths, did not check
  any step, and verified no hash. A truncated download could half-overwrite `lib/`.
- **The pin.** The fork's CMake pins the same archive URL with `URL_HASH SHA256 2a03fa6b…63cc9`, which gives the
  installer a hash to check.

## What was done

- **`scripts/setup/check-cef-caspar.sh`** (new, read-only, `--quiet`, exit 1 on FAIL), covering T-A.2/T-A.3. Green
  means three things:
  - the bundle `lib/libcef.so` matches `CEF_LIBCEF_SHA256` and the CEF resource files are present;
  - `ldd` resolves the bundle as `run.sh` starts Caspar (FAIL otherwise);
  - every running `casparcg` main process maps the bundle (FAIL otherwise).

  It WARNs on these:
  - a RUNPATH other than `$ORIGIN/../lib`, naming any empty entry;
  - a bare start that would not resolve the bundle;
  - a libcef in the linker cache;
  - `/usr/lib/cef` or `casparcg-cef` copies that differ from the bundle.

  Other apps' CEF is listed for information only. It is called with `--quiet` at the end of step 08; it never fails
  the install.
- **`scripts/lib/install-helpers-binaries.sh`, `install_highascg_cef_binary`:**
  - downloads into `mktemp -d`, checks every step, and cleans up;
  - verifies the archive sha256 (`CEF_BINARY_SHA256`) and `Release/libcef.so` (`CEF_LIBCEF_SHA256`) **before**
    touching `lib/`;
  - `HIGHASCG_CEF_SYSTEM_LAYOUT=copy|symlink|none` chooses the layout of `/usr/lib/cef/<ver>/<triplet>`: copy is the
    default and the old behaviour, symlink makes per-file links into `lib/` (T-B.2), none skips it. An unknown value
    is an error.

  The dead `sync_caspar_cef_into_system` was removed, with a WO-848 comment in its place.
- **`scripts/lib/install-config.sh`:** `CEF_BINARY_SHA256` (= the CMake `URL_HASH`) and `CEF_LIBCEF_SHA256`.
- **Loader fix at the source:** `~/caspar-build/build-26.sh` now builds with
  `CMAKE_BUILD_WITH_INSTALL_RPATH=ON` and `CMAKE_INSTALL_RPATH=$ORIGIN/../lib`. Every new binary in `bin/` resolves
  `lib/libcef.so` itself, with or without `run.sh`, so no `/usr/lib/cef` entry or linker-cache entry is ever needed.
  This is the robust form of T-D.1. The first binary built this way is the WO-847 build (fb955e76).
- **Docs:** `docs/install-cef.md` (new; covers T-E.1: where CEF lives, the check, reinstall, layout modes,
  rollback) and a `check-cef-caspar.sh` line in `scripts/README.md` (T-E.2).

## What was VERIFIED (2026-10-30)

- **Check script on the live box:** `CEF check: OK (2 warn)`. The two warnings are the deployed binary's build-tree
  RUNPATH with an empty entry, and a bare start resolving into the build tree. Both are expected until the swap.
- **Check script with `CASPAR_BIN=` the new build:** `OK (0 warn)`, with `RUNPATH $ORIGIN/../lib`.
- **Check script with a fake `lib/libcef.so`:** FAIL, rc=1.
- **New binary started from a bundle copy with no `LD_LIBRARY_PATH`:** the html module initialized, `CG ADD` returned
  202, and `/proc/<pid>/maps` shows `/home/casparcg/highascg/lib/libcef.so`.
- **Installer, run as the user** against a scratch `lib/`, with `ln`/`mkdir`/`ldconfig` stubbed for the system paths
  and a `file://` URL to the cached archive:

  | Case | Result |
  |------|--------|
  | Bad archive hash | rc=1, `lib/` untouched |
  | Bad libcef hash | rc=1, `lib/` untouched |
  | Missing file | rc=1, `lib/` untouched |
  | Good | rc=0, 14 entries in `lib/`, `libndi` kept |
  | `symlink` | per-file links |
  | `bogus` | rc=1 |

  No `/tmp/highascg-cef.*` directory was left behind.
- `bash -n` passes on all four edited scripts. `node --test tools/smoke/smoke-wo832-iso-remnants.test.js` passes
  35/35 (the step-08 assertions). `check-max-file-lines` reports 0 files over 500 lines.

## Left

- **Acceptance 1/3 on a fresh install from a clean ISO** (a stick reinstall): needs the WO-847 binary swapped in first,
  so `bin/casparcg` carries `$ORIGIN/../lib`.
- Phase C (apt pins/hold) and acceptance 2: **not applicable**, since Ubuntu 26.04 ships no CEF package. Revisit only
  if one appears (`apt-cache search cef | grep -i libcef`).
- Optional (owner, sudo): drop the unused 600 MB copy in `/usr/lib/cef/142.0.17/x86_64-linux-gnu`. Caspar never
  reads it; the commands are in the agent report.
- No CI smoke for the check script: it reads host state (`/proc`, `ldd`), like the operator-display test.

---

## Original draft

## 1. Objective

After installation:

1. **Only** the CasparCG-provided CEF binaries are used for paths Caspar loads.  
2. **Generic** CEF packages do not overwrite Caspar’s libs **without an explicit admin action**.  
3. **Recovery:** Admins can **see** what is linked (symlinks vs copies) and roll back.  
4. **`casparcg-server`** (or `casparcg-server-2.5`) resolves **`libcef.so`** from the **Caspar CEF** install — verified by **`ldd`** / loader trace where practical.

---

## 2. Technical notes (limits)

- **ELF `RPATH` / `DT_RUNPATH`:** The server binary may already embed a **runpath** to `/usr/lib/cef/...`. “Linking casparcg-server to casparcg cef” may mean **filesystem layout + dynamic linker path**, not recompiling. Confirm with `readelf -d /usr/bin/casparcg-server-2.5 | grep -E RUNPATH|RPATH` and `ldd`.  
- **Symlinks vs copies:** Symlinks from `/usr/lib/cef/VERSION/.../libcef.so` → `/usr/lib/casparcg-cef-VERSION/libcef.so` are **transparent** if the loader searches the symlinked path. **Copies** (current behavior) avoid symlink issues with some package managers that replace files on upgrade. **Policy:** prefer **one** strategy per deployment; document trade-offs.  
- **Blocking generic CEF:** Use **`apt`** pinning (`/etc/apt/preferences.d/`) or **`apt-mark hold`** on specific packages **only** after identifying exact package names on **Ubuntu 22.04/24.04** (e.g. `chromium-cef`, `libcef`, etc. — **verify on target**).

---

## 3. Phases

### Phase A — Inventory and verification scripts

| Task | Description |
|------|-------------|
| **T-A.1** | Document **all** packages on a clean install that touch `/usr/lib/cef` or ship `libcef.so` (`dpkg -S libcef.so` / `apt-file`). |
| **T-A.2** | Add a **non-destructive** check script (e.g. `scripts/check-cef-caspar.sh`) that prints: Caspar CEF dir, system CEF dir, `sha256sum` of `libcef.so`, and **`ldd`** on `casparcg-server-2.5` for `libcef`. |
| **T-A.3** | Define **“green”** criteria: hashes match Caspar package OR symlinks resolve into `casparcg-cef-*`. |

### Phase B — Installer: strengthen `sync_caspar_cef_into_system`

| Task | Description |
|------|-------------|
| **T-B.1** | Keep **backup** (`.bak`) behavior; add optional **`--dry-run`** if script is extracted to CLI. |
| **T-B.2** | **Optional mode:** `HIGHASCG_CEF_SYNC_MODE=copy|symlink` — **symlink** individual files into `/usr/lib/cef/...` when safe; **copy** remains default. |
| **T-B.3** | After sync, run **`ldconfig`** (already done); add **one** `ldd` log line in verbose installer mode. |
| **T-B.4** | If **no** `/usr/lib/cef/<ver>/…` exists, consider **creating** the directory tree **only** when admin sets `HIGHASCG_CEF_CREATE_SYSTEM_DIR=1` (avoid surprising partial layouts). |

### Phase C — Block generic CEF (apt)

| Task | Description |
|------|-------------|
| **T-C.1** | Create **`/etc/apt/preferences.d/99-highascg-cef`** (name TBD) with **`Pin`** entries that **prevent accidental install** of identified generic CEF packages — **version** `Pin: release o=Ubuntu` patterns as needed. |
| **T-C.2** | Document **`apt-mark hold <package>`** for machines where pinning is insufficient. |
| **T-C.3** | **Warning:** Pinning wrong packages can **break** desktop browsers or unrelated tools — **scope** to headless playout machines where acceptable. |

### Phase D — Symlink “just in case” layer

| Task | Description |
|------|-------------|
| **T-D.1** | If generic CEF **must** remain installed for other apps, use **alternatives** or **separate** `LD_LIBRARY_PATH` only for Caspar **systemd** / **openbox** wrapper — **last resort**; prefer single canonical `/usr/lib/cef/<ver>/` content = Caspar. |
| **T-D.2** | Optional: **`/usr/local/lib/casparcg-cef`** aggregate symlink tree pointing at `casparcg-cef-*` for debugging. |

### Phase E — Documentation and rollback

| Task | Description |
|------|-------------|
| **T-E.1** | **`docs/install-cef.md`:** One-page: what we copy/symlink, how to restore `.bak`, how to remove apt pins. |
| **T-E.2** | Link from **`scripts/README.md`** or main installer doc. |

---

## 4. Risks

| Risk | Mitigation |
|------|------------|
| Apt upgrade reinstalls generic `libcef` | Re-run sync post-upgrade; **hook** `APT::Update::Post-Invoke` (optional, advanced) |
| Symlinks break on `casparcg-cef` package upgrade | Re-run installer sync; document |
| Pinning breaks unrelated software | Limit pins to dedicated Caspar **appliances** |

---

## 5. Acceptance criteria

1. Fresh HighAsCG install on reference Ubuntu: **`check-cef-caspar.sh`** reports **OK**.  
2. Simulated **`apt install`** of a generic CEF package either **fails** (pin) or **post-install** docs describe re-running sync.  
3. **`ldd`** on server binary shows **`libcef.so` →** resolved path under **`casparcg-cef`** or verified hash match.  
4. Rollback: restoring **`.bak`** files restores previous behavior without orphan symlinks.

---

## 6. References (in-repo)

- `scripts/install-helpers.sh` — `sync_caspar_cef_into_system`  
- `scripts/install-phase3.sh` — invocation after Caspar `.deb` install  

---

## 7. Ownership

Assign: **installer maintainer**, **Linux deployment owner**.  
**Security review:** Only if adding `Post-Invoke` hooks or broad apt pins.
