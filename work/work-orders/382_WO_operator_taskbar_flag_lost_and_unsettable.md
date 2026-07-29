# WO-382 — Operator taskbar gone + operator-GUI stacking changed: the WO-317 flag was lost and unrecoverable

**Status: 🟡 Implemented 29.07.26 (flag restored live — `enabled: true`; suite 1684/0/2) — owner: confirm the strip and the window behaviour on the glass**

Owner, 2026-07-29:
> "there is also a regression with how the operator gui behaves in relation to other windows as
> well as the app 'taskbar' is gone."

One cause for both halves.

---

## 1. Investigation

`config.operatorTools.multiHelperTaskbar` gates WO-317's helper taskbar
(`src/system/operator-helper-live.js:33`). It does more than draw the strip: with the flag ON the
**helper coordinator** becomes the authority over operator-GUI window stacking; with it OFF the
WO-283 single-helper path is (deliberately — two writers would fight over the kiosk shape flag).
So losing the flag changes both what you see (no strip) and how the GUI behaves against other
windows. That is exactly the pair of symptoms reported.

Measured on the box before the fix:

```
GET /api/system/operator-helper-taskbar  →  {"ok":true,"enabled":false,"helpers":[]}
config/general.json operatorTools        →  pointerConfineMultiview, pointerConfine,
                                            cefInteractiveBridge, cefInteractiveLayer,
                                            cefRemoteDebuggingPort            (5 keys)
```

Those five are **exactly** `defaults.operatorTools` (`src/config/defaults-core.js:39`). The two keys
that were gone — `multiHelperTaskbar` and `cefEnableGpu` — are the two the box had set that
defaults does not carry. `git diff config/general.json` confirms both were there in the committed
state (`3256730 "WO-317 taskbar enabled"`) and are absent from the working tree, so the block was
rebuilt from defaults at some point; a factory reset (the owner ran one recently — WO-363) does
exactly that. The file's last write was 13:55, and the loss predates it.

**The part that made this unrecoverable:** `multiHelperTaskbar` had no writer at all. It is not in
`defaults.operatorTools`, it is not collected by the settings modal
(`client/components/settings-modal-logic.js:131` deliberately leaves `operatorTools` alone), and
`POST /api/settings` applied only `pointerConfineMultiview`, `pointerConfine` and `cefEnableGpu`
(`src/api/settings-post.js:194-205`). Once dropped, the only way back was hand-editing
`config/general.json`. `cefEnableGpu` at least had a Devices-tab checkbox
(`device-view-inspector-caspar.js:104`).

The settings-save path itself is NOT the culprit and was verified sound: `cfg` is `ctx.config`
(the live config, `settings-post.js:44`), and WO-268's merge `{...defaults, ...cfg.operatorTools}`
preserves saved keys, so a narrow patch does not wipe its neighbours. Same for `config-manager`'s
`_merge` (level-1, sub-key preserving) and the persistence block at `:374`.

## 2. What was done

- `src/api/settings-post.js` — `POST /api/settings` now applies
  `operatorTools.multiHelperTaskbar` (strict boolean, same shape as the other keys). The feature is
  recoverable through the normal path instead of an editor.
- Flag restored on the box through that path:
  `POST /api/settings {"operatorTools":{"multiHelperTaskbar":true,"cefEnableGpu":true}}`.

Deliberately NOT done: adding the flag to `defaults.operatorTools`. Its default must stay off
(WO-317's whole safety argument is that exactly one of {WO-283 path, coordinator} is ever live, and
turning it on restacks windows on the live operator monitor). Putting it in defaults would not have
preserved a `true` value through a reset anyway — only made the key present and false.

## 3. What was VERIFIED

- **Live, after the fix**: `GET /api/system/operator-helper-taskbar` →
  `{"ok":true,"enabled":true,"helpers":[],"actions":["nvidia-settings","desktopvideo_setup","desktop_video_updater","firefox","file-manager"]}`,
  and `config/general.json` again carries `multiHelperTaskbar: true` + `cefEnableGpu: true`.
  Server restarted, kiosk reloaded (XTEST F5).
- **Tests**: `tools/smoke/smoke-wo382-operator-tools-flag-settable.test.js` (3), in the curated CI
  list. The third drives the REAL `handlePost` over a defaults-built config and asserts the flag
  reaches both the live config and the persisted one, that the gate
  (`isMultiHelperTaskbarEnabled`) then reads on, that a narrow patch leaves `pointerConfine` /
  `cefEnableGpu` untouched, and that it can be turned back off.
- **Suite**: 1684 pass / 0 fail / 2 skip. Existing WO-317 gate tests still pass unchanged.
- **Owner QA**: the taskbar strip appearing in the operator GUI header, and the GUI's stacking
  against other windows being back to what it was. Both are on-glass judgements — the shape helper
  is running (`pid 161743`, log healthy: "kiosk/consumer adjacency restored").

## 4. Follow-up worth doing

No UI exposes this flag. A checkbox next to the existing GPU one in the Devices tab would make it
visible and self-service; the API half now exists for it.
