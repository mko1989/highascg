# WO-838 — Lockscreen (Settings)

**Status: OPEN (30.10)**
**Source:** owner 30.10: *"add setup in settings, lockscreen. it should display locked (by default), logo (changable) and a
semi transparent bg (changeable), lock any input other than the set key combination (default shift+ctrl+L both for lock
and unlock-changable of course)"*.

Spec:

- Settings has a Lockscreen section: text (default "LOCKED"), logo (changeable; default the HighAsCG logo),
  background colour and opacity (semi-transparent by default), key combination (default Ctrl+Shift+L).
- The same combination locks and unlocks.
- While locked, every other input (keys, mouse, wheel, touch) is swallowed by the client.
