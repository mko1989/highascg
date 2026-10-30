# WO-620 — Rewir "·" renders blank: every " · " separator in the Godot client was a gap

**Area:** godot-client
**Status: DONE (2026-10-19, Godot glyph probe + box GUI screenshots; Godot --test 1297/1297; web client woff/ttf patched too, Firefox render-verified).**

Found during WO-616 T10d. The walk status text "P2 · 58 samples · 4.0 s" showed on the box as "P2   58 samples   4.0 s".
Related: [WO-608](./608_WO_godot_port_shell_settings_web_surfaces.md) R3 (Rewir is the only font, theme default and
`ThemeDB.fallback_font`).

## Investigation

- A 4× zoom of the box GUI (Camera view → Detect → Verification walk) showed the gaps where the separators should
  be. "—" in the same line rendered.
- **Godot probe** (`TextServer.font_get_glyph_contours` at 64 px):
  - U+00B7 → glyph 98, 0 points. U+2022 → glyph 99, 0 points. "." → 12 points, "-" → 4.
  - `has_char` is true for both, at a 9 px advance.
- fontTools (`python3-fonttools` 4.46, installed by the owner) confirms it: `periodcentered` and `bullet` have
  `numberOfContours` 0 and advance 600 of 2048 upm. The period is 175..392 × −24..190, and sxHeight is 984.
- **A font fallback cannot fix this.** Godot picks the first font in the chain that claims the codepoint, and Rewir
  claims U+00B7. This was tried: a `SystemFont("sans-serif")` fallback on the theme's FontFile did not change the
  separator.
- **Codepoints Rewir really lacks** (↔ →) were never broken. `FontFile.allow_system_fallback` defaults to true, and
  the bare FontFile already gives ↔ / → their 25 px system glyphs. The SystemFont fallback was therefore redundant
  and was reverted.
- **Scale:** about 70 "·" uses across 24 Godot files, most of them in visible strings. Rewriting the strings to
  another character would be churn and would still look foreign. Fixing the glyph fixes every string at once, in
  Rewir's own style.
- **License:** Rewir is under the SIL OFL. Modified versions are allowed, and the font declares no Reserved Font
  Name, so the family name can stay.

## What was done

- **`tools/dev/patch-rewir-middot.py`** (new, needs python3-fonttools):
  - `periodcentered` becomes a composite of the period, centred in its 600 advance at half the x-height (y 492).
  - `bullet` becomes the same composite scaled 1.5×.
  - DSIG is dropped, because any change invalidates it. Name ID 5 gets "; middot/bullet outlines (HighAsCG WO-620)".
  - The script is idempotent: a second run reports "nothing (already outlined)".
- **`godot/client/assets/fonts/Rewir-Light.ttf`**: replaced with the patched font (29 188 → 29 096 bytes). No other
  glyph changed.
- **`godot/client/assets/fonts/README.txt`** and **`THIRD_PARTY_NOTICES`** (a new Rewir block) record the
  modification. `THIRD_PARTY_NOTICES` had no Rewir entry before.
- **Web client** (owner, 19.10: "Patch it in web too, it's not on air"):
  - `client/fonts/Rewir-Light.woff` was patched with the same script. The flavor stays woff and the glyf outlines
    are the same.
  - `client/fonts/Rewir-Light.ttf` is now byte-identical to the Godot copy. Each fontTools save stamps
    `head.modified`, so the second run's output was replaced with the committed file.
  - `Rewir-Light.otf` is not referenced by `01a1-base-theme-tokens.css`, so it stays upstream.
  - Both READMEs and `THIRD_PARTY_NOTICES` list which files are modified.
  - `npm run build:client` was run. `dist-web` is gitignored and is rebuilt on the box.

## What was VERIFIED

- **Patched font:**
  - `periodcentered` is now a composite with bbox 191..408 × 385..599 (centred at 299.5, 492).
  - `bullet` is 138..463 × 332..653.
  - The Godot contour probe now gives 12 points for both, the same as the period.
- **Box GUI**, after a relaunch with the patched font:
  - The mask list reads "Mask 1 · 4 pts".
  - The live walk status reads "Walking — P2 · 44 samples · 3.0 s · off the line: mean 24.3 cm · 5 % of the line
    walked", with the dots visible at Rewir's weight.
  - The test walk was reset afterwards.
- **Gates:** Godot `--check` boots clean, and `--test` gives 1297 passed, 0 failed. No smoke test reads the font or
  the notices. The release script copies `THIRD_PARTY_NOTICES` as a whole.
- **Web**:
  - `dist-web/assets/Rewir-Light-*.woff`, as served by `:4200`, is byte-identical to the patched woff, with
    `periodcentered` as a composite.
  - Headless `firefox-esr` (the kiosk's browser) rendered a side-by-side page. The upstream woff showed
    "Mask 1   4 pts   x" with gaps. The patched woff showed "Mask 1 · 4 pts • x" in Rewir.
  - No kiosk was running, so there was no live reload.
- **Owner QA:** whether the dot's height and weight read well next to Rewir text in the other tabs (Live, Timeline,
  Settings).
