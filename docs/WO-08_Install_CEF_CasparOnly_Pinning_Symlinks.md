# WO-08 — Installation: Caspar-only CEF (block generic, sync, symlinks, loader safety)

**Status:** Draft work order  
**Scope:** HighAsCG installer (`scripts/install-*.sh`) + optional `apt` / packaging policy on deployment hosts.  
**Problem:** Distro or generic **Chromium CEF** packages can install **`libcef.so`** (and friends) under `/usr/lib/cef/<ver>/…`. CasparCG’s **HTML/template** stack expects the **Caspar-patched** CEF build shipped in **`casparcg-cef-*`** `.deb`. Loading the wrong `libcef.so` causes subtle failures (wrong CEF version, missing patches).

**Current baseline in repo:** `sync_caspar_cef_into_system()` in `scripts/install-helpers.sh` **copies** key files from `/usr/lib/casparcg-cef-*` into the system CEF layout and runs `ldconfig`. This WO tightens policy and optional symlinks.

---

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
