# WO-1036 — Presenters from a tracking-camera picture, named by the operator
**Area:** tracking-vr, godot-client
**Status: DONE (11.11 — box through the API with a clip on the camera input: capture → name → bound, body feature ok, marker driven; UI not seen on the glass)**

Owner, 11.11: *"recognizing of the presenters. its now based on a photo from a crew member which might not always work.
so the system should grab a screenshot from a tracking camera and let operators name the caught presenters so the
names can then be used for automation. based on being on stage etc."*

## Investigation

- WO-675 / WO-835: roster from a phone photo (`src/tracking/presenters.js`), features via
  `tools/tracking-detect/face_embed.py`, the operator binds a presenter to a person key (`w:<id>` fused, else
  `camera:tid`), a bound presenter drives hub marker 65000+n, a zone action `presenter` fires its actions. Owner rules
  D1 (operator confirms), D2 (/tmp only), D3 (consent).
- The sidecar (`tools/tracking-detect/sidecar.py`) already holds each camera frame and every track's box at the same
  step: the one place a crop of the right person can be cut.

## What was done

- Sidecar: stdin `{"type":"capture","id","dir"}` → at each camera's next step a JPEG crop per live person (12 % pad,
  mode 0600) and `{"type":"captured", shots}`.
- `detect-service.js` `capture(dir)`; `presenter-capture.js` picks one picture per person (fused: the largest view,
  key `w:<id>`); `presenters.js` captures (`c<n>.jpg`), `nameCapture` → a presenter from that picture, bound to that
  person; unnamed pictures expire after 20 min, on clear and on shutdown; routes under `/api/tracking/presenters/
  capture|captures/…`.
- Godot Tracking ▸ Presenters: "Take pictures of the people on stage", name + mic per picture, one consent tick, Save /
  Discard.

## Verified

- `tools/smoke/smoke-wo1036-presenter-camera-capture.test.js` (5), the WO-675 / WO-835 smokes, Godot
  `test_tracking_presenters.gd`.
- Box: `bridge/TALK2` on channel 5 layer 2 → `POST …/capture` gave `c1` (key `w:1`), the crop showed the tracked
  person; naming without consent → 400; with it → presenter bound to `w:1`, body `ok`, face `none` (back view), marker
  "Test Runner (mic 3)". Roster and clip removed afterwards.
- Open for the owner: whether the consent tick should apply to camera pictures at all.
