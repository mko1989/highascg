# WO-1096 — ISO redistribution fixes: ship only what we may distribute, with its licences and sources

**Area:** os-iso, process, testing-ci
**Status: DONE (2026-11-16 — offline suite 6873/0, Godot 28907/0, synthetic mksquashfs + the 11.11 ISO listing, headless lower-third parity, live :4200 checks; no eggs produce was run, so the first real ISO after this is the final proof — see Verified)**

Follows the WO-1095 audit (c3669d3f), item by item (A–G).

Owner rules, 16.11.26:
- *"we cant bake anything into iso that i have no right to distribute"*;
- *"nothing will be sold. everything is free open source"*.

How they apply here:
- **NC terms** do not block on their own. Attribution and share-alike must be met, and NC items are labelled NOT
  under the AGPL.
- **Unlicensed works and other people's copyrighted works** stay out.
- Every audit finding was **re-read before acting**. A licence that could not be confirmed counts as none.

Mid-task owner changes:
- **A:** "Mario template: drop".
- **C:** "wetransfert: drop it. remove code from the base. no need for the wetransfer, we have a regular browser."
- **E (GDTF):** "GDTF Share password: not really, i wanted to leave the highascg login, so getting the gdtf files would
  be easier, streamlined".

Commits, each unit separate, not pushed:

| Unit | Commit |
|---|---|
| G | `360d1e91` |
| C | `06db7620` |
| A | `39f2dbb3` |
| E | `9c95a861` |
| F | `9ed52fb3` |
| B | `3684115b` |
| D | `7ece04b7` |

## 1. Investigation (re-verified)

### A — template/mario
- The assets were opened and checked:
  - `sprites/player.png` is the Super Mario Bros. sheet, with "Mario", "Luigi", "Fire Mario/Luigi" and
    "Invincibility" labels;
  - `tiles.png`, `items.png` and `enemy.png` are SMB art (pipes, ? blocks, goombas, koopas, Bowser);
  - `js/levels/11.js` and `11tunnel.js` are World 1-1;
  - the 14 `.wav` files are SMB effects; the two `.ogg` files are silent ffmpeg placeholders.
- The vendored MIT licence (reruns/mario) covers only the engine code.
- **Nothing stored references the template.**
  - `projects/*.json`, `_autosave`, `~/.highascg/**` and `config/` contain only `SHADERS/SH-MARIO` (the shader, see
    B) and two GDTF Share creator names.
  - The template list is Caspar TLS → `/api/templates` (`src/api/routes-state.js:116`), not a registry.
- **How a stale reference degrades** (from the code; no AMCP was sent):
  - on project load, WO-608 `report()` → `missingTemplates` (a planted ref gave `{"missingTemplates":["MARIO/INDEX"],…}`),
    shown by `client/lib/project-media-reconcile.js:158` and `godot/client/app/hardware_reconcile_model.gd:72`;
  - on take, Caspar answers 404 → `amcp-protocol.js:205-223` logs it, and `amcp-batch.js:22-31` (WO-281) records it
    while the rest of the take finishes.
- **History.** One commit added every Nintendo file: `e01aee9a` (2026-07-15, WO-232); `81739e2b` is CSS/JS only.
  `scripts/lib/archive-common.sh:30` packs `template/`.
  - `tar tz` of all 13 published **Server** releases found 24 `template/mario/s*` entries in each:
    2026-10-22_214247, 10-24_174730, 10-26_044709, 11-15_062846, _083108, _093242, _102246, _112123, _115341,
    _192137, _205322, _215525, 11-16_100252.
  - The 11.11 ISO carries the folder (verifier FAIL, below).
- The **shader** `sh-mario` (HLorenzi, Shadertoy Msj3zD) is Nintendo IP too; handled in B.

### B — template/shaders (190 → 183)
- **Shadertoy's default licence.** The B agent read https://www.shadertoy.com/terms in the web.archive.org snapshots
  20251001020819 and 20250920061115, which agree:
  > "if you don't place a license on a shader, it will be protected by our default license: This work is licensed
  > under a Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported License."

  My own re-fetch failed: the live page returns 403, and archive.org returned 429 / was blocked for WebFetch. The
  same default is reported by godotshaders.com's "shadertoy port" licence page and the vidvox/magicmusicvisuals
  forums. So the 28 shaders that were on Shadertoy without a licence line are **CC BY-NC-SA 3.0**: labelled, kept.
- **The 147 `sh-sa-*` / `sh-bg-*` shaders** (WO-586/587) already had headers. Four were re-read against their code:
  - `log-spherical-kifs-zoomer`: the header said CC0, the code says NC-SA 3.0 → corrected;
  - `exclamation-heart-nr-2-3`, `speaker-visualizer` and `mystic-flower-interactive`: header and code disagree →
    the stricter one kept, with a note.
  - No ND licence anywhere.
- **The 36 owner-pasted shaders** had no header. They were matched to their originals using the Vipitis 20k dump,
  GabeRundlett/shadertoy-api-shaders, ShaderAmp and Shaderfuse. Three are only probable, and say so in their
  header: `sh-ksjb`, `sh-mb-fork-polar`, `sh-raymarched-mandelbaum-reactive`.
- **Out:**
  - `sh-mario` (Nintendo);
  - `sh-balatro` (the commercial game's shader, no licence);
  - `sh-audio-visualiser-v0-1-sadeghi` ("All rights reserved");
  - four of unknown origin (no author, URL or licence; no dataset match): `sh-blue-thunder`, `sh-closer-to-god`,
    `sh-dot-globe`, `sh-shader-equalizor`.
- `data/shaders` is not on the ISO (`penguins-eggs-exclude-highascg-embed-server.list` excludes
  `home/casparcg/highascg/data`). Only the `template/shaders/*.html` ship. So the six FragCoord `sh-fc-*` shaders
  (MIT / CC0 / CC BY 4.0, WO-999) never reach the ISO today.
- **`tools/shaders/shadertoy-pack-export.js`** (untracked, owner's; not touched) is a browser-console script.
  - It POSTs 13 Shadertoy ids to `/shadertoy` and downloads `shadertoy-pack.json`:
    `mll3DH mlsXR2 M3XSR2 cs3GDr mlKSW1 csBBRG cljBWw MtVfWt 4dfcWN tsXSDH MtBGRt Xtj3DW 73s3Wl`.
  - Nothing imports packs yet. Whatever does must go through `shadertoyConfigFromApiJson`, which now writes the
    header. `shader-licence-manifest.js --check` then requires a manifest entry for each.
  - MtBGRt is already `sh-solines`.

### C — wetransfert
- `node_modules/wetransfert/package.json` 2.4.0: `"license": "none"`.
- `gh api repos/orliesaurus/wetransfert/license` → 404; the repo's licence is null.
- It was a direct dependency, used only by the WeTransfer branch of `src/api/routes-ingest.js`.

### D — GSAP 3.6.0
- **Header:** "@license Copyright 2021, GreenSock. All rights reserved. Subject to the terms at
  https://greensock.com/standard-license …".
- **The 2021 licence** (web.archive.org 20210303144612):
  - "non-transferable right to use";
  - "You may make modifications … **exclusively for your own use**";
  - "not … license the PROGRAM's source code or any derivative works thereof to any third party".
- **The 2025 Webflow licence** (gsap.com/standard-license, effective 30.04.2025) adds "Prohibited Uses": tools that
  let users "build visual animations without code" competing with Webflow. CG Studio (no-code lower thirds, .gtzip
  import) is arguably one.
- Neither licence gives AGPL recipients the right to modify and redistribute. → Replaced.
- **What GSAP actually did here** (timelines dumped in headless Chrome):
  - GSAP ignores a timeline-level `ease`, so every built-in template really animated with `power1.out`;
  - `classic-box`'s timeline `duration: 1` was a hidden 1 s lead-in.

### E — the ISO exclude sweep
- **The matcher.** coa (eggs 26.10) runs `mksquashfs -wildcards -ef custom.exclude.list`: per-component fnmatch with
  FNM_PATHNAME|FNM_PERIOD. **`*` does not match a leading dot**: measured with mksquashfs 4.7.5, `root/*` leaves
  `root/.ssh`. The audit's proposed `root/*` alone would have kept `known_hosts`, so `root/.*` is needed too.
- **The 11.11 ISO** (`/home/eggs/highascg-nvidia-615-2026-11-11_1249.iso`, squashfs at LBA 9314) carries:
  - `root/.ssh/known_hosts`, mc history, npm logs;
  - BMD icons, `/etc/blackmagic`, the dracut conf, rc links, the DesktopVideoHelper enable link,
    `~/.config/Blackmagic Design`;
  - MagicQ `.desktop` files, pixmaps, udev rule, mime, dpkg info;
  - NoMachine `usr/share/NX`, `var/NX`, pam, polkit, icons, mime;
  - Zoom apparmor/mime;
  - NM `seen-bssids` / leases / timestamps, the pulse cookie, `exfat-sync.json.bak.*`;
  - a system `libndi`, the 622 MB `/usr/lib/cef` copy, the noble libs, template/mario and wetransfert.
- **Added on the box since 11.11:** Shutter Encoder (`/opt/shutter-encoder`, 12.11) and client `Documents/` CSVs /
  `highascg-backups`.
- **NDI / CEF:** Caspar maps only `~/highascg/lib/libndi.so.6` and `lib/libcef.so`
  (`/proc/<caspar>/maps`, RUNPATH `$ORIGIN/../lib`, `run.sh`). No process maps the `/usr/lib` copies.
- **Noble libs:**
  - the 71 files in `lib/NOBLE-COMPAT-MANIFEST.txt` are linked only by the rollback binaries `bin/casparcg.*`
    (excluded);
  - `bin/casparcg` links none;
  - every kept `lib/` ELF resolves without them (`ldd`: no "not found").
- **The GDTF Share login** `~/.highascg/gdtf-share.json` ships **by owner decision**: 22.10, confirmed 16.11.26 with
  the quote above.
  - For the record: GDTF Share's terms (§5) ask users to keep their login details confidential.
  - No exclude line and no absence assertion. The downloaded GDTF files stay out (`projects/_gdtf` reset,
    `.highascg/cache` excluded).
  - The file's contents were never printed. `GET /api/fixtures/share/account` → `set: true`; the login flow in
    Settings → System → GDTF library is untouched.
- **Per-box installs are untouched:**
  - the BMD gate is `decklink_payload_present` (`usr/lib/blackmagic/DesktopVideo/DesktopVideoHelper`);
  - ~~its dpkg status was already excluded, so `dpkg -i` from exFAT is a fresh install and recreates every excluded
    leftover~~ **Corrected (WO-1106 B74, 17.11.26):** `var/lib/dpkg/status` is NOT excluded; it ships whole, with
    `install ok installed` records for desktopvideo / desktopvideo-gui / magicq / nomachine / zoom / shutter-encoder
    (phantoms, WO-431; checked with `dpkg-query -W` on the build host and the exclude lists, which hold only
    `var/lib/dpkg/info/<pkg>.*` lines). So `dpkg -i` from exFAT is an upgrade of a "installed" package, not a fresh
    install: dpkg treats a conffile that is missing on disk as deleted by the admin and does NOT recreate it. The
    excluded `etc/dracut.conf.d/dracut-blackmagic.conf` is such a conffile (desktopvideo also lists
    `/etc/init.d/DesktopVideoHelper` and `/etc/init/DesktopVideoHelper.conf`, which are not excluded). The payload
    gates (`decklink_payload_present`) stay the protection against the phantoms; recreating the conffile needs
    `dpkg -i --force-confmiss` in `scripts/lib/decklink-install-lib.sh` or stripping the records from the shipped
    status (follow-up, not done);
  - MagicQ has no installer in the repo; its excluded `.desktop` / dpkg leftovers only made a non-installed app
    look present (WO-431 phantom).

### F — notices and docs
- **`COMPLIANCE-ISO.md` existed only inside the generated tree** (`/usr/share/doc/highascg/licenses/`, hand-written
  30.06, untracked). It said BMD is "embedded" in the ISO ("**Yes** — embedded on build host"), as did the manifest
  note (`collect-third-party-licenses.sh:223`) and `docs/ISO_CONTENTS.md`. False: excluded since WO-92/430, and the
  EULA forbids copying.
- **`EGGS_EXCLUDE_LIST.md`'s NDI row** had no conditions.
- **Collector gaps.** It had no Caspar/CEF/Godot/cores/Companion/eggs texts and no source offer. It read the NDI
  version from the system copy, which is now excluded.
- **CEF.** The CEF 142.0.17 minimal distribution's `CREDITS.html` is a placeholder: "This is sample credits page. To
  get correct credits page, set `generate_about_credits=true`". So Chromium's licences were nowhere on the image.
- **Deployed Caspar** = `2.5.1 8a2e29372 Stable`: `strings bin/casparcg`, sha256 4e1835c5… = `caspar/PINNED.json`,
  tag `highascg-8a2e29372`.
- **Upstream tags checked:** WayVR `v26.8.0` (GPL-3.0), media-scanner `v1.4.0`, CEF branch 7444, penguins-eggs
  `v26.10.30` (LICENSE blob 7a645069 = vendored copy).
- **NDI SDK:** the box runs 6.3.2 (installed 07.06). NDI's release notes
  (docs.ndi.video/all/developing-with-ndi/sdk/release-notes) list **6.3.2, 2026-04-13, as the newest**. A 6.4 with an
  NDI file format was announced at NAB 2026 as a roadmap item; no release was found. Not updated, as instructed.

### G — icons
- uxwing-style port icons (uxwing: "Reselling, redistributing, sublicensing … strictly prohibited"), IcoMoon-style
  alignment/save/arrows and Godot save/load had no confirmable licence. Two "Uploaded to: SVG Repo" cables and
  `camera-icon.svg` were unused.
- Lucide `headphones` is Feather-derived: MIT (Cole Bemis) + ISC (Lucide). `bnc_female_axis.svg` is public domain.

## 2. What was done

- **G (`360d1e91`).**
  - Redrew 10 web and 3+2 Godot icons as our own SVGs; deleted the 3 unused ones.
  - THIRD_PARTY_NOTICES "UI icons" section (Lucide MIT+ISC, bnc PD).
  - The redrawn port icons are generic shapes close to the originals.
- **C (`06db7620`).**
  - `npm uninstall wetransfert` (29 packages out of the lock) and the WeTransfer branch out of
    `routes-ingest.js` (484 → 386 lines). The Godot placeholder now says "Paste URL… (http(s) file)"; a pasted we.tl
    link is now fetched as a plain URL.
  - New gate `tools/ci/check-npm-licenses.js` (`npm run verify:npm-licenses`, a ci.yml step after npm audit, and a
    curated smoke).
  - The allowlist:
    - permissive: MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, CC0, BlueOak-1.0.0, Unlicense, Zlib, Python-2.0;
    - notice-required copyleft: LGPL-2.1/3.0, MPL-2.0, GPL-2.0-or-later, GPL-3.0, AGPL-3.0;
    - GPL-2.0-only only as one side of an OR; jspack has a reviewed override.
- **A (`39f2dbb3`).**
  - `template/mario/` (50 files), its static smoke and its live test deleted.
  - Docs (`cef-interactive-bridge.md`, `system-settings-hardware.md`) stop citing it.
  - WO-232 deprecated and moved to `deprecated/`.
  - New curated smoke `smoke-wo1096-no-nintendo-template`: fails on `template/mario`, on a Nintendo-named template
    path, or on any template asset with the SHA-256 of a removed sprite or sound (renamed copies included).
- **E (`9c95a861`).**
  - New fragment `penguins-eggs-exclude-redistribution.list`, merged in both embed modes (`generate-eggs-config.js`).
    It covers every item listed in Investigation E, with `root/*` + `root/.*`, `Documents/.*`, `Blackmagic?Design`,
    and version-pinned noble globs that match exactly the 71 manifest files.
  - New `exclude-match.js`, an offline model of the mksquashfs matching.
  - New `verify-iso-redistribution.sh`: one `unsquashfs -l` pass, needle table. Sourced by the build verifier, also
    runnable standalone. It took over the WO-870 dev-box needles to keep `verify-iso-squashfs-excludes.sh` under
    500 lines; WO-1094's lines are untouched.
  - New curated smoke `smoke-wo1096-iso-redistribution-excludes`. `smoke-wo870-eggs-config`'s fragment regex now
    includes `redistribution`.
- **F (`9ed52fb3`).**
  - `tools/release/licenses/` is tracked:
    - `COMPLIANCE-ISO.md` (rewritten: BMD and MagicQ **not on the ISO**, NDI §2(a)/(b)/no system path/no Tools,
      NVIDIA, and the GDTF decision);
    - `SOURCES.md.in`;
    - vendored upstream texts with provenance in `README.md`: Caspar GPL-3 at 8a2e29372, CEF LICENSE, Chromium
      142.0.7444 `LICENSES.chromium.html` (from Electron v39.2.4 = Chromium .177, the nearest published credits for
      CEF's .176; xz 180 KB), Godot 4.7.2 LICENSE + COPYRIGHT.txt, Companion 5.0.2, penguins-eggs.
  - New `collect-licenses-stack.sh`, sourced by the collector. It writes:
    - next to the binaries: `bin/LICENSE` + `bin/SOURCE.txt` (Caspar version read from the binary and checked
      against PINNED), `lib/LICENSE-CEF.txt`, `~/companion/LICENSE.md`, `cores/<pkg>.copyright`;
    - into the tree: all the texts, the scanner copyright, `ubuntu-packages.tsv` (1827 packages with source
      package + version), and **`SOURCES.md`**, a written 3-year source offer (requests via
      github.com/mko1989/highascg/issues) plus exact directions for HighAsCG at its commit, Caspar tag
      `highascg-<sha9>` + source tarball, CEF/Chromium tag, scanner v1.4.0, eggs v26.10.30 + our patch, WayVR
      v26.8.0, Godot, Companion, each core's Ubuntu source version, npm and Ubuntu packages.
  - Collector fixes:
    - the NDI version is read from `lib/` first;
    - manifest BMD = `not-on-iso`;
    - NDI notes complete;
    - `HIGHASCG_LICENSES_OUT` override for tests.
  - `get-cores.sh` keeps each core's copyright and version.
  - `verify-iso-redistribution.sh` `licence_tree_check` **requires** SOURCES.md, COMPLIANCE-ISO.md, the NVIDIA
    agreement (tree + dpkg copyright), the NDI PDF, and the Caspar/CEF/Chromium/Godot/Companion/cores/eggs texts,
    each when its component is on the image.
  - THIRD_PARTY_NOTICES: the CEF line is corrected, and a new "ISO image components" section is added.
  - `EGGS_EXCLUDE_LIST.md`: WO-1096 block + NDI row conditions. `docs/ISO_CONTENTS.md`: the BMD claims are fixed.
  - New curated smoke `smoke-wo1096-licence-tree`, which also asserts the NDI trademark + ndi.video in both clients:
    - `client/lib/ndi-attribution.js` (used by `live-input-modal.js` / `device-view-inspector-stream.js`);
    - `stream_record_model.gd` `NDI_ATTRIBUTION` (used by `live_input_dialog.gd`). In Godot it is the text
      "ndi.video", not a clickable link.
- **B (`3684115b`).**
  - Every one of the 183 shaders has a header (title — by author / URL / License).
  - New `src/shaderfx/shader-licence.js` and `tools/shaders/shader-licence-manifest.js` (`--check`).
  - `template/shaders/LICENSES/{README.md,manifest.json,opt-in.json}`: third-party works, **NOT under the AGPL**.
  - The 7 out are deleted (both halves; the box copies are in `~/.highascg/backup/wo1096-shaders/`, already
    excluded). `RETIRED_SHADER_IDS` hides leftovers on other boxes until they carry a header.
  - The Shadertoy importer writes the header and refuses "All rights reserved" code.
  - Also: a NOTICES section, a verifier needle, the ShaderToyLite BSD text in the licence tree, and a curated smoke.
  - `sh-console`, `sh-test` and `sh-wavy` were re-exported from the box's live JSON, so they also pick up its audio
    channel; `sh-test` is renamed "squeres".
- **D (`7ece04b7`).**
  - `template/lower-thirds/lt-tween.js` (original, 342 lines): timeline `set` / `to` / `fromTo` / `call` /
    `addLabel` / `kill`, positions, stagger, the standard ease families, timeScale.
  - All 10 templates, the lt-engine files, the .gtzip generator, the export path rewrite and the thumbnail settle
    use it.
  - `src/cg-studio/legacy-tween-migrate.js` rewrites older `template/studio/*.html` exports at boot (idempotent).
  - `vendor/gsap.min.js` deleted; verifier needle and curated smoke added. The dead timeline eases are dropped
    (power1.out is what always played); classic-box's lead-in is explicit.

## 3. What was VERIFIED

### Gates (16.11, after the last commit)

| Gate | Exit code |
|---|---|
| `verify:script-paths` | 0 |
| `check-max-file-lines` | 0 |
| `check-unwired-exports` | 0 |
| `node index.js --no-http` | 0 |
| `lint` | 0 |
| `format:check` | 0 |
| `npm-audit-ci` | 0 |
| `check-npm-licenses` ("154 production packages") | 0 |
| `run-offline-tests` (6880 tests: 6873 pass, 0 fail, 4 skipped, the rest known `todo`) | 0 |
| `godot/client/run-client.sh --test` (28907 passed, 0 failed) | 0 |

### E
- **The 11.11 ISO** fails `verify-iso-redistribution.sh` with 13 groups, as expected: root, BMD, MagicQ, NX, Zoom,
  NM, cookie, baks, libndi, cef, noble, mario, wetransfert. Its licence checks also fail: no SOURCES.md and none of
  the new texts.
- **A synthetic tree:**
  - the full 11.11 listing, 190,016 entries, recreated as empty files;
  - real `mksquashfs -wildcards -ef` with today's generated list.

  Result: every exclude group OK. The model and mksquashfs agree path for path (188,343 kept each, zero diff).
- **The host-path check:** every audit item excluded except the intended `lib/libndi.so.6`.
- **The curated smoke** builds a tree, squashes it with and without the list, and checks:
  - the good image → rc 0;
  - the bad image → rc 1;
  - a missing SOURCES.md → rc 1.

### F
- **The collector, run into a scratch output** (`HIGHASCG_LICENSES_OUT`, `HIGHASCG_LICENSES_NEXT_TO_BINARIES=0`) →
  rc 0, 17 manifest components.
- **INDEX.md** lists:
  - BMD as "NOT on ISO";
  - NDI 6.3.2;
  - Caspar `2.5.1 8a2e29372 Stable`;
  - CEF 142.0.17;
  - Godot 4.7.2;
  - Companion 5.0.2;
  - eggs `26.10.30+highascg1`;
  - WayVR v26.8.0;
  - the 3 cores with their Ubuntu versions.
- **SOURCES.md** rendered with no placeholder left. Its links point at:
  - this repo's commit;
  - `highascg-8a2e29372`;
  - media-scanner v1.4.0;
  - wayvr v26.8.0;
  - godot 4.7.2-stable;
  - the 3 cores' `apt-get source`.

### A
- `/api/templates` has no `MARIO/INDEX` (only `SHADERS/SH-MARIO` remained before B), and `GET /template/mario/index.html`
  → 404.

### B
- After the node restart (16.11 12:24, under the flock), `/api/shaders` → 189 (183 + 6 fc). No retired id.
- `shader-licence-manifest.js --check` → 0.

### C
- The node restart loaded the new `routes-ingest.js`.

### D
- **Headless parity** (puppeteer, fake clock, 20 ms frames):
  - max |Δ| = 0 for computed opacity / transform / origin / dashoffset on all 10 templates;
  - speed 2 + next(): 0 mismatches;
  - studio hold-in: 0 mismatches;
  - migrated old exports: 0;
  - a generated .gtzip template: 0.
- **Side-by-side screenshots:** I viewed classic-box (pixel-identical). The sheets are in the session scratchpad
  (`wo1096/D/shots/sbs/`).
- **After restart:** `template/studio/*.html` has 0 files still loading `vendor/gsap`, and `lt-gradient-wave-marcin.html`
  loads `lt-tween.js`.

### Not verified
- **No eggs produce** (as instructed): the first real ISO after this must pass `verify-iso-redistribution.sh` /
  `verify-iso-squashfs-excludes.sh`.
- **The live licence tree** `/usr/share/doc/highascg/licenses/` was **not regenerated** (I did not write into
  `licenses/`). `build-highascg-egg.sh:161` runs the collector, which also writes `bin/LICENSE`, `bin/SOURCE.txt`,
  `lib/LICENSE-CEF.txt`, `~/companion/LICENSE.md` and `cores/*.copyright`.
- **The new lower thirds were not played on air in Caspar's CEF 142**: headless Chrome 149/150 only.
- **The Shadertoy terms page** could not be re-read by me (403 / archive 429); the B agent's archive reading and
  secondary sources are cited.

## 4. Owner decisions (facts, not done here)

1. **Git history and published releases.**
   - `e01aee9a` (2026-07-15) onward carries the Nintendo sprites and sounds.
   - All 13 Server release tarballs from 2026-10-22_214247 to 2026-11-16_100252 carry 24 `template/mario/s*`
     entries each, plus GSAP, wetransfert, the removed shaders and the old icons.
   - Retracting or replacing them and rewriting history are the owner's call. Nothing was rewritten.
2. **Old ISOs**: `/home/eggs/…11-02_2029.iso`, `…11-03_1038.iso`, `~/iso-backup/…11-03_1038.iso`, and the 11.11 ISO.
   - They carry `root/.ssh/known_hosts`, NM bssids, the pulse cookie, BMD/MagicQ leftovers, mario, wetransfert and
     the shaders.
   - 11-02 / 11-03 also carry `~/backups` (WO-1095).
   - Do not distribute them; delete or retract them once a clean ISO exists.
3. **GDTF Share login ships** (16.11.26, owner): *"i wanted to leave the highascg login, so getting the gdtf files
   would be easier, streamlined"*. GDTF Share T&C §5: keep login details confidential.
4. **Ubuntu trademarks** (Canonical IPR policy) **and codec patents** (H.264/HEVC/AAC in ffmpeg, x264/x265, CEF):
   owner decision (WO-1095).
5. **Shutter Encoder / 7zip-rar on the build host.**
   - Shutter Encoder is excluded from the ISO; uninstalling it is the owner's call.
   - 7zip-rar ships: the unRAR licence allows free distribution; nothing uses it.
6. **The permanent payload gate** (`third-party-payload.json`, WO-1095 §design) is still to do: follow-up WO.
7. **Shaders:**
   - the four unknown-origin shaders are out until the owner names their author (an own-work header brings one
     back);
   - three shaders ship on probable identification (`sh-ksjb`, `sh-mb-fork-polar`,
     `sh-raymarched-mandelbaum-reactive`);
   - the six fc shaders do not reach the ISO (no HTML half);
   - stored looks that used `SHADERS/SH-MARIO` (airport.json, llkk.json and backups; 20 hits) now get the "missing
     template" notice.
8. **`template/CasparCG-Guide-HTML-Template-master`** (MIT) declares `gsap ^3.6.0` and loads it from a
   non-existent `node_modules`: keep, port or drop it.
9. **Server release tarball** (`make-github-release-server.sh:163-164`) ships `node_modules` incl. devDeps, e.g.
   lightningcss (MPL-2.0). Recommend `--omit=dev`, or extend the npm licence gate with `--include-dev`.
10. **SOURCES.md is a written offer**, valid 3 years, with requests through GitHub issues. Confirm the contact channel.
11. **G leftovers:**
    - `docs/guides/stick/images/flash_step*.png` are third-party screenshots;
    - the provenance of the eyes / bunny / bounce / logo / favicon art is unconfirmed;
    - Vite emits no licence file for `dist-web/`.

## 5. Left as is (named, not fixed)

- `client/assets/map-data.json` (generated code map) still mentions wetransfer 65 times. It is historical.
- `docs/wiki-site/assets/wiki-bundle.js` (built 07.11) still contains the old `template/mario` text. Rebuild it with
  `npm run wiki:build` once the other agents' doc edits are committed.
- The legacy `tools/eggs/live-usb/exclude.list` (pre-coa eggs) is not updated; coa reads only `custom.exclude.list`.
- ~~After a phantom-free fresh install, dpkg would not recreate BMD conffiles (`dracut-blackmagic.conf`, init.d) only
  if a stale status entry existed. The dpkg status is excluded, so `dpkg -i` from exFAT is a fresh install.~~
  **Corrected (WO-1106 B74):** the dpkg status is not excluded; the stale `desktopvideo` entry ships, so the per-box
  `dpkg -i` does not recreate the excluded `dracut-blackmagic.conf` (see §1 E). Open: `--force-confmiss` or strip the
  phantom records.
