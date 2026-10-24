# WO-746 — One shared project across linked servers (WO-732 P2 = WO-712 R5 = the WO-670 piece never built)

**Status: OPEN (24.10.26) — split out of WO-732 so that WO-732 (P1 mutual link, P3a/P3b Devices targets) could close. Not started on purpose: when it is switched on, it replaces the show on every linked server, both of which are on-air boxes. The owner says when.**

## Investigation

- Owner decision **WO-712 D2** (23.10): *"Duties first, shared project next … both work on the same project makes it
  required, not optional."* WO-670 answer 2 asked for it too.
- State on 24.10, after WO-732:
  - Links are mutual and self-repairing (WO-732 P1).
  - Any client can cable any linked server (WO-732 P3b).
  - Each server still runs **its own** project. Screen destinations therefore have different ids per box: this box
    has PGM/PRV 1 + 2, .4 has only the Operator GUI (WO-732 P3b screenshots). A "shared destination" cannot match
    across them, so takes are not forwarded ("no shared destination is cabled there", on .4's card for this box).
- Design already written (WO-712 R5, WO-732 plan P2):
  - The master pushes the show over the signed cluster channel, by revision with epoch fencing (`src/cluster/` epochs,
    WO-712 R2 signed calls).
  - The show is stripped of device-local slices: cables, the device graph, Caspar wiring, screen ports.
  - Each server keeps its own cables and applies the show to its own outputs.

## Open questions for the owner (before building)

1. What happens to the follower's current project at first sync: kept as a backup project file, or overwritten?
   *Recommended: saved as `<name>.before-share.json`, then replaced.*
2. Edits made on a follower: refused (the master owns the show), or sent to the master and merged?
   *Recommended: sent to the master, as a take already is (WO-712 R2).*

## What was done

Nothing yet.

## What was VERIFIED

Nothing yet.
