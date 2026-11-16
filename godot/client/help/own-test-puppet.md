# Use your own character as the test puppet

The test people (**Previs → Camera → Markers → Test people**) can wear your own rigged character instead of the
shipped Woman / Man. It is a **previs puppet only**: it walks, stands and turns with the same motion-capture moves as
the shipped bodies. It is never a tracked person's look.

> Status: tested with a Rocketbox avatar (FBX) used as the "own" model, and with a synthetic test character for the
> MetaHuman DNA route. **Not yet tested with a real MetaHuman export** — none was on the box when this was written.

## Where to put it

1. Make a folder per character in `~/.local/share/highascg/puppets/` on this machine, e.g.
   `~/.local/share/highascg/puppets/ada/`.
2. Put the model in it: `.glb` (best), `.gltf` or `.fbx`, with its textures beside it or in a sub-folder.
3. In **Test people → Look**, pick **Own: ada**. The line under the row says what was loaded: triangles, how many
   bones were mapped, the height, and any warning.

Optional `puppet.json` in the folder: `{"name": "Ada", "moves": "woman"}` (`moves`: whose walk it borrows, `woman`
or `man`; by default the shorter characters take the woman's).

## What the model needs

- A **humanoid skeleton**: hips, spine, neck, head, both legs with feet, both arms. Bone names from Unreal /
  MetaHuman, Mixamo, 3ds Max Biped (Rocketbox), Rigify, VRM and Godot's humanoid are recognised. If bones are
  missing, the row names them and the puppet stays the cartoon.
- Standing in T-pose or A-pose. Facing does not matter; it is turned to face its walking direction.
- Up to 150 000 triangles without a warning (1 000 000 at most). Textures over 2048 px are scaled down.
- **GLB carries its own textures.** An FBX's textures are found by file name (`…body_color.png`,
  `…_normal.tga` …) in the model's folder.

## It stays on this machine

The folder is outside the HighAsCG repo. It is never copied into the ISO, onto a stick, onto the bridge disk, or
by Syncthing. The ISO build fails if it finds it. Do not put a character into `media/` or a project folder.

To use the same character on a second box of yours, copy the folder there yourself (for example with `scp`).

## MetaHuman: what is and is not possible here

**Possible:**

- **A — export from Unreal.** In Unreal, export the MetaHuman's body and head skeletal meshes as FBX (or glTF),
  with their textures. Put them in one folder as above. The Unreal bone names are mapped.
- **B — the DNA files** (MetaHuman Creator's **Export → DCC Export**, or Fab's **OpenRigLogic Sample Content**).
  On Fab, download the **Additional files** (the DNA files and textures), not the Unreal Engine format; `.uasset`
  files cannot be read outside Unreal. Then:
  1. Once per machine, build Epic's DNA library (MIT; about 5–10 minutes):
     `sudo apt install git cmake g++ swig python3-dev`, then
     `~/highascg/tools/people/openriglogic_build.sh`
  2. Put the head and body `.dna` files and the textures in `~/.local/share/highascg/puppets/<name>/`.
  3. Pick **Own: <name>**. The row shows the conversion's progress. The result,
     `<name>.converted.glb`, is written beside the DNA files. Delete it to convert again.

**Worse than in Unreal (expect this):**

- **No hair, eyebrows or beard strands.** The DCC export and the sample have no groom, so the head is bare.
- **No clothes.** The export contains the body mesh only.
- **A neutral face.** The face rig (RigLogic, its expressions and corrective shapes) is not run: the puppet does
  not talk or emote.
- **Simpler skin and eyes.** It uses the previs's standard shading with light subsurface scattering, not
  MetaHuman's skin and eye shaders. The thin eye-edge, eye-shadow and tear meshes are hidden.
- **One mesh detail level** (LOD 1 by default) and textures at 2048 px at most. The previs's lighting applies.
- Walk and idle are the shipped puppets' moves retargeted onto the MetaHuman's proportions.

**Licence** (Fab Standard License, as summarised on fab.com/eula):

- You **may** "Use the assets commercially or privately".
- You **may** "Share the asset (directly, via a private repository or in the Project) with your collaborators that
  are working on the Project with you".
- Use is "not limited to Unreal Engine".
- You **may not** "Resell or redistribute the asset for free on a standalone basis or allow others to do the same".
- The listing says "Allows usage with AI: No".

So the sample may be used on your own machines. It, and every file converted from it, must never go into the
HighAsCG repo, a release, or the ISO. Fab notes that this summary "is not legally binding"; the full EULA text is
what binds. Epic's OpenRigLogic libraries are MIT ("Copyright (c) 2026 Epic Games, Inc.") and contain no
characters.

Sources: github.com/EpicGames/OpenRigLogic (README, LICENSE, 5.8 headers), fab.com/eula (the summary), and the
Fab listing "OpenRigLogic Sample Content".

## When it does not load

The line under **Look** says why:

- **missing: …**: not a humanoid skeleton, or bone names that could not be matched.
- **no skeleton**: the model is not rigged.
- **over the … limit**: export a lower detail level.
- **needs Epic's DNA library**: run the build script above.
- **conversion failed**: see the message. Delete `convert.json` to try again.
