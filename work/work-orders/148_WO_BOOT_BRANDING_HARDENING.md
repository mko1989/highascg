# WO-148 — Boot branding hardening (produce-path gate + Calamares slideshow)

**Status:** Planned
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

- [ ] T148.1 Make the safe path the only path: every produce variant kept by WO-143 must route through `build-highascg-egg.sh` → `inject-iso-boot-branding.sh` → `verify-iso-boot-branding.sh`. No wrapper may call `eggs produce` directly.
- [ ] T148.2 Fail the build when `verify-iso-boot-branding.sh` fails (non-zero exit propagates out of the wrapper; error message names the missing asset).
- [ ] T148.3 Brand the Calamares slideshow: replace penguins-eggs slideshow assets with HighAsCG artwork via `tools/eggs/live-usb/install-eggs-calamares.sh` / `prepare-branding-assets.sh`. If no artwork exists yet, generate a minimal branded slide set from the existing GRUB/Plymouth assets and note it for the owner to replace.
- [ ] T148.4 Add a QEMU boot-check entry (using `preview-live-iso-qemu.sh`) to the stick QA checklist (`tools/startup/stick-boot-test/` or WO-77 checklist) covering: GRUB theme visible, Plymouth splash visible, Calamares slideshow branded.

## 3. Acceptance criteria

- [ ] A148.1 An ISO built via the consolidated wrapper passes `verify-iso-boot-branding.sh` (output pasted).
- [ ] A148.2 QEMU boot of that ISO shows branded GRUB menu + Plymouth splash; launching Calamares shows the HighAsCG slideshow (screenshots or described observation in work log).
- [ ] A148.3 Deliberately skipping the inject step makes the build FAIL (demonstrated once, then reverted).

## 4. Work log

- 2026-07-07 — WO created from branding pipeline assessment.
