# WO-857 — Mirror the console's group / head selection in the previs (MagicQ, grandMA3 remote for VR programming)

**Area:** lighting, tracking-vr
**Status: OPEN — research done (30.10), nothing built**

Owner, 30.10:
> is it possible to mimic selections of groups from chamsys to the highascg visualizer? should be.
> check what type of remote control of gma3 is for vr programming purpose.

Related: [WO-796](./796_WO_magicq_show_from_highascg_mvr.md) (MagicQ show from the MVR, previs driven by MagicQ's Art-Net),
[WO-792](./792_WO_magicq_ui_in_vr_via_wayvr.md) (MagicQ UI in the headset),
[WO-793](./793_WO_aim_from_highascg_record_on_chamsys_desk.md) (HighAsCG aims, the desk records; CREP details),
[WO-765](./765_WO_mvr_export_calibrated_rig_to_desk.md) (MVR export to the desk),
[WO-771](./771_WO_vr_panel_selection_highlight_groups_view.md) (HighAsCG's own selection / groups view).

This is web and code research only. Nothing was sent to a console, an Art-Net port or the network.

## 1. Investigation

How to read the evidence tags below:
- **[docs]** = stated in the vendor manual or a protocol spec page I read.
- **[code]** = seen in public source code that runs on that console.
- **[inferred]** = my reading; not stated anywhere and not tested.

### 1.0 What HighAsCG has to mirror into

- The previs selection is one object per client: `godot/client/features/previs/fixtures/fixture_selection.gd`
  (`shared()`, `ids` = fixture ids in pick order, `set_ids()`, signal `changed`). The 3D pick, the VR box select
  ([WO-774](./774_WO_vr_box_select_type_filter_grip_fan.md)) and the Programmer list all write to it, and all of them
  already highlight from it.
- A console mirror needs (a) a feed of "console selected these head numbers", (b) a map head number to HighAsCG fixture
  id. [WO-796](./796_WO_magicq_show_from_highascg_mvr.md) already makes MagicQ head numbers equal the MVR FixtureIDs
  (line 90), so (b) is mostly free for a rig that came from the MVR.
- The only thing the previs gets from either console today is the DMX output. DMX has no selection in it.

### 1.1 Licensing facts that gate everything on the box's MagicQ PC

[docs] MagicQ PC manual, "Using MagicQ on PCs and Macs" (feature table by mode),
<https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/magicq_pc.html>:

| Feature | Demo mode (no ChamSys hardware) | Unlocked mode (ChamSys hardware) |
|---|---|---|
| OSC | not listed | listed |
| ChamSys Remote Control Protocol | not listed | listed (serial or network) |
| PSN | not listed | listed |
| Net sessions / multi-programming | not listed | listed |
| Visualiser / CITP | not listed in any mode | not listed |

- [WO-792](./792_WO_magicq_ui_in_vr_via_wayvr.md) saw the box's MagicQ run as "MagicQ PC (Demo Mode)". So on the box
  as it is, **OSC, CREP-in and PSN are all off the table**. Only Art-Net / sACN out (64 universes) works.
- The manual does not say whether the visualiser/CITP link works in demo mode. It is silent, not a no. Test it.

### 1.2 ChamSys MagicQ — can an outside app learn the current selection?

**Short answer: no documented channel carries it out of MagicQ. One undocumented one (CITP selection) is plausible
and cheap to test.**

1. **CREP (ChamSys Remote Ethernet Protocol), UDP 6553** — input only.
   - [docs] <https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/remote_control_commands.html> lists the commands.
     Selection commands: `01` select heads, `02` deselect heads, `03` deselect all, `04` select group (1..200).
     Programmer: `05` intensity, `06` attribute, `07`/`08` step, `09` clear, `20`-`23` record palette / cue.
     Attribute numbers: Pan 4, Tilt 5.
   - I read the command page and found **no command that reports state back**. The only state going out of MagicQ
     on this protocol is the Q-Sys plugin's playback and 10Scene levels and cue-stack active/inactive
     ([docs] <https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/remote_control_network.html>, "Q-Sys Plugins").
   - The only outbound mechanism is the `Y` macro in a cue stack's Macro field (it fires when that cue runs, not when
     heads are selected) ([docs] same page).
2. **MagicQ OSC** — feedback is playbacks and executes only.
   - [docs] <https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/OSC.html>: `/feedback/pb`, `/feedback/exec`,
     `/feedback/pb+exec` turn on feedback of "state of playbacks and executes". Built-in addresses cover the first 10
     playbacks and execute items. `/rpc` accepts a CREP command string (so it is a CREP bridge, still inbound only).
     Cue-stack macros can send OSC out (`K` macro), as above only when a cue runs. OSC bundles are not sent.
   - The manual excerpt I read does not mention selection or groups for OSC at all.
3. **AUTOM window / macros** — [docs] <https://docs.chamsys.co.uk/magicq/manual/automation.html> lists triggers such
   as Run macro, Exec toggle / activate / release / level, OSC Message, Serial and Custom TCP/IP (incoming text).
   I found no "head selected" or "group selected" trigger. [inferred] There is no hook to hang a selection push on.
4. **Web server / Remote app** — [docs] <https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/remote_control_console.html>:
   the built-in web server (off by default) has a Remote page ("a simple remote focus for setting channel levels"),
   an Execute page and window views. It is a view of console windows, not a data API. Remote Control Full is
   MagicQ-to-MagicQ (needs 1.9.8.0+ on both ends), not for third parties. [inferred] Screen-scraping the Outputs
   window would be the only way to read selection from it. Not worth it.
5. **MIDI / telnet** — the MagicQ manual pages I read mention no telnet or VNC interface. MIDI is input
   (`/midi` over OSC). Nothing reports selection.
6. **Art-Net / sACN tricks** — Art-Net cannot carry selection.
   - [docs] MagicQ visualiser page: "Art-Net does not support transfer of patch, XYZ or head selection information"
     (<https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/visualisers.html>; paraphrased by the fetch tool, wording
     close to this).
   - **Highlight is a side effect you could read.** [docs] MagicQ "Controlling Attributes" describes a Highlight
     Mode setting (Normal / Advanced / Advanced Highlight only / Advanced no reset): in Advanced modes selected heads
     are driven to their personality's highlight values; in Normal mode the selection's intensities are reduced
     except the head being controlled
     (<https://docs.chamsys.co.uk/magicq/manual/controlling_intelligent_heads.html>).
     [inferred] With the desk's Highlight on, the Art-Net output of selected heads differs from the playback state
     (full dimmer, open white, etc.), so the previs could diff "playback-expected" against "output". That is
     noisy: it only shows with Highlight pressed, it breaks as soon as a cue or the programmer already drives the
     head to the same values, and it needs the desk in a mode the operator may not want. A last resort, not a plan.
   - A reserved "selection universe" cannot be produced by a macro that fires on selection, because no such trigger
     exists (point 3). Rejected.
7. **CITP to a visualiser (the promising one, unverified).**
   - [docs] MagicQ visualiser page: "MagicQ supports transfer of patch, XYZ and head selection information to and
     from Visualisers." The page names Capture (CITP, "Capture (same pc)" option) and WYSIWYG (driver file, "Auto
     Focus" relays design-mode changes to the programmer). It does **not** say which protocol carries the
     selection.
   - [docs] CITP has a dedicated selection layer: **FSEL** (Fixture Selection), messages `Sele` (select; a `complete`
     flag = "fixtures not in the message are deselected", plus a list of 16-bit fixture identifiers) and `DeSe`
     (deselect). Fixture identifiers come from the patch layer FPTC (`Ptch` / `SPtc` / `UPtc`), are 1..65535 and "must
     be persistent". Discovery is multicast PINF/PLoc on 239.224.0.180:4809 (old 224.0.0.180), then TCP.
     Source: Rust `citp` crate docs mirroring the spec, <https://docs.rs/citp/latest/citp/protocol/fsel/index.html>,
     <https://docs.rs/citp/latest/citp/protocol/fptc/index.html>, <https://docs.rs/citp/latest/citp/protocol/pinf/index.html>.
     Full spec PDF (not read, the download redirects): <https://bitbucket.org/lars_wernlund/citp/downloads/master_2020-11-27.pdf>.
   - [docs] Another vendor proves the idea works: Avolites says "If you select fixtures on the console, the fixtures
     will highlight in Capture" (<https://manual.avolites.com/docs/capture-visualiser/visualising-using-capture>).
   - Capture's technical director on the Capture forum: with Hog's own drivers "you get the ability to select and focus
     fixtures in Capture"; for CITP "it comes down to what the console has implemented"
     (<https://www.capture.se/Support/Forum/aft/6849>). A forum user there says MagicQ selects in Capture when a
     fixture is selected in MagicQ, "believed to be CITP" — anecdotal, not confirmed by ChamSys or Capture.
   - [inferred] If MagicQ emits `Sele` on head selection, HighAsCG could act as a CITP "visualiser": answer discovery,
     read `Ptch` (identifier to head number), then `Sele`. FSEL is direction-neutral in the spec, and the MagicQ
     sentence says "to and from", so it might also carry HighAsCG's selection into MagicQ without the CREP unlock.
     Untested.
8. **What other visualisers do.**
   - Capture: CITP (MagicQ), Hog drivers, MA-Net3 for grandMA3 (below). WYSIWYG: ChamSys driver file. Vision / Depence /
     L8: Art-Net only, no selection from MagicQ ([docs] same visualiser page, "Vision, Depence, L8").
   - MagicQ's own free visualiser "MagicVis" exists. I could not read its page (404 on the versioned URL), so I do not
     know if it mirrors selection. [unverified]

**Groups.**
- [docs] <https://docs.chamsys.co.uk/magicq/1.9.9.x/manual/selecting.html>: pressing a group selects its heads; the group
  also becomes the reference for Group Cues / Group FX unless "No Group" type is used.
- CITP FSEL carries heads, not groups. [inferred] "Group 3 pressed" would arrive as a list of heads. HighAsCG can show
  the heads, and can name the group only by matching the head set against a group list it knows. MagicQ groups live in
  the show file, and I did not research an export path for them. So: **head selection yes (if FSEL works), group
  identity not observable.**
- The reverse is easy for groups: CREP `04,<n>H` selects group n ([docs], needs unlock).

**Reverse direction (HighAsCG to MagicQ), already in [WO-793](./793_WO_aim_from_highascg_record_on_chamsys_desk.md).**
- CREP `01`/`04`, `06` etc. on UDP 6553, or OSC `/rpc` carrying the same string. Needs Unlocked mode. [docs] says on PC /
  Mac the remote protocol works "when connected to a MagicQ Wing or Interface"; an MQ500 is fine at its own IP.
- The value scale of `06` is undocumented (WO-793, needs a desk test).

### 1.3 grandMA3 — remote-control surfaces, ranked for VR programming

**Short answer: there is no built-in "selection feed", but a small Lua plugin can push it, and OSC `/cmd` takes any
command line back. This is much better defined than MagicQ.**

1. **OSC in: the whole command line.**
   - [docs] <https://help.malighting.com/grandMA3/2.3/HTML/remote_inputs_osc.html>: "the entirety of the grandMA3
     command line can be accessed via OSC by using the `/cmd` OSC Address and the string `s` OSC Type", with *Receive
     Command* = Yes on the OSC line (Menu, In & Out, OSC; Enable Input on). Examples: `/cmd,s,Fixture 1 At 75`,
     `/cmd,s,Go+ Exec 402`. UDP or TCP, messages only (**no OSC bundles**), prefix without slashes.
   - [code] A public MA3 bridge sets attributes with `Attribute "<name>" At <value>` for the selection
     (<https://github.com/bdstark/gma3-mcp>, `plugin/gma3_mcp_feedback.lua` note KB-19/KB-20). [inferred] So the
     pan/tilt command is `Attribute "Pan" At <value>`; the scale (percent of range or physical) needs a test.
   - Direction (b), "send selection/aim back": `/cmd,s,Fixture 101 Thru 110`, then `/cmd,s,At 50`,
     then `/cmd,s,Attribute "Pan" At ...`. All plain command-line text, so this works from HighAsCG with one UDP
     packet per command.
2. **OSC out: playbacks only, not selection.**
   - [docs] same page: with *Send* on, "playback actions generate OSC output" for sequences, masters, groups, presets,
     etc. The manual "does not describe any other automatic messages ... for fixtures". A forum thread complains the
     output is a numeric format and has no subscribe/query (<https://forum.malighting.com/forum/thread/7614-osc-out/>,
     community posts, no MA staff in it).
   - The console can send arbitrary OSC from the command line or a plugin: `SendOSC 1 "/address,s,text"`
     ([docs] <https://help.malighting.com/grandMA3/2.3/HTML/keyword_sendosc.html>; types i f b s T F N I t; several
     values separated by commas). Destination is the OSC line's IP, so a third party like HighAsCG is fine
     (the manual's own example targets `/Videoserver/...`).
3. **Lua plugin: read the selection and push it out. This is direction (a).**
   - [docs] `Selection()` returns "a handle to the object holding the current selection of fixtures"
     (<https://help.malighting.com/grandMA3/2.2/HTML/lua_objectfree_selection.html>); `SelectionCount()`,
     `SelectionFirst()`, `SelectionNext()` walk it. `SelectionFirst` "returns the patch index number and the XYZ grid
     values", so it is a patch index, **not the FID**
     (<https://help.malighting.com/grandMA3/2.3/HTML/lua_objectfree_selectionfirst.html>).
   - [code] gma3-mcp's feedback module does exactly this walk (SelectionCount / SelectionFirst / SelectionNext), and
     maps handles to fixture IDs by reading the object's `FID` property. It reports "selection" among the things it
     observes, and it is "live verified" on **onPC 2.5.1.0** (macOS; Windows partly). Nothing is qualified on a physical
     console (<https://raw.githubusercontent.com/bdstark/gma3-mcp/HEAD/docs/compatibility.md>).
   - [code] That same plugin runs a TCP server inside onPC with **LuaSocket**: "Uses the LuaSocket and JSON libraries that
     ship with grandMA3 (shared/resource/lib_plugins/requirements)" (`plugin/gma3_mcp_bridge.lua`, line 4-5, `require("socket")`).
     So a plugin on onPC can open a UDP/TCP socket to HighAsCG directly. [inferred] Hardware consoles probably ship the
     same Lua runtime, but no evidence found; `SendOSC` works there regardless.
   - **How to know the selection changed:** [docs] `HookObjectChange(function, handle, pluginHandle)` calls a function
     when an object changes ([docs] <https://help.malighting.com/grandMA3/2.5/HTML/lua_objectfree_hookobjectchange.html>),
     but the page says only "grandMA3 objects" and its only example hooks the sequence pool. **Whether
     `HookObjectChange(..., Selection(), ...)` fires is not documented. [unverified]** Fallback: a plugin loop that polls
     `SelectionCount()` and the walk every ~100 ms and sends only on change. The gma3-mcp project polls the same way.
   - Direction (a) is therefore: plugin sends e.g. `SendOSC 1 "/sel,s,101,102,103"` or one UDP JSON packet; HighAsCG
     listens and calls `fixture_selection.set_ids`.
4. **grandMA3 web remote** (browser on port 8080).
   - [docs] <https://help.malighting.com/grandMA3/2.3/HTML/network_webremote.html> and the protocol table
     <https://help2.malighting.com/grandMA3/2.3/HTML/network_design_protocols.html>: HTTP 80 / websocket 8080 (TCP). It
     mirrors screens and a (linked) command line; max 5 devices on onPC (2 on a console); logs in as user "Remote" or
     `?user=&password=`.
   - No documented data API. I searched for a community reverse-engineered grandMA3 websocket client and found none
     (only a Qt example for **grandMA2**, so not usable). It is a video-ish mirror, not a selection feed.
     [inferred] Skip it for this job.
5. **MVR-xchange** (Menu, MVR).
   - [docs] <https://help.malighting.com/grandMA3/2.3/HTML/remote_inputs_mvr.html>: stations in the same network and
     exchange group commit and request **MVR files**, with a comment. Standard: DIN SPEC 15801:2023-12 (I did not read
     it). It carries rig geometry and patch, not live state. **It does not carry selection** (the manual describes only
     file commit / request; the spec text was not read, so "live selection is not in it" is my reading). Useful for
     [WO-765](./765_WO_mvr_export_calibrated_rig_to_desk.md), not for this.
6. **CITP / Capture.** [docs] Capture connects to grandMA3 through a *viz-key* and shows up "as a MA-Net3 device"; DMX is
   Art-Net or sACN (<https://capture.se/Blog/Post/7198/Capture-2021-1-released-with-grandMA3-support>). I found no
   source that grandMA3 speaks CITP/FSEL, and none on how (or if) it syncs selection to Capture. Dead end for us.
7. **Telnet.** grandMA2 had telnet on port 30000 ([docs] grandMA2 manual). I found no grandMA3 telnet page. Not
   claimed.
8. **PSN.** Already in HighAsCG for output (WO-631). Not a selection channel.

**Licensing and versions (grandMA3).**
- [docs] <https://help.malighting.com/grandMA3/2.0/HTML/qsg_output_dmx.html>: "We are not permitted to output anything
  from the grandMA3 onPC software unless we have some grandMA3 hardware", also for Art-Net / sACN. onPC alone is
  capped at 4,096 parameters; a DMX key / node / wing unlocks them
  (<https://help.malighting.com/grandMA3/2.1/HTML/system_parameter_expand.html>).
- So for the previs to show onPC's *output*, the owner needs MA hardware. OSC, Lua and the command line are not stated to
  need it, but I did not find a statement either way. [unverified]
- Version evidence: OSC `/cmd`, `SendOSC`, `Selection*()` and `HookObjectChange` are documented from 2.0 through 2.5;
  the one live-verified plugin baseline is onPC 2.5.1.0. Enumerated OSC addresses change between versions (manual warns).

### 1.4 What is NOT possible (honestly)

- **MagicQ:** no documented selection or group feedback over CREP, OSC, macros, MIDI or the web server. Art-Net cannot
  carry it. The only candidate is CITP FSEL, and nobody (ChamSys, Capture) states that MagicQ sends it. Group identity
  is not observable even then, only the heads.
- **MagicQ on the box today (Demo mode):** OSC and CREP in are locked (table 1.1). Even the reverse direction needs
  ChamSys hardware.
- **grandMA3:** selection is not pushed by the console on its own, and MVR-xchange and the web remote do not give a
  clean feed. It needs a plugin the operator installs and runs.
- **Both:** a console cannot be made to show HighAsCG's selection as its own without the unlocked remote protocol
  (MagicQ) or a command-line OSC receive (MA3).

## 2. Recommendation

**Build one transport-neutral "console selection" feed first, then one adapter per console.**

Common part (effort ~1 day):
- `src/fixtures/console-selection.js`: holds `{ source, heads: [headNumber...], ts }`, broadcast on the existing WS so
  the Godot client gets it. Head number maps to the fixture id through the MVR FixtureID (WO-796).
- Godot: a *second* selection set ("console") drawn in its own colour in the previs, plus a toggle "follow console
  selection". Do **not** write into `fixture_selection.gd.ids` unconditionally: the owner's VR pick and the console
  selection would fight (WO-774 / WO-841 own that set).

**grandMA3 (recommended path; ~1.5 days after the common part):**
1. Lua plugin on onPC: poll `SelectionCount/First/Next` (try `HookObjectChange(Selection())` first and log if it fires),
   resolve each handle to its `FID`, and on change send a UDP packet (LuaSocket) or `SendOSC` to the box. ~100 lines Lua.
2. HighAsCG UDP listener (small, one new port, add to the box layout notes) parses it into the common feed.
3. Return path: a server module sends `/cmd,s,...` OSC (UDP) to the console: `Fixture <a> Thru <b>`, `At <n>`,
   `Attribute "Pan" At <v>`. Needs *Receive Command* = Yes and no OSC bundles. ~half a day, plus a test for the
   pan/tilt scale.
- **Prototype first:** the plugin printing the selection to the command-line history while the owner selects groups and
  heads, to settle (i) whether the hook fires, (ii) FID vs patch index, (iii) group select giving the expanded head
  list. No HighAsCG changes needed for that step.
- **Gate:** the MA hardware question (1.3, licensing) decides whether the previs sees onPC output at all.

**ChamSys MagicQ (uncertain; ~0.5 day to find out, 2-3 days if it works):**
1. **Passive CITP test first**, no code in HighAsCG: set MagicQ's Visualiser type to Capture ("Capture (same pc)") for a
   universe, and watch with a packet capture on the box (multicast 239.224.0.180:4809 and the TCP port it announces)
   while selecting heads and a group. Question answered: does MagicQ send FPTC `Ptch` and FSEL `Sele`, and does it
   work in Demo mode. Read-only on our side; no frames go to any desk.
2. If `Sele` shows up: write a minimal CITP peer in Node (PLoc discovery, TCP accept, parse `Ptch` and `Sele`/`DeSe`),
   feed the common part. Also try sending a `Sele` back for direction (b) without CREP.
3. If not: the options are (a) buy into the unlock (any ChamSys interface/wing) and use CREP only for the *reverse*
   direction (WO-793), (b) the Highlight-diff hack (1.2 point 6), which I would not build, (c) skip selection mirroring for
   MagicQ and rely on grandMA3 for it.
- Group identity: by matching the head set to the show's groups, only if a group export path is found; otherwise show
  heads only. Say so in the UI.

Order of work: common feed, grandMA3 plugin prototype, MagicQ CITP capture test. The two are independent.

## 3. Open questions for the owner

1. Is grandMA3 actually in play (onPC only, or hardware: command wing / node / console), and which version? This
   decides whether the grandMA3 path can show anything on the box.
2. May I run the passive CITP capture while you press selections in MagicQ, and is it OK to set one universe's Visualiser
   type to "Capture (same pc)" for the test (it changes how that universe is output, and Capture is not installed)?
