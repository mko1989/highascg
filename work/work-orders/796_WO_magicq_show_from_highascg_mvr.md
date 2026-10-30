# WO-796 — A MagicQ show of the loaded MVR scene, driving the previs from MagicQ in VR

**Area:** lighting, tracking-vr
**Status: DONE (27.10, MagicQ → previs probed head by head on the box + smokes 49/49 + offline suite); owner QA in the
headset. Follow-up: 4 conventional types stay dark in the previs (their GDTFs have no Beam geometry, see below)**

Owner, 27.10 (after WO-792's "ok. looks good"):
> make a project for magicq so i will be able to programm the stage/scene in vr via magicq
>
> the current mvr scene loaded in highascg

Parent: [WO-792](./792_WO_magicq_ui_in_vr_via_wayvr.md) (MagicQ PC as a panel in the headset).

## Investigation

- **The loaded scene.** The active project is `mhp_harder`. Its `previs.mvr` is "MHP Patch Final" (`projects/_mvr/<id>.mvr`,
  13 GDTFs, 199 fixtures), and `fixtures.patch` lists all 199 as `mvr-<uuid>` entries.
- **MagicQ PC 1.9.8.3 imports MVR** (Setup → File Manager → `.mvr` → "MVR GDTF Data"). The user folder is
  `~/Documents/MagicQ/show`. The first import of the raw scene MVR patched 199 heads with the right per-type counts.
- **The raw scene MVR is the wrong rig for the previs.** With MagicQ sending `1@100`, head 1 (MAC Quantum,
  `mvr-b4eee245-…`, Art-Net 4.1) still decoded `i: 0` in `GET /api/tracking/fixtures`.
  - The MVR's own GDTFs are often placeholders. "Martin MAC Quantum 27CH" is 27 × `DimmerN`.
  - HighAsCG's patch replaced 10 of the 13 types with Share / store GDTFs (WO-633 / WO-785). For example, Quantum is
    now `c24ac67a2350` "Extended".
  - A desk patched from the placeholders sends a channel layout the previs does not decode. The MagicQ show therefore
    has to be built from **HighAsCG's patch**, not from the scene file.
- **Addressing.** An Art-Net port-address U is MVR universe U + 1 (absolute = (U)·512 + address). MagicQ universe N
  outputs Art-Net N − 1 by default, so MagicQ's universe numbers line up with no remapping.
- **Getting MagicQ's DMX into HighAsCG on the same box.**
  - Both bind `0.0.0.0:6454` with `SO_REUSEADDR`. Linux hands a unicast to `127.0.0.1:6454` to the last-bound
    socket, which is MagicQ, so HighAsCG never saw it (scratchpad `reuse.js`, reproduced).
  - A socket bound exactly to `127.0.0.2:6454` wins over every wildcard bind for datagrams to 127.0.0.2.
  - MagicQ's DMX I/O accepts a per-universe unicast IP.
  - Broadcast was ruled out: it would also put MagicQ on the venue network and onto the box's own lighting input
    (see the Art-Net loop memory).
- **The previs reads the desk only in visualiser mode** (`project.fixtures.dmx.visualise`, WO-615 T7,
  `src/fixtures/follow-service.js:142-143,222`). With it off, the previs shows HighAsCG's own programmer.

## What was done

- **`src/vr/magicq-mvr.js` (new): `stageMvrForMagicq()`** builds `~/Documents/MagicQ/show/<scene name>.mvr`.
  - It reads the scene archive and rewrites `GeneralSceneDescription.xml` per patched fixture (`rewriteScene`, pure):
    `GDTFSpec` → `Manufacturer@Name@hacg-<typeId>.gdtf`, `GDTFMode` → the patch mode, and `Addresses` → the absolute
    address (`absAddress`).
  - Fixtures that aren't in the patch, are disabled or have no type keep the scene's own values.
  - It packs the store GDTFs (`gdtf-store` `fileOf`, now exported) and drops `.gdtf` members nothing references any
    more. Trusses, meshes and matrices stay byte for byte.
  - It writes only when the bytes changed. A missing scene, scene file or MagicQ folder returns null.
- **`src/vr/vr-desk-panel.js`:** "MagicQ in VR" stages the file before starting MagicQ. A failure is non-fatal, and
  the file name shows in the status as `mvr`.
- **`src/fixtures/follow-through.js`:** `ConsoleFrames` also binds `LOCAL_DESK_HOST` = `127.0.0.2:6454`
  (`:26`, `:92`, `_listen` `:110`). `status().local_desk` reports it.
- **`src/stage/mvr-store.js`, `src/fixtures/gdtf-store.js`:** export `fileOf`.
- **The MagicQ show "MHP Patch Final"** was made in a hidden MagicQ on Xvfb :99, without touching the owner's :0:
  - New show, programming mode Live (Chase), then File Manager → "MHP Patch Final.mvr" → "MVR GDTF Data".
  - Setup → DMX I/O: MagicQ universes 1–9, 11–23 and 27 (= Art-Net 0–8, 10–22, 26, the 23 the patch uses) are
    Enabled, Art Unicast to 127.0.0.2. These are console settings, so they survive a new show.
  - Save As "MHP Patch Final" (overwrote the 14:42 save from the placeholder import). MagicQ quit cleanly, and
    `lastshow.shw` / `status.dat` now point at it, so "Continue last show" opens it.
  - Backup of the MagicQ folder before WO-796: session scratchpad `magicq-docs-before-wo796.tgz`.
- **Live project:** `fixtures.dmx.visualise = true` via the autosave (rev 262). So the previs now follows MagicQ.
  To give the previs back to HighAsCG's own programmer, switch "Art-Net / sACN input" off in the Godot fixtures
  section. Backup: scratchpad `mhp_harder.before-wo796.json`.
- **Smoke test:** `tools/smoke/smoke-wo796-magicq-show.test.js` (curated list 2). It covers:
  - `absAddress`;
  - `rewriteScene` (patched / kept / disabled / byte-identical untouched fixtures);
  - the builder on a fake MVR zip (placeholder GDTF dropped, store GDTF packed, truss kept, unchanged → not
    rewritten, repatch → rewritten, all three null cases);
  - the 127.0.0.2 socket winning over a later wildcard `:6454` bind.
- `smoke-wo792-vr-desk-panel` rig: an injected `stageMvr` (never the real folder); start reports `mvr`.

### Known gap: four types never light in the previs

The four types are Mini Pony PC (`2b4960235c00`), ELP WW (`e52b86f0a60a`), ELP CL (`de5b428eeba3`) and Micro Wash
RGBW (`d939b53518fd`): 33 fixtures. `gdtfStore.visual()` returns a rig of a single `Geometry` node and `plan.beams`
is empty (`gdtf-visual.js:61-66` only makes beams from `Beam` nodes), so `beams: {}` whatever the DMX.

- Three are MVR-exporter stubs: one `Base` geometry, no model.
- The ELP CL Share file (rid 84089) has a single plain `<Geometry Name="Beam">`: the name, not the type.
- MagicQ drives them correctly (e.g. U0 ch1 = 255 for an ELP WW at 0.1). This is a previs gap that predates
  WO-796, not a show problem.
- A fallback (treat a beamless type's root geometry as its beam) needs the Godot previs to draw it too. Not done
  here.

## Verified

- **The builder, live:** `patched: 199, kept: 0`, and the archive holds 13 `hacg-` GDTFs (no placeholders).
- **MagicQ's patch after import:** 199 heads in 13 tabs. "Martin MACQuaPro Extended 5-001 Hd 1" has Colour Mix, and
  "Robe 300 LEDWash Mode 1 Extended" is at 4-001.
  - Head numbers = MVR FixtureIDs (1–16, 21–28, 31–36, 101–110, 121–152, 201–224, 401–416, 601–632, 1001–1056,
    10001–10010, 10101–10105, 10201–10207, 10301–10322).
- **Network:** a sniffer on 127.0.0.2 / 255.255.255.255 / 192.168.50.255 saw exactly Art-Net 0–8, 10–22 and 26
  unicast to 127.0.0.2, and nothing broadcast. `GET /api/tracking/fixtures` shows input `from 127.0.0.1` with
  `local_desk: 127.0.0.2`.
- **End to end, MagicQ `<head>@100` → previs `i: 1`:**

  | Head | Type | Previs |
  |---|---|---|
  | 1 | MAC Quantum | Art-Net 4: ch1 shutter 30, ch2-3 dimmer 255/255 |
  | 21 | Robin 300 LEDWash | 19 pixel beams |
  | 31 | MAC Encore Performance CLD | lit |
  | 101 | Sharpy Plus | colour [0.96, 0.86, 1] |
  | 121 | Vizi Beam CMY | lit |
  | 201 | X-DOT | 35 beams |
  | 401 | P10 Profile HP | lit |
  | 601 | MAC Aura PXL | 160 beams |
  | 1001 | Pixel Line / Strobe 3 IP | 48 beams |

  - 9 of 13 types are proven. The other 4 are the gap above.
  - Programmer cleared → 0 fixtures lit.
- **Tests:**
  - Smokes wo796 + wo792 + wo770 + wo632 + wo615-visualise / visual / mvr-patch: 49/49.
  - The full curated offline suite: 3408 passed, 0 failed, 2 skipped.
  - ESLint clean, no file over 500 lines, prettier `tools/ci` clean.
- **Deploy:** server restarted, 38-fixture programmer restored identical, `input.artnet.local_desk: "127.0.0.2"`;
  `POST /api/vr/start` ok (headset off, so no client yet). The live builder now returns `written: false` against
  the imported file, so "MagicQ in VR" leaves the show's MVR as imported.
- **Owner QA:** in the headset, VR… → "MagicQ in VR" opens "MHP Patch Final"; program heads and watch the stage.
