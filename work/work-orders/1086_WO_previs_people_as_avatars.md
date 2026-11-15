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

Our own design: a toy-like figure, about 4½ heads tall, built from a few Godot primitive meshes (no assets, no
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
