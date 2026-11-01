# WO-918 — GUI test sweep 01.11: new / load / rename / file projects and screen destinations — 28 findings, 3 lose data

**Area:** godot-client, engine, devices-config, mapping
**Status: IN PROGRESS (01.11.26: 21 of 28 fixed and re-tested live in the Godot GUI; F2 F4 F6 F11 F13 F20 F26 + N1–N5 open)**

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

## Suggested fix order (items 1–4 done, 5 partly — see below)

1. **F27 / F28.** Autosave must carry the slug the client is editing (`fromSlug`) and must never retire on a guess.
   A retire must also log. An empty payload must not count as a rename. A client whose slug ≠ the server's active
   slug must adopt the server's project, not write.
2. **F9 / F10.** Give New project a unique slug (untitled-2 …) or a trash copy. `_commit_name` must not fire across a
   project switch.
3. **F23.** Offer "Replace current (keep a trash copy)" or "Import as copy" on `stale_rev`.
4. **F22 / F25.** Fix the path resolution for root media and image producers.
5. F1 / F3 / F4: make load and apply state honest. The rest is UI polish.

## What was done (01.11.26)

Commits 77d509c9, 51b7cd25, 8b765c91, 67544d2b, f19c85b3 (not pushed).

**Project switch / rename (F27 F28 F10 F9 F23 F14 F15 F1 F8)** — `src/api/routes-data-project-slug.js`,
`routes-data-project-handlers.js`, new `routes-data-project-new.js` (the /api/project/new block, 500-line limit),
`src/engine/new-project.js`, `project-store.js`, `project-volume-sync.js`; Godot `core/project_sync.gd`,
`project_sync_policy.gd`, `app/header_project.gd`, `header_model.gd`.
- The Godot client sends `editingSlug` (the slug the server handed it) with every autosave/save. Server
  `previousSlugKind`: editing the active slug under another name = `rename`; editing any other slug = `stale_client`
  → 409 `not_active` (the client re-pulls `/api/project` and adopts it, notice "The server switched to …"). Chosen over
  better heuristics because the client KNOWS which show it edits; guessing from looks is what trashed shows.
  Without `editingSlug` (web client) a rename now needs positive evidence (shared looks) — an empty payload is never
  a rename. Every rename logs `[project] renamed "a" → "b"`.
- F10: a rename onto a stored show's name = 409 `name_taken`; the client restores the name. The header field follows a
  project switch even while focused, and only commits after the operator typed.
- Load / New / Load from file call `ProjectSync.settle()` first (pending autosave lands, timer stops).
- Live sweep follow-up: every Load broadcasts `change project.activated`; other Godot clients now adopt the server's
  show at once (their own switch opens a 30 s settle window so they do not adopt twice).
- F9: New project takes the first free name (Untitled, Untitled 2, …; an autosave alone holds a name).
- F23: Load from file refused with `stale_rev`/`stale_saved_at` asks Replace / Import as copy / Cancel. Replace
  re-posts with `replaceExisting:true`: the stored file is COPIED to `_trash/<slug>-<ms>-replaced/` (the suffix keeps it
  from reading as a retirement in `wasProjectSlugRetired`), the file wins with the stored rev.
- F14/F15: retiring a slug also moves its bridge / stick copies into their `_trash` (the copy F15's sync revived).
- F1: the restart-required load notice is sticky; a successful Apply (any client) broadcasts `change caspar.applied`
  and replaces it with "CasparCG config applied". F8: New project wording says Operator GUI only.

**Server (F25 F22 F3)** — agent, reviewed: `live-scene-reconcile.js` maps an image producer's
`<file><path>media/x.png` to its clip id; `media-reference-rewrite.js` resolves a bare ref like playback (project copy
if it exists, else media root); `full-config-apply.js` returns `layoutOk`/`layoutProblem` (applied AND verified) and
stops claiming restarts that did not happen; `routes-caspar-config.js` puts both at the top of the Apply reply.

**Devices (F16 F17 F18 F21 F19 F1 F5 F3)** — agent, reviewed: size 64..16384, fps 1..240, main index capped to the
main-bus count (read-only with one screen), Operator GUI disabled in Add while one exists, Remove asks when looks sit
on that main, drag-release on a valid connector completes the cable (`cable_drag_release.gd`), `devices_follow.gd`
marks Apply dirty after a restart-required Load and shows an unverified layout in amber.

**Live (F12 F24 F7)** — agent, reviewed: the look editor closes when its show / look / bus goes
(`look_editor_stale.gd`) and cancels its pending preview push; the action line resets on a switch; the PGM outline
uses the project's saved `liveSceneIdByMain` only when no PGM channel exists; missing-media labels stack and elide.

Tests repointed (assertions kept, new form pinned): wo823 (import body built once), wo821 (rename sends
`editingSlug` — its flat `scenes` fixture has no look ids), wo697 (6th gated `usbAutoSync`: retire). New:
`smoke-wo918-project-switch` (8), `smoke-wo918-server-fixes` (19), Godot `test_devices_wo918`, `test_wo918_live_devices`,
policy/header tests, e2e `17_wo918_drag_and_stale`.

## What was VERIFIED (01.11.26)

Offline: node suite 5158 pass / 0 fail / 5 skipped; Godot 25690 / 0; check-max-file-lines 0 over.

Live, through the Godot GUI (test client on Xvfb :120 + the owner's :0 client relaunched on the new code), server
restarted on the new code:
- F9 New project → "Untitled 2" (untitled.json kept); :0 followed. F8 wording seen in the confirm dialog.
- Rename "Untitled 2" → "WO918 Sweep A": journal `renamed "untitled_2" → "wo918_sweep_a"` + `retired untitled_2.json on
  bridge` (F14).
- F10 rename onto "mhp harder": `autosave refused (name_taken)`, field back to "WO918 Sweep A", mhp_harder rev 588
  unchanged.
- F18 "Operator GUI" disabled in Add; F16 99999 → 16384 and 1000 fps → 240 reached the device view; F17 one screen →
  index read-only, two screens → typed 5 shows/stores 1; F21 confirm "1 look on this screen stays…"; F12 the open look
  editor closed when its bus was removed.
- F28: API load of mhp_harder under the clients, then an edit in the test client → `autosave refused (not_active)`,
  the client adopted mhp_harder with the notice, mhp_harder rev 588, no fork. After the follow-up both clients
  followed an API load immediately with no edit.
- F1 GUI Load (with hardware) → sticky "Caspar channel layout changed…" still up after 14 s, Apply amber; Apply →
  "Config written; layout applied; Caspar restarted." and the header notice became "CasparCG config applied".
- F25 blackFHD.png taken to PGM ch 2 and ch 4, node restarted: `scene.live` kept both.
- F22 against the real media tree: root `testowe/…/PK CLICK.wav` → used by look "Intro"; the project copy of
  blackFHD.png wins over a root path.
- F23 file saved at rev 5, show edited to rev 6, Load from file → dialog; Import as copy → `wo918_sweep_a_copy`
  loaded, original rev 6 kept; Replace → rev 7 from the file, backup `_trash/wo918_sweep_a-…-replaced` (rev 6).
- F19 press-drag-release from PGM/PRV 1's PGM dot onto DP 2/3 → edge `dst_in_dst_mvxpjc47_1 → gpu_p1`.
- F7 Intro card shows two readable "No preview" labels.
- Restored: mhp_harder active (rev 588), channels 1080p/3840x1792×2/1080p×3/64x36 aligned, DP-4 +0 / DP-6 +1920 /
  DP-0 +3840, :0 client at 0,0; test projects moved to the session scratchpad.

Not re-tested live: F15 on a stick (exFAT) — the bridge path only (untitled_2 did not come back after the rename);
F27 legacy (web, no `editingSlug`) path — offline only (an API probe would have been adopted by
both clients, the incident in memory); F3 failure wording (xrandr did not fail this time) — offline only; F24 outline.

## Still open

- F2 F4 F6 F11 F13 F20 F26 (unchanged).
- N1 The header notice is clipped at 200 px: the restart / switch / name-taken texts need the tooltip to be read.
- N2 A destination edit made just before another client switches shows is not stamped into the project: the autosave
  that would carry it is (correctly) refused, so loading the show later brings back the removed destination.
- N3 Live-thumb PRINT frames (`media/2026…T….png`) show in the Sources media list for the moment they exist.
- N4 Bridge `_trash` syncs back into `projects/_trash` (a renamed slug left two `untitled_2-*` dirs) and `-replaced`
  backups replicate to the bridge.
- N5 A rename leaves the old, empty `media/projects/<old slug>/` folder.
- The web client still uses the legacy path (no `editingSlug`, does not follow `project.activated`).
