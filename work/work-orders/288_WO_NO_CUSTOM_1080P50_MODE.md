# WO-288 — Generated Caspar config must not emit a custom 1080p50 video mode

**Source:** todos19.07.26 — "in the generated caspar config there is no need to write the
additional mode for 1080p50, standard video modes are built into caspar and dont need to be
called."

## Problem
The config generator writes a `<video-mode>`/custom-mode block for 1080p50 (and possibly other
standard modes). CasparCG ships these modes built in; redefining them is noise at best and a
source of mismatch at worst.

## Scope
1. Find where the generator emits custom video-mode definitions
   (`src/config/config-generator*.js` and friends — grep for `1080p50`, `video-mode`,
   `custom-video-mode`).
2. Determine which modes Caspar 2.6-dev already knows (the standard set: 1080p25/50/5000,
   720p50, 2160p25/50, PAL/NTSC, etc.). Emit a custom mode ONLY for a genuinely non-standard
   resolution/refresh (e.g. an odd LED-wall mode from screen destinations).
3. Remove the standard-mode emission; keep the code path that handles a truly custom mode.
4. Confirm nothing downstream depends on the emitted block existing (grep the config consumers
   and the smoke tests that assert generated XML).

## Acceptance
- Generated `casparcg.config` contains no custom definition for a standard mode; a non-standard
  screen-destination resolution still produces one.
- Existing config-generator smoke tests updated (not deleted) and passing.
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.
- Do NOT apply the config to the live Caspar or restart anything — generation only.
