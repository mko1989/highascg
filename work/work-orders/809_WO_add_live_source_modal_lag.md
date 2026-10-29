# WO-809 — "Add live input" modal lags after "Add live source"

**Status: DONE (29.10, live e2e on the box) (29.10) — investigation** · fix built in the Godot dialog, verified offline (Godot suite 22182/0, boot
check OK, sandbox GUI e2e 3/3 with click → close timed); owner QA on the glass open · **live e2e 29.10: add live input → dialog closes at once, PASS on the glass**
**Source:** owner 29.10: *"there is a weird modal lag after clicking add live source in add live input modal."*
**Related:** [WO-605](./605_WO_godot_port_device_view.md) slice 11 (the dialog, ported from the web modal incl. its
1.5 s close), [WO-719](./719_WO_gui_e2e_show_creation.md) (GUI e2e, scenario 05_live_inputs),
[WO-805](./805_WO_devices_apply_button_latency.md) (the other Devices-tab latency WO).

Nothing was added on the box and no routing or output was changed for this investigation: server numbers are
read-only GETs on the live node (:4200); client numbers come from the WO-719 sandbox (throwaway server, Xvfb).

---

## 1. Investigation

### 1.1 The click, traced

| step | file:line (before the fix) | what |
|---|---|---|
| button | `godot/client/features/devices/live_input_dialog.gd:87-89` | AcceptDialog OK = "Add live source", `dialog_hide_on_ok = false`, `confirmed` → `_flow.submit()` |
| submit | `godot/client/features/devices/live_input_flow.gd:213-233` | `busy` on (OK button disabled), then per kind, all awaited in sequence |
| NDI / browser / webpage | `live_input_flow.gd:269-281` | ONE `POST /api/device-view {addExtraLiveSource}` |
| DeckLink | `live_input_flow.gd:241-265` | 7 sequential requests: GET `/api/settings`, GET `/api/device-view`, POST `updateConnector`, GET `/api/settings`, GET `/api/device-view`, POST `/api/host-live/layer` (AMCP PLAY decklink), POST `addExtraLiveSource` |
| live audio / USB video | `live_input_flow.gd:285-318` | GET settings, POST `…/config`, GET settings, GET list, optional POST `…/apply` |
| success | `live_input_flow.gd:208-210` → `live_input_dialog.gd:52-54` | status line set, then `added.emit()` (Devices tab `refresh()`: GET `/api/state` 192 KB + GET `/api/device-view` + full `show_model` rebuild, `devices_tab.gd:273-299`) and **`_close_later()`** |
| **the lag** | **`live_input_dialog.gd:75-79`** | `await get_tree().create_timer(1.5).timeout` then `queue_free()` — a fixed 1.5 s hold of the exclusive modal after every successful add, ported 1:1 from the web modal (WO-605 notes "closes the modal after 1.5 s") |

So after every successful add the modal sits on screen for a fixed 1.5 s, still exclusive (the tab behind it
cannot be used), while the Devices tab rebuilds behind it. No `sleep`/timer anywhere else in the path; the server
reply itself is awaited (needed: an error must stay in the modal).

### 1.2 Measured

| what | where | result |
|---|---|---|
| click → dialog gone, NDI add | sandbox GUI e2e, before | **1510 ms** (server reply ≈10 ms + the fixed 1500 ms), longest frame 25 ms |
| GET `/api/device-view` (37 KB) | live box, curl ×14 over 3 min | 26-58 ms typical; one 1.40 s outlier on the very first call; `?fresh=1` 29-31 ms |
| GET `/api/settings` (19 KB) | live box | 6-9 ms |
| GET `/api/state` (192 KB) | live box | 30-32 ms |
| GET `/api/audio/live-inputs`, `/api/v4l2-inputs` | live box | < 1 ms |
| POST `addExtraLiveSource`, `updateConnector`, `/api/host-live/layer` | live box | **not measured** — they write config and PLAY on Caspar (no dry mode); server side = `persistConfigPatch` (sync write) + `playHostLiveSourceNow` AMCP PLAY (`src/api/routes-device-view.js:210-262`, `src/config/host-live-sources-setup.js:112-123`) |

The fixed 1.5 s is the dominant, always-present part. The server GETs are tens of ms; the DeckLink path's 7
round-trips plus Caspar opening the input add real but unmeasured time on the box (the OK button is disabled and
the status reads "Registering DeckLink SDI port N..." during it). NDI/browser adds show no "Adding…" text while the
POST runs (the flow mirrors the web modal); left as is.

Not a server problem: no server change proposed.

## 2. What was done

- `godot/client/features/devices/live_input_dialog.gd` — `_close_later()` (1.5 s timer) replaced by
  `_close_if_clean()`: on a successful add the dialog is freed at once and its message goes out on a new
  `status(text, ok)` signal, before `added` (so the Devices reload runs after the modal is gone). An add whose
  message reports a failed host PLAY / capture start (`M.add_warning`) keeps the dialog open on that red-worthy text,
  as do hard errors (unchanged: they never reach `added`). Why not "close on click, add in the background": a hard
  error would then need the dialog re-opened or a second error channel; the reply is fast on the GET-only paths and
  the button is already disabled while it runs.
- `godot/client/features/devices/live_input_model.gd` — `add_warning(text)`: " Host PLAY: " / " Capture: " in a
  success message.
- `godot/client/features/devices/devices_tab.gd` — `live_inputs.status` → `_set_status`, so the add's message
  ("Added to Live Sources…", "…Apply Caspar config and restart…") stays on the Devices status line over the reload.
  The Audio tab's "+" (WO-604) does not show it (its strip appears on the reload; audio tab untouched).
- `godot/client/tests/test_devices_live_input.gd` — `test_add_warning` (6 cases built from the real message
  builders).
- `godot/client/e2e/scenarios/05_live_inputs.gd` — click → close is timed (prints the ms and the longest frame) and
  must be under 1000 ms; the server check now runs after the close.

## 3. Verified

- Godot suite: **22182 passed, 0 failed** (baseline 22176 + 6 new).
- Boot check `run-client.sh --check`: boot OK (no script errors). `check-max-file-lines.js`: 0 over 500
  (`devices_tab.gd` is now exactly 500 — split before adding to it).
- Sandbox GUI e2e `--e2e=05_live_inputs`: before 1510 ms → after **1 ms (NDI) / 25 ms (webpage)** click → close,
  longest frame 23 ms; 3/3 pass; screenshot shows the Devices status line "Added to Live Sources. Apply Caspar config
  and…" after the reload.
- **Not verified:** the feel on the owner's glass; a real add on the live box (POST time with Caspar PLAY, the
  DeckLink 7-request path); the Devices `show_model` rebuild cost with the box's full payload.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** On the Devices tab, Add live input → Type NDI → name `E2E_TEST_NDI` → Add. The dialog closed at once:
the screen recording rec809.mkv shows the close in the frames of q809_close_frames.png, and q809_after.png shows the
result. The row was then removed (Remove + confirm).
- Finding (WO-805 area, not fixed): after an add + remove of a live source, the Apply button stays amber.

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).
