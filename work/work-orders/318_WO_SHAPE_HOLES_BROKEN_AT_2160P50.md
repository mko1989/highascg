# WO-318 — Punch holes through Firefox still broken on the operator GUI monitor at 2160p50

**Source:** todos21.07.26 — "the punch holes in firefox doesnt work currently on the operator gui
monitor (at 2160p50)". Earlier same-day report: "the gui displays correctly, the caspar windows
under also show up when i alt tab them. but no punch holes thru firefox."

## What was already found and fixed (2026-07-21, in the working tree, NOT yet committed)
Two real code bugs were root-caused live and fixed, with offline tests
(`tools/smoke/smoke-operator-gui-4k-layout-rect.test.js`, in the ci gate, suite green 1234/0):

1. **Mode-token type confusion** — `src/utils/os-layout-calculator-place.js`: a
   multiview/operator_gui head's `osMode` can carry a Caspar mode id ("2160p5000") instead of an
   xrandr token; it was trusted literally, failed the WxH parse, and silently defaulted the head
   to 1920x1080 — so the shape pipeline computed a 1080p rect on a 2160p monitor. Guarded:
   only `\d+x\d+`-shaped tokens are used as-is.
2. **No A/B port-pair resolution** — `src/utils/xrandr-output-resolve.js`:
   `resolveSysIdToXrandrOutput` never consulted `config.gpuPhysicalTopology` (the dpA/dpB pairing
   table), so a pinned "DP-5" from an earlier boot did not resolve to the same physical port's
   live "DP-4" and fell into a fuzzy name heuristic. Now resolved via the pair table first.

Verified against the live config: the operator port now resolves DP-5 → DP-4 and computes
3840x2160 (was 1920x1080).

## What is still open — three items, in order

### 1. Stale legacy `screen_3` override duplicates the port (owner chose to clear it via the UI)
`config/general.json` still carries flat `screen_3_system_id: "DP-5"`,
`screen_3_force_os_resolution: true`, `screen_3_os_mode/os_rate/os_backend` — while
`config/caspar_server.json` (nested `casparServer`) says `null`/`false` for the same keys. The
re-injection in `src/utils/os-layout-calculator-assign.js` (~lines 238-253: operator screen
assignments re-added whenever `screen_N_force_os_resolution` is true, even when a device-graph
binding exists) makes the SAME physical port appear twice in the plan, so the multiview head's
auto-stacked X lands at 6912 instead of 3072. **Owner action:** GPU port inspector → screen 3 →
uncheck "Force OS resolution", clear the custom fields, Apply. (Code hardening for the
readCasparSetting/readScreenSetting precedence split-brain is a separate, deliberate non-goal
here — too invasive for a live box; open a dedicated WO if it bites again.)

### 2. DPI-scaling interaction — checked 2026-07-21, cleared as a rect-payload suspect
The same-day 4K scaling fix (`src/system/operator-gui-scale.js`) sets Firefox
`layout.css.devPixelsPerPx` to **2** on the operator monitor, which halves every CSS-px value the
client sees. This does NOT corrupt the hole rects: `cellRectsToLayoutCells`
(`client/lib/operator-gui-mode.js:110`) normalizes DOM rects to 0-1 fractions of the CSS viewport
(`getBoundingClientRect ÷ innerWidth/innerHeight` — same units in numerator and denominator), so
the payload is dpr-invariant by design and the overlay scales fractions by the real X window
geometry. What DOES still need one live confirmation: the overlay matches the kiosk window by
exact device-px geometry equality, so it only latches once the kiosk window is genuinely
3840x2160 at the correct X offset — which is exactly what item 1 plus today's two fixes restore.
Check the overlay log for a successful match line before blaming anything else.

### 3. Live verification sequence (after 1 and 2)
- Restart the node service (`kill -TERM`, systemd restarts it) so the working-tree fixes load;
  kiosk reload for any client change (dist-web rule: `npm run build:client` first).
- Confirm in the journal: overlay matched the kiosk window at 3840x2160+<x>+0 with x=3072, and
  a rects payload with plausible device-px values.
- Confirm by eye: video holes show Caspar output; holes are click-dead; alt-tab not needed.
- `~/.highascg/log/operator-shape-overlay.log` clean of match/geometry warnings.

## Acceptance
- Punch holes work on the operator monitor at 2160p50 exactly as they did at 1080p.
- Works across a service restart AND a full reboot (port may re-enumerate DP-4↔DP-5; the pair
  table must absorb it with no manual re-apply).
- Offline tests cover the dpr=2 rect scaling; `npm run test:ci` → 0 fail.
- Today's two fixes + tests committed once verified (owner asks for commits explicitly).

## Constraints
- LIVE box. Coordinate restarts with the owner; no config file edits behind the UI's back —
  item 1 is explicitly owner-via-UI.
