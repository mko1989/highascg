# WO-414 — Pinned host channel vs dynamic allocation collision + PGM SOLO (owner follow-up 03.08)

**Status: DONE (2026-08-03 — live-verified: `oal[6|720p5000]`, ch5 back to the NDI host, route://2 default playing on ch6; suite 1801/0/2. Owner QA: SOLO the PGM strip, confirm the macbook strip meter stays quiet while PRV plays)**
**Priority:** High (owner: "im not able to solo the pgm channel so i can monitor it. when audio
was playing on prv it also showed up as meter in macbook ndi input.")
**Source:** owner message, follow-up to WO-406/409
**Related:** WO-406 (§5 predicted exactly this collision), WO-409 (PRV strips + layer-less solo),
WO-377/381 (planned-vs-stored family — stored pins never move)

## 1. Investigation

1. **PGM solo**: pure UI gap. `audio-mixer-console-masters.js:44` rendered the SOLO button only
   for `r.isPreview` strips (WO-409 scope). The whole pipeline underneath already handles it:
   PGM master key `pgm:<ch>` → `soloKeyToTarget` → layer-less `{channel}` → server plays
   `route://<ch>` on the monitor bus.
2. **PRV audio on the macbook NDI meter**: the WO-406 §5 collision, now with proof of a third
   symptom. The stored NDI source pins `hostChannel: 5` (`listHostLiveChannelEntries` uses the
   stored number verbatim); enabling the monitor bus allocated `monitorCh = nextCh++` = **5 as
   well** (`routing-map.js:347`). Two owners, one channel:
   - the generator's channel table (`config-generator-channels.js`, `setChannelXml`) let the
     monitor block **clobber** the NDI block (monitor is set last) — that is why the live
     config had no NDI channel;
   - the mixer's live-input strip (`collectLiveInputMeterRows`) meters `entry.channel` = 5 —
     which now carried the monitor bus route of PRV → PRV audio "showed up as meter in
     macbook ndi input";
   - offline repro: `getChannelMap(boxConfig)` returned `monitorCh: 5` AND `ndi_host: 5`.

## 2. What was done

- **`src/config/routing-map.js`** — dynamic allocation flows AROUND stored host-live pins:
  `pinnedHostChannels` (from `listHostLiveChannelEntries`, lazy-required — circular module) and
  `allocCh()` which skips pinned numbers; all `nextCh++` allocations (multiview, operator-gui,
  inputs, legacy host, extra-audio, monitor, dedicated streaming) go through it. Stored pins
  themselves never move (WO-377/381 design decision stands).
- **`client/components/audio-mixer-console-masters.js`** — SOLO button on every master strip
  (PGM + PRV), title names the bus; same layer-less solo path as WO-409.
- **`tools/smoke/smoke-wo414-pinned-host-channel-collision.test.js` (new, in CI list)** —
  monitorCh skips a pin placed exactly on its would-be channel; no duplicate channel numbers
  across map owners; PGM SOLO source pin. WO-406 smoke's allocation pin repointed to
  `allocCh()` (same resolver gate, never weakened).

## 3. What was VERIFIED to work

- Offline: suite **1801 pass / 0 fail / 2 skip** (1803); repro now yields `monitorCh: 6`,
  `ndi_host: 5`, no duplicates. Line limit clean (routing-map 496/500).
- Live: node restarted → planned roster shows **both** `channel 5: NDI host` and
  `channel 6: Monitor / headphone mix`; Apply + caspar restart →
  `oal[5|720p5000] Uninitialized` / `oal[6|720p5000] Initialized`; solo-clear re-armed the
  default (`previewCh: 6`, `route://2`). Client rebuilt + kiosk reloaded.
- Owner QA: PGM strip SOLO audible on the headset; macbook strip meter stays quiet while PRV
  plays (its ch5 is the silent NDI host again, macbook away).
