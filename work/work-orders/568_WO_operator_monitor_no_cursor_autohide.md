**Status: IMPLEMENTED (2026-09-10, offline suite 2405/0/2, syntax-checked, prettier pre-existing-only) — needs `highascg` service restart + owner on-hardware confirmation**

## Investigation

`work/work-orders/todos10.09.26`: "when the operator monitor is set, turn off the cursor auto
hide function."

`unclutter -idle 2 -root` hides the mouse cursor after 2s idle, X-server-wide (`-root` — not
scoped to one output). WO-87 shipped it deliberately coupled to the operator monitor confine
lifecycle ("Operator cursor hides after 2s on operator head" — see
[87_WO_OPERATOR_POINTER_CONFINE.md](./87_WO_OPERATOR_POINTER_CONFINE.md)), and it ran on **every**
path, not just when an operator monitor was set:

- [pointer-confine.js](../../src/system/pointer-confine.js) `ensureUnclutterRunning()` was called
  from `stopPointerConfine()` unconditionally — including from `startPointerConfine`'s own RUN
  (operator-monitor-just-got-set) transition, which calls `stopPointerConfine()` first to clear the
  old barrier daemon, then immediately called `ensureUnclutterRunning()` again right after. So
  unclutter ran whether or not an operator monitor was configured.
- [x-display-session-runtime.js](../../src/utils/x-display-session-runtime.js)
  `buildConfineCursorShellLines()` (feeds the boot-time `apply-layout.sh`) only *started*
  unclutter, and only inside the operator-monitor-set branch — the opposite gating from what the
  todo asks for, though moot in practice since `09-openbox-autostart.sh` already starts unclutter
  unconditionally at X session boot regardless of config.

Net effect matching the owner's complaint: whenever an operator monitor is configured, the cursor
vanishes 2s after the operator stops moving it — annoying while working the operator GUI.
`isOperatorPointerConfineDesired(config)` (WO-308's pure verdict) is already the SSOT this file
uses everywhere else for "is an operator monitor set" (see `applyOperatorDisplaySession`'s own
`'[X-Display] No operator monitor — skip primary/confine session'` log tied to the same flag), so
that's the gate this fix hangs off too.

## What was done

Flipped the coupling: unclutter now runs only when there is **no** operator monitor set (the old
"desktop" case); it's killed instead of started while one is.

- **pointer-confine.js**: added `ensureUnclutterStopped(env, log)` (pkill -x unclutter). Gave
  `stopPointerConfine()` an opt-out (`{ manageUnclutter: false }`) so the RUN/transition branch of
  `startPointerConfine()` — where an operator monitor is being confined to — can skip the
  auto-restart `stopPointerConfine()` would otherwise fire (which would race the subsequent stop:
  `ensureUnclutterRunning`'s own pgrep-then-spawn is async and not awaited by `stopPointerConfine`,
  so calling both back-to-back without the opt-out could leave unclutter running depending on
  scheduling) and instead `await ensureUnclutterStopped(env, log)`. The SKIP branches (both in
  `startPointerConfine` and `syncOperatorPointerConfine`, i.e. "no operator monitor") keep calling
  plain `stopPointerConfine()`, which still restores unclutter by default — unchanged behavior for
  the no-operator-monitor case.
- **x-display-session-runtime.js**:
  - `buildConfineCursorShellLines()`: the operator-monitor branch now emits
    `pkill -x unclutter 2>/dev/null || true` instead of the old start line.
  - `applyOperatorDisplaySession()`'s `!confineDesired` branch now calls `stopPointerConfine()`
    (lazy-required, same pattern the `confineDesired` branch already uses one block down) instead
    of a bare `pkill -f confine-cursor.py` — needed so disabling an operator monitor (live, via a
    config apply) actually restores unclutter; previously nothing on that path called into
    pointer-confine.js's restore logic at all, which didn't matter while unclutter always ran
    regardless but would have permanently wedged it off once this change started actively killing
    it.

Not touched: `09-openbox-autostart.sh`'s unconditional `unclutter -idle 2 -root &` at X session
boot — still correct as a startup default for the no-operator-monitor case, and gets killed by the
above the moment a config with an operator monitor is applied.

## What was verified

- `node --test` on the four touched/adjacent smoke files — **32/32 pass**, including two new
  source-text assertions in `smoke-wo308-pointer-confine-split.test.js` (RUN branch stops unclutter
  via the race-free `{ manageUnclutter: false }` + `ensureUnclutterStopped` pair; SKIP branch still
  restores it via plain `stopPointerConfine()`), and updated assertions in
  `smoke-interactive-operator-display.test.js` (operator-monitor-set apply-layout lines now assert
  `pkill -x unclutter` present and `unclutter -idle` absent).
- `node tools/ci/run-offline-tests.js` — **2405 pass / 0 fail / 2 skip** (full suite, all files).
- `node --check` on all four touched files — syntactically valid.
- `check-max-file-lines.js` — no touched file near the 500-line cap; the one file over
  (`scene-take-lbg.js`, 522) is pre-existing and unrelated.
- `prettier --check` warns on all four touched files — confirmed **pre-existing** by stashing this
  change and re-running (same warnings before it).
- Not yet verified live: no service restart performed this session. Owner should
  `kill -TERM $(systemctl show -p MainPID --value highascg)` (systemd restarts it), then with an
  operator monitor configured, confirm the cursor stays visible past 2s idle on that head, and with
  no operator monitor configured, confirm the old auto-hide-after-2s desktop behavior still happens.
