# WO-918 — GUI test sweep 01.11: new / load / rename / file projects and screen destinations — 28 findings, 3 lose data

**Area:** godot-client, engine, devices-config, mapping
**Status: OPEN**

Owner, 01.11.26:
> Run tests for new projects, loading projects, changing/ creating new screen destinations etc but from a point of view
> of the user in Godot gui. You can restart servers and do what ever is needed. I want this tested thoroughly.
> There is no live show, it's a machine in dev mode

## How it was tested (01.11, Opus)

The live box was used: real Caspar, real Apply, node and Caspar restarts. A second Godot client ran on Xvfb :120
(`tools/test-agent/ui start --live`, xdotool input). The on-box :0 GUI was left running and was never driven.
Backup before testing: `~/.highascg/backup/guitest-20261101T104352` (config/, projects/). Baseline sandbox e2e
01/02/15/16 passed 33/33. Test projects (gui_test_a, focus_repro, file_import, race_probe) were removed afterwards.
`untitled.json` was restored from the backup. At the end, mhp_harder was loaded and applied: Caspar showed
1 OPG / 2-3 3840x1792 / 4-6 1080p / 7 64x36, and xrandr showed DP-4 +0, DP-6 +1920, DP-0 +3840. mhp_harder matches the
backup (24 looks and its destinations are identical).

**What passed:**
- adding PGM/PRV, PGM only, Multiview and Pixel Map destinations;
- rename, custom size, maths and gibberish in fields (per RULES.md);
- switching PGM only → PGM/PRV renumbers the channels;
- Apply then produced the expected Caspar channels;
- Load dialog: list, ● active marker, Cancel and double-click all work;
- three Loads within 4 s left server and header in agreement, with no file cross-written;
- Save to file writes the server's bytes verbatim;
- Load from file under a new name imports a new slug and keeps the open show;
- the look-delete confirm works;
- after a node restart the client reconnects by itself, with Apply shown in warn colour.

## Investigation — findings, most severe first

### Data loss

**F27 — an autosave of an EMPTY show under another name "renames" (trashes) the active show.**
`/api/project/autosave` takes `prevSlug` = the server's active slug (routes-data-project-handlers.js:395). It does not
use the slug the client was editing. `previousSlugKind` → `isLikelyStaleProjectReplace` returns false as soon as the
incoming show has 0 looks (src/engine/project-scenes.js:82), so the kind becomes `'rename'`, and `retireRenamedSlug`
moves the active show to `_trash`. No journal line is written: a retire on rename is silent.
- Deterministic repro: with `focus_repro` (1 look) loaded, `POST /api/project/autosave {"project":{"name":"Race
  Probe","scenes":{"scenes":[]}}}` moved `focus_repro.json` to `_trash/focus_repro-1793527827119` and made
  `race_probe` the active project.
- Seen through the GUI: "Untitled" (0 looks) was open, then "GUI Test A" was loaded (activated 11:08:39.835). At
  11:08:42 an autosave of the stale "Untitled" retired gui_test_a (`_trash/gui_test_a-1793527722993`). Two clients
  were connected (the test client and :0), so which one sent it is unknown.
- The show survived only because the Load list offers the bridge copy (F14/F15).

**F28 — a second client does not follow a Load made elsewhere; its stale autosave forks the show and steals the
active slug.** After an API load of mhp_harder (11:10:45.802), the on-box :0 client was still holding "Race Probe". At
11:10:48 it autosaved: the server enriched the payload from the live deck, so a 78 kB `race_probe.json` with
mhp_harder's 24 looks was written and made active. Log line: `"race_probe" shares no looks with "mhp_harder": another
show … kept`. Anything loaded on one client is therefore at the mercy of every other client's next autosave. Fixed
here by re-asserting mhp_harder through `/api/project/autosave`, which the :0 client then adopted.

**F9 — New project silently overwrites `untitled.json`, even when it holds looks.** `createNewProject` →
`persistProject` with slug `untitled` (src/engine/new-project.js) bypasses `validateIncomingProject`. Results:
- with Untitled open: rev 5 with 1 look → rev 6 with 0 looks;
- with ANOTHER show open and a saved Untitled holding 1 look: rev 8 → rev 10 with 0 looks.

There is no trash copy and no "overwrite?" prompt. The confirm text only warns about "unsaved changes".

**F10 — header name focus renames the fresh show onto the previous one.**
1. Type a name and press Enter. Focus stays in the LineEdit, and `Store.project_changed` skips `name_edit` while it
   has focus (godot/client/app/header_project.gd).
2. Press New project → Start fresh.
3. When focus leaves the field, `_commit_name()` renames the empty Untitled to the old name. The server's rename
   retires `untitled` and overwrites the old show's file.

GUI Test A lost its 5-destination rig this way (`_trash/untitled-1793526986969`, gui_test_a rev 11 at 10:56:26). Only
`empty_over_nonempty` protects shows that have looks, and when it skips an autosave the header gives no notice.

**F23 — a saved file of the SAME show cannot be restored.** After any edit, importing the earlier file fails with a
red, clipped "Load from file failed: Project save reject…" (`stale_rev`). `file_import_body` sends `allowReplace:true`
(header_model.gd:110), but that flag only skips the empty and stale-replace guards, not the rev check
(project-scenes.js:137). The user is offered no "replace" or "import as copy" choice, so a show cannot be rolled back
from a file. The file dialog also always opens at /home/casparcg.

**F22 — the media inspector says "Not used in any look or timeline." for a root file that two looks play.**
`findProjectMediaUsage` → `resolveRefValue` expands a bare `x.png` to `projects/<slug>/x.png` (project-scoped media is
on by default; src/media/media-reference-rewrite.js:63). Playback plays the root file: Caspar ch2 L10 showed
`20261031T121932.png`. As a result, Delete's confirm omits the "used N times" warning, and deleting the file breaks
those looks without a warning.

### Wrong state after load / new / restart

- **F1** After a Load that needs a Caspar restart, nothing in the GUI says so:
  - the header notice is non-sticky (header_model.gd load_notice), clipped at 200 px, and was overwritten by
    "Autosaved" within 3 s;
  - Devices Apply is not marked dirty (devices_toolbar.gd:129 only reacts to `restart_dirty`).
- **F2** "Server ▾" compare says "matches" while its "Module expects" column lists the RUNNING layout, not the loaded
  project's.
- **F3** The Apply status shows green "layout applied" although xrandr failed 3/3 or verify mismatched.
  src/utils/full-config-apply.js:320-329 picks the message from `casparRestart.reconnected` only.
- **F4** Load of an old project (frontex: PGM1 → DP-2, which is down) + Apply:
  - nodm restarts the whole :0 session;
  - xrandr fails, and Caspar's 5760x1728 window buries the Godot GUI;
  - the old operator destination's `videoOutput=screen` opens a screen consumer on DP-4;
  - a header Load gives no hardware-mismatch warning (hardware_reconcile.gd only runs on boot/reconnect).
- **F11** New project leaves the old show on air: PRV ch3 keeps playing, and Visuals "Send" re-sends to 2-1 after New
  project and after Caspar restarts.
- **F12** A ghost "Edit look: ?" editor survives New project.
- **F13** A stale "Live audio input 1 · HOST · ch 7" card remains after New project.
- **F24** The "TAKE ok" status and the red on-air outline survive loading a different project.
- **F5** The previous Apply's green status line stays after loading another project.
- **F6** Loading (and Apply) re-stamps savedAt, so the "Saved" column in the Load list loses its meaning. This was not
  seen on every load.
- **F25** A node restart forgets that a still image is on air: "Live scene reconcile: channel 2 layer 10 mismatch …
  clearing persisted live look", although Caspar plays that exact file. The image producer reports
  `<file><path>media/x.png</path></file>` with no `<name>`/`<clip>`, and `parseLayerFgClipsFromChannelXml`
  (src/state/live-scene-reconcile.js:68-90) reads only name/clip, so it returns '' for every still image.
- **F26** After a node restart in the F20 overlap state, OS-Watchdog makes 12 xrandr re-apply attempts in ~15 s and
  then logs "Layout still wrong … operator may need Apply OS". This appears in the journal only; the GUI shows nothing.

### Project list / sync

- **F14** A rename retires the slug in projects/ only. `~/bridge/projects/<old>.json` stays, so the Load list shows a
  ghost entry (source bridge, conflict:true). project-store.js:150.
- **F15** Bridge/exFAT sync resurrects retired projects: gui_test_a was retired at 10:57:34.331 and copied back from
  the bridge at 10:57:42.

### Screen destinations (Devices)

- **F21** Removing a destination whose bus holds looks:
  - happens without a confirm or warning;
  - leaves the looks in the project as hidden orphans (mainScope 1), which reappear when a destination takes that
    main index again;
  - leaves the removed bus's look editor open.
- **F16** Width and Height have no upper bound (99999 is stored). Frame rate accepts 1 and 1000.
  destinations_model.gd `_clamp_int` / `_clamp_float`.
- **F17** Main index silently snaps back to 0 (server-normalised), with no feedback.
- **F18** A second Operator GUI is refused (correct), but the type list keeps offering it.
- **F19** Press-drag-release from an output dot onto a GPU port does not cable; it only arms click-click mode.
- **F20** Outputs that are connected but uncabled keep their old xrandr position, so after Apply DP-6 overlapped DP-0
  (+1920+0).
- **F7** Look cards with missing media show overlapping "No p" / "No preview" labels.
- **F8** The New project wording ("one PGM screen destination", "reset to one PGM") contradicts the result, which by
  design (WO-264) is Operator GUI only.

Screenshots and the raw log are in the session scratchpad: `findings.md` and `live/shots/` (01–49).

## Suggested fix order (not done)

1. **F27 / F28.** Autosave must carry the slug the client is editing (`fromSlug`) and must never retire on a guess.
   A retire must also log. An empty payload must not count as a rename. A client whose slug ≠ the server's active
   slug must adopt the server's project, not write.
2. **F9 / F10.** Give New project a unique slug (untitled-2 …) or a trash copy. `_commit_name` must not fire across a
   project switch.
3. **F23.** Offer "Replace current (keep a trash copy)" or "Import as copy" on `stale_rev`.
4. **F22 / F25.** Fix the path resolution for root media and image producers.
5. F1 / F3 / F4: make load and apply state honest. The rest is UI polish.

## What was done

Nothing in code. This WO records the test sweep.

## What was verified

Every finding above was reproduced on the box on 01.11.26, with journal lines, API responses and screenshots as
cited. F27 was also reproduced deterministically over the API.
