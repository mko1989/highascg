# Todo list — WO audit of last week (2026-07-19 → 2026-07-26), compiled 2026-07-26 late

Method: every WO 306–344 read; unclear ones verified against code/commits by three audit agents
(spot-checked); stale status lines corrected in the WO files tonight.

## A. NEEDS IMPLEMENTATION (real remaining work)

- [ ] **WO-343** — look editor must show REAL PRV video on the screen consumer while editing
      (WO-339 v2 design; three candidate mechanisms in the WO — pointer-capture test decides)
- [ ] **WO-344** — shader look-deck thumbnails: content-aware crop + synthetic audio + fill
      compositing (currently borders + alpha void)
- [ ] **WO-342** — click empty deck-header space clears that screen's PRV (small)
- [ ] **WO-320 Part A** — pixel-precise countdown-timer position (Part B eye-fade landed b168f25)
- [ ] **WO-326 rest** — contentZoom / scale-% control for look layers (the W/H bug part landed
      0299b2d + follow-ups; the feature itself was never built)
- [ ] **WO-341** — client-sync structural kill list (persisted-timer chain, reconnect resends,
      layout heartbeat, scene.deck ingestion, ws seq-gap, autosave rev race). Top defects fixed
      2026-07-26; the rest is the redesign.
- [ ] **WO-338/337 long tail** — CINF-before-routing reorder, async xrandr exec, remaining
      latency items (all small, listed in the WOs)
- [ ] **WO-340 v2** — live shader uniforms via CG UPDATE (v1 pickers/sliders shipped 3256730)
- [ ] **WO-318 residue** — shape holes at 2160p50: two bugs fixed 2026-07-21, three items listed
      open; needs the 2160p50 display to verify (partly owner-gated)

## B. IMPLEMENTED — NEEDS OWNER SIGN-OFF ON HARDWARE (nothing to code)

- [ ] **WO-322** shader-on-look-band: visual check of bank-crossfade + shader composition
- [ ] **WO-323** compose live-source tiles: drop/remove/persist check on the kiosk
- [ ] **WO-317** taskbar: enabled 2026-07-26 + chips restyled — open two helpers, toggle chips
- [ ] **WO-336** live-audio host-channel controls: check device swap + FFT toggle on display
- [ ] **WO-329** two-client save/load: after tonight's sync fixes re-run the two-browser drill
- [ ] **WO-330** Companion: run the one deploy command in the WO, then desk QA
- [ ] **WO-332** power button: root install still pending (needs sudo run)
- [ ] **WO-325 Part A** headless GUI flag: needs a Caspar config regenerate+restart to take
- [ ] **WO-315** nodm-on-canvas-growth: verify on the next real canvas-growth apply

## C. STALE STATUSES CORRECTED TONIGHT (done, was marked OPEN/not started)

WO-310 (bbd940d) · WO-311 (acf2493) · WO-312 (8c4bc88) · WO-313 (e14909d) · WO-327 (d47388b) ·
WO-331 (ecd23c0) · WO-319 (e3bb16a/4e0a998/7faee72) · WO-321 Part A (b168f25) ·
WO-335/336/339 v1/340 v1 (today's work, statuses refreshed)

## D. CLOSED / OBSOLETE / BLOCKED

- **WO-306** closed (owner: works as Caspar intends) · **WO-324** obsolete — the "stuck together"
  triage inverted into the 2026-07-26 adjacency REQUEST, implemented (809a809)
- **WO-314** blocked on hardware (secure boot vs nvidia module)
- **WO-328** owner-gated: needs the live media-continuity repro session before any code

## E. OPEN INVESTIGATIONS (not WOs yet)

- [ ] Shader brightness decay over time (worst: 3d-meters) — all infrastructure measured clean
      (FFT feed, stored opacity, mixer opacity, 3-min render). Need owner's trigger pattern:
      gradual-while-idle vs step-per-take.
