# CEF interactive bridge (operator X11 → CDP)

Operator mouse/keyboard on the multiview (or interactive screen consumer) is forwarded to embedded CEF HTML via Chrome DevTools Protocol. Host-channel webpages ([WO-88](../../work/work-orders/88_WO_HOST_CHANNEL_LIVE_SOURCES.md)) keep the CEF tab alive; [WO-89](../../work/work-orders/89_WO_CEF_OPERATOR_CONTROL.md) routes input to the host channel tab.

## Enable

1. `operatorTools.cefInteractiveBridge: true` in `config/general.json`
2. `<remote-debugging-port>9222</remote-debugging-port>` in `casparcg.config` (non-zero)
3. Interactive multiview or screen consumer enabled in layout settings
4. Webpage host source playing on a dedicated channel (`PLAY ch-N [HTML] … LOOP`)

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `HIGHASCG_CEF_INTERACTIVE_BRIDGE` | on | Set `0` / `false` to disable the bridge |
| `HIGHASCG_CEF_INTERACTIVE_LAYER` | `999` (or `operatorTools.cefInteractiveLayer`) | Operator consumer layer for legacy L999 path |
| `HIGHASCG_CEF_FORCE_LEGACY_INFO` | off | Force AMCP INFO needle resolve on operator layer (dev/load-test) |
| `HIGHASCG_CEF_BRIDGE_TRACE` | `1` (on) | Bridge + X11 stderr trace; `0` to silence; `all` includes mousemove |

Trace output appears in HighAsCG logs as `[CEF bridge] …` and in the X11 helper stderr as `x11: …`.

## Keyboard behaviour

- **Modifiers:** X11 events include a `modifiers` array (`Control`, `Alt`, `Shift`, `Meta`). CDP forwarding tracks held modifiers for combos (e.g. Ctrl+C, Shift+click flows that need shift held).
- **HTTP API:** `POST /api/cef-interactive/keyboard` accepts optional `modifiers: ["Control"]` (aliases `Ctrl`, `Cmd`).
- **Autorepeat:** The X11 poller uses `XQueryKeymap` snapshots (~60 Hz). It emits keydown/keyup on **state transitions** only. OS key autorepeat does **not** produce repeated keydown events unless the keymap flickers — by design so Thunar and other apps are not flooded. For held-key repeat inside CEF, use the HTTP API or type text via `keyboard.type`.

## HTTP API

See [system-settings-hardware API](../wiki/api/system-settings-hardware.md#host-live-sources--cef-interactive).

## Related files

| File | Role |
|------|------|
| `src/system/cef-interactive-bridge.js` | X11 zone poll → CDP |
| `src/system/cef-interactive-forward.js` | Shared `forwardToCefTarget()` for HTTP |
| `src/system/cef-focus-registry.js` | `cefFocusTarget` from operator fullscreen |
| `tools/runtime/cef-interactive-x11.py` | Passive pointer/keymap capture |
| `tools/runtime/cef-interactive-load-test.sh` | Legacy L999 dev test |
