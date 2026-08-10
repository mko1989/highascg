# WO-468 — New box: "(no Ethernet found)" and operator GUI duplicated onto the PGM2 monitor

**Status: IN PROGRESS (2026-08-10 — two root causes fixed and verified offline; owner QA on highascg7579 owed)**

**Source:** owner, 2026-08-10 — fresh install on a new machine (`highascg7579`, 192.168.0.27):
"it wont display shit on the caspar outputs / the gui doesnt show the ip, only no ethernet port
found / i set operator gui and pgm2 to two different ports and they are displaying both the gui /
the exfat partition on the stick is being mounted as the bridge".

Diagnosed remotely from `.30` over the HTTP API (`/api/system/*`, `/api/logs`, `/api/support/bundle`)
plus an owner-run shell block on the box. Nothing was written to `.27`.

---

## Investigation

### 1. "(no Ethernet found)" — interface allowlist rejects PCI-style names

`/api/system/network` on the box returned `{"interfaces":[], "primaryInterface":null, ...}`, and
[`device-view-inspector-caspar.js:207`](../../client/components/device-view-inspector-caspar.js)
faithfully renders `(no Ethernet found)` for an empty list. The UI is not at fault.

The box's only IPv4 interface is **`enp3s0`** (support bundle `system/inventory.json:1505`,
`04:7c:16:15:c6:e4`, 192.168.0.27). `network-inventory.js:20` filters `os.networkInterfaces()`
through `isAllowedEthernetIface`, which was:

```js
const IFACE_RE = /^(eth|enp|eno)[0-9]+$/i
```

After the prefix it accepts **digits only to end-of-string**. Verified against the real export:

| iface | old | new |
|---|---|---|
| `eno1`, `eno2`, `eth0` | ✅ | ✅ |
| `enp3s0`, `enp4s0` (this box) | ❌ | ✅ |
| `ens33`, `enp0s31f6`, `eno1np0`, `enx047c1615c6e4` | ❌ | ✅ |
| `wlo1`, `lo`, `tailscale0`, `docker0`, `br-*`, `veth*` | ❌ | ❌ |

Every box shipped so far had an onboard `enoN` NIC, so the digits-only suffix never bit. `enp3s0` is
the standard systemd PCI scheme (`p<bus>s<slot>`) and was filtered out entirely — leaving the
operator with no interface to select and no way to configure the network from the GUI.

Note the *inventory* code path enumerates `enp3s0` correctly; only this allowlist was wrong.

### 2. Operator GUI duplicated onto PGM2 — clamp instead of shift in the WO-40a offset

`/api/system/xrandr-layout` already reported the fault: `"ok": false`, mismatch
`DP-0+DP-2 · overlap · expected "unique positions" · actual "6144,0"`. Confirmed in the box's raw
xrandr query:

```
DP-0 connected primary 1920x1080+6144+0
DP-2 connected         1920x1080+6144+0
```

Two outputs at the same framebuffer origin scan out identical pixels; the operator GUI owns that
rect (`/api/system/operator-display` → `DP-0 — multiview 1 @ 6144,0`), so it won on both monitors.
The *planned* layout carried the same collision, so this is the planner, not drift.

Reproduced offline and deterministically from the box's own config
(`support bundle → config/highascg-redacted.json`, no manual `*_os_x` overrides present):

```
screen_2      DP-2  x=6144  1920x1080
multiview_1   DP-0  x=6144  1920x1080   ← same origin
```

`computePlacedLayoutResults` lays heads out left-to-right from a running `cumulativeX`, so each head
already carries a correct *relative* offset. Screen 1 is pixel-mapped (fed to DP-4/DP-6) and holds no
GPU assignment, so pre-offset the two heads sat at `screen_2 = 0` and `multiview_1 = 1920` —
correctly 1920 apart. `applyMappingGpuPlacementOffsets` then moved them past the 6144-wide mapping
bbox using **two different semantics**:

| head | old operation | result |
|---|---|---|
| `screen_2` | `info.x += offX` (shift) | `0 + 6144` = 6144 |
| `multiview_1` | `info.x = Math.max(info.x, offX)` (clamp) | `max(1920, 6144)` = **6144** |

The clamp discards the relative offset and parks the head exactly on the bbox edge — where the first
shifted screen also lands. The `verticalStack` branch already used `+=` for multiview, so the
horizontal clamp was the outlier.

**Second defect, found by the new test while fixing the first:** the multiview/prv offset lived in a
*separate block that ran unconditionally*, not inside the horizontal branch. On a vertically-stacked
layout a multiview head was therefore moved **down and right**. The clamp had hidden this by usually
being a no-op on that path; switching to `+=` exposed it (`x` became `1920 + 1920 = 3840`). The two
placements are mutually exclusive and are now written that way.

### 3. Not defects (recorded so they are not re-chased)

- **Mounts are correct.** `sda3` (internal, `HIGHASCGDAT`) → `/home/casparcg/bridge`; `sdb3` (USB
  stick, `HIGHASCGEXF`) → `/home/casparcg/exfat`. Both systemd units matched their labels. The
  owner's "stick mounted as the bridge" is about *contents*: `bridge/` holds `configs, drop-config,
  media, .private, projects` timestamped after boot, i.e. something copied stick payload onto the
  bridge disk. **Separate seeding issue — still open, not covered by this WO.**
- **DeckLink driver is healthy.** `blackmagic`/`blackmagic_io` loaded, `.ko.zst` payloads present,
  `desktopvideo 16.2a1`, helper active, Caspar enumerates all four 8K Pro cards at startup. Not the
  WO-430/431 missing-payload class. `DesktopVideoUpdater --status` failing is a Qt tool with no
  `DISPLAY`. The `Could not enable video input` errors were the card profile not set to expose
  in+out sub-devices — **owner corrected on the box**.
- **`REMOVE FAILED` flood** (17:19:49→17:22:38) is the config-apply reconcile loop tearing down
  consumers that a factory-default boot never created. Noise from the WO-415 post-stick-insert
  config reset, not an independent fault.
- **Test pattern not visible:** the log shows `CG 1-999 ADD/PLAY led_grid_test` at 17:49:36 followed
  by `CG 1-999 CLEAR` at 17:49:39 — it renders, then something clears it three seconds later.
  **Unexplained, still open**, and independent of the two fixes here.
- **OpenAL:** `Failed to find specified OpenAL output device` — channel 7's `system-audio`
  `device-name` is `sc60mon`, which does not exist on this box. Config carried over from another
  machine. **Open.**

---

## What was done

- **`src/config/network-settings.js`** — `IFACE_RE` → `/^(eth[0-9]+|en[a-z0-9]+)$/i`, covering every
  systemd predictable-name scheme (`eno1`, `ens33`, `enp3s0`, `enp0s31f6`, `enx<mac>`, `eno1np0`)
  while still excluding `wl*`, `lo`, bridges, veth and tun. Comment records why digits-only passed
  unnoticed until this box.
- **`src/utils/os-layout-calculator-offset.js`** — rewritten so horizontal and vertical placement are
  one mutually-exclusive pass over an `axis` (`'x'` or `'y'`), and every head class — screens,
  multiview, prv — takes the same `info[axis] += off` shift. Manual overrides (`screen_N_os_*`,
  `multiview_N_os_*`/`multiview_os_*`, `screen_N_prv_os_*`) are still honoured per axis, and
  mapping-fed screens are still skipped. 105 → 91 lines.

Chose a shift over teaching the clamp about occupied spans: the relative offsets are already correct
when they reach this function, so the only bug was destroying them. Collision detection here would
paper over that.

## What was VERIFIED to work

- `npm run test:ci` → **1933 tests, 1931 pass, 0 fail, 2 skipped** (the two skips are the pre-existing
  CI-gated server-spawn tests). Baseline before the change was 1931/1929/0/2.
- `npx eslint` on all five changed files → **0 warnings, 0 errors**.
- `node tools/ci/check-max-file-lines.js` → **0 files over 500 lines**.
- **New** `tools/smoke/smoke-os-layout-offset-overlap.test.js` (registered in the curated `FILES`
  list) pins: the live highascg7579 shape resolves to distinct origins; screen/multiview/prv keep
  1920 spacing through the offset; a lone multiview head still lands on the bbox edge; each manual
  override key is honoured; `skipWo40aAutoOffset` still short-circuits; and the vertical path moves
  `y` only. This is the test that caught the second defect.
- `tools/smoke/smoke-project-fps-network.test.js` extended with the eight accept and nine reject
  interface cases above. **It was not in the curated `FILES` list** and so had never gated CI —
  added.
- Replay of the box's own config through `calculateLayoutPositions` now yields non-overlapping
  origins: `DP-4 x=0 · DP-6 x=3072 · DP-2 x=6144 · DP-0 x=8064`.

### Owner QA owed (nothing below has been proven on hardware)

1. Deploy to `highascg7579` — the fixes are in the repo on `.30`, not on `.27`.
2. Server restart, then confirm the Device View network section lists `enp3s0 — 192.168.0.27`.
3. Apply the OS layout and confirm `xrandr` shows `DP-0` at `+8064+0` and `DP-2` at `+6144+0`, that
   `/api/system/xrandr-layout` reports `"ok": true`, and that the operator GUI appears on its monitor
   only. **The framebuffer widens 8064 → 9984**; check the GPU accepts it.
4. The Caspar `screen` consumer x positions for the operator GUI and PGM2 must be re-applied to match
   the corrected layout — the owner noted they share an x in `casparcg.config` too.

## Still open (not addressed here)

- Bridge partition seeded with stick payload (§3).
- `led_grid_test` cleared ~3s after PLAY (§3) — likely why "the outputs aren't even showing the test
  pattern".
- Channel 7 `system-audio device-name sc60mon` does not exist on this box (§3).
- Channel 1's decklink consumer declares `2160p5000` with a `subregion` of `3840x2160` from a
  `6144x1536` canvas — the region is taller than the source raster. Suspicious; not yet investigated.
