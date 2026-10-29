# Dev mode: highascg servers until 3 November 2026

**Status: ACTIVE (set 29.10.2026, owner note) — expires 03.11.2026**

Every highascg server on this box is in **dev mode** until 3 November 2026.

What this allows, per the owner:
- Restarting the highascg server (`kill -TERM $(systemctl show -p MainPID --value highascg)`, systemd restarts it).
- Restarting or swapping whatever else is needed to verify a change (Caspar binary swaps, node restarts).
- Disruptive tests on this box.

What still holds (from CLAUDE.md and the box memory):
- Keep `casparcg.prev` and the rollback binaries in place before any Caspar swap.
- Do not push, and do not commit config/ (live runtime state). Stage explicit paths only.
- Do not drive the pointer or keys on :0 without the owner (the owner shares the pointer live).
- Do not close the owner's Godot GUI; relaunch instead of closing.

## Verification rule (owner, 29.10)

- After every GUI change made in dev mode: restart the Godot client, bring it to the right tab (launch with
  `--tab=N`, no pointer clicks), and take a screenshot to verify the change on screen.
- Restart whatever else is needed to verify end to end (the node, the Caspar binary, the supervisor), for as long as
  dev mode lasts.

## Testing on the real outputs (owner, 29.10)

- Tests may run on the actual outputs (PGM and PRV, real Caspar channels, real looks), including Caspar restarts,
  node restarts and clips played on air, for as long as dev mode lasts.
- Before a test on PGM, say what will go on air and for how long, and leave the owner's PGM content as it was afterwards.

After 3 November 2026 this note is out of date: restore the normal discipline and delete or
update this file.
