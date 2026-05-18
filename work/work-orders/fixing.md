# Fixing — LED test pattern + device view / GPU connectors

Local scratch notes (`work/` is gitignored — see root `README.md`).

---

## 1. LED test card — HTTP 502 / `COMMAND_UNKNOWN_DATA`

### Symptom

Running the LED test pattern from the GUI surfaces an error similar to:

```text
LED test card: HTTP 502: COMMAND_UNKNOWN_DATA: CG 3-999 ADD 0 led_test_pattern/index 1 "{\"showLedGrid\":false,\"showCircle\":true,\"showCross\":true,\"resolutionLabel\":\"1280×720 · 720p5000\",\"resolutionWidth\":1280,\"resolutionHeight\":720,\"videoMode\":\"720p5000\",\"connectorLabel\":\"Output: Multiview (ch 3) · Screen consumer · 720p5000\",\"ipLines\":[\"100.93.95.67\",\"192.168.0.10\"],\"centerLabel\":\"HighAsCG\",\"showCenterCharacter\":true,\"cols\":20,\"rows\":10,\"panelWidth\":192,\"panelHeight\":108,\"showPanelLabels\":false,\"showSpecLine\":false,\"pattern\":\"bouncing-element\",\"charCount\":3}"
```

### Notes

- Caspar rejects the `CG … ADD …` line (`COMMAND_UNKNOWN_DATA`): validate channel/layer, flash template name/path, AMCP quoting/escaping for JSON payload, and server version vs. what the UI assumes.
- Trace from HTTP handler → AMCP builder → `AmcpClient` / Caspar logs on the box running the engine.

---

## 2. Device view — config generation + connector “online” state

### Symptom / gap

Config generation and marking GPU outputs as **online / connected** in device view do not reliably match the machine (physical cabling + EDID / kernel display state vs. configured multiview / consumer modes).

### Example ground truth (host)

`DISPLAY=:0` / `XAUTHORITY=~/.Xauthority`, then `xrandr --query`:

- Many NVIDIA `DP-*` outputs **disconnected**; one output (e.g. `DP-7`) **connected** at **1920×1080**.
- UI may still label multiview / screen consumer as **1280×720 · 720p5000** — metadata can drift from **actual framebuffer / connector** state.

### Work direction

- Tie device-view connector list to real probe data (where appropriate: `xrandr`, DRM, or existing orchestrator) before generating commands or overlay labels.
- Reconcile “configured mode” vs. “live mode” so templates and CG payloads use consistent width/height and connector identity.

---

## Status

Resolved — Applied fixes for LED test card template name and bypassed stale inventory cache for device view. Ready for verification.
