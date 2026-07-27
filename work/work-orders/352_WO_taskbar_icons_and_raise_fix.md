# WO-352 — Taskbar: system icons in circular chips + the raise/recall bug

**Status: DONE (2026-07-27, live-verified)** · Source: todos27.07.26 (owner): "the taskbar in the
top bar of operator gui, uses apps system icons inside the cirlce. when i click back to gui, the
browser hides under the casparcg screen, but after around 2s. but then i cant recall to the front
the browser again."

## Root causes (journal 12:17, three independent defects)

1. **Adjacency heal fought raised helpers.** The WO-349-era adjacency watchdog
   (`enforce_caspar_under`) ran its gap/inversion heal unconditionally — 6s after a helper was
   promoted above the kiosk, "window(s) between kiosk and consumer — raising consumer+kiosk pair"
   shoved the browser back under the video. The kiosk *top-assert* respected `helperOpen`; the
   heal did not. Fix: `helper_open` threaded into `enforce_caspar_under`; the restack watchdog
   stands down while a helper is deliberately raised (EWMH pinning + input-dead stay in force).
2. **Taskbar helpers wedged in 'launching' forever.** Nothing ever called
   `coordinator.onHelperMapped` — the registry's watchdog hooks existed but had no caller. A
   launching chip renders disabled, so once wedged the browser was unrecallable from the taskbar.
   Fix: `launchHelper` in operator-helper-live.js polls `findGuiWindowIds` (500ms × 40) after the
   spawn → `onHelperMapped(id, wid)`, timeout → `onHelperGone`. Plus `reconcileHelperWindows` on
   every taskbar GET (the client's 1.5s poll): an 'open' helper whose window vanished is reaped.
3. **WO-283 "Back to GUI" desynced the registry.** The single-helper restore re-asserts the kiosk
   over everything but the WO-317 registry still thought its helpers were raised — the next chip
   click ran 'park' on an already-hidden window. Fix: `restoreNow` → `noteKioskRestored()` →
   `coordinator.parkAllOpen()`.

## Icons

- New endpoint `GET /api/system/operator-helper-icon?action=<x>` (system-hardware-gui.js):
  fixed per-action candidate lists into hicolor/pixmaps (firefox-esr, org.xfce.thunar,
  BlackmagicDesktopVideoSetup, DesktopVideoUpdater, nvidia-settings); first readable file wins,
  served as PNG with 24h cache; 404 otherwise. No globbing, no user-controlled paths.
- Chips are now 22px circles with the app icon inside (`.header-operator-taskbar__chip` +
  `__icon` in 01a2-header-bar.css): red ring = raised, gray ring = parked, pulse = launching;
  img error → first letter fallback.

## Live verification (12:31–12:32 on the box)

launch → 'open' with real windowId in 8s (was: wedged 'launching'); raised helper survived
multiple watchdog ticks with zero heal events (was: stolen in ~2s); park → kiosk topmost;
raise → helper topmost directly above kiosk; window closed → reconcile reaped it, kiosk
re-activated. Icon endpoint: 200 image/png. Smoke guard added (heal-suspension grep) —
shape smoke 6/6, full test:ci 1532/0.
