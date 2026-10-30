# WO-836 — Test categories: offline / live-box, and a GUI release suite with screenshot + PRINT checks

**Status: OPEN (30.10)**
**Source:** REPORT §7a/7b; owner 30.10: *"id like to have a full suite of tests that i could run before each relese and/or
pull request that would run a routine test of all/most of the features by literally clicking in gui and verifing by
screenshots/ casparcg channel prints. so the tests that do actual stuff on the box are needed. but they should be in their
own category."*
**Related:** WO-719 (sandbox GUI e2e, `npm run test:e2e:gui`), WO-720, WO-725, 8b9fc4e (test-isolated projects root).

Parts:

1. **Category + guard.** Tests that touch the live box (AMCP on real channels, POST to the live API, writes into live
   `config/`, `data/`, `projects/`, `/run/highascg`) move to their own category and refuse to run without
   `HIGHASCG_LIVE_TESTS=1`. The offline suite never reaches them.
2. **CI gate bugs (7a):** Godot runner 8-bit exit, npm-audit passes on a registry error, unwired-exports misses
   single-line exports, `check-script-paths.js` red and unrun, vacuous asserts.
3. **Release suite:** one command that clicks through the main features in the real Godot client and verifies with
   screenshots and Caspar channel PRINTs, building on WO-719's scenarios.
