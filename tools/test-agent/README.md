# Test driver — reference for the agent running a test card

You are testing the HighAsCG operator GUI **like a person**: you look at the screen, you click and type with a real mouse
and keyboard, you look again. Two tools do that for you. You follow ONE card at a time (`tools/test-agent/cards/NN_*.md`)
exactly as written, keep the evidence it asks for, and finish with a verdict. You never improvise.

```
tools/test-agent/ui        the screen: look (list, shot, state) and act (click, type, drag, key, scroll)
tools/test-agent/caspar    what is on air: print (a picture of a channel + numbers), info (which clip plays), api (read-only)
```

Run them from the repo root `/home/casparcg/highascg`. Every command prints ONE line of JSON
`{"ok":true,"result":…}` or `{"ok":false,"error":"…"}` (exit code 1 when `ok` is false), except `ui list`, which prints one
control per line. The driver was already started for you (`ui start`); never start or stop it yourself.

## 1. How to see

| You want | Command | Notes |
|---|---|---|
| A picture of the whole screen | `tools/test-agent/ui shot <name>` | prints `{"png": "<path>"}`. **Open it with the Read tool on that path** — you see exactly what a person sees, popups and dialogs included. Name shots `NN_what` (e.g. `03_after_take`). |
| What can I click? | `tools/test-agent/ui list` | every visible control with its label and where it is on screen. Narrow it: `ui list buttons`, `fields`, `tabs`, `options`, `rows` (media/file lists), `labels` (text on screen), `menu` (an open right-click menu), `--under "<container>"` (a tab title or section heading), `--limit N`. |
| Is this label on screen? | `ui find "<label>"` | JSON with `matches` (each has `at`: x,y) or an error with the closest labels. |
| Wait for something to appear | `ui wait_for "<label>" 10` | seconds timeout; `--gone` waits for it to disappear. |
| Where am I? | `ui state` | current tab, focused control, open dialogs (title, text, buttons) and menus. |

A `ui list` line looks like:
`[button] "TAKE" tip="Take the look on PRV to PGM" at 1153,664 rect 1130,647,47x35` — kind, label, tooltip, centre `at x,y`
(screen pixels, 1920x1080), `rect x,y,wxh`. Flags: `DISABLED` (greyed out, cannot be pressed), `ON`/`off` (toggles),
`SELECTED` (tabs). A control is matched by its label **or** its tooltip **or** its field caption/hint.

## 2. How to act

All of these use the real mouse and keyboard on the test screen.

| Do | Command |
|---|---|
| Open a workspace tab | `ui tab Timeline` (tabs: Live, Previs, Timeline, Audio, Devices, Multiview, Settings) |
| Click a control by label | `ui click "TAKE"` — options: `--double`, `--right`, `--contains` (label contains the text), `--under "<container>"`, `--kind button\|tab\|row\|field\|menuitem\|label`, `--nth N` (Nth match) |
| Click a right-click menu entry | `ui click "Delete look…" --kind menuitem` (right-click the thing first, then `ui list menu`) |
| Type into a named field | `ui type "Project name" "My Show"` (selects the old text, types, presses Enter; `--no-submit` skips Enter) |
| Type into whatever has focus | `ui type "text"` (one argument) |
| Pick from a drop-down | `ui choose "Destination type to add" "PGM only"` (the drop-down's current text or caption, then the item) |
| Press keys | `ui key ctrl+z`, `ui key space`, `ui key delete`, `ui key Return`, `ui key Escape`, `ui key F3` |
| Drag one labelled thing onto another | `ui drag "e2e_bars.mp4" "New look — or drop a media file here / on empty deck space"` |
| Pixel-level actions (canvases, timelines, empty areas) | `ui click_xy X Y [--double\|--right]`, `ui drag_xy X1 Y1 X2 Y2 [--steps N]`, `ui move X Y`, `ui scroll X Y up\|down [N]` |
| Wait | `ui wait 2` (seconds) |

After each action the driver waits a moment for the screen to settle. If the card says "wait N seconds", do it with `ui wait N`.

**Coordinates (`*_xy`)** — only when the card tells you to act on a place that has no label (a timeline lane, an empty part
of a frame). First take a `ui shot`, **Read** it, and choose the point like a person would. The card names the area and gives
a rule ("inside the dark frame, left of the white-outlined box"). A control's `at` from `ui list` / `ui find` is its centre
in the same coordinates, so you can also drag *from* a labelled thing: `ui find "e2e_still.png"` → `at` → `ui drag_xy <x> <y> <x2> <y2>`.

## 3. How to check what is on air

```
tools/test-agent/caspar channels            → {"program":[1],"preview":[2]}   the channel numbers to use below
tools/test-agent/caspar info 1              → what plays on channel 1: [{"layer":110,"clip":"E2E_BARS","state":"playing","time_s":"2.29",…}]
tools/test-agent/caspar info 1-110          → same, filtered to layer 110
tools/test-agent/caspar print 1             → LIVE ONLY. Caspar photographs channel 1: {"png":"<path>","mean_luma":…,"mean_rgb":[r,g,b],
                                              "nonblack_fraction":…,"mean_alpha":…}  (open the png with Read as well)
tools/test-agent/caspar print 1 --crop 0,0,960,540     → the same numbers for that box only (x,y,w,h; must lie inside the frame)
tools/test-agent/caspar api /api/timelines  → read-only GET of the node's API, prints the JSON
```

- `mean_luma` is the brightness 0–255 (black = 0). `nonblack_fraction` is the share of pixels brighter than 16 (black = 0, a
  full picture = about 1). `mean_alpha`/`alpha_note` describe transparency: if the note says the alpha plane is all zero, say so in
  your evidence; judge the picture by the PNG you opened, and by the numbers the card names.
- Clip names in `caspar info` may be UPPER CASE or carry a folder; compare case-insensitively with "contains".
- `caspar print` on the sandbox answers `no Caspar in the sandbox` (exit code 2). Steps marked **LIVE-ONLY** in a card are
  then recorded as `SKIPPED (sandbox)`; they do not fail the card.

## 4. When a label is missing — never guess

1. `ui list` (or `ui list buttons`, `ui list labels`) and `ui shot`; Read the shot.
2. Is the control hidden behind another tab, a dialog, a menu? `ui state` shows open dialogs and menus. Close what the card
   did not open (`ui key Escape`) only if the card says so; otherwise report it.
3. Still not there: **stop the card and report `UNCLEAR`** with the missing label, the closest labels from the error text, and the
   shot. Do NOT click a coordinate you made up, do NOT try another label "that looks similar", do NOT retry more than once.

A step whose command returns `ok:false` for any other reason (disabled control, "covered by …", timeout) is also an
`UNCLEAR` stop unless the card says that failure is the expected result. A step whose command works but whose **Expected**
is not met is a `FAIL` for the card (see its FAIL rule).

## 5. Evidence and verdict

Keep every shot / print the card asks for (they are already written to the run folder). Your final message is the verdict,
in exactly this format and nothing else around it:

```
CARD: 01_looks_take
VERDICT: PASS | FAIL | UNCLEAR
STEPS:
  1 PASS  <one line: what you saw>
  2 PASS  …
  5 FAIL  expected "<what the card says>" — saw "<what you saw>" (shot: <png path>)
  6 SKIPPED  not run because step 5 failed
EVIDENCE: <png path>, <png path>, <json you were asked to keep, one line each>
NOTES: <anything odd on screen — error banners, wrong text, leftover dialogs — or "none">
```

Rules: PASS only when every non-LIVE-ONLY step is PASS. The first FAIL stops the card (rest SKIPPED) but still do the card's
"Cleanup" section. UNCLEAR stops the card the same way. Never write PASS for a step you did not run.
