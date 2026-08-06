# WO-438 — Real-world Art-Net test guide for the Pixel Map destination

**Status: DONE (2026-08-06 — doc shipped, linked from ARTNET_PIXEL_MAPPING.md; owner QA = follow it for A242.1)**

Owner (todos06.08.26 item 4): "make an md file guide on how is the pixel mapping destination
suppose to work in real world (artnet) so i can actually try to test it."

## Investigation

- WO-241's docs (ARTNET_PIXEL_MAPPING.md + two walkthroughs, 15.07) predate the WO-242
  native **Pixel Map destination** — they document the raw consumer schema and the deprecated
  JS pipeline, not the destination flow the owner wants to test. A242.1 (owner: create one,
  light fixtures) has been unchecked since 15.07 — this guide is the missing on-ramp.
- Ground truth pulled from source, not the older docs: fixture fields + clamps
  (`src/config/screen-destinations.js:41-59` `normalizeArtnetFixtureArray`), generated XML
  shape incl. whole-raster single fixture group and spill note
  (`src/config/config-generator-consumer-attach-misc-channels.js:75-110`
  `buildPixelmapChannel`), universe auto-spill math (`src/config/artnet-pixelmap-universe.js`),
  UI field labels (`device-view-destinations-inspector-form.js:325-437`), refresh default
  10 Hz, port default 6454 unicast.
- Box tooling checked: no tcpdump/tshark/ngrep/socat/nc installed — only python3, so the
  guide's packet-watch section uses a ~15-line python3 ArtDMX listener instead of assuming
  capture tools.

## What was done

- New `docs/WALKTHROUGH_PIXELMAP_DESTINATION_TEST.md`:
  - Mapping node vs Pixel Map destination disambiguation table (both live in the Devices
    tab; the owner is actively using both this week).
  - End-to-end mechanism (destination → generated channel + `<artnet>` consumer →
    ArtDMX unicast, area-averaged whole-raster sampling, PGM-only take path).
  - Universe math cheat-sheet (170 RGB / 128 RGBW fixtures per universe, spill rule).
  - Exact box steps with the real UI field names + the Apply/restart requirement.
  - **Hardware-free test path**: grep the generated config for `<artnet>`, python3 ArtDMX
    listener (run on the Controller-IP machine or loopback on the box), monitor-app option.
  - Gotchas: restart per fixture edit, Art-Net-only (sACN = legacy JS path), single
    whole-frame group (multi-group → hand-edit walkthrough or multiple destinations),
    serpentine handled controller-side, unicast.
- Linked first in ARTNET_PIXEL_MAPPING.md's walkthrough header line.

## Verified

- All claims source-cited (files/lines above); spill examples match the
  `computeArtnetUniverseSpill` unit fixtures. Doc-only change — no code, no tests to run;
  `.md` is outside the 500-line CI gate's extension set (`check-max-file-lines.js:10`).
- Owner QA: follow the guide's loopback test (C) end-to-end — that closes A242.1's software
  half without waiting for a controller.
