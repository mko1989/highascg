# Card NN — <what is tested, one line>

**Area:** <Live / Timeline / …>  **Takes PGM:** yes | no  **Needs:** <fixture files, a screen, …>  **Time:** ~N min

If **Takes PGM** is `yes`, this card puts pictures on the program output of the box and clears them again at the end. The
coordinator only runs it when nothing important is on air.

## Preconditions
(What must already be true. Each is a command with an expected answer, so you can check instead of assuming.)
1. `<command>` → expected `<exact text or value>`.
(A precondition that is false → stop: verdict UNCLEAR, say which one.)

## Steps
(One action per step. Run the command(s), compare with **Expected**, keep the **Evidence**.)

### 1. <what a person does, in words>
- Run: `tools/test-agent/ui tab Live`
- Expected: ok:true; `ui list tabs` shows `[tab] "Live" SELECTED`.
- Evidence: shot `01_live`.

### 2. …
- Run: …
- Expected: …
- Evidence: …
- LIVE-ONLY: yes (omit the line when the step also works in the sandbox)

## Cleanup
(Always done, even after a FAIL/UNCLEAR. Leaves the box as it was found.)

## PASS rule
All steps PASS (LIVE-ONLY steps may be SKIPPED in the sandbox), and Cleanup done.

## FAIL / UNCLEAR rule
- **FAIL**: a command worked but its Expected is not met → note expected vs seen + shot, skip the rest, do Cleanup.
- **UNCLEAR**: a label/control is missing, disabled, covered, a command errors, or you cannot tell from the shot → follow
  README section 4, skip the rest, do Cleanup.
- Never improvise coordinates or labels.
