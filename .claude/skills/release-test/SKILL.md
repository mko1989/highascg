---
name: release-test
description: Run the HighAsCG release test — written test cards executed one after another by cheap Haiku agents that drive a second Godot client with real mouse/keyboard on a hidden display, and check the picture on air. Use for /release-test [cards…] before a release or after a sweep of GUI/engine changes.
---

# /release-test [cards…]

The full release test is **test cards run by Haiku agents** (WO-836 Part 3c), not a scripted suite: each card in
`tools/test-agent/cards/NN_*.md` is a written procedure of driver commands with exact labels and thresholds. A cheap agent
follows it literally and returns a PASS / FAIL / UNCLEAR verdict with evidence; only the FAIL/UNCLEAR cards are looked at by a
stronger model. This costs a few Haiku runs instead of one expensive agent poking at the GUI.

The driver (`tools/test-agent/README.md` is its reference — the agents read it):

- `tools/test-agent/ui` — a second Godot client on its own hidden Xvfb display. **All input is real X input** (xdotool
  on that display, never `:0`): mouse, drag, keyboard. The Godot side only reports where labelled controls are.
- `tools/test-agent/caspar` — `print` (Caspar PRINT → PNG + luma/colour numbers), `info` (what plays), `api` (read-only GET).
- The owner's own GUI on `:0` is never touched. **PGM is** (cards that take PGM say `Takes PGM: yes`).

## Procedure (you are the coordinator; do not do the card steps yourself)

1. **Pick the cards.** No arguments → every `tools/test-agent/cards/[0-9]*.md`, in name order. Arguments → those cards
   (`/release-test 01 02` or names). Read each card's header: list the ones with `Takes PGM: yes` to the owner in one line
   ("cards 01 will put pictures on PGM") and check that nothing important is on air:
   `tools/test-agent/caspar info <PGM channel>` (channel from `tools/test-agent/caspar channels`; both are read-only). If
   something is playing and the owner did not say it is fine, stop and ask.
2. **Run folder.** `RUN=work/release-reports/$(date +%F)` (add `_2`, `_3` if it exists). `mkdir -p $RUN`.
3. **Fixtures.** Cards need `e2e_bars.mp4`, `e2e_still.png`, `e2e_tone.wav` in the box's media root:
   `node tools/test-agent/provision-fixtures.js` (never overwrites; `--remove` takes them out again at the end). Then the
   Sources list must be reloaded; the driver does that after start: `tools/test-agent/ui click "Reload the list"`.
4. **Start the driver on the live node:** `tools/test-agent/ui start --live --out $RUN/driver`. It prints the display and
   remote port; the second Godot client adopts the node's token itself (nothing to type, never print the token).
   For a dry run without the box use `--sandbox` (cards mark their PRINT steps LIVE-ONLY and skip them).
5. **Run the cards SEQUENTIALLY** (one GUI, one PGM — never in parallel). For each card, one Agent call with
   `model: "haiku"`, a fresh agent per card, prompt =

   ```
   You are running ONE test card against the HighAsCG GUI, from /home/casparcg/highascg. Do exactly what the card says,
   nothing else; never improvise coordinates or labels. Your reference for the tools:

   <paste the full text of tools/test-agent/README.md>

   THE CARD:

   <paste the full text of the card file>

   The driver is already running; do not start/stop it; do not run git; do not edit files; only use tools/test-agent/ui
   and tools/test-agent/caspar (and the Read tool for PNGs). Finish with the verdict in the exact format of README section 5
   and nothing after it.
   ```

   Save the agent's final message to `$RUN/<card>.verdict.md`. Copy the evidence it names: the shots/prints are already under
   `$RUN/driver/shots/` and `$RUN/driver/prints/` (refer to them, do not duplicate).
   If a Haiku run returns no verdict in the format, or UNCLEAR for a reason that looks like a card/driver problem rather
   than the product (missing label, ambiguity), rerun it **once**; keep both verdicts.
6. **Between cards** run `tools/test-agent/ui state` — if a dialog or menu was left open, `tools/test-agent/ui key Escape`;
   and `tools/test-agent/caspar info <PGM>` — if a card left something on PGM, report it (it is a card failure) and clear it with
   the GUI (`ui click "Fade to black (PGM + PRV), then clear"`), not with AMCP.
7. **Report.** Write `$RUN/report.md`:

   ```
   # Release test <date> — <git short sha> — target live|sandbox
   | Card | Verdict | Time | Evidence |
   |---|---|---|---|
   | 01_looks_take | PASS | 3m | [prv](driver/shots/…png) … |
   ```

   then one short paragraph per FAIL / UNCLEAR card (step, expected, seen, shot link) and the **LEFTOVERS** the cards listed
   (e.g. a timeline `ZZ release-test`): the project is the owner's, so list them and ask before removing.
8. **Stop the driver:** `tools/test-agent/ui stop`; and `node tools/test-agent/provision-fixtures.js --remove` (only if
   step 3 created them: the `already_there` list it printed then). Make sure no `Xvfb`/`godot` of the run is left:
   `ui stop` kills by recorded pid; check `tools/test-agent/ui state` answers "no driver running".
9. **Hand-over.** Tell the owner: counts (PASS/FAIL/UNCLEAR), the report path, and — only for FAIL/UNCLEAR cards — pass the
   verdict + shots to a stronger model (Opus/Sonnet) to decide: real product bug (open a WO), stale card (fix the card), or
   driver problem. Haiku verdicts are never the final word on a FAIL.

## Rules

- Cards that take PGM must say `Takes PGM: yes` in their header and Preconditions (the template enforces it); the
  coordinator checks PGM is free first and after each card.
- Cards are the only test procedure: a new area gets a new card (`tools/test-agent/cards/_TEMPLATE.md`), written from what
  `ui list` / `ui shot` show in the sandbox first (`ui start --sandbox`), dry-run by hand until it passes there.
- Never use the owner's `:0` display, `xdotool` outside the driver, AMCP, or API writes from this skill. The only writes to the
  box are the GUI actions the cards describe, the fixture files, and the project edits the cards clean up.
- Cost: a card is ~25–60 driver calls; on Haiku a full run of the pilot cards costs a small fraction of a single
  Opus session doing the same by hand, and the stronger model only reads the failures.
