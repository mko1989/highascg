# WO-428 — Phantom DeckLink card on driverless installs + the tar.gz installer never matched the real Blackmagic archive

**Status: DONE (2026-08-04 — suggest gate live-verified both ways: this box keeps its 4 detected ports, a detected:false snapshot renders zero; the REAL 16.2 archive now extracts (16.2a1 pair found); smoke 3/3; suite 1829/0/2. The staged 16.2 on this box installs after the owner's one-liner below.)**

Owner: "on the freshly installed system on the second machine, that dont have decklink
drivers, in the devices tab there is still a full decklink card displaying. also this needs
to be more flexible, as i only have the one decklink card type but there are many others."
Plus the real driver at `~/Downloads/Blackmagic_Desktop_Video_Linux_16.2.tar.gz`.

## Investigation

1. **The phantom card.** The Devices tab's rear panel renders DeckLink ports from the
   SUGGESTED connectors (`device-graph-suggest.js`). Suggest builds them from the live
   snapshot AND a config fallback (`decklink_input_count` / `screen_N_decklink_device` keys)
   that exists for "Caspar offline on a box that HAS a card". A fresh machine whose config
   carries cloned decklink keys (03.08-era ISO / exFAT pull) therefore renders a full card
   with zero hardware and zero drivers. The factory config is clean (verified — count 0), so
   new produces won't seed it, but the gate belongs in code, not in config hygiene.
2. **Flexibility.** Nothing binds the UI to the owner's card model: detection labels come
   from lspci (`pciModel` — any Blackmagic card name) and ffmpeg enumeration, port count
   follows whatever is detected (config offers up to 8 input slots — covers Duo/Quad/8K Pro).
   The phantom made it LOOK model-hardcoded; it was config-echo.
3. **The real archive never worked.** Exercising WO-427's upload with the actual 16.2
   package (2 GB, streamed in 1.1 s, byte-identical) exposed that WO-188's tar.gz support
   greps `^deb/x86_64/.*\.deb$` — but the real archive nests everything under
   `Blackmagic_Desktop_Video_Linux_16.2/`. The listing matched nothing → the entire tar.gz
   path silently skipped, ever since it shipped. (T188.2 was evidently never run against a
   real download.)

## What was done

1. `device-graph-suggest.js` — every DeckLink port creation is gated on
   `live.decklink.detected !== false` (the snapshot's merged ffmpeg→OS probe; the OS half
   counts a PCI card even with no driver, so physically present hardware always shows).
   Fails OPEN when the snapshot has no probe data (Caspar-offline fallback preserved —
   pinned by smoke).
2. `scripts/lib/decklink-install-lib.sh` — listing matches `(^|/)deb/x86_64/*.deb`,
   extraction uses `--wildcards '*deb/x86_64/*.deb'`, and a new
   `decklink_extracted_deb_dir()` finds the deb dir wherever it landed. Rooted layout still
   accepted.

## What was VERIFIED

- Functional smoke: detected:false + cloned config → 0 ports; detected:true → ports kept;
  no probe data → config fallback kept. Source pins on the layout-agnostic extractor.
- LIVE both ways: this box (card + driver) still suggests its 4 SDI ports after restart;
  the finder run against the real staged 16.2 tarball returns the
  `desktopvideo_16.2a1_amd64.deb` + gui pair from under the nested folder.
- WO-427 upload QA with the real file: 2 GB multipart → staged byte-identical,
  `vendorAvailable: true` — the Install button on this box is now armed with 16.2
  (installed: 16.0.1a2).

## Owner actions

1. **Before pressing Install** (and before the next produce):
   `sudo bash scripts/exfat/install-exfat-systemd-units.sh` — refreshes the root-owned
   installed copies of the install script + lib; without it the old extractor still misses
   the nested archive.
2. Then Settings → decklink → **Install driver** (nuclear password) whenever a maintenance
   moment suits — it's a 16.0.1→16.2 driver upgrade on the box that runs the DM3/capture
   stack, so expect a Caspar restart and possibly a reboot for the DKMS module.
3. The second machine: after updating it (git pull or drop-update), its phantom card
   disappears on the next Devices-tab load; real ports appear once a card + driver exist.

## Follow-up (same day, owner pressed Install)

Two more defects surfaced live:
1. **Password prompt with no password set** — `wireDecklinkInstallListener` prompted
   unconditionally; the server's `checkNuclearPassword` passes without one when
   `nuclearRequirePassword` is off. Now: gate ON → password prompt; gate OFF → a plain
   confirm (WO-193's system-time rule applied here).
2. **"skipped: unknown"** — the install script logs to STDERR; the handler's `execFileSync`
   read stdout only (empty), and parsed a fixed line position. Now `spawnSync` reads both
   streams and scans all lines for the last `ok:`/`skip:` marker. Bonus: when a package IS
   staged from the GUI upload but the (stale, root-owned) installed scripts didn't look
   there, the reason now says exactly that and names the one-time fix command.

Live-verified after restart: `POST /api/system/decklink/install {}` →
`skipped: no vendor debs in ~/exfat/decklink or ~/bridge/decklink — a driver package IS
staged from the GUI upload, but the installed system scripts predate it. Run once:
sudo bash scripts/exfat/install-exfat-systemd-units.sh — then retry Install.`
Smoke extended to 4/4; suite 1830/0/2; client rebuilt + kiosk reloaded.

## Follow-up 2 (owner re-ran the installer, STILL "no vendor debs")

The installed lib WAS refreshed (16:10, byte-identical to the repo) — the remaining bug was
a `set -o pipefail` trap that user-context testing missed: `tar -tzf | grep -Eq` — grep
quits at the first match and closes the pipe, tar dies with SIGPIPE (exit 141), and under
the front script's pipefail the pipeline counts as FAILED despite the successful match. The
ORIGINAL WO-188 code had the same trap, so the tar.gz path was doubly dead. Fixed by
capturing the listing with `|| true` (no early-quit grep on the tar pipeline); same
treatment for the `find | head -1` in `decklink_extracted_deb_dir`; skip message now names
all three search locations including the GUI upload dir.

Verified under the front script's exact options (`set -euo pipefail`) against the real
staged 2 GB archive: `decklink_needs_install_from_vendor` → "install or upgrade to 16.2a1",
main deb resolved. Smoke 5/5. Owner: run
`sudo bash scripts/exfat/install-exfat-systemd-units.sh` ONE more time (the fixed lib must
reach /usr/local/lib), then Install.

## Follow-up 3 — OWNER QA PASSED (04.08 evening)

Owner: "the decklink driver install seems to succeded" — the full chain works end-to-end:
browser upload of the real 2 GB tar.gz → staged → installer refresh → Install button →
Desktop Video 16.0.1 → 16.2 installed through the GUI. The flow shipped in WO-188 never
worked once; it now has three fixes (stderr parsing, nested-archive layout, pipefail
SIGPIPE) each proven against the real package. CLOSED.
