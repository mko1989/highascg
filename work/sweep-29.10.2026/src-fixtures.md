# src/fixtures — sweep 29.10.2026 (batch 082)

Files: 34 · lines: 5812 · findings: 0 BUG-HIGH, 2 BUG, 3 DEAD, 9 RISK, 15 QUALITY

Scope notes. The batch has no MVR parser (that lives in src/stage); the GDTF side is `gdtf-parse.js` / `gdtf-store.js`. Neither writes archive entries to disk: `member()` only looks a name up in the zip directory and returns bytes, so there is no zip-slip. XML goes through xml2js (sax), which does not resolve external entities. Art-Net and sACN packet layouts were checked byte by byte: `artdmx.js` encodes ProtVer 14 BE, Length BE, SubUni = port-address low byte, Net = bits 8-14, sequence 1..255 (never 0). `encodeArtDmx` → `decodeArtDmx` round-trips (0x1234 → "34 12", len 0x0200). `sacn.js` offsets and PDU lengths match E1.31 (root 110+n, framing 88+n, DMP 11+n). 16-bit order is coarse-first everywhere (axisBytes / axisDeg / putChannel / raw / writePixel agree). All files are under the 500-line limit (largest: calibrate-solve.js, 389). No Art-Net was sent in this sweep; only pure functions were run.

## src/fixtures/artdmx.js
- `OK` Encoder, decoder and sender verified as described above. Sender opens one ephemeral socket and never binds :6454; `close()` is wired from `follow-service.stop()`.
- `QUALITY` src/fixtures/artdmx.js:48 `parseDest` accepts any dotted IPv4, including `0.0.0.0` and multicast, so the loop guard in follow-service.js:107 has to know about them (see the RISK there).

## src/fixtures/beam-offset.js
- `OK` Pin blending is exact on a pin (d² < 1e-12 branch), and `sentFor` keeps the closest step. Inputs are clamped, with at most 64 pins.

## src/fixtures/beam-spot.js
- `OK` Luma weights 29/150/77 sum to 256, so the `>> 8` is correct, and the BGRA order is right. The Uint16 sum is fine up to 257 frames; callers use 3. The flood fill is bounded by the grid size.

## src/fixtures/calibrate-session.js
- `OK` Sessions are in memory, one per fixture, and `end` / 404 delete them. The hold TTL covers the engine side. Live points store `inv: null`, so the pan sign flip in `view()` is not applied to them, as the comment says.

## src/fixtures/calibrate-solve.js
- `OK` Gauss-Jordan `solveLinear` and the LM loop terminate: the inner damping loop is bounded by `lambda < 1e10`, and the outer loop by 200 iterations. The fits are CPU-bound (about 550 seeds in `solveOffsets`) and run synchronously on every session `view()`, which is acceptable at the point counts used (3 to 6 per head).

## src/fixtures/calibrate-spot.js
- `QUALITY` src/fixtures/calibrate-spot.js:34 reads the camera surface from a hard-coded `/dev/shm/highascg-${role}`. The sibling pixel-map-service.js:58-60 documents that the WO-807 e2e caught exactly this: a WO-719 sandbox announces its segment under `<cwd>/shm/` (`video-surfaces.js segmentFor`), so the spot finder would sample the LIVE Caspar's segment from a sandbox. Fix: take `surfacePath` as a dep and default it to `segmentFor(role).path`. (`detect-service.js:90` outside this batch has the same literal.)

## src/fixtures/dmx-input.js
- `RISK` src/fixtures/dmx-input.js:250-258 (`SacnFrames.configure`): a bind error (for example :5568 held by another sACN app that did not set SO_REUSEADDR) is only logged by the `'error'` handler. `_sock` stays set, so every later `configure()` with the same port takes the `return this._join(want)` early path on a dead socket. The visualiser then receives nothing until the port setting changes or the universe set empties. Failing case: another process owns :5568 without reuse, then visualise mode is switched on → "sACN input" error line, then permanent silence with `status().port` still reporting 5568. Fix: on `'error'` before listening, `this.stop()` so the next `configure()` retries.
- `DEAD` src/fixtures/dmx-input.js:261 `this._pending = want` is assigned and never read. grep: `grep -rn "_pending" src/fixtures` → only that line.

## src/fixtures/fixture-looks.js
- `OK` Crossfade only touches channels whose function is unchanged and not wheel or discrete. `snapshotChannels` / `blendChannels` index by position in `fx.gdtf.channels` (see the `_fades` note under follow-engine.js).

## src/fixtures/follow-engine.js
- `QUALITY` src/fixtures/follow-engine.js:173-176 (header) still says a fixture that "loops into this box's own Art-Net input" is "never written". Since WO-695 (line 250-255) a self-loop only sets `fx.noSend`: the frame is built and the previs works, and only the wire is muted. The header contradicts the code below it.
- `QUALITY` src/fixtures/follow-engine.js:221-222, 226 `_fades` and `_w` are pruned for nothing on `configure()` (only `_aim`, `_hold` and `_values` are, lines 269-271). A fade started by `fade()` keeps `from` indexed by the OLD `fx.gdtf.channels`; if the mode or type is re-patched during the fade (up to the look's transition), `blendChannels` pairs `from[i]` with the wrong channel for the rest of the fade. A removed fixture's `_fades` entry is never deleted, because the delete happens only inside the per-fixture loop. Fix: prune both maps in `configure()` alongside the others and drop a fade whose channel count changed.
- `QUALITY` src/fixtures/follow-engine.js:449 `Buffer.from(u.buf).equals(u.last)` allocates a 512-byte copy per universe per tick (44 Hz); `Buffer.compare` against a view would avoid it. Negligible, noted only.
- `RISK` (self-loop guard timing) see follow-service.js:136-141 (BUG). The engine computes `noSend` only inside `configure()`.

## src/fixtures/follow-ik.js
- `OK` The solutions (p0, t0) and (p0+180, −t0) are enumerated over ±3 turns and the one nearest `prev` wins. NaN input cannot leak: `Math.abs(NaN) > pr` is false, but then `c` is NaN and `c < cost` is false, so `best` stays null → "out of range", never a NaN byte. `axisBytes` clamps.

## src/fixtures/follow-patch.js
- `BUG` src/fixtures/follow-patch.js:336 `parseFixed` splits on `/[,;\s]+/`, so whitespace around `=` breaks a pair. The doc comment on line 333 gives `"6=255, 7 = 8"` as an example. Failing case, run: `parseFixed('6=255, 7 = 8')` → `[{ch:6,value:255}]`; `7 = 8` is silently dropped (`parseFixed('6=255,7=8')` gives both). `fixed` is the "shutter / dimmer held open" field, so an operator who types `6 = 255` gets no channel written, with no error shown. The Godot twin (follow_model.gd:275-277) splits only on `,` / `;` and then on `=`, so it handles `7 = 8` differently (and ignores space-separated pairs the server accepts), which contradicts the "both normalize the same way" header claim. Fix: strip spaces around `=` before splitting (`text.replace(/\s*=\s*/g, '=')`) and make the Godot twin do the same.
- `QUALITY` src/fixtures/follow-patch.js:329 `axis()` does not reject `pan.ch === tilt.ch` (or fine channels colliding); `footprint()` dedups through a Set, so two axes can silently write one channel. Only reachable on the generic (untyped) profile.

## src/fixtures/follow-service.js
- `BUG` src/fixtures/follow-service.js:136-141 + src/fixtures/follow-engine.js:252-258. The "would loop into this box's own Art-Net/sACN input" guard (`fx.noSend`) is computed only inside `engine.configure()`, which `apply()` skips when `JSON.stringify(project.fixtures)` is unchanged (`if (json === lastJson) return`). The guard's inputs are not in that slice: the input port-address (`config.dmx.artnetInput*`, or the global-border slot's `artnetPatch` in the scenes) and this box's interface addresses (`targets = localTargets()` is refreshed only inside `apply`). Nothing else calls `reload()` for them (grep `fixtureService` outside src/fixtures: only GDTF type import/delete, MVR and gdtf-share routes). Failing case: patch has an Art-Net fixture on universe 3, dest 255.255.255.255 (the default), output on; the input listens on universe 0, so `noSend` is null (correct). The operator sets the Art-Net input universe to 3 in Settings, or edits the global-border patch: the fixtures slice is identical, `apply` returns early, and `noSend` stays null. The engine keeps broadcasting universe 3 to :6454, straight into the box's own lighting input, so the border driver reads our own pan/tilt/dimmer bytes. The same stale guard applies after a DHCP or NIC change that makes an address the destination "local". Fix: include `inputPortAddress(ctx)`, `inputUniverse(ctx)` and `[...localTargets()].join()` in the `lastJson` key (or re-run the `noSend` / `problem` pass on every `onProjectChanged`, plus the settings-save hook).
- `RISK` src/fixtures/follow-service.js:107 `reachesSelf` only knows `127.*`, `255.255.255.255`, own addresses and directed broadcasts. `parseDest` (artdmx.js:48) accepts `0.0.0.0`, which Linux sends to the local host. A patch `dest: "0.0.0.0"` (or `0.0.0.0:6454`) on the input's port-address is not flagged and loops into :6454. Verified: `parseDest('0.0.0.0')` → `{host:'0.0.0.0',port:6454}`, and `localTargets()` never contains it. (Not sent: the sweep's send ban applies.) Fix: treat `0.0.0.0` (and `0.*`) as local.
- `QUALITY` src/fixtures/follow-service.js:67-89 `inputPortAddress` and `inputUniverse` are two copies of the same try/catch around `resolveArtnetPatch` (which reads the project scenes from disk on each call); the first is `.universe & 0x0f` of the second. One resolve per `configure()` pass would do (currently once per fixture).
- `QUALITY` src/fixtures/follow-service.js:286 exports `localTargets` and `inputPortAddress` that nothing outside the file uses. grep: `grep -rnw "localTargets\|inputPortAddress" src tools scripts` → only follow-service.js.

## src/fixtures/follow-through.js
- `OK` Fade maths is in degrees and the 16-bit read (`(hi<<8)|lo`) inverts `axisBytes`. `stop()` clears the watch interval and both sockets.
- `QUALITY` src/fixtures/follow-through.js:92,110-116 `_listen` returns a socket even when `bind` fails (error only logged), so `status().local_desk` reports "127.0.0.2" for a desk socket that never bound (the 127.0.0.2 loopback alias missing on a non-Linux dev machine, for example). Cosmetic: the tap path still works.

## src/fixtures/gdtf-aliases.js
- `OK` Alias lookup is guarded (`ID.test(a.to)`, target must exist, no self alias). `all[from?.id]` with `__proto__` yields `a.to === undefined` → null.
- `QUALITY` src/fixtures/gdtf-aliases.js:601-608 `readAll()` re-reads and parses aliases.json on every `aliasFor()`, and `gdtf-store.summary()` calls it once per type (`list()` → N reads). Write is non-atomic (`writeFileSync`), so a crash mid-write silently drops all aliases (readAll swallows the parse error). Cache with mtime, write via tmp + rename.

## src/fixtures/gdtf-dmx.js
- `DEAD` src/fixtures/gdtf-dmx.js:152 channel field `highlight` is computed (`atRes(dmxValue(attr(ch,'Highlight')))`) and stored in every type JSON, but nothing reads it. grep: `grep -rn "highlight" src/fixtures src/api src/tracking` → only this line (other hits are unrelated UI "highlight" functions); `grep -rn "\.highlight\b" godot/client --include=*.gd` → only Godot `rows.highlight()` / `_colors.highlight()` method calls unrelated to channels. Drop it or use it for the programmer's "highlight" action.

## src/fixtures/gdtf-features.js
- `OK`

## src/fixtures/gdtf-ik.js
- `OK` The 12-number affine `mul`, `rotX`, `rotY` and `rotZ` are consistent with the stated basis layout. The solver tries both branches, then a coarse grid, and the pan ±360 candidates are range-checked in physical degrees.
- `QUALITY` src/fixtures/gdtf-ik.js:29 vs src/fixtures/pixel-map-propose.js:49 the same `mul` is duplicated (pixel-map-propose.js says so in its comment), as are `num`, `int`, `wrap` and `initialFn` across several files in this folder. One shared `affine.js` would remove four copies.

## src/fixtures/gdtf-parse.js
- `RISK` src/fixtures/gdtf-parse.js:121-128 `unzipper.Open.buffer` + `desc.buffer()` inflate `description.xml` with no cap on the uncompressed size (and `member()` in gdtf-store.js:266-267 does the same for any member). The only limit is the upload size in `readUpload`. A small `.gdtf` whose description.xml deflates to hundreds of MB (a zip bomb) is fully inflated into memory, then `xml2js`-parsed, inside the live server process. Failing input: a 100 KB zip with a 1 GB `description.xml` of repeated spaces. Fix: check `desc.uncompressedSize` (and `hit.uncompressedSize` in `member`) against a cap (for example 64 MB) before `.buffer()`.
- `OK` (otherwise) Only a root `description.xml` is accepted (case-insensitive), archive paths are kept as opaque strings, the depth is capped at 48, and a missing `FixtureType` throws a clear error.

## src/fixtures/gdtf-patch.js
- `DEAD` src/fixtures/gdtf-patch.js:231,355 `DMX_PROTOCOLS` is defined and exported, never used. grep: `grep -rnw DMX_PROTOCOLS src tools scripts test godot client/components` → only the definition and the export line.
- `OK` (otherwise) Two-pass `writeGdtf` handles twin offsets, `putChannel` writes big-endian with a per-byte `< 512` guard, `encodeValue` clamps to the function range. `invert: fx[k].invert !== f.physTo < f.physFrom` parses as `!== (a < b)` as intended.

## src/fixtures/gdtf-rig.js
- `OK` Only top-level geometries are referenceable, as the GDTF spec says. Depth and node count are capped (32 / 4096). The mesh path is used only for a set-membership test, never as a file path.

## src/fixtures/gdtf-share-match.js
- `RISK` src/fixtures/gdtf-share-match.js:436-439 `makerAgrees` is a bidirectional `startsWith` on the normalized names. Run: `makerAgrees('Robe','Robert Juliat')`, `('Martin','Martin Audio')`, `('ETC','Etcetera')` and `('A','Acme')` are all `true`. `rank()` marks a candidate `sure` at coverage ≥ 0.75, and `gdtf-share.resolve()` then downloads it and writes an alias without asking, so a same-named fixture from a different company whose name merely begins with the stub's maker is taken automatically. Needs the fixture name to match too (`nameRank <= 1`), so it is rare, but the failure is silent and persistent (aliases.json). Fix: require equality after synonyms, or a word-boundary prefix ("martin" vs "martin professional").
- `OK` (otherwise) `loose()` builds its RegExp from a `[^\w ]`-stripped maker, so no regex injection.

## src/fixtures/gdtf-share.js
- `RISK` src/fixtures/gdtf-share.js:328,337,355,367 every `fetch` (login, getList, downloadFile) has no timeout or AbortSignal. A hung gdtf-share.com (TCP accepted, no response) leaves `resolve()` (the HTTP request that triggered it) pending indefinitely, and `list()` never reaches its stale-cache fallback, because that only triggers on a thrown error. The user-visible effect is "Resolve placeholders" spinning forever offline-but-connected. Fix: `AbortSignal.timeout(15000)` on the metadata calls and a longer one for downloads.
- `OK` (otherwise) The account file is 0600 + chmod, the password is never logged, one re-login on 401, and `rid` is forced through `Number()`.

## src/fixtures/gdtf-store.js
- `RISK` src/fixtures/gdtf-store.js:191-195 and 207-213: `.gdtf` and `.json` are written with plain `writeFileSync` (non-atomic). A crash or power loss mid-write leaves a truncated `<id>.json`. `record(id)` then throws from `JSON.parse`, `list()` skips the type (swallowed), and `ensureGdtf()` (used by every MVR import, routes-stage-mvr.js:81-90) calls `record()` first, so it rejects for that content hash forever; it never falls through to `importGdtf` to overwrite the bad file. Failing case: a truncated `<id>.json`, then re-import the same MVR → `Unexpected end of JSON input`, and the only fix is deleting the file by hand. Fix: write to `*.tmp` and rename, and have `record()` return null (and unlink) on a parse error.
- `QUALITY` src/fixtures/gdtf-store.js:216-225 `list()` loads every stored type's full JSON into `_types` (never evicted), and the header says one pixel tube with 165 modes is several MB. `list()` only needs the summary fields. A box with a few dozen imported types keeps hundreds of MB resident for the process lifetime. Store a small `<id>.summary.json` or evict.
- `OK` (otherwise) `fileOf` validates the 12-hex id, so there is no path traversal through `id`; `member()` never touches the filesystem with the archive path.

## src/fixtures/gdtf-visual.js
- `OK` `cieToRgb` matrix, the 1.055 gamma and the normalize-then-gamma order are the standard xyY → sRGB path. Big-endian `raw()`; virtual channels are excluded from scopes (WO-784).

## src/fixtures/pixel-map-frame.js
- `OK` The seqlock is checked before and after, the fd is closed in `finally`, the plan is rebuilt only on a size change, and the regions are clamped (NaN rect → null). Reads are bounded by `x1 <= width`, so `row.subarray(a*4, b*4)` stays inside `stride`.

## src/fixtures/pixel-map-model.js
- `OK` Colour maths checked: w = min(r,g,b) extraction only when a white and an rgb channel coexist, amber = min(r,g)/2, CMY = 255−x, 16-bit scaled to `256**res − 1` and written big-endian. Mapping validation rejects NaN rects, duplicate ids and a duplicate target pixel.
- `QUALITY` src/fixtures/pixel-map-model.js:174,263 `ORDER_RE` allows only `[rgbwacmy]`, but the auto order uses `-` for an emitter driven dark (lime, UV). A pixel with such an emitter (4+ channels) has no way to be given an explicit `colourOrder` of the right length that also zeroes it. Only the auto path covers it.

## src/fixtures/pixel-map-propose.js
- `OK` Wall-local transform (`u = x cos − z sin`, `n = x sin + z cos`) matches Godot's `rotated(UP, yaw)` x-axis (cos, 0, −sin); edge distance, along-edge direction and clamping are consistent. Mapping ids are `auto-<fixtureId>-<pixel>` cut to 64 chars: a fixture id longer than about 55 chars would collide after the cut and make `accept` fail with "duplicate id" (400), not silently.

## src/fixtures/pixel-map-proposal.js
- `OK` The signature-based dedupe means a persist (which re-fires `onProjectChanged`) does not loop: `sig === stored.sig` returns early. Debounce timer is cleared in `stop()`.

## src/fixtures/pixel-map-service.js
- `QUALITY` src/fixtures/pixel-map-service.js:571-578 + follow-service.js:132,163-169. The service is created, and loads and resolves the project mappings immediately, BEFORE `apply()` configures the engine, so `engine.fixtures` is `[]`. Every boot logs `[pixelmap] N mapping(s), 0 outputtable` plus a `warn [pixelmap] pmX: fixture "fxY" is not in the patch` for up to 10 mappings, though they resolve fine on the first tick (`resolve()` re-checks when `engine.fixtures` changes identity). Reproduced offline: `createPixelMapService({}, {fixtures:[],…}, {loadProject: () => ({pixelMappings:[{id:'pm1',fixtureId:'fx1',…}]})})` → logs `0 outputtable` and `fixture "fx1" is not in the patch`. The same ordering means a project change that edits both fixtures and mappings is logged against the previous patch (pixel-map's `onProjectChanged` is registered before `apply`'s). Misleading log lines on the box's journal. Fix: log from the first `resolve()` after the engine is configured, or skip the boot log until `engine.fixtures` is set.
- `OK` (otherwise) Lease timer is unref'd and cleared in `stop()`, black on lost signal after HOLD_MS, sampling idles unless a head is on the wire.

## src/fixtures/psn.js
- `OK` Chunk header (id 16 / len 15 / sub 1), packet count patched at byte 4+4+11, tracker sub-ids 0x0000/0x0001/0x0003/0x0006 match the PSN v2 layout in the header comment. Timers are unref'd and cleared in `_stop`. Multicast TTL 1; the socket is send-only.

## src/fixtures/rig-anchors.js
- `RISK` src/fixtures/rig-anchors.js:355-373 `findRows` is O(rows × n³) (every head pair, each with an O(n) chain scan, repeated per extracted row) and runs synchronously in the HTTP handler. Measured: 100 heads in 5 rows → 24 ms; 300 in 15 → 287 ms; 600 in 20 → 1.39 s of event-loop stall (all the follow engine's 44 Hz ticks and AMCP wait). Realistic rigs are far smaller, but an MVR with several hundred moving heads makes "Calibrate the rig → start" freeze the server for seconds. Fix: sort heads along a candidate direction once, or cap n.

## src/fixtures/rig-calibrate.js
- `OK` The state machine keeps `s.cur` consistent through `measure` / `skip` / `undo` (anchors spliced before `cur` shift it back). A removed prompted mark gives a 409 instead of a crash.

## src/fixtures/rig-infer.js
- `OK` The rotation fit (atan2 of cross / dot sums) and yaw sign handling are consistent with "pose.yaw runs clockwise seen from above".

## src/fixtures/sacn.js
- `RISK` src/fixtures/sacn.js:185 `buf.write(String(sourceName).slice(0, 63), 44, 'utf8')` limits CHARACTERS, not bytes. `Buffer.write` only stops at the end of the buffer, so a multi-byte name overruns the 64-byte field into priority/sync/sequence/options. Run: `sourceName: '日本'.repeat(20)` → byte 112 (options) = 0xa5, i.e. Preview_Data set, which tells receivers to ignore the data. Latent: `follow-engine.js:453` passes no `sourceName`, so the default "HighAsCG" is always used; but `encodeE131` is exported with a free `sourceName` param. Fix: `Buffer.from(name).subarray(0,63)` copied into the field.
- `QUALITY` src/fixtures/sacn.js:175-194 `encodeE131` throws on a plain-array `data` (`data.buffer` is undefined; run: `encodeE131({universe:1,data:[1,2,3]})` → "The first argument must be of type string or an instance of Buffer…"), whereas `encodeArtDmx` accepts arrays; and a NaN `universe` silently becomes universe 0 (invalid for sACN). The engine always passes a clamped Uint8Array and integer, so latent.
- `OK` (otherwise) Layer offsets and PDU lengths verified against E1.31.
