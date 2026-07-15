# WO-232 — Mario game as a transparent-background HTML producer, puppeteer-controlled (CEF interactive bridge)

**Status:** Planned | **Date:** 2026-07-15
**Source:** owner todos15.07.26 ***mario-game***: "id like to be able to add a mario game via an html producer but with transparent background instead of the sky. controlled via pupeteer the same as before." Candidate sources given: github.com/tylerreichle/mario_js, codepen.io/yananas/pen/xrjaGX, github.com/reruns/mario (JS), github.com/axonyxquantum/desktop_mario (python — NOT usable in an html producer; ignore).

## Design
- "Same as before" = the existing **CEF interactive bridge** (src/system/cef-interactive-cdp.js / cef-interactive-forward.js / bridge-events — puppeteer 25.x already a dependency; `template/cef_input_test.html` is the prior art). The game runs as a Caspar `[html]` producer pointed at a locally served page; input is forwarded via the CDP bridge exactly like the existing interactive templates.
- **Vendor the game locally** (offline/CSP box): clone one of the JS candidates (prefer `reruns/mario` or `tylerreichle/mario_js` — pick whichever is a self-contained canvas game with no build step / no CDN deps; document the choice + license) into `template/mario/` with all assets local.
- **Transparent background:** patch the game's renderer — remove the sky fill (canvas `fillRect` of the background color / sky sprite layer) and create the canvas context with alpha; `html,body{background:transparent}`. The parts of the scene that must remain (ground, pipes, sprites) keep rendering. Document exactly which draw calls were patched.
- **Layer/lifecycle:** playable as a normal browser/template source in a look (browserAsCg or template source — follow how CasparCG-Guide templates/cef_input_test are added); no server-side lifecycle changes needed.

## Tasks
- [ ] T232.1 Fetch + vendor the chosen game into template/mario/ (self-contained; note license + upstream commit).
- [ ] T232.2 Transparency patch (sky removal + alpha context + transparent body); verify with a local headless screenshot (puppeteer is available — render the page offscreen and check corner pixels have alpha 0).
- [ ] T232.3 Input: verify keyboard reaches the game via the CEF interactive bridge path used by cef_input_test.html (read those modules; document the AMCP/setup steps an operator needs, e.g. which layer + how the bridge attaches).
- [ ] T232.4 Sources/UX: make it appear like other templates (it lands in the template catalog automatically if template-dir scanned — verify; else add a note).
- [ ] T232.5 Smoke: page exists + contains the transparency patch markers; puppeteer screenshot alpha test where feasible offline (mark honestly if headless env lacks a display — use --headless with swiftshader flags; skip with note if impossible).
- [ ] A232.1 owner check: Mario on air over video, transparent sky, playable via the bridge.
