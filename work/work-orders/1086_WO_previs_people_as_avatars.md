# WO-1086 — Previs: tracked people as friendly avatars derived from the person (no camera pixels)

**Area:** tracking-vr, godot-client
**Status: IN PROGRESS (15.11.26 — built and committed; sidecar traits proven on real footage + the real sidecar process, Godot 28625/0; the avatar render NOT seen yet: shows on the owner's next GUI relaunch)**

Owner 15.11: *"for dummies on previs i was thinking more to create a character based on the person that is 'caught'
by cameras. in a similar look like nintendo mi characters. the camera live view looks horrible."*

Meaning: replace the camera picture on the previs figures with a clean, stylised cartoon avatar per tracked person,
derived from that person (clothes / hair colours, height) so each presenter is recognisable at a glance — but drawn as
a simple character, never showing camera pixels. The style is our own (not a copy of any console avatar system):
see "Avatar style" below.

Related: [WO-665](./665_WO_previs_person_cutout_cards.md) (cut-out cards, the seg mask),
[WO-666](./666_WO_previs_textured_person_dummies.md) (painted mannequins),
[WO-667](./667_WO_previs_posed_person_dummies.md) (body keypoints, world joints),
[WO-701](./701_WO_cutout_sticky_camera.md) (sticky camera, `facing()`),
[WO-1080](./1080_WO_tracking_person_ids_no_memory.md) (tracked ids are remembered 30 s),
[WO-978](./978_WO_tracking_desk_test_env_puppet_psn_magicq.md) (marker pins with name tags in the 3D stage).

## Investigation

### Where the people layer is today

- One Node3D draws every tracked person: `godot/client/features/previs/tracking/person_cards.gd` (302 lines). The
  toolbar picker "People: off / cut-outs / dummies" sets `style` (`STYLES := ["off", "cards", "dummies"]`, line 20),
  stored per client in `user://ui.cfg [previs] people` (lines 37–47). Nothing is stored per project.
  - With nothing stored the default is "off" (or "cards" for a pre-WO-666 `cutouts = true`), line 40.
  - The owner's own client has `people="dummies"` stored
    (`~/.local/share/godot/app_userdata/HighAsCG Operator/ui.cfg`, read only).
- Input: the WS `tracking:detections` snapshot (`src/tracking/register.js` `withPins`, line 213):
  `cameras[].persons[] {tid, box, score, age_s, floor, mask?, kps?, world?, marker?}` and
  `world.persons[] {id, x, y, height, keys ["cam:tid"], age_s, joints?, marker?}`.
  `person_cards_model.cards()` turns it into one record per world person (feet, height from the fused head or the box
  top ray, the views, joints).
- Both existing styles bind live video: `_place_card` / `_place_dummy` set `video`/`videoN` uniforms from
  `VideoSurfaces.texture(role)` and `_hold_roles()` acquires every role a figure draws (`person_cards.gd` 214–227).
  Holding a role means the client reads + uploads that camera's 1080p frames every frame and keeps its lease.
  Measured earlier on this hardware class: 1920×1080@50 native read 1.33 ms + upload 1.12 ms p50 per frame
  ([WO-596](./596_WO_godot_hshm_gdextension.md) table) and +4.9–5.2 % client CPU per held surface
  ([WO-617](./617_WO_previs_2d_mode_and_surface_refcount.md): Live tab 11.9 % with one surface vs 7.0 % with none).
  The Caspar-side shm consumer of a tracking camera exists anyway while detection runs (the sidecar reads it), so a
  mode without video saves the client-side read/upload, not the Caspar consumer.

### Where the pixels are (the one honest place for traits)

- Only the Python sidecar (`tools/tracking-detect/sidecar.py`) sees camera pixels. Per detection step it has the raw
  BGRA frame (`face.bgr_from_bgra`, a no-copy BGR view used by the WO-675 face/body features and the WO-1036 capture),
  every track's box, the WO-665 seg mask (when the model is `*-seg`; `seg.py` encodes a 48×96 bit grid inside the
  box) and the WO-667 keypoints (when "Body pose" is on; 17 × [x, y, v] normalised to the frame). The detector's own
  `rgb` is CLAHE-equalised (`detector.py` `preprocess`, line 172) — unusable for colour; traits must read the raw view.
- The Godot client cannot sample colours without binding the very video the owner dislikes (the WO-666 shader's
  "mean colour" is computed on the GPU from the bound camera texture), so traits are computed in the sidecar and travel
  as a few numbers. No second pipeline: same frame, same boxes/masks/keypoints, same `tracks` message.
- Identity: the sidecar's ByteTrack keeps a person's `tid` through losses and parks it 30 s in memory (WO-1080,
  `bytetrack.py`). Trait state keyed by camera + tid therefore survives a brief loss: a revived track gets its old
  traits back at once. World ids (fusion) are separate; in Godot an avatar whose world person vanishes is held briefly
  and adopted by a new world id that carries one of its camera keys, so the avatar does not pop.
- Server pass-through: `src/tracking/detect-model.js` `personsFrom` (line 155) whitelists per-track fields (mask
  regex, `kpsFrom`). A `traits` field needs a validator there; nothing else on the server changes (the snapshot copies
  the persons).
- Labels: pinned people already get a name tag in the 3D stage — [WO-978](./978_WO_tracking_desk_test_env_puppet_psn_magicq.md)
  `marker_pins_3d.gd` draws every hub marker (a pinned person drives one, a bound WO-675 presenter drives 65000 + n)
  as a pole + ball + `Label3D` with its name at the marker's position. A second label on the avatar would duplicate it.
- Testing without cameras: `src/tracking/detect-sim.js` (WO-979) is a fake sidecar speaking the same protocol
  (switched on per project with `detection.simulate`). The live project has detection disabled
  (`GET /api/tracking/detections`: `enabled:false`, no world persons), and changing the project is not allowed in
  this session, so the live GUI cannot show a tracked person now.

### What the data honestly supports

| Trait | Source | Notes |
|---|---|---|
| top colour | torso region: shoulders→hips with keypoints, else box rows 22–45 % (centre half) | mask-filtered when seg runs |
| bottom colour | hips→knees with keypoints, else box rows 55–72 % (centre) | skipped when the box is cut by the frame bottom |
| skin tone | face patch (nose + both eyes visible) with keypoints, else box rows 5–12 % | only pixels passing a broad YCrCb skin range; no sample when < 30 % pass (back of the head) |
| hair colour | above the eyes with keypoints, else box rows 0–5 % | skipped when the box top is the frame top, or a wrist is above the nose (box top = a hand) |
| hair length | short / long / bald-ish | bald = hair patch ≈ skin; long = mask pixels beside the neck (ear → shoulder) match the hair colour — needs seg **and** pose; else never "long" |
| height | already in the snapshot (fused head height or box-top ray, WO-665 `estimate_height`) | Godot side |

Left out on purpose: glasses (a stage person's eyes are a few pixels; no reliable detector without a new model),
build / body shape (the box width follows arm pose and stride, no honest signal), gender, age or anything else
inferred about the person, and the real face (the avatar's face is the same simple drawing for everyone).

## Avatar style ("pebble people")

Our own design: a toy-like figure, about three heads tall (corrected 15.11: the build is 1.02 / 0.35), built from a few Godot primitive meshes (no assets, no
downloads), flat matte colours:
- a big round head (sphere, skin tone) with two dot eyes, a small dark smile and two soft blush dots — identical for
  everyone, never derived from a face;
- a hair cap: a slightly larger sphere set up and back on the head (short), plus a rounded fall down the back to the
  shoulders (long), none (bald-ish);
- a rounded capsule body in the top colour, stubby capsule arms in the top colour with round hands in skin tone;
- two short capsule legs in the bottom colour with rounded shoes a darker shade of it.

## What was done

**Sidecar — `tools/tracking-detect/traits.py` (new) + `sidecar.py` (+5 lines).** After seg and pose have attached
their masks / keypoints, `cam.traits.attach(tracks, face.bgr_from_bgra(...), now, memory_s)` reads the raw frame:
- regions per the table above, each cut to ≤ 16 × 16 px (INTER_AREA) and restricted to the seg mask when present;
  head sizes from keypoints are converted to box heights with the box's pixel aspect;
- every pixel votes for its nearest palette entry (CIE Lab, CIE76); the sample is the winner when it holds ≥ 30 % of the
  region (a strap or an arm across the shirt gives the shirt, never an average of the two). Per-channel medians were
  tried first and gave a brown "top" for a white shirt with an arm across it on the pedestrian footage — replaced;
- `Vote`: a window of 15 samples; follows a clear majority (≥ 60 %) until it has agreed 8 times running (locked);
  once locked another entry must hold the clear majority 10 checks running (a jacket taken off ≈ 4 s at the 5 Hz
  sample rate); near ties keep the value;
- palettes: 21 clothing colours (black … pink), 9 hair colours, 6 skin tones — flat, pleasant, never the camera shade;
- sampling only for live, un-overlapped (another box covers > 30 %), ≥ 80 px tall tracks, at most every 0.2 s per
  track and 6 per step; hair / face skipped when the box touches the frame top, bottom when it touches the bottom;
- state per camera + `tid`, kept `memory_ms` + 5 s after last seen (the WO-1080 tracker memory), so a revived track
  sends its locked look in its first message; coasting tracks carry their traits without being sampled;
- wire: `"traits": {top?, bottom?, skin?, hair?: [r,g,b], hair_len?, locked}` — median 68 bytes per person.
- Always on (no setting): measured 0.7–1.0 ms p50 per detection step on real footage, ≤ 2.2 ms for 6 people sampled
  in one step (synthetic 1080p), against 51–184 ms for the detection itself.

**Server — `src/tracking/detect-model.js`.** `traitsFrom()` keeps only the four colour keys (3 whole numbers 0–255),
`hair_len` ∈ short / long / bald and a boolean `locked`, as a copy; `personsFrom` adds it like `kps`. The snapshot
and fusion are untouched (the Godot side reads traits off the camera persons by the world person's keys).
`detect-sim.js` (WO-979 imitated camera) gives its persons four fixed looks so a simulated stage shows coloured
avatars.

**Godot.**
- `person_avatar_model.gd` (new, pure): `look()` (traits → colours, NEUTRAL clay for missing keys, shoes = darker
  bottom), `pick()` (which camera's look a person wears: sticky key, a locked look beats a settling one, gaps filled
  from the next views), `yaw()` (pose facing → walking direction above 0.35 m/s → keep), `limb_dirs()` (shoulder →
  wrist / hip → ankle in the body frame, legs clamped below horizontal), `stride()`, `hang_toward()`.
- `person_avatar.gd` (new): the figure (17 mesh instances from 5 shared unit meshes; per-avatar StandardMaterial3D in
  lambert-wrap with a 0.35 self-light and a soft rim so it reads in the dark venue — no shader, no texture). It eases
  feet (8/s), height (3/s), yaw (5/s), colours (2.5/s, a new look fades in ~1 s) and limbs (slerp 9/s). Speed is
  measured over a 0.6 s baseline and only after a full baseline, so box jitter never reads as walking: ±5 cm jitter at
  15 Hz moves the avatar < 3 cm and never turns it. Limbs follow the WO-667 joints when the pose model runs, else a walk
  swing proportional to speed; idle breathing; arms slightly away from the body.
- `person_avatars.gd` (new): one avatar per world person; a vanished person's avatar is held 1.5 s and taken over by a
  new world id carrying one of its camera keys (also within the same snapshot), so a fusion re-number or a brief loss
  does not pop the figure.
- `person_cards.gd`: STYLES gains "avatars" ("People: avatars"); in that style `set_detections` hands `cards()` to the
  avatar layer and returns before any video / mask code, and `_clear()` releases every surface on the switch, so the
  layer holds **no** VideoSurfaces role. Dev probe accepts `:avatars` (persons.json may carry `traits`).
- `person_cards_model.cards()`: each card also carries `keys` and `looks` (traits per view, best view first).

**Default (decided on the stored data).** The setting is per client (`user://ui.cfg [previs] people`), not per
project. Nothing stored → "avatars" (was "off"). A stored "dummies" is moved to "avatars" once (`people_rev = 1086`):
the owner's message is literally about the dummies ("for dummies on previs i was thinking more to create a
character"), and the owner's client has `people="dummies"` stored, so "leave stored choices alone" would have kept
showing them the look they called horrible. "cards" and "off" stay as stored; every style is one click away.

**Labels.** No new label: a pinned person / bound presenter already has the WO-978 marker pin with its name tag in the
3D stage, drawn at the same place.

## What was VERIFIED

- **Trait extraction, synthetic** (`test_traits.py`, 24 checks, sidecar venv): flat figure → red top, navy bottom,
  black hair, a skin palette tone, locked after 12 samples; ±14 pixel noise + ±10 tint over 80 samples → one look;
  a shirt on the red / maroon boundary wobbling every sample never flips; jacket off → white after 16 samples
  (≥ SWITCH_RUN), a 6-sample blip changes nothing; revived after 9 s → same look, locked, at once; coasting keeps,
  forgotten after keep + 5 s; overlapping / small / cut boxes not guessed; seg mask keeps a loud green set out
  (without it the set wins — why the mask is used); arms up + keypoints → right regions; hair length long only with
  mask + pose, bald from a skin-coloured crown, left out when hair ≈ top or without evidence; the back of a head gives
  no skin tone; cost < 10 ms (measured 1.0–2.2 ms) for 6 people.
- **Trait extraction, real footage (offline, scratch scripts):** the sidecar's own chain (seg + pose + ByteTrack +
  traits) on `media/testowe/pedestrian_area.yuv` (fixed camera, people walking): plausible looks — the woman in the red
  top → maroon top, black hair; a man in a white shirt → light grey top; dark suits → black / charcoal; 1–4 value
  changes per person over 15 s while they turn and pass behind each other; traits attach p50 0.7–1.0 ms, max 10 ms.
  On a dark audience shot (PGM recording) everything honestly reads black / charcoal (hair length correctly left out).
- **The real `sidecar.py` process** fed that clip through a scratch HASCGSHM surface (seg + pose, 2 threads): 204
  tracks messages, 0 errors, 1966 track entries, 1232 with traits, 73 locked; traits median 68 B per person.
- **Server:** `smoke-wo1086-avatars` (4 tests, curated list): traits pass / junk dropped key by key / copied; the real
  detect-sim child delivers 3 persons with 3 locked looks through `personsFrom`; sidecar order (after seg + pose, raw
  pixels) and the Godot wiring pinned; the avatar layer source names no VideoSurfaces, shader or texture.
  `smoke-wo665-person-cutouts` repointed to the new STYLES list and default (legacy `cutouts = true` → cards still
  pinned). WO-616 / 665 / 667 / 979 / 1080 smokes pass.
- **Godot:** `test_person_avatar.gd` (10 tests, 59 checks): look / pick / yaw / limb directions in 3 facings / leg
  clamp / stride; the avatar has only plain colour materials (no texture), takes the look at first sight, scales to
  1.6 m, hair per class, a new look fades in and arrives within 2 s; jitter smoothed and never walking or turning;
  walking turns it the way it goes and swings the limbs; the smile ring shows only its lower arc; the layer holds,
  adopts (also within one snapshot) and drops avatars; `cards()` carries keys and looks best view first.
  Full suite 28625 passed / 0 failed; `run-client.sh --check` boot OK.
- **Box:** the node was restarted at 21:08:45 (not by this WO), after the server files were last written (21:05:53),
  so the running node already passes `traits`; the sidecar loads `traits.py` whenever detection starts. The live
  project has detection off (`GET /api/tracking/detections`: `enabled:false`, no persons), so nothing could be watched
  live without changing the owner's project.
- **Cost of the camera texture (not re-measured):** in this style the layer holds 0 surfaces (tests + source). What it
  saves per camera, from earlier measurements on this class of box: native read 1.33 ms + upload 1.12 ms p50 per
  1080p frame (WO-596) and ~5 % client CPU per held surface (WO-617). No new measurement: that needs a second client.

## Not verified

- **The avatar on screen.** No Godot instance could render it: the owner's GUI (started 19:29) runs the old scripts,
  and a second Godot / Xvfb is not allowed while the owner works. The look (proportions, colours under the venue
  light, the smile) is unseen — only its geometry is tested. It appears on the owner's next GUI relaunch: Previs → 3D →
  "People: avatars" (selected automatically if "dummies" was stored), with detection on, a solved tracking camera and
  someone in view — or the WO-979 imitated camera (project setting `previs.tracking.detection.simulate = true`, a
  solved camera still needed), whose persons now carry four fixed looks.
- A real tracking camera with a person on the rig (none in the live project now).

## Avatar spec (for the three.js twin, WO-1089) — as built and seen on the box, 15.11 late

The source of truth is `godot/client/features/previs/tracking/person_avatar.gd`, `person_avatar.gdshader` and
`person_avatar_model.gd`. If this section and the code ever disagree, the code wins. This is a snapshot after the
WO-1087 look-and-fix pass.

### Frame and scale

- One **unit frame** per person. Feet are at y = 0, up is +Y, the front (face) is +Z, and the person's own left is
  +X. three.js uses the same right-handed Y-up axes, so copy the numbers as they are.
- The top of the hair is at `UNIT_TOP = 1.02`. The whole figure is scaled uniformly by `H / 1.02`, where H is the
  person's height in metres. The tracker clamps H; test people use 1.55 to 1.95 m.
- The figure is placed with its feet on the tracked floor point (the stage top, plane_z) and turned about +Y by its
  yaw. Yaw 0 faces +Z.
- At yaw 0 in Godot the front is +Z. In PSN the feet are `(x, z, −y)`, and walking toward PSN +x gives yaw π/2.
- Proportions: the head is 0.35 across and the figure is 1.02 tall, so it is **about 2.9 heads tall**. The head
  is a third of the height. This toy ratio is what makes it read as friendly from the house.
- **Primitives only.** Every round part is one sphere of radius 1, scaled per part: the values below are its
  semi-axes (x, y, z). Every limb is a capsule.
  - Godot's `CapsuleMesh.height` is the **total** length, caps included.
  - three.js `CapsuleGeometry(radius, length)` takes the **straight middle only**, so use `length = height − 2·radius`.
- No shadows are cast. There are no textures and no camera pixels.

### Parts (unit frame; multiply every number by H / 1.02)

| part | shape | centre (x, y, z) | size | material |
|---|---|---|---|---|
| head | sphere | (0, 0.815, 0) | r 0.175 | skin |
| torso | capsule r 0.13, total 0.36 (y 0.30 to 0.66) | (0, 0.48, 0) | scale (1, 1, 0.8) (flatter front to back) | top |
| arm ×2 | capsule r 0.042, total 0.24 | pivot at the shoulder (±0.155, 0.60, 0); the capsule centre is 0.11 below the pivot | — | top |
| hand ×2 | sphere | 0.245 below the shoulder pivot | r 0.05 | skin |
| leg ×2 | capsule r 0.058, total 0.30 | pivot at the hip (±0.065, 0.32, 0); the capsule centre is 0.15 below the pivot | — | bottom |
| shoe ×2 | ellipsoid | (0, −0.275, +0.025) from the hip pivot, so the centre is at y 0.045 | semi-axes (0.075, 0.045, 0.11) | shoes |
| eye ×2 | ellipsoid | (±0.058, 0.83, 0.161) | (0.019, 0.025, 0.011) | eye |
| eye glint ×2 | sphere | (±0.058 + 0.007, 0.838, 0.171) | r 0.0055 | glint |
| blush ×2 | ellipsoid | (±0.10, 0.775, 0.137) | (0.028, 0.017, 0.009) | blush |
| smile | tube along an arc, plus a ball on each end | see "Face" | tube r 0.0085 | mouth |
| hair cap (short and long) | ellipsoid | (0, 0.86, −0.02) | (0.185, 0.16, 0.185) | hair |
| back of the head (short and long) | ellipsoid | (0, 0.80, −0.045) | (0.18, 0.13, 0.16) | hair |
| hair fall (long only) | capsule r 0.12, total 0.34 | (0, 0.72, −0.075) | scale (1.6, 1, 0.65) | hair |

Notes on the table:

- The glint offset is +0.007 on **both** eyes, not mirrored. Both catch-lights sit on the same side.
- Pinned by `test_standing_soles_on_the_floor_hair_at_the_height`:
  - Standing, the soles are at exactly y 0, and the top of the hair is exactly 1.02, which is H.
  - Leg capsules end at y 0.02, inside the shoes.
  - The shoes used to sink 2 % of H into the stage (fixed 15.11).

### Hair classes

`traits.hair_len` is one of `short`, `long` or `bald`. Anything else is treated as `short`.

- **short:** the cap and the back of the head. The cap's front edge sits on the forehead above the eyes. The
  back-of-head piece covers the skull down to the nape, and a little skin shows at the neck.
- **long:** short plus the fall. The fall reaches the shoulders and frames the face from the front.
- **bald:** no hair parts at all. It is a clean skin-coloured head, deliberately not a "bald cap" in hair colour.

### Face (identical for everyone, never derived from the person)

The face sits on the front of the head, low and wide. The eyes are 0.015 above the head centre (y 0.815) and the smile is
0.025 below it. In detail:

- **Eyes:** two dark, slightly tall ovals, (0.11, 0.10, 0.14), roughness 0.3. Each has a small unshaded white
  glint high on the person's left. The glint is what makes it read as alive at a distance.
- **Smile:** a thin tube of radius 0.0085 along the **lower** arc of a circle.
  - The circle is centred at (x 0, y 0.79) with radius 0.036. The arc runs from 205° to 335°, where 270° is
    straight down, so the ends turn up.
  - Each centre-line point is laid onto the head sphere: `z = sqrt(0.175² − x² − (y − 0.815)²) + 0.002`.
  - The ends are capped with balls of the same radius.
  - It is about 0.08 wide, a quarter of the head. Colour (0.42, 0.14, 0.17), roughness 0.6.
  - In three.js, a `TubeGeometry` over a `CatmullRomCurve3` of about 17 such points matches it.
- **Blush:** two soft flattened dots on the cheeks, outside and below the eyes. The colour is
  `skin.lerp((1.0, 0.45, 0.5), 0.45)`, so it always works with the skin tone, light or dark.
- There is no nose, no ears and no eyebrows. That is deliberate: our style, not a console Mii.

### Colours

- Traits arrive as `[r, g, b]` 0–255 sRGB from the sidecar or the puppet. Use them as the albedo colour
  (in three.js, `Color.setRGB(r/255, g/255, b/255, SRGBColorSpace)`).
- **Shoes** are the bottom colour darkened by 55 %: `c * 0.45` per channel.
- Missing keys fall back to the neutral clay figure:
  - top (0.70, 0.73, 0.78), bottom (0.40, 0.43, 0.50), skin (0.87, 0.74, 0.63), hair (0.32, 0.25, 0.20);
  - hair_len short.
- When the look changes, colours fade toward it at `1 − exp(−2.5·dt)` per frame, which is about a second.

### Material (one flat-colour shader per colour, `person_avatar.gdshader`)

- **Matte:** roughness 0.9, no specular highlights worth copying.
- **Self-light:** `emission = albedo · (0.3 + 0.2 · (1 − N·V)³)`. That is a 30 % glow so the figure reads in a dark
  venue, plus a soft rim.
- **Per light:**
  - `wrap = clamp((N·L + 0.4) / 1.4, 0, 1)`, a wrapped lambert with no hard terminator;
  - `l = lightColour · attenuation · wrap / π`;
  - then `diffuse += max(0.75 − diffuse, 0) · l / (0.5 + l)`.
- Each light only fills part of the remaining headroom under **0.75**, so any number of spots can never sum past it.
  The brightest the figure can get is about 1.1 × its colour. That is why pale skin and blonde hair stay their colour
  inside a beam: before this they blew out to white (seen on the box, 15.11).
- In three.js you get this with a `ShaderMaterial` (or `onBeforeCompile` on `MeshLambertMaterial`) that accumulates
  `diffuse` the same way. A plain `MeshLambertMaterial` with `emissive = colour · 0.3` is the fallback, but it WILL
  blow out under strong spots.

### Motion

`person_avatar.gd step()` runs every frame. `blend(dt, k) = 1 − exp(−k·dt)`.

- **Position:**
  - Eases to the target at rate 8/s.
  - While walking (speed ≥ `WALK_MIN` 0.35 m/s), the target is led by `velocity · min(time since the last
    snapshot, 0.15 s)`. This is dead reckoning: the 15 Hz snapshots no longer make a surge-and-stall.
  - Measured on the box: the per-frame step varies by under 1 mm at a steady walk.
- **Speed** is measured over a 0.6 s window, so ±5–10 cm box jitter never reads as walking.
- **Facing:**
  - Uses the pose's body facing when one is present.
  - Otherwise faces the walk direction once speed ≥ 0.35 m/s.
  - Otherwise keeps the last yaw. Yaw eases at 5/s.
- **Height** eases at 3/s.
- **Walk cycle:**
  - Phase advances by `dt · speed / (0.35 · H) · π`.
  - `k = clamp((speed − 0.35) / (1.4 − 0.35), 0, 1)`.
  - Swing is `sin(phase) · 0.5 · k` rad about the X axis. arm_l moves with leg_r, and arm_r with leg_l, in
    opposite directions.
  - Body bob is `|sin(phase)| · 0.025 · k` in unit-frame y.
  - Limbs ease at 9/s.
- **Standing:** the arms hang 0.12 rad out from the body (rotation about +Z: + for the left arm, − for the right).
  The body breathes: y-scale is `1 + 0.006 · sin(2.2 · t)`.
- **Posed limbs:** when the sidecar sends joints, each limb hangs toward its joint direction. The legs never point
  above `y = −0.5` (a squat, never a leg in the air).

### Labels

- **Test people** (WO-1087) carry a billboard label over the head:
  - text `TEST puppet n`, warm yellow (1.0, 0.8, 0.25) with a dark outline (0.08, 0.06, 0.04);
  - placed at unit y `1.02 + 0.13`, scaled with the figure;
  - Godot `pixel_size` 0.002 at font 48, which is roughly 0.1 m tall text. It clears the head at every distance
    seen.
- Real people have no label.
- The hub's Auto marker for a person ("Auto — tracked person n", `marker_pins_3d.gd`) is a separate thing. It is a
  small cyan tag beside its ball at the feet.

