# src/vr — sweep 29.10.2026 (batch 106)

Files: 4 · lines: 889 · findings: 0 BUG-HIGH, 1 BUG, 1 DEAD, 2 RISK, 4 QUALITY

Method: every file read in full. No VR process, WiVRn, WayVR or D-Bus call was made; the one repro (`j51-mvr.js`) drives
`stageMvrForMagicq` through its injectable deps with a scratchpad MVR zip and a scratchpad show dir. Consumers: only api/routes-vr.js
requires these modules. WO context: WO-770 (VR session), WO-780 (user-session env), WO-792 (desk panel), WO-796 (MVR staging).

## src/vr/magicq-mvr.js
- `BUG` src/vr/magicq-mvr.js:39-42,82,122-123 — GDTFs of patched types are silently dropped from the staged MVR when the manufacturer or fixture name contains an XML-special character. `gdtfName` keeps `&`, `<`, `>`, `"` raw (`part()` strips only `@ / \`), the archive key is that raw name (:120), but the scene XML gets `xmlEsc(name)` (:82, `&amp;`) and the "keep only referenced GDTFs" pass (:122-123) compares the key against the still-escaped text read back from the XML, so the key `A & B Lighting@Spot@hacg-t1` never equals `A &amp; B Lighting@Spot@hacg-t1`, is judged unused and deleted. Repro (`j51-mvr.js`, deps injected): manufacturer "Martin" → archive `GeneralSceneDescription.xml | Martin@Spot@hacg-t1.gdtf`; manufacturer "A & B Lighting" → archive `GeneralSceneDescription.xml` only (the XML still points at a GDTF that is not in the file → MagicQ imports the rig without the fixture definition). Fix: unescape the match (`xmlUnesc(m[1])`) or build `used` from the names handed to `setChild`.
- `RISK` src/vr/magicq-mvr.js:107-109 — every entry of the (user-uploaded) previs MVR is inflated into memory (`await e.buffer()`) with no size or entry-count cap, unlike `extractZipSafely`; a zip bomb as "previs MVR" exhausts memory on the control server. Add the same entry/byte limits.
- `QUALITY` src/vr/magicq-mvr.js:22,73-86 — the scene is edited with a `<Fixture …>…</Fixture>` regex; a self-closing `<Fixture …/>` (legal XML) would make the lazy match swallow up to the next fixture's closing tag and rewrite the wrong element. MVR writers always emit children, so no failing case, but a real XML parse would be safer than regex surgery on an on-disk rig.

## src/vr/vr-desk-panel.js
- `RISK` src/vr/vr-desk-panel.js:326-327 — `stop()` TERM/KILLs every process classified `wayvr` (`byKind(procScan(), 'wayvr')`), not only the WayVR this module started (`start()` reuses an already-running WayVR with `fresh=false`, :280). A WayVR the operator launched by hand for another purpose is killed (with its process group when it leads one) by "End VR session". The file is careful about MagicQ ("another group: never stopped") but not about WayVR; remember the started-by-us pid in the state file the same way as the MagicQ pgid.
- `QUALITY` src/vr/vr-desk-panel.js:86-106 vs vr-session.js:51-69 — two copies of the `/proc/*/cmdline` scan, plus `realSpawn` (:108-121) vs `realSpawnXr` (vr-session.js:84-98) are the same detached-spawn-with-log-fd helper. (Measured: a scan of 478 processes costs ~1.2 ms, so polling at 1 s / 250 ms is fine.)

## src/vr/vr-session.js
- `DEAD` src/vr/vr-session.js:324 — `isXrClientArgv` is exported only for tools/smoke/smoke-wo770-vr-session.test.js (used internally by `scanProc`); `createVrSession` is the real entry for the smokes and `instance`.
- `QUALITY` src/vr/vr-session.js:269 — `start()` opens a pairing window (`enablePairing(5)`) automatically whenever no headset is paired, and the PIN is then returned in `status()` to every caller of the VR status endpoint. Intended by WO-770 (operator sees the PIN), noted because the endpoint's auth is the only protection for the PIN.

## src/vr/wayvr-ipc.js
- `QUALITY` src/vr/wayvr-ipc.js:70-73 — responses are matched to requests by COUNT (any non-`WvrStateChanged` packet is pushed to `out` until `out.length >= expected`), not by serial; an unsolicited packet of another type while a `WlxInputState` request is open would make `inputState()` read `r.WlxInputStateResponse[1]` of the wrong object (a `TypeError`, which `answers()` in vr-desk-panel.js turns into "no answer"). Harmless today (one request per connection), fragile if requests are ever batched.
