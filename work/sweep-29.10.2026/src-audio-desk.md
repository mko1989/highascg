# src/audio-desk — sweep 29.10.2026 (batch 067)

Files: 12 · lines: 1453 · findings: 0 BUG-HIGH, 2 BUG, 7 DEAD, 4 RISK, 9 QUALITY

Context: the audio desk is the WO-731 "Accept presenter → unmute the mic channel, raise the fader to at least a threshold" link. It is mounted by the tracking module (`src/tracking/register.js:330,475`), so its routes sit behind `checkHttpAuth` like every other module route. All desk calls are serialised through one queue in `desk-service.js`. No request string reaches a desk command (only integers from `settings.mics`), so there is no protocol-injection path.

## src/audio-desk/audio-page.html
- `QUALITY` src/audio-desk/audio-page.html:436-441 — `editing` is set on `focus`/`input` of the desk fields and cleared only after a successful Connect. Focusing a field and leaving it (or a failed save) freezes `renderDesk()` for the rest of the page's life: the 2-second poll no longer refreshes model/host/port/threshold, so a change made from a second tab or after a reconnect is never shown. Clear it on `blur` when the value equals the server's.
- `QUALITY` src/audio-desk/audio-page.html:445-468 — the page has no way to re-probe the desk (the server's `POST …/audio/probe` is never called by the page). Together with the BUG in `desk-service.js` below, a red "Desk: no answer…" chip cannot be cleared from the UI.
- `OK` for XSS: every server-supplied string (presenter name/note/mic, channel names, status detail) goes through `textContent` / element properties; `img.src` is `${API}/${p.id}/photo` with an id matching `p\d+`.

## src/audio-desk/audio-routes.js
- `DEAD` src/audio-desk/audio-routes.js:60 — `POST /api/tracking/presenters/audio/probe` has no caller. grep: `grep -rn "audio/probe" src client godot/client tools` → only the route, its doc comment and `tools/smoke/smoke-wo731-audio-desk.test.js`; the page never posts it. Either add a "Check desk" button (it would fix the BUG in desk-service.js) or drop the route.
- `QUALITY` src/audio-desk/audio-routes.js:29-33, 40 — the doc comment says that with the presenters duty off "the page answers 409 like the intake", which is true only for `GET …/audio`; `POST …/audio/desk`, `GET …/audio/channels` and Accept are still served (Accept just 404s on an empty roster, desk settings can still be changed). The intake gates its POST as well (`presenter-routes.js:54,63`). Align the comment or the code.
- `OK` for input handling: malformed JSON on the settings POST returns 400 (strict `JSON.parse`), unknown audio paths return 404, and the accept path only matches `p\d+`.

## src/audio-desk/desk-models.js
- `OK` — static table; unknown models throw before any socket is opened.

## src/audio-desk/desk-service.js
- `BUG` src/audio-desk/desk-service.js:94-106 — `setSettings` re-connects and re-probes only when model/host/port/midi_channel changed. Failing case: the desk is off or unplugged when the operator first presses Connect → status becomes `error`; the desk is then switched on and Connect is pressed again with the same values → `relink` is false → no `reconnect()`, no `probe()`, and the 200 response carries the old red status. `status` is otherwise updated only by an Accept attempt, so the chip stays red until a setting changes. The page's `setTimeout(refresh, 1500)` after Connect cannot help. Fix: always `probe()` after a settings POST (cheap), or call it from a button.
- `RISK` src/audio-desk/desk-service.js:63-66 vs 56-60 — `reconnect()` closes and replaces `driver` immediately and outside the queue. A queued or running Accept holds the old driver object (`acceptChannel(driver, …)` evaluates `driver` when the job starts, but a job that is already mid-sequence keeps using the closed one): the operator who edits the desk address while an Accept is running gets an error entry, and `accepted` records a failure for a presenter whose mic may already have been unmuted on the old desk. Run `reconnect()` inside `run()`.
- `QUALITY` src/audio-desk/desk-service.js:124 — `settings.mics[mic]` is a plain-object lookup, and the presenter's `mic` text is free-form (`MIC_RE` in the store admits `constructor`, `toString`, `__proto__`). An unmapped mic literally named `constructor` resolves to `Object`, passes the `!channel` check, and the driver builds an address from `String(Object)` (`/ch/function Object() { [native code] }/mix/fader`) instead of the "not matched" 409. Use `Object.hasOwn(settings.mics, mic)` and create `mics` with a null prototype.
- `QUALITY` src/audio-desk/desk-service.js:108-118 — "Read channel names" runs in the same queue as Accept: for the 288-input RIVAGE it is 288 sequential TCP gets (and the page also starts it on every load and every Connect), during which a presenter's Accept waits. Give names its own low-priority path or abort it when an Accept arrives.
- `DEAD` src/audio-desk/desk-service.js:178 — export `fmtDb` is not imported anywhere (`grep -rn fmtDb src tools` → only this file). `acceptChannel` is used by the smoke tests.

## src/audio-desk/desk-store.js
- `RISK` src/audio-desk/desk-store.js:33-38 — `host` accepts any hostname/IP and `port` any 1–65535, so anyone who can POST the desk settings makes this server open TCP (Yamaha model) or send UDP (X32/WING) to an arbitrary address and port, with a fixed protocol payload (for example `get MIXER:Current/InCh/Fader/Level 0 0` to `127.0.0.1:5250`, Caspar's AMCP). The payload is not attacker-chosen, so the impact is a blind probe/scan from the box, not code execution. Restrict to private/link-local addresses or at least refuse loopback ports other than the desk defaults.
- `QUALITY` src/audio-desk/desk-store.js:34 — `port` and `midi_channel` require `Number.isInteger`; a client that sends them as strings (`"10023"`) silently gets port 0 ("model default") and channel 1, saved to disk. The bundled page sends numbers, other callers would not notice.
- `QUALITY` src/audio-desk/desk-store.js:52-58 — a corrupt or hand-edited `audio-desk.json` yields the default (empty) settings with no log line, and the next save overwrites the file (mic → channel table lost). Log it and move the bad file aside as `config-manager` does (`.corrupt-<stamp>`).
- `QUALITY` src/audio-desk/desk-store.js:73 + desk-service.js:95 — `mics` is replaced wholesale by the client's copy (`next?.mics ?? settings.mics`). The page builds it from a state up to 2 s old, so two operators editing the table at once overwrite each other's rows.
- `DEAD` src/audio-desk/desk-store.js:73 — `deskFile` export unused (`grep -rn deskFile src tools` → only this file); `THRESHOLD_DB` is used by `desk-service.js`.

## src/audio-desk/drivers/allenheath-dlive.js
- `BUG` src/audio-desk/drivers/allenheath-dlive.js:20 + src/audio-desk/desk-store.js:16 — the store allows a threshold down to -60 dB, but the dLive fader code has no value below -53.5 dB (LV 1); `dbToLv(db)` returns LV 0 (= -∞) for anything at or under -54 and rounds to 0 up to about -53.8. Failing case: threshold -60 → Accept unmutes the channel, `setDb` writes LV 0, the read-back says -∞ dB, `acceptChannel` computes `ok=false` and the presenter shows "Not accepted: the desk reads on at -∞ dB after the change" with a 502. Fix: clamp the threshold per model (`MODELS[...].minDb`) or map to LV 1.
- `DEAD` src/audio-desk/drivers/allenheath-dlive.js:69 — exports `lvToDb`, `dbToLv`, `SYSEX` are not imported anywhere (`grep -rn "lvToDb\|dbToLv\|SYSEX" src tools` outside this file → nothing).

## src/audio-desk/drivers/allenheath-sq.js
- `DEAD` src/audio-desk/drivers/allenheath-sq.js:61 — exports `valueToDb`, `dbToValue` unused outside the file (same grep, no hit).
- `OK` otherwise — fader law and NRPN layout are consistent with the file's own documentation; channel range 1–48 matches `inputs`.

## src/audio-desk/drivers/behringer-wing.js
- `OK`

## src/audio-desk/drivers/behringer-x32.js
- `DEAD` src/audio-desk/drivers/behringer-x32.js:62 — exports `floatToDb`, `dbToFloat` unused outside the file (no importer in `src` or `tools`).
- `OK` otherwise — the four-segment fader law round-trips (checked the segment boundaries 0.0625 / 0.25 / 0.5 against the dB formulas).

## src/audio-desk/drivers/midi-tcp.js
- `QUALITY` src/audio-desk/drivers/midi-tcp.js:46-50 — the SysEx collector appends every data byte until `F7` with no size cap; a desk (or anything that can reach the TCP session) that opens `F0` and keeps streaming grows the array without bound. Cap at a few KB and drop the message.
- `OK` for the rest: running status, real-time byte skipping, NRPN assembly, timeouts that remove their waiter, `error` listener attached before the socket can fail.

## src/audio-desk/drivers/osc-udp.js
- `RISK` src/audio-desk/drivers/osc-udp.js:20-31 — replies are matched by OSC address only; the datagram's source is never compared with `host:port`. Any host on the LAN that sends a UDP packet to the driver's ephemeral port with the right address (`/ch/05/mix/on`, `/ch/05/mix/fader`) can supply the read-back, so a spoofed answer makes `acceptChannel` report success for a mute that never changed. The ephemeral port is random, which makes this hard but not impossible on a flat network. Check `rinfo.address === resolved host`.
- `OK` otherwise — one retry then a readable error, `closed` guard on send, errors swallowed so a bad host cannot crash the process.

## src/audio-desk/drivers/yamaha-rcp.js
- `RISK` src/audio-desk/drivers/yamaha-rcp.js:46-48 — the "late reply for a command that timed out" filter compares only verb and parameter address (`t[1]`, `t[2]`), not the channel index (`t[3]`). After a 1.5 s timeout on `get …/Fader/Level 4 0`, the delayed `OK get …/Fader/Level 4 0 … -400` arrives while the next command `get …/Fader/Level 5 0` is pending, passes the filter, and is returned as channel 6's level. Add `t[3] === pending.index`.
- `DEAD` src/audio-desk/drivers/yamaha-rcp.js:151 — exports `levelToDb`, `dbToLevel` are not imported anywhere (`tokens` is imported by `tools/smoke/smoke-wo731-desk-drivers.test.js:18`).
- `OK` for injection: every command line is built from the fixed parameter table and integers (`n - 1` of a validated integer, dB converted to an integer level).
