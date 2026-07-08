# WO-148 — Boot branding hardening (produce-path gate + Calamares slideshow)

**Status:** Implemented — awaiting owner-run acceptance (A148.1–A148.3)
**Priority:** Medium
**Date:** 2026-07-07
**Depends on:** WO-143 (eggs wrapper consolidation).
**Related:** WO-11, WO-66, WO-77; `tools/eggs/live-usb/branding/README.md`.

---

## 1. Problem

GRUB/Plymouth branding scripts are complete but the pipeline is fragile:
1. A plain `eggs produce` runs mkinitramfs and **overwrites the custom `splash.png`** with stock penguins artwork — branding only survives when the exact `build-highascg-egg.sh` → `inject-iso-boot-branding.sh` → `verify-iso-boot-branding.sh` sequence is used. The branding README documents repeated real-world breakage (black panel, purple Ubuntu dots, blank menu).
2. The Calamares installer slideshow **still shows penguins-eggs artwork** (documented gap in branding README §Calamares).
3. Verification is manual/QEMU-only; no automated gate.

## 2. Tasks

- [x] T148.1 Make the safe path the only path: every produce variant kept by WO-143 must route through `build-highascg-egg.sh` → `inject-iso-boot-branding.sh` → `verify-iso-boot-branding.sh`. No wrapper may call `eggs produce` directly.
- [x] T148.2 Fail the build when `verify-iso-boot-branding.sh` fails (non-zero exit propagates out of the wrapper; error message names the missing asset).
- [x] T148.3 Brand the Calamares slideshow: replace penguins-eggs slideshow assets with HighAsCG artwork via `tools/eggs/live-usb/install-eggs-calamares.sh` / `prepare-branding-assets.sh`. If no artwork exists yet, generate a minimal branded slide set from the existing GRUB/Plymouth assets and note it for the owner to replace.
- [x] T148.4 Add a QEMU boot-check entry (using `preview-live-iso-qemu.sh`) to the stick QA checklist (`tools/startup/stick-boot-test/` or WO-77 checklist) covering: GRUB theme visible, Plymouth splash visible, Calamares slideshow branded.

## 3. Acceptance criteria (owner-run — exact commands below)

- [ ] A148.1 An ISO built via the consolidated wrapper passes `verify-iso-boot-branding.sh` (output pasted).
- [ ] A148.2 QEMU boot of that ISO shows branded GRUB menu + Plymouth splash; launching Calamares shows the HighAsCG slideshow (screenshots or described observation in work log).
- [ ] A148.3 Deliberately skipping the inject step makes the build FAIL (demonstrated once, then reverted).

### A148.1 — build one ISO through the gated wrapper

```bash
cd /home/casparcg/highascg
cp config/casparcg.config config/casparcg.config.bak.$(date +%s)   # pre-produce backup
sudo bash work/run-eggs-prepare-safe.sh                            # check-only preflight
sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh
```

The wrapper runs `build-highascg-egg.sh` → `eggs produce --theme …` →
`patch-iso-squashfs-calamares.sh` → `inject-iso-boot-branding.sh` →
`verify-iso-boot-branding.sh`. Paste the verify block (ending
`All boot branding checks passed.`, now including
`OK: Calamares slideshow in squashfs is HighAsCG-branded (show.qml)`) into the work log.

### A148.2 — QEMU boot-check (no flash needed)

```bash
sudo bash tools/eggs/live-usb/preview-live-iso-qemu.sh   # picks the newest ISO under /home/eggs/
```

Work through checklist items **B1–B3** in `tools/startup/stick-boot-test/README.md`
(GRUB theme visible; "Live (Plymouth splash)" entry shows HighAsCG splash + corner
throbber, no purple Ubuntu dots; launching the installer shows the dark HighAsCG
slideshow, cancel before partitioning). Note observations here.

### A148.3 — demonstrate the failure gate (then revert)

```bash
cd /home/casparcg/highascg
mv tools/eggs/live-usb/branding/splash.png tools/eggs/live-usb/branding/splash.png.hidden
sudo HIGHASCG_NVIDIA_DRIVER=595 bash work/run-eggs-produce-from-host.sh; echo "exit=$?"
# EXPECTED: non-zero exit BEFORE eggs produce, error naming the asset:
#   "Missing /home/casparcg/highascg/tools/eggs/live-usb/branding/splash.png"
#   (from prepare-branding-assets.sh via finalize-boot-branding-for-eggs-produce.sh)
mv tools/eggs/live-usb/branding/splash.png.hidden tools/eggs/live-usb/branding/splash.png
```

Cheap variant of the same gate without a rebuild (verify alone must fail on an
un-injected/stock ISO): `sudo bash tools/eggs/live-usb/verify-iso-boot-branding.sh /path/to/stock.iso; echo "exit=$?"` → expect `exit=1` with `FAIL:` lines naming the missing assets.

## 4. Implementation (2026-07-08)

### T148.1/T148.2 — call-chain audit of the WO-143 surviving wrappers

| Wrapper | Produces ISO? | Branding-gated (produce → inject → verify)? | verify exit propagates? |
|---|---|---|---|
| `work/run-eggs-clone-flash.sh` | yes — `build-produce-flash-stick.sh` → `build-highascg-egg.sh` | yes (gate inside `build-highascg-egg.sh`) | yes — rc captured around build, `exit $rc`; `set -euo pipefail`; log via `exec > >(tee …)` (process substitution, no pipeline to swallow rc) |
| `work/run-eggs-clone-flash-tmux.sh` | yes — detached tmux → `…-inner.sh` → same chain | yes (same chain) | inside the tmux pane + log: yes. Launcher exits 0 after spawning by design (detached); NOTE printed telling the operator to watch the pane/`tail -f` — inner runner exits non-zero on failure |
| `work/run-eggs-clone-flash-inner.sh` | yes (internal helper) | yes (same chain) | yes — `build_rc` captured and re-exited |
| `work/run-eggs-prepare-safe.sh` | **no** (check-only; exempt) — `--produce` execs `run-eggs-produce-from-host.sh` | n/a / yes via exec chain | yes (`exec` replaces process, child rc is wrapper rc) |
| `work/run-eggs-produce-from-host.sh` | yes — `build-highascg-egg.sh` | yes | yes (`set -euo pipefail`, no `|| true` on the chain) |
| `work/run-eggs-produce-clone-only.sh` | yes — was the ONE direct `eggs produce` caller | **fixed:** mandatory `inject-iso-boot-branding.sh` + `verify-iso-boot-branding.sh` after produce | yes — `brand_rc` captured, host exFAT remount still runs, then `exit $brand_rc` with an error that points at the FAIL lines naming the missing asset |

Notes:
- `run-eggs-produce-clone-only.sh` deliberately does **not** route through
  `build-highascg-egg.sh` (that script also mutates the host: apt installs, hostname,
  factory-config reset). It now implements the identical inject→verify gate inline; the
  documented escape hatch `HIGHASCG_SKIP_ISO_BOOT_BRANDING=1` prints an UNBRANDED
  warning and is for debug ISOs only.
- Repo-wide grep confirms only two `eggs produce` call sites remain:
  `build-highascg-egg.sh` (gated) and `run-eggs-produce-clone-only.sh` (now gated).
- `build-highascg-egg.sh` retains `HIGHASCG_SKIP_ISO_BOOT_BRANDING_VERIFY=1` as an
  explicit env escape hatch; default path hard-fails and now tells the operator the
  FAIL lines name the missing asset.
- All wrappers/scripts in the chain have `set -euo pipefail`; the only `tee` usage is
  `exec > >(tee -a "$LOG")` process substitution which cannot swallow exit codes.

### T148.3 — Calamares slideshow

Root cause found: `highascg-eggs-theme/theme/calamares` was a **symlink to
`/usr/lib/penguins-eggs/addons/eggs/theme/calamares`** (created by
`install-eggs-live-grub-theme.sh`), so `eggs calamares --theme` and `eggs produce
--theme` always baked the stock penguin slideshow/branding into `/etc/calamares` and
the ISO squashfs.

- Replaced the symlink with a real repo directory:
  - `theme/calamares/branding/show.qml` — new minimal HighAsCG QML slideshow (4 slides,
    solid `#0c1220` background, "HighAsCG" wordmark, GRUB-theme palette `#5eb3ff` /
    `#b8c4d8` / `#121a2a`), no dependency on penguin PNGs.
  - `theme/calamares/branding/highascg-mascot.png` (+ `highascg-eggs-theme-logo.png`,
    `eggs-logo.png`, `welcome.png` under the names eggs 26.6.2/Calamares expect) — all
    copies of `branding/splash.png` (mascot). **Owner may replace these with richer
    artwork later; keep the file names (or update `show.qml`).**
  - `theme/calamares/branding/branding.desc` — stub (eggs generates the real one).
  - `theme/calamares/modules/{locale,partition,users}.yaml` — copied from the eggs
    defaults previously reached through the symlink (behavior unchanged).
- `install-eggs-live-grub-theme.sh` no longer symlinks `calamares` (only
  `applications`/`artwork`); it removes a legacy symlink if present, refuses a
  non-HighAsCG `show.qml`, and refreshes `modules/*.yaml` from the eggs defaults.
- `install-eggs-calamares.sh` refuses the legacy symlink, and **always** syncs the
  branding dir (minus `branding.desc`) into `/etc/calamares/branding/highascg-eggs-theme/`
  — including on the "already installed, skip re-apply" path — and deletes stale
  penguin slide PNGs (`1-*.png … 7-*.png`).
- `verify-calamares-installed.sh` now fails pre-produce if `show.qml` is missing /
  stock penguins / un-branded (also fixed a latent `bad` → `fail` undefined-function
  bug that aborted the script with exit 127 on the l10n/logs-helper checks).
- `verify-iso-boot-branding.sh` gained a post-produce squashfs check
  (`unsquashfs -cat … show.qml`): FAIL names the asset when the slideshow is missing
  or penguins; skipped in FAST mode or when `HIGHASCG_ISO_EMBED_CALAMARES=0`.

### T148.4 — QA checklist

- New `tools/startup/stick-boot-test/README.md`: suite overview + **Boot-branding
  checklist (B1 GRUB theme, B2 Plymouth splash, B3 Calamares slideshow)** driven by
  `preview-live-iso-qemu.sh`, with fix/rebuild pointers.
- Branding README §Calamares rewritten: documents the new real directory, the file
  roles, and the three-layer gate (installer refusal, host verify, ISO verify).

## 5. Work log

- 2026-07-07 — WO created from branding pipeline assessment.
- 2026-07-08 — T148.1–T148.4 implemented (agent). Root cause of penguin slideshow found:
  `theme/calamares` → `/usr/lib/penguins-eggs/...` symlink; replaced with real branded
  directory. `run-eggs-produce-clone-only.sh` was the only wrapper calling `eggs produce`
  outside the gate — now runs mandatory inject + verify with rc propagation. Squashfs
  slideshow check added to `verify-iso-boot-branding.sh`; host-side check added to
  `verify-calamares-installed.sh` (+ fixed latent `bad`→`fail` exit-127 bug). QA
  checklist B1–B3 added at `tools/startup/stick-boot-test/README.md`. `bash -n` clean
  on all 16 touched/chain scripts. No ISO build run (live playout box) — A148.1–A148.3
  are owner-run with exact commands in §3.
