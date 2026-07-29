# WO-387 — "Open window" lists what is INSTALLED, not a hard-coded five

**Status: DONE (2026-07-29, live-verified on the box: launch → promote/place → park → raise → close
→ reap, for both a plain app and a console app; offline suite 1710 pass / 0 fail)**

Owner (29.07): *"i want to be able to launch other apps from the operator gui open window. terminal,
zoom. but i dont want it hard coded list but rather whats installed/available."*

Owner decisions taken before implementing:
- **Menu shape:** keep the five curated tools pinned at the top, installed apps below a divider.
- **Risky entries:** *show everything installed* — no curated denylist. See "Known hazard" below.

---

## 1. Investigation

The WO-283/WO-317 helper machinery is action-driven and complete; what was hard-coded was the
*vocabulary*. The same five actions were written out by hand in four places:

| what it encodes | where it was | what it is in the spec |
|---|---|---|
| menu rows | `client/components/header-bar-operator-helper.js:28` `HELPER_ITEMS` | `Name=` |
| the allow-list | `src/system/operator-helper-window.js:84` `HELPER_ACTIONS` | — |
| what to run | `src/api/system-hardware-gui.js:30` `spawnGuiDetached`'s if-chain | `Exec=` |
| **which window it is** | `src/utils/x-display-session-gui-windows.js:293` `GUI_WINDOW_CLASS` | `StartupWMClass=` |
| chip icon | `src/api/system-hardware-gui.js:254` `HELPER_ICON_CANDIDATES` | `Icon=` |

**The window class is the load-bearing one.** The helper watchdog finds, promotes, places, parks and
reaps a helper *purely* by window class (`findGuiWindowIds`). An app the table does not know is an
app the kiosk can never recover from — that is WO-283's original failure mode ("the watchdog sees a
helper window forever and never restores"). So a dynamic list is only safe if the class comes with
it. It does: this box's entries already declare it.

Measured on the box (36 `.desktop` files, 18 visible, 17 launchable after the stale/installed filter):

| entry | `Exec` | `StartupWMClass` |
|---|---|---|
| `Zoom.desktop` | `/usr/bin/zoom %U` | `zoom` |
| `debian-xterm.desktop` | `xterm` | `XTerm` |
| `thunar.desktop` | `thunar %U` | *absent* → exec basename `thunar` |

Two live probes decided the fallbacks:

- `xdotool search --class` is **case-insensitive** — `--classname navigator` and `Navigator` both
  matched the kiosk (id 23068717). So an exec-basename fallback (`thunar`) matches res_class
  `Thunar` and no case table is needed.
- `x-terminal-emulator` on this box realpaths to `/usr/bin/lxterm`, an **xterm wrapper script**: the
  window it maps reports res_class `xterm`, never `lxterm`. A console app therefore cannot be
  identified by the emulator's own name, and every console app would share one class anyway (parking
  "Midnight Commander" would park an unrelated terminal). Probe: `lxterm -class HighascgTestCls
  -iconic -e sleep 8` → `WM_CLASS = "xterm", "HighascgTestCls"`. The `-class` flag survives the
  wrapper, so each console app gets a **private class**.

## 2. What was done

**New — `src/utils/desktop-app-catalog-parse.js` (pure)**: `.desktop` parsing (main group only,
locale variants dropped), spec-correct `Exec` tokenisation with field-code stripping (`%%` survives,
`%U` vanishes), window-class derivation, the `app:<id>` action shape, and the spec's own visibility
flags. No I/O, so the whole vocabulary is offline-testable.

**New — `src/utils/desktop-app-catalog.js` (I/O)**: scans the XDG application dirs (highest
precedence per ID wins), drops entries whose binary is gone (a `.desktop` left by a removed package
must not appear as an app that then fails to start), wraps `Terminal=true` tools in the box's
emulator under their private class, and caches for 15s (the taskbar polls at 1.5s; a launch POST
invalidates, so the menu is never stale in the direction that matters).

**New — `src/api/operator-helper-icon.js`**: the five pinned tools keep their exact hard-coded paths
(they were verified against what those packages ship); everything else resolves `Icon=` through the
icon roots. PNG/SVG only — Debian ships XPM for xterm/mc and an `<img>` at an XPM shows nothing, so
404 → the client's letter fallback is the honest answer.

**Changed:**
- `x-display-session-gui-windows.js` — `windowClassesFor(action)`: curated table first, catalog for
  `app:*`. Both `findGuiWindowIds` and `raiseOperatorGuiWindows` go through it.
- `operator-helper-window.js` — `isHelperAction()` replaces `HELPER_ACTIONS.includes()`.
- `system-hardware-gui.js` — `spawnGuiDetached` gained an `app:` branch; both POST routes validate
  through `isHelperAction`; new `GET /api/system/apps`.
- `header-bar-operator-helper.js` + new `header-bar-operator-app-menu.js` — pinned rows, divider,
  scrollable "All apps" with icons (capped at 46vh so a full desktop install cannot push the menu
  off the operator screen). Fetched on first menu open, plus once at init so a chip surviving a GUI
  reload can still be named.

**Security model — the API takes an app ID, never a command.** `app:<desktop-id>`; the server
re-reads the catalog and refuses any ID that is not a currently installed launchable entry; the
command line comes from the on-disk `.desktop` file. The nuclear-password gate is unchanged. So the
allow-list is exactly "what root installed on this box", which is what was asked for, and a client
that invents an ID gets a 400 rather than an exec.

**Apps that ARE a pinned tool route to the pinned action** (`pinnedActionFor`). Not cosmetic:
`firefox-esr.desktop` launched raw opens the DEFAULT profile — the one the kiosk holds — so the
operator would get the "Close Firefox" profile-lock modal instead of a browser. Only a *bare*
invocation aliases; `thunar --bulk-rename %F` stays its own app.

## 3. What was VERIFIED

**Offline:** `tools/smoke/smoke-wo387-desktop-app-catalog.test.js`, 22 tests (registered in the
curated `run-offline-tests.js` list). Full suite after the change: **1714 tests, 1712 pass, 0 fail,
2 skipped** (the two pre-existing CI-skipped server-spawn tests). `check-max-file-lines.js`: 0 files
over 500; `check-unwired-exports.js`: no new orphans.

**Live on the box** (server restarted, kiosk reloaded):

- `GET /api/system/apps` → 17 apps with correct `pinnedAction` mapping.
- `app:debian-xterm` (plain app, declared class): POST → `launching` → **`open`, windowId 41943054**,
  placed at **2018,90 1726x966** (the operator-monitor rect, i.e. off the program heads) → toggle
  → `park` → toggle → `raise` → `windowkill` → **chip reaped, helpers `[]`**, kiosk back to
  `_NET_WM_STATE_FULLSCREEN, _NET_WM_STATE_ABOVE`.
- `app:mc` (console app, terminal-wrapped): opened as `WM_CLASS = "xterm", "highascg-mc"` — the
  private class — reached `open` state, found and reaped by that class.
- Refusals: `app:nope` → 400 `Unknown action`; `app:../../bin/sh` → 400.
- Icon resolution: Zoom → `/usr/share/pixmaps/Zoom.png`, mc → `MidnightCommander.png`, xterm →
  `mini.xterm.svg`, and the five pinned tools unchanged.

**Owner QA remaining:** clicking through the menu on the glass, and **Zoom specifically** — see below.

## 4. Owner's first live pass — two reports, both fixed

> *"when i have zoom open the open window button just shows zoom app is open and i cant open
> anything else. also hide the all apps unless show all apps clicked."*

**(a) One window at a time — a WO-317 hole, not a WO-387 regression.** The taskbar coordinator is
supposed to run N helpers, but `operator-helper-live.js`'s `launchHelper` delegates the spawn to
`openOperatorHelperWindow`, whose single session refuses `open_requested` while busy
(`operator-helper-window-state.js:54`, *"Refuse rather than stack a second helper"*). So the box was
capped at ONE open window the whole time WO-317 has been on — with five tools you rarely noticed;
with the whole install list you notice immediately. The client compounded it: `render()` disabled
"Open window ▾" from that same single-session state.

Fixed at both ends:
- `yieldOperatorHelperSession()` — the coordinator hands the single session to each newcomer instead
  of inheriting a refusal written for the single-helper configuration. The previous helper stays in
  the coordinator's registry, keeps its chip, and is reaped by `reconcileHelperWindows` on the
  taskbar poll rather than by the yielded watchdog. **The WO-283 refusal is untouched when the
  taskbar is off** — proven by test, both branches.
- `render()` — the busy lockout now applies only when the taskbar is off.

**(b) "All apps" is collapsed** behind a `Show all apps ▸` row, and re-collapses every time the menu
opens, so the five pinned tools are always what the operator sees first.

Verified live after the fix: `app:debian-xterm` and `app:mc` open **simultaneously** (both `open`,
distinct window ids 31457294 / 41943052), park toggles independently (`[xterm parked, mc raised]`),
both reaped on close, kiosk back to `FULLSCREEN, ABOVE`.

## 5. Known hazards (owner decided to show everything)

1. **`install-system.desktop` (the Calamares OS installer) is in the menu**, one click from the
   operator GUI on a live box. Shown because the owner chose "show everything installed"; the spec
   filters (`NoDisplay`/`Hidden`) do not hide it because the ISO ships it as a visible entry. If it
   should go, the cheapest fix is deleting/`NoDisplay`ing that one `.desktop` file — not a code
   denylist.
2. **Zoom was NOT launched during verification, deliberately.** It grabs an audio device, and this
   box's DM3 hardware is single-open (the shader FFT path depends on it). Its launch resolution and
   window class are verified (`/usr/bin/zoom`, class `zoom`); the first real launch should be done
   with the owner watching and nothing on air.
3. A helper is placed inside the operator-monitor rect only when that monitor is known; the
   pre-existing `resolveHelperWindowRect` warning path is unchanged and still applies.
