# WO-747 — The first settings save after every boot reloads every subsystem (AMCP reconnect + routing)

**Area:** devices-config, amcp
**Status: DONE (24.10.26: smoke + sandbox probe; live on .4 after release 214554Z: the first save after boot skipped the reload)**

## Investigation

- Seen on .4 on 24.10, right after the 212858Z update (server up 23:35:12). I toggled **Settings → Defaults →
  Timeline → Loop always** on and back off in the kiosk (WO-722 check: "an unrelated save must not touch confine").
  - 23:35:50, the first save: `[Config] Reloading subsystems...` → OSC restarted, `[v4l2-bridge] Caspar consumer
    removed` … `stopped`, compose-preview FILE consumers removed, `AMCP → INFO 1`.
  - 23:35:53, the second save: `subsystem recycle skipped (… signature unchanged)`, as it should be for a key the
    signature does not cover (`editorDefaults`).
- Cause, `index.js:240` (before this WO): `let subsystemReloadSig = null` ("null until first config change after
  boot").
  - The change listener skips only when `subsystemReloadSig !== null && nextSig === subsystemReloadSig`. The first
    change after boot therefore always takes the full path, whatever changed.
  - The full path (`index.js:252-275`): `restartOscSubsystem()`, `handleConfigReload()` (streaming), DMX
    `updateConfig`, Art-Net `reconfigure`, **`casparConn.start()`** (AMCP reconnect, which re-runs `setupAllRouting`,
    as `config-reload-signature.js` WO-172 notes), compose-preview and v4l2-bridge `onConfigChange`, confine sync.
  - On an on-air box, the first trivial toggle after a restart reconnects AMCP and re-issues routing mid-show.
- Since `e0bbf2f9` (18.05.26, the repo's published history); no WO mentions it (`rg -il "first save|recycle
  signature"` → only WO-722, which quotes the skipped line).
- **Reproduced offline** (`$S/probe747.js`: a WO-719 sandbox server, then two POSTs of
  `{editorDefaults:{timeline:{loopAlways}}}`): `Reloading subsystems...` once, then two `recycle skipped`.
  - In the sandbox, the full reload came from a boot-time config write, 170 ms before the first POST. Either way,
    the first change event after boot reloads everything.
- Boot builds `config` the way the listener's `syncRuntimeConfigFromManager()` does (`Config.buildConfig(cli,
  configManager)` + `applyAuthAndBindPolicy`), and starts every subsystem from it. So its signature is the
  signature of what is already applied.

## What was done

- `index.js`: `let subsystemReloadSig = hashSubsystemReload(config)`, seeded before the change listener is
  registered.
  - A change now reloads only when the signature differs from what is **applied**: boot-applied, or the last reload.
  - Alternatives rejected:
    - a "first change after boot" grace period: a timing guess;
    - forcing a reload on boot-time config writes: they are the same config boot just applied.
- `tools/smoke/smoke-wo747-boot-seeded-recycle-sig.test.js` (new, in FILES).

## What was VERIFIED

- Smoke, 2 tests: the seeded line comes before the listener and the null start is gone; `hashSubsystemReload` stays
  the same for an `editorDefaults` change and differs for `periodic_sync_interval_sec`. Mutation: the line put back to
  `= null` → it fails (restored).
- **Sandbox probe after the fix:** the boot-time change, Loop always on, then off → three `recycle skipped`, no
  `Reloading subsystems`. A covered key (`periodic_sync_interval_sec: 17`) → `Reloading subsystems...` as before.
- Gates: repo-integrity, max-lines, unwired, boot, format; test:ci 3199 pass / 1 fail (WO-498, export-only). Lint 214.
- **Live on .4.** Release 214554Z (cf836104) was installed from .4's kiosk Updates pane; `highascg` active 23:47:20.
  The same toggle as at 23:35, Loop always on then off, as the first saves after that boot:
  - 23:47:44 `Saved modular config` → `subsystem recycle skipped`, and 23:47:47 the same. No `Reloading
    subsystems`, no v4l2-bridge / compose-preview teardown. At 23:35, on the old code, the first save logged
    `Reloading subsystems...` and tore those down.
  - On boot, `[Pointer confine] RUN — operator_monitor_port_2` + barriers on HDMI-0 (helper PID 144129, still
    running after the saves). Caspar running. `editor_defaults.json` `loopAlways: false`, as before.
