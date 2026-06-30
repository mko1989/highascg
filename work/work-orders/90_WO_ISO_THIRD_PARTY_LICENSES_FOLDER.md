# Work Order 90: ISO third-party licenses folder

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Status:** In progress (Phase A–B partial — collector, COMPLIANCE-ISO, install hook, audit)  
**Priority:** Medium (distribution compliance, operator/support transparency)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on:**
- [12_WO_PRODUCTION_INSTALLER.md](./12_WO_PRODUCTION_INSTALLER.md) — `scripts/install.sh` installs the stack cloned into the ISO
- [73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md](./73_WO_CALAMARES_SYSTEMD_CASPAR_NUCLEAR.md) — ISO build / Calamares install path
- [`docs/ISO_CONTENTS.md`](../../docs/ISO_CONTENTS.md) — canonical list of what ships on the live image

**Related:**
- [`docs/LIVE_USB_IMAGE.md`](../../docs/LIVE_USB_IMAGE.md) — operator workflow
- `tools/eggs/live-usb/build-highascg-egg.sh` — `eggs produce` pipeline

---

## 1. Problem statement

The HighAsCG live ISO is a **clone of a production playout host** bundling many third-party components (Ubuntu, NVIDIA, DeckLink Desktop Video, NDI, CasparCG + CEF, FFmpeg, Tailscale, Syncthing, Node/npm dependencies, Companion, Calamares, etc.).

Today there is **no single, operator-visible licenses folder** that:

1. Lists every bundled product and its license terms.
2. Ships **on the ISO** at a stable path (not buried in `/usr/share/doc` alone).
3. Is **regenerated** when the build host or dependency versions change.
4. Can be linked from the Web UI / setup page for support and legal review.

**Goal:** Add a repo-maintained **`licenses/`** tree, a build-time collector, and bake the result into the ISO + server drop so operators and integrators can answer “what software is on this box?” without SSH archaeology.

---

## 2. Scope — software to cover

Use [`docs/ISO_CONTENTS.md`](../../docs/ISO_CONTENTS.md) as the master checklist. Minimum rows in the manifest:

| Component | Typical source for license text |
|-----------|----------------------------------|
| **Ubuntu 24.04 LTS** | `/usr/share/doc/*/copyright` (deb copyright) |
| **linux-generic kernel** | deb copyright |
| **NVIDIA driver** (one branch per ISO) | `/usr/share/doc/nvidia-*` |
| **Blackmagic Desktop Video** | BMD `.deb` copyright / EULA |
| **NDI SDK** | NewTek / Vizrt license file from install tree |
| **CasparCG Server 2.5** | upstream `LICENSE` (GitHub release) |
| **CEF (Caspar build)** | Chromium / CEF `LICENSE.txt` |
| **casparcg-scanner** | upstream license |
| **FFmpeg** | deb + upstream `LICENSE` |
| **Tailscale** | `/usr/share/doc/tailscale/copyright` or snap metadata |
| **Syncthing** | deb copyright |
| **Node.js** | deb copyright |
| **HighAsCG npm tree** | `npm run licenses:collect` from `package-lock.json` |
| **Bitfocus Companion** (when on image) | module + Companion license |
| **Calamares / penguins-eggs** | deb copyright |
| **Openbox, nodm, unclutter** | deb copyright |
| **HighAsCG application** | repo root `LICENSE` (if present) + bundled assets |

**Out of scope (v1):** Per-font license mining inside DeckLink/Caspar assets unless trivially available; full SPDX SBOM for every `.so` on the squashfs.

---

## 3. Deliverables

### 3.1 Repo layout

```
licenses/
  INDEX.md                 # Human-readable table: name, version, license, path to full text
  manifest.json            # Machine-readable same data (for API / UI)
  third-party/
    ubuntu-24.04.NOTICE    # Aggregated or per-package subdirs
    nvidia-595.NOTICE
    casparcg-server.LICENSE
    cef.LICENSE
    ...
```

**Naming:** `{component-slug}.{LICENSE|NOTICE|COPYING}` — one file per logical product; large deb trees may use subdirs.

### 3.2 On-playout / ISO install path

| Path | Role |
|------|------|
| **`/usr/share/doc/highascg/licenses/`** | System-wide copy (survives Calamares install) |
| **`~/highascg/licenses/`** | Symlink or copy for Web UI `GET /api/system/licenses` (optional) |

Prefer **`/usr/share/doc/highascg/licenses`** as canonical; HighAsCG serves or symlinks for HTTP.

### 3.3 Build-time collector

New script: **`tools/release/collect-third-party-licenses.sh`** (or `scripts/licenses/collect.sh`):

1. Run on **build host** after `scripts/install.sh` (same state as `eggs produce`).
2. Gather:
   - `dpkg-query -W -f='${Package}\t${Version}\t${Status}\n'` filtered to HighAsCG-relevant packages.
   - `apt-get download` not required — read installed `/usr/share/doc/<pkg>/copyright`.
   - Pin upstream files for CasparCG, CEF, HighAsCG npm (`npx license-checker` or `npm ls --json` + lockfile).
3. Write `licenses/INDEX.md` + `licenses/manifest.json` with **version stamps** from build host.
4. Fail CI/audit if manifest older than `package-lock.json` / known driver stamp (`/etc/highascg/nvidia-iso-driver`).

Hook into:

- `tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh` or `build-highascg-egg.sh` — run collector before `eggs produce`.
- `scripts/install.sh` Phase 5 — install licenses tree to `/usr/share/doc/highascg/licenses`.

### 3.4 Operator surfaces (v1 minimal)

| Surface | Behaviour |
|---------|-----------|
| **`client/setup.html`** | Card: “Third-party licenses” → link to `/licenses/INDEX.md` or rendered HTML |
| **Settings → Diagnostics** (or About) | Read-only link + `GET /api/system/licenses` summary |
| **Support bundle** | Include `licenses/manifest.json` (not full text if huge) |

Full in-app license browser is **optional v1.1**.

---

## 4. Tasks

### Phase A — Inventory + collector

- [x] **T90.A1** Create `licenses/` with `INDEX.md` template and `manifest.json` schema (name, version, licenseId, licenseUrl?, file, category).
- [x] **T90.A2** `tools/release/collect-third-party-licenses.sh` — deb copyright harvest + version detection.
- [ ] **T90.A3** npm license harvest from `package-lock.json` → `licenses/third-party/highascg-npm.json` + merged INDEX rows.
- [ ] **T90.A4** Pin upstream CasparCG / CEF / scanner licenses from known install paths or release tarballs.
- [x] **T90.A5** Document manual steps for BMD / NDI when `.deb` copyright is insufficient → `licenses/COMPLIANCE-ISO.md`.

### Phase B — ISO / installer integration

- [x] **T90.B1** `scripts/setup/15-licenses-install.sh` — copy `licenses/` → `/usr/share/doc/highascg/licenses`.
- [x] **T90.B2** Wire into `build-highascg-egg.sh`; `04-ndi.sh` archives NDI SDK license.
- [x] **T90.B3** `audit-eggs-clone-host.sh` — manifest check; DeckLink CAUTION / `HIGHASCG_ISO_FORBID_DECKLINK=1`.
- [x] **T90.B4** Update [`docs/ISO_CONTENTS.md`](../../docs/ISO_CONTENTS.md) — new § Licenses.

### Phase C — API + UI link

- [ ] **T90.C1** `GET /api/system/licenses` — returns `manifest.json` (+ optional `?component=casparcg`).
- [ ] **T90.C2** Static route or prebuilt HTML for `/licenses/` from `dist-web` or server static middleware.
- [ ] **T90.C3** `setup.html` + Settings Diagnostics link to licenses index.
- [ ] **T90.C4** Support bundle: attach manifest snippet (`src/support/`).

### Phase D — QA

- [x] **T90.D1** Smoke: `tools/smoke/smoke-licenses-manifest.test.js` — schema valid, required components present.
- [ ] **T90.D2** Live ISO QA: path exists on booted stick, INDEX lists NVIDIA branch matching `/etc/highascg/nvidia-iso-driver`.

---

## 5. Acceptance criteria

1. Fresh ISO build contains **`/usr/share/doc/highascg/licenses/INDEX.md`** listing all major stack components with correct versions for that build.
2. `collect-third-party-licenses.sh` is **idempotent** and documented in [`tools/eggs/live-usb/BUILD_AND_FLASH.md`](../../tools/eggs/live-usb/BUILD_AND_FLASH.md).
3. Operator can open licenses from **`setup.html`** without SSH.
4. HighAsCG npm dependencies appear in manifest with SPDX identifiers where available.
5. No secrets or `tailscaled.state` in licenses tree.

---

## 6. Related files

| Area | Files |
|------|--------|
| ISO contents reference | `docs/ISO_CONTENTS.md` |
| Build pipeline | `tools/eggs/live-usb/build-highascg-egg.sh`, `prepare-eggs-clone-with-exfat.sh` |
| Installer | `scripts/install.sh`, `scripts/setup/` |
| Setup page | `client/setup.html` |
| System API pattern | `src/api/routes-system-setup.js` |
| Support bundle | `src/support/` |

---

## Work Log

### 2026-06-30 — Phase A/B: collector, COMPLIANCE-ISO, ISO audit (agent)

**Work Done:**
- Created `licenses/` with `INDEX.md`, `manifest.json`, `COMPLIANCE-ISO.md`, `third-party/*` notices (NVIDIA, BMD, NDI PDF, FFmpeg, …).
- `tools/release/collect-third-party-licenses.sh` + `scripts/setup/15-licenses-install.sh`.
- `build-highascg-egg.sh` runs collect/install before produce; `04-ndi.sh` archives NDI SDK license.
- `audit-eggs-clone-host.sh`: manifest check; DeckLink CAUTION; `HIGHASCG_ISO_FORBID_DECKLINK=1` strict mode.
- Smoke: `smoke-licenses-manifest.test.js`.

**ISO compliance summary:**
- **NVIDIA:** OK to ship unmodified + include Driver License Agreement.
- **NDI:** OK with SDK EULA PDF + product attribution (ndi.video link in UI still TODO).
- **Blackmagic:** CAUTION — EULA not OEM redistribution; prefer manual install or legal review.

**Instructions for Next Agent:** T90.A3–A4 (npm + Caspar/CEF); T90.C UI links for NDI; optional `GET /api/system/licenses`.

### 2026-06-30 — Work order created (agent)

**Work Done:**
- Drafted WO-90 from user request for ISO licenses folder.
- Scoped manifest to `ISO_CONTENTS.md` stack; defined repo layout, collector script, and install path.

**Instructions for Next Agent:**
1. Start **T90.A1–A2** — create `licenses/` skeleton and deb copyright collector on a prepared build host.
2. Run collector once and commit a baseline `manifest.json` (expect large `third-party/` tree — consider `.gitignore` for raw deb copyrights if regenerated every build; keep INDEX + manifest in git).
3. Coordinate with ISO rebuild — licenses must be collected **before** `eggs produce`.

---
*Work Order created: 2026-06-30 | Series: HighAsCG ISO compliance*
