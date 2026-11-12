# pixelhue-studio (vendored)

A pinned copy (unmodified but for the local patches listed at the end) of the owner's PixelHue Studio (github.com/mko1989/pixelhue-studio): `server.js`, `lib/`,
`public/` (without `public/fonts`), `package.json` (ES modules), `README.md`. The commit is in `VENDORED_COMMIT`.

HighAsCG runs its server in-process on a loopback port (src/pixelhue/studio-bridge.js) and serves its API under
`/api/pixelhue/studio/*`; the Godot client's PixelHue tab is a native UI over that API (WO-1039).

Do not edit files here beyond those patches (each one listed below, with its WO). To update: `tools/dev/vendor-pixelhue-studio.sh <path to a pixelhue-studio checkout>`.

## Local patches (re-apply after a re-vendor, or land them upstream)

- WO-1042 (owner 12.11: "Patch vendored copy"): the P80 joins the multiviewer models — `['P20', 'Q8']` →
  `['P20', 'Q8', 'P80']` in `lib/pixelhue.js` (capability, read, apply), `lib/mvr-layers.js` (window add / edit) and
  `lib/mvr-templates.js` (templates, still probed per device). The P80 reports its MVR outputs as screens of type 8
  like the P20 / Q8; it takes the Q8-like rules Studio already has for non-P10/P20 models (no 512 × 480 input-window
  cap, AUX screens allowed as MVR sources).
