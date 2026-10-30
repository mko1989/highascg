# grandMA3 selection plugin (WO-857)

`highascg_selection.lua` mirrors the grandMA3 fixture selection into the HighAsCG previs. It has NOT been run on a
console yet (no console on the dev box): the first-run checks below are the acceptance test.

## What it sends

One UDP text datagram per selection change, plus the same selection again every 5 s (a lost packet heals):

```
HACG-SEL 1 gma3 <seq> <FIDs>        HACG-SEL 1 gma3 1790000123 101,102,110-115
HACG-SEL 1 gma3 1790000124 -        (nothing selected)
```

The receiver is `src/fixtures/gma3-selection-listener.js` on the HighAsCG box. Its port is **6290/udp** (override with
`HIGHASCG_GMA3_SELECTION_PORT` or config `lighting.gma3SelectionPort`; `0` / `off` disables it; bind address
`HIGHASCG_GMA3_SELECTION_BIND` / `lighting.gma3SelectionBind`, default all interfaces). The box firewall must allow it
(`sudo ufw allow 6290/udp comment "grandMA3 selection plugin"`), and the listener starts with the HighAsCG server, so a
server restart is needed once after this code is deployed.

FIDs become previs fixtures through the MVR FixtureIDs of the loaded scene (a patch entry `mvr-<uuid>` has the FixtureID
of that scene object; a hand-patched entry may carry an explicit `fid`). Head numbers with no patched fixture are listed
as `unmatched` in `GET /api/fixtures/console-selection`.

## Install on the console (onPC or hardware)

1. Put `highascg_selection.lua` in the console's plugin folder (onPC: `gma3_library/datapools/plugins/`; hardware: a USB
   stick's `grandMA3/plugins/`), or paste its text into a new Lua component of a plugin in the Plugin pool (Add, Edit,
   Create component, Lua). Exact menu names differ between 2.x versions.
2. Set the target: edit `HOST` / `PORT` at the top of the file, or set the user variables `HACG_HOST` and `HACG_PORT`
   (`SetVar UserVars "HACG_HOST" "192.168.0.56"`). The user variables win.
3. Run the plugin (`Plugin "HighAsCG_Selection"` or tap it in the pool). It prints `[HighAsCG] selection mirror -> udp ...`
   in the system monitor. Run it again to stop it (it sends an empty selection first).
4. In HighAsCG, Previs > Programmer: tick **Follow console selection**. Selected console heads get a cyan box.

## First-run checks (the open questions of the WO)

Select heads and groups on the console and watch the system monitor (`[HighAsCG] selection 101,102 ...`):

1. Does the poll see the selection? (`selection ...` lines appear.) If the line says "(hook seen)", the
   `HookObjectChange(Selection())` hook fires on this console; the poll is used either way.
2. Are the numbers FIDs, not patch indexes? Select the fixture whose FID you know (`Fixture 101`) and compare.
3. Does a group select give the expanded head list?
4. `require("socket")` must work. If the plugin stops with an error about `socket`, the console's Lua has no LuaSocket:
   hardware consoles are the likely case. Report it; the fallback is `SendOSC` to HighAsCG (not built).
5. On the box: `curl -s http://127.0.0.1:4200/api/fixtures/console-selection` shows `listener.packets` counting up and the
   selection's `heads` / `ids`.

## Return path (HighAsCG to the console)

`POST /api/fixtures/console-selection/send` types command lines into a grandMA3 listed in Devices > Lighting consoles
(kind grandMA3, OSC input enabled, **Receive Command = Yes**, no OSC prefix mismatch). One OSC `/cmd` message per command,
never a bundle:

```
{ "console": "<id>", "action": "select",    "ids": ["mvr-..."] }     -> Fixture 101 Thru 103 + 110
{ "console": "<id>", "action": "at",        "level": 50 }            -> At 50
{ "console": "<id>", "action": "attribute", "attribute": "Pan", "value": 12.5, "heads": [101, 102] }
                                                                       -> Fixture 101 + 102   then   Attribute "Pan" At 12.5
```

Still to check on a console: that the multi-range `Fixture a Thru b + c` form is accepted, and the scale of the Pan / Tilt
value (percent of range or physical degrees).

## Syntax check

`luac -p highascg_selection.lua` (package `lua5.4` or `lua5.3`). The dev box has no Lua interpreter, so the file has not
been syntax-checked there.
