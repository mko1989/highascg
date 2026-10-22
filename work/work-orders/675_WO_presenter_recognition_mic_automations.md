# WO-675 — Presenter recognition: backstage photo + name + mic → recognised on stage → automations

**Status: OPEN (22.10, feasibility + owner decisions D1–D4; no code yet)**

Owner, `next.md` 22.10: *"how possible is it to do this: an audio tech is giving a mic to a presenter backstage he
takes a photo of him/her full person, sends it to the system, with a note, name and mic number. when that presenter
goes on stage is recognized as that presenter and automations happen."*

## Owner decisions (22.10)

- **D1 — an operator approves every recognition.** The system only suggests ("this is Anna, 87 %"); nothing fires
  for a presenter until the operator confirms the match. No auto-assign phase.
- **D2 — photos live in `/tmp`**, so a reboot removes them. The roster (name, mic, note) and any embeddings go there
  too; never into the project, config/, a stick or Syncthing.
- **D3 — consent is asked by the tech** when taking the photo ("for automation during the show"). The intake page
  shows a consent tick that must be set before it sends.
- **D4 — mics go through Companion.** A presenter's actions are Companion buttons (the existing
  `companion:<page>/<row>/<col>` action); no desk protocol on the box.

## Investigation (desk, 22.10)

**Already on the box (WO-616 / 665):**

- Calibrated stage cameras (DeckLink) + the `tools/tracking-detect/sidecar.py` YOLO26 detector (~17 ms CPU; the GPU is
  an RTX PRO 4000, 24 GB, ~2 GB used).
- `src/tracking/fusion.js`: one Kalman track per **world person**, with a stable person id (the Godot P-tags).
- `src/tracking/zone-engine.js` + `zone-actions.js`: floor zones fire `look:<id>[@preview]` or
  `companion:<p>/<r>/<c>` on enter / leave.
- WO-663 lower thirds take operator text. WO-665 cut-out crops give a clean per-person image.

**Missing — the identity of a person:**

1. **Intake:** a phone page (photo + name + mic number + note) → a show roster on the server.
2. **Recognition:** compare each world person with the roster.
   - **Body re-ID (clothes / build)** is the strong signal here. The photo is full-length and taken the same day,
     so the outfit matches. Candidates: OSNet (torchreid, MIT), ONNX, a few ms per crop.
   - **Face** is a second signal. It only helps when faces are big enough: near cameras, a downstage presenter. It
     fails when backlit or turned away. License trap: InsightFace's pretrained models are **non-commercial only**.
     OpenCV Zoo YuNet (MIT) + SFace (Apache-2.0) are usable.
   - **Matching:** a small known roster (5–30), per-track evidence over time, hysteresis, and "unknown" below a
     margin. A wrong name on air is worse than no name.
3. **Identity actions:** per presenter: take the lower third with their name, a look, a Companion button (D4: the
   mic is a Companion button).

**Risks:**

- Look-alike outfits (all-black suits, a choir), and stage light shifting colours. Mitigation: face as a tie-breaker,
  and the operator confirms.
- Privacy: photos + embeddings are biometric data (GDPR art. 9) → D2 + D3.
- A cue firing on a wrong ID → D1.

## Face recognition candidates (web, 22.10)

The weights' license is what matters, not the code's.

| Project | Model | License (as stated) | Note |
|---|---|---|---|
| [OpenCV Zoo](https://github.com/opencv/opencv_zoo) YuNet + SFace | detect + recognise (MobileFaceNet), ONNX | YuNet dir: MIT; SFace dir: "All files … Apache 2.0" | tiny, CPU-fast, 99.40 % (zoo eval); the cleanest license; first choice |
| [EdgeFace](https://github.com/otroshi/edgeface) (Idiap) | 1.2–18 M params | repo BSD-3-Clause; weights not separately licensed | LFW 99.57–99.83 %; small and accurate; check the weights' terms |
| [AdaFace](https://github.com/mk-minchul/AdaFace) (CVPR 2022) | ResNet-100 | code MIT; weights unlicensed, trained on MS1MV2 / WebFace | best on low-quality faces (TinyFace 72 % rank-1) = stage distance; dataset terms are research-only |
| [DeepFace](https://github.com/serengil/deepface) | wrapper (SFace, ArcFace, FaceNet …) | MIT; "license types will be inherited" from each model | 23.6 k stars; good for comparing models on our own footage, not for shipping |
| [facenet-pytorch](https://github.com/timesler/facenet-pytorch) | InceptionResnet (VGGFace2) | code MIT; weights unstated | LFW 99.65 %; older |

Avoid: InsightFace `buffalo_*` / glintr100 (non-commercial; a license costs money).

The sidecar already runs ONNX Runtime (CUDA when present) and numpy; it has no OpenCV. YuNet + SFace run as plain ONNX.

## Proposed phases

| Phase | What | Estimate |
|---|---|---|
| P1 | Intake page (photo, name, mic, note, consent tick) → `/tmp` roster; Godot: roster in the Inspector; the operator taps a P-tag → assigns a presenter; zones fire that presenter's actions (lower third with the name, look, Companion button for the mic) | ~1 day |
| P2 | Suggest: OSNet body re-ID in the sidecar, the best roster match shown on the P-tag with a confidence; the operator confirms with one tap (D1) | ~2–3 days |
| P3 | Face (YuNet + SFace) added to the suggestion, as a tie-breaker between look-alike outfits | ~1–2 days |

## What was done

Nothing yet — feasibility only.

## What was VERIFIED

Desk read of the tracking code (fusion person ids, zone actions, sidecar). Nothing was run.
