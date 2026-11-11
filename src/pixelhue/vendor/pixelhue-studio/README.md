# Pixelhue Studio

For integrations and AI-assisted development, see the [searchable Node.js API catalog](api-library/README.md): JSON endpoint contracts, manual tables, source references, type lookup and an offline CLI.

A fast local client for Pixelhue device setup, inputs, outputs, screens, programming and multiviewer layouts. Version 1.6.0-alpha.2 is a pre-release of the full client: it adds the Audio matrix, layer effects, keying, Cut & Fill, layer presets, source backup, self-test, output and screen format/colour, screen test patterns, MVR device layouts, gallery management, detailed timing and EDID files. These additions follow PixelFlow's own requests but have not yet been run against hardware; see `work/checklist-wo036.md` and `work/checklist-wo037.md`. It does not cover every PixelFlow function ([what is left](docs/pixelflow-parity/README.md)). Portable distributions include Node.js. Running from source requires Node.js 22 or newer, with no npm dependencies or UI build step.

```sh
git clone https://github.com/mko1989/pixelhue-studio.git
cd pixelhue-studio
npm start
```

Open **http://127.0.0.1:3210** in your browser and enter the device IP in the top bar. The connection controls, detected model and serial stay together in the header. Existing source remains in the sibling `mvr-app` folder; this project has its own checkout and GitHub remote. Development rules from `claude.md` are also in `AGENTS.md`.

| Model | Input setup | Capacity choices | Multiviewer editing |
| --- | --- | --- | --- |
| P10 | 4 HDMI/DP + 2 SDI inputs | SL / 4K | Disabled |
| P20 | 8 HDMI/DP + 4 SDI inputs | DL / 4K | Supported |
| P80 | Actual inputs from installed cards | 4K only | Disabled |
| Q8 | Actual inputs from installed cards | Reported capacity, fixed | Supported |

The app detects the model from the serial-verified discovery record, or authenticated node information when using an explicit API port. All models open the Device tab. Other panels load on demand; P10/P80 connection does not query screen/layer endpoints, and their MVR tab stays disabled. The server rejects Multiviewer writes for those models.

See the [PixelFlow feature inventory and Studio gap checklist](docs/pixelflow-parity/README.md): 121 reviewed feature groups across every main tab and global tools, with original source references and searchable JSON.

## Client tabs

Tabs stay in this order:

1. **Device** — discover and connect, device name, identity, firmware and installed cards; identification beacon, genlock and supported fan controls. Work-mode and layer-profile choices come from device configuration. Mode changes use a separate confirmation because firmware may reset screens.
2. **Inputs** — model-aware bulk port/capacity/name/EDID setup. Collapsed Advanced adds Mac compatibility (individual/all supported inputs), native Mac 1×2 tiled groups, input HDCP, advertised signal overrides and image-quality controls. Fields/ranges follow connector and card XML; existing nested values are preserved and writes are read back.
3. **Outputs** — installed Main/AUX/MVR ports with per-port standard-resolution selectors (including fractional Hz) and custom dimensions, bulk names/timing, colour depth, HDCP and patterns. Presets follow device XML, capacity, scan and timing limits; bandwidth checks include sampling/bit depth before writes. Copy ports show their primary timing. P20 has a separate card-level DL/4K control: Switcher DL uses independent HDMI 1/3/5/7; 4K uses 1/5 with the remaining HDMI ports copying them. PGM-only uses its own XML topology. Capacity Apply checks resources and requires reset confirmation; timing changes affecting screens/genlock also require confirmation. Inputs, optical, AUX and MVR routing are preserved. Fill stages a batch; Apply writes and verifies it.
4. **Screens** — create Main/AUX screens, set global origin/dimensions, map actual outputs and position/tile them, freeze, blackout and delete. A port already used by another screen must be unmapped there first. LED screens are listed, but LED topology editing is not implemented.
5. **Programming** — inputs show their physical mapping (for example `IN 1-1`, or the fixed P10/P20 panel input number) alongside the editable source name. Live signals appear first, with numeric physical order within each signal group and compact live/no-signal/warning badges. Status refreshes every two seconds while Programming is visible, using only input metadata and preserving source filters/selection and layer geometry. Filter/select input or other-screen PGM/PVW sources, add layers to PVW or PGM, route sources, drag/resize or enter local coordinates, change stacking and delete layers. Take/Cut supports duration and swap/copy selection. Layout canvases display source names and geometry; monitoring uses the hardware MVR.
6. **MVR** — existing window editor with automatic saves described below.

Dropped sources default to aspect locked, including replacement drops onto an unlocked layer/window. Programming uses the source ratio for inputs, screen PGM/PVW, grouped members, logos and background pictures. MVR placement includes the device-reported UMD height in the full rectangle before checking collisions and input limits, then confirms the new window's actual UMD setting and lock by readback. Enabled strips use a compensated content ratio; UMD off adds no height. No Fix button is needed for a new drop. A source without usable timing starts with the initial fallback ratio; run Fix after its signal becomes available. You can still unlock a window manually; dropping another source establishes the default lock again. Unknown UMD height is reported instead of guessed.

Dropping a replacement source onto an existing layer keeps its top-left X/Y and fits the new ratio inside the previous width and height. Neither dimension grows; MVR includes the UMD strip within those bounds. The replacement remains aspect locked. If the ratio cannot fit at the device minimum size, the replacement is rejected before writing.

Programming position/size changes stream to the edited device screen during dragging and resizing. Numeric fields send valid values while typing; arrow nudges, align and fill also use the live geometry queue. The canvas stays editable while a request is running. Intermediate drag updates are limited to one every 40 ms, with one request in flight and only the newest pending position retained; release/commit sends the final position immediately when the current request finishes. Cancelling a live drag sends the original position back to the device. Normal layer and two-member group geometry use a lean read/validate/write/readback path without reloading presets or sources. Failed writes stop the queue and show Retry save. Take, source changes, aspect changes and other Programming commands wait for pending geometry to be confirmed first.

Device discovery uses Pixelhue's HTTPS service on port **19998**, including on-device services. **Find** checks localhost and the entered address first; when necessary, Scan LAN probes that service on local private IPv4 /24 interfaces, with bounded concurrency. It filters other NovaStar models, lists device identity/address/API port and connects the selected serial. No video preview, streaming or PixelFlow desktop process is required. For other subnets, enter a known address directly.

The Device tab shows layer profiles with their MAIN/PIP layer counts and HDR support, edits the device's Ethernet address (static or DHCP), offers restart, shut down and factory reset (keep user data, keep network only, or erase everything), and names installed cards with the rear-panel ports they carry. Programming shows any set of screens at once, with PGM above PVW. Drag inputs onto either band, move layers anywhere (including off-screen) with edge snapping, Take/Cut all shown screens, and save/load/rename/delete device presets. Screens map outputs with + Add buttons and draggable, snapping tiles. The layer panel has PixelFlow's position/size tools (aspect presets, align, fill screen/output, native 1:1), per-layer KeyFrame and arrow-key nudge. Presets can be absolute or relative and loaded to PVW, PGM or Auto-take (load to PVW, confirm, Take). Grouped inputs pair two layers side by side or top/bottom and move/resize them as one. Live background and multi-input sources are not available on P20 V2.0.0 firmware (WO-025). This client does not yet implement an LED topology editor, blending or the full PixelFlow layer-effect set (WO-017). New setup/programming writes are verified against a mock device; physical firmware QA remains outstanding. Writes use typed routes, actual device IDs and session/origin guards; they are not a general API proxy. Geometry/settings readback detects silently ignored writes. Take/Cut acknowledges the command and refreshes metadata after its duration; output transition completion still needs hardware verification.

## Connect and edit Multiviewer

1. Run this app on a computer that can reach the device over the network.
2. Enter the device address in the top bar and click **Connect**. The app discovers the HTTP API port through HTTPS port 19998, matches the entered IP and verifies the serial using the device's own API. Other discovered NovaStar devices do not require you to enter a serial. If necessary, enter a known API port under the **⋯** connection options; the serial field remains an optional override.
3. Select an MVR output and window. Drag to position it, drag a corner to resize, or type exact X/Y/width/height values. Coordinates are pixels relative to the top-left of the MVR output.
4. Changes save automatically: numeric/keyboard edits coalesce for 100 ms; a drag sends when released. Only changed geometry/locks are sent, one request at a time. The app verifies readback and preserves newer edits made during the request. A rejected save remains editable and exposes **Retry save** instead of looping.

Arrow keys move the selected window by 1 pixel; Shift moves by 10. Ctrl/Cmd+Z undoes an edit, Ctrl/Cmd+Shift+Z redoes it. The Snap menu controls drag snapping; Keep aspect ratio applies to the selected window independently. Save layout downloads JSON with the current geometry and ratio locks, including pending edits. Load layout validates the same device serial, MVR output, resolution and window IDs, then saves automatically. Undo and Redo also save automatically and remain available after a successful save. Refresh waits for an in-flight save, then rereads the device; unresolved pending edits require discard confirmation.

**Fix aspect ratios** reads actual connected-input timing and the dimensions of referenced PGM/PVW screens. It fits each window's video area to its source ratio, preserves its centre, and locks the content ratio for numeric and corner resizing. Screen IDs are resolved separately from input IDs, so Screen 2, Screen 3 and later screens work regardless of their window order.

Enabled UMD strips occupy part of the total window height. The app reads the exact height from authenticated device configuration XML, including per-source-type values, and subtracts it when calculating the video area. The P20 checked on 2026-11-09 reports **24 output pixels** for input, PGM and PVW UMD strips. Disabled UMD adds zero height. The inspector shows the detected height and the canvas marks the strip. If configuration does not provide a height, enabled-UMD windows are skipped with an explanation rather than using an estimated value; reconnect to retry configuration discovery.

The correction normally shrinks within the existing full window rectangle. If the ratio cannot fit at the 64×64 minimum, it tries a minimum-size placement in nearby free output space. Full rectangles, including UMD, must never overlap. Unfittable windows, disconnected inputs and missing/invalid screen resolutions remain unchanged. The fix is one undoable action and saves automatically with verified readback. It waits for earlier saves before reading current source metadata.

UMD-compensated windows use native Custom=5 locks, with the app retaining the content ratio plus fixed label height during resizing. Windows without UMD use native Original=8 locks. The app reads back geometry and lock state after every save. Source ratios are restored precisely when rounded content geometry matches the source within one pixel.

Windows cannot overlap: pointer movement/resizing, numeric edits, alignment, keyboard movement, imports and server writes check the complete rectangles. Edge touching is allowed. Geometry writes are ordered to free space before neighbours use it. A direct swap with no collision-free write order requires an intermediate free position and save.

Existing locks remain movable when a signal disappears or changes. Run Fix aspect ratios after changing source resolutions or toggling UMD. Ratio locks are included in undo/redo, Save/Load and Refresh. Saved layouts record UMD height and reject incompatible current UMD settings. Older layouts preserve their rectangle geometry while converting their locks to account for the current strip. Save only downloads JSON locally.

The canvas is a geometry preview, not a video monitor. The MVR tab moves/resizes windows and adds new ones: drag a screen's PGM/PVW or an input from **Add to MVR** onto empty layout space (or double-click to place it), drop onto a window to swap its source, or use the window's Source menu and Delete window. Each source can appear once, and windows may not overlap or leave the output. MVR template selection is not implemented yet. Saved layouts depend on stable window IDs; recreate them if PixelFlow regenerates the windows.

For the local PixelFlow Q8 simulator, enter **127.0.0.1** as the device address; its advertised API port is discovered automatically. The simulator used for verification exposed two MVR outputs and 72 physical input ports across six installed cards. Counts depend on the card configuration. Empty MVR outputs need initial windows created in PixelFlow.

## Inputs creator

Inputs creator adapts to the connected model. **P20** lists Inputs 1–8 with **HDMI 2.0 / DP 1.2** selection and SDI Inputs 9–12. **P10** lists four HDMI/DP inputs and SDI Inputs 5–6. Missing cards are omitted. **P80 and Q8** enumerate actual input connectors on their installed cards, with each physical port kept fixed; there is no assumed input count or HDMI/DP pair switching. Output and MVR interfaces are excluded. Q8 retains each reported capacity and work mode; the capacity and port selectors are fixed. Inactive ports are labelled. Names and supported EDIDs can still be configured.

Configure supported capacity and source names individually or in bulk. HDMI/DP (and supported DVI) inputs also expose EDID width/height/frame rate/timing standard. EDID frame rates use Hz, including fractional rates such as 59.94. Imported EDID files and detailed timings are kept until you edit the EDID fields; editing replaces them with a preset timing. Device-managed capacities are read-only and bulk capacity choices preserve them. Other connector types expose their detected signal rather than an invented EDID editor.

Row and bulk capacity choices follow the detected model, and the server rejects unsupported capacity changes before any write. An existing unsupported/legacy value can be preserved during name or EDID edits; it appears as a disabled current-value entry and cannot be used for a new port/capacity configuration. Device-managed values are preserved.

SDI does not use EDID. Its rows show detected signal timing; bulk HDMI/DP selection and EDID presets leave SDI untouched. SDI name/capacity changes preserve existing connector routing and exclude the optical ports on the same card.

To configure multiple inputs at once:

1. Select the rows to configure, or use **Select all**.
2. Set the bulk port, capacity, EDID preset and optional name pattern (for example `Camera {n}`). Leave individual bulk options at **Keep** to preserve those fields.
3. Click **Fill selected** to stage the settings. You can still edit individual rows.
4. Click **Apply inputs** to send the pending changes and verify device readback.

Capacity/port changes first use PixelFlow's resource-assessment endpoint. The server writes only the affected input connector pairs and resolves interface IDs again after switching ports, before applying names and EDIDs. Output, MVR and AUX connector modes are excluded. Input changes may interrupt signal acquisition or affect sources used by live layers. Changes across modes, names and EDIDs are sequential and can partially succeed; after an error, refresh inputs to inspect actual settings.

The P10/P20 slot/pair mappings follow their backboard configurations in the supplied PixelFlow source. P80/Q8 inputs require a reported input interface joined to its actual card connector. Names are limited to 32 UTF-8 bytes, matching PixelFlow. Device firmware enforces bandwidth and timing limits beyond the editor's basic validation.

## Firmware limits

Free placement is subject to what the device firmware accepts. The supplied PixelFlow source locks input sizes on devices with `Features.Layer.TemplateFixedInput.Support === 1` and checks overlaps and screen boundaries. A third-party editor cannot remove hardware/firmware restrictions. If a write is rejected, changed, or silently ignored, the app reports an error and retains the pending edit for inspection; click Refresh to see the actual device state. Apply may partially change a batch before a firmware error; it does not perform an automatic rollback.

MVR output dimensions come from `screen.timing.horizontal.addTime` / `vertical.addTime`, falling back to `mosaic.window`. If neither is available, the app warns that 1920×1080 is assumed. Minimum editable window size is 64×64. Overlap rules and per-source scaling limits are left to the device, which may reject a layout even if it fits on the canvas.

**Hardware verification remains necessary:** Q8 IP-only connection, input name/EDID writes, repeated MVR geometry Apply and aspect locks on both outputs were verified against the local PixelFlow simulator. Simulator results and automated tests do not prove physical firmware behavior.

## Connection details

The integration follows the supplied `companion-module-pixelhue-switcher-2.2.7`:

- Discover at `https://DEVICE:19998/unico/v1/ucenter/device-list` and use the selected device's advertised HTTP port.
- Read `/unico/v1/node/open-detail`; sign an HS256 JWT with payload `{SN: sn}`, secret `startTime`, and no timestamp. Send the raw token as `Authorization`.
- Read `/unico/v1/screen/list-detail` and `/unico/v1/layers/list-detail`. MVR screens have `screenIdObj.type === 8`; layer membership comes from `layerIdObj.attachScreenId`.
- Write `PUT /unico/v1/layers/window` with `[{layerId, window: {x, y, width, height}}]`.

Input settings follow the supplied PixelFlow source maps: read `interface/list-detail` and `node/subcard/mode?nodeId=1&startSlotId=0&endSlotId=100`; assess with `system/auxiliary/assess/subcard-mode`, then write `node/subcard/mode`, `interface/general`, and `interface/preset-thumb-timing`.

The Node server handles device communication, so browser CORS does not affect the P20 connection. Discovery accepts the device's self-signed certificate, matching Companion; subsequent API traffic uses HTTP. Tokens remain in server memory. This app has one active device connection per process; another tab switching devices invalidates older tabs' Apply sessions. Use Refresh to load the current connection. Do not edit the same layout simultaneously in multiple tabs or in PixelFlow.

By default the web server listens only on `127.0.0.1`. `PORT=3211 npm start` changes the port. For access from a tablet on a trusted LAN, use `HOST=0.0.0.0 npm start` and browse to the computer's IP on port 3210. There is no user authentication; keep this local control app on a trusted network. No server-side runtime files are written.

## Portable distributions

The UI uses locally embedded [Rewir Light](https://github.com/warszawskie-kroje/rewir) throughout, including controls and numeric fields. Font files, attribution and the SIL Open Font License are included under `public/fonts`; no external font service or system font installation is needed.

The previous stable MVR/input editor is [v1.5.0](https://github.com/mko1989/pixelhue-studio/releases/tag/v1.5.0), with a bundled Node.js runtime and launchers:

- [Intel Mac](https://github.com/mko1989/pixelhue-studio/releases/download/v1.5.0/Pixelhue-Studio-1.5.0-macos-intel.zip)
- [Apple Silicon Mac](https://github.com/mko1989/pixelhue-studio/releases/download/v1.5.0/Pixelhue-Studio-1.5.0-macos-silicon.zip)
- [Windows x64](https://github.com/mko1989/pixelhue-studio/releases/download/v1.5.0/Pixelhue-Studio-1.5.0-windows-x64.zip)
- [Ubuntu x64](https://github.com/mko1989/pixelhue-studio/releases/download/v1.5.0/Pixelhue-Studio-1.5.0-ubuntu-x64.tar.gz)

Extract the full archive, then launch `Start Pixelhue Studio.command` on Mac, `Start Pixelhue Studio.cmd` on Windows, or `Start Pixelhue Studio.sh` on Ubuntu. The launcher opens your browser and prints the URL; keep the terminal window open and use Ctrl+C to stop. No separate Node/npm installation is required. The default port is 3210, with automatic fallback through 3220 if occupied. `PORT` overrides this choice; `PIXELHUE_NO_BROWSER=1` disables automatic browser opening.

Current builds also include Raspberry Pi archives: **raspberry-pi-arm64** for a 64-bit OS and **raspberry-pi-armv7** for a 32-bit OS. Check with `getconf LONG_BIT` on the Pi; choose by OS bitness. Use Raspberry Pi OS Bullseye or newer on an ARM64/ARMv7 CPU; there is no ARMv6 build. Both include Node.js and the Unix launcher. Extract the archive and run `./"Start Pixelhue Studio.sh"` on the Pi desktop. For a headless Pi, run:

```sh
HOST=0.0.0.0 PIXELHUE_NO_BROWSER=1 ./"Start Pixelhue Studio.sh"
```

Then browse to `http://PI_IP:3210` from another computer on the control network (use the printed port if it changed). After building, local archives and checksums are listed in the generated `dist/README.md`. ARM archive contents and architecture are verified on the build host; native Raspberry Pi execution remains target QA. Runtime requirements follow the [pinned Node platform/toolchain list](https://github.com/nodejs/node/blob/v22.23.4/BUILDING.md#platform-list).

These are portable folders, not signed installers or notarized macOS `.app` bundles. Runtime compatibility follows [Node 22's platform requirements](https://github.com/nodejs/node/blob/v22.23.4/BUILDING.md#platform-list). See each archive's `README.txt` and `build-info.json` for usage and runtime provenance. The release includes `SHASUMS256.txt` and `manifest.json` with archive checksums, plus `verification.json` recording performed checks and native execution limits. The full-client pre-release is [v1.6.0-alpha.2](https://github.com/mko1989/pixelhue-studio/releases/tag/v1.6.0-alpha.2), with the same six portable targets; v1.5.0 stays the latest stable release until the alpha has been checked on hardware.

To rebuild on macOS/Linux with Node 22+, `tar`, `zip`, and `unzip`:

```sh
npm run build:dist
npm run verify:dist
```

The builder downloads pinned official Node 22.23.4 runtimes and checks their SHA-256 hashes against the official release checksums before extracting them. Its cache is `.dist-cache/`. It packages only application source, web assets, runtime/license, launcher and build metadata. The verifier checks archive hashes, source hashes, native binary formats, archive contents, and the extracted native launcher when running on a matching supported build host. Other target execution still requires target OS QA.

## Verification

```sh
npm test
npm run check:size
npm run build:client
```

The Node test suite covers authentication, IP-only discovery in the presence of another device, serial/model verification, MVR membership, geometry limits, rejected and ignored writes, P10/P20/P80/Q8 input mapping and batch writes, P10/P80 MVR rejection, resource assessment, refreshed interface IDs, EDID payloads, stale sessions, origin checks, resize math, layout import validation, PGM/PVW screen-source resolution, device XML UMD heights and UMD-aware resize/save/readback. Tests need permission to listen on local loopback sockets.

Version 1.6.0-alpha.2 passes 224 tests, including the offline API catalog. Chrome checks cover all six tabs, device/input/output/screen/programming mock writes, MVR autosave during typing/in-flight edits, drag completion, retry, UMD-aware input/PGM/PVW correction, locked resizing, Undo/Redo, Save/Load and mobile fit. CI runs the curated offline suite, the 500-line source limit and static client checks. P20 device configuration was read to confirm the 24-pixel UMD height; physical output verification after saves remains necessary.
