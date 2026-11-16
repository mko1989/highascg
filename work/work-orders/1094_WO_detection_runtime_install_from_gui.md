# WO-1094 — Person detection runtime: status, install / repair / remove and offline provisioning from the GUI

**Area:** tracking-vr, godot-client, os-iso
**Status: DONE (16.11.26 — real installs through the API into scratch prefixes, sidecar + detect-service detect people from one, failure cases, ISO verifier on the 11.11 image, on glass)**

Owner 16.11: *"i see in the about that some of person detection is installed per machine, yet there is no way to get it
from the gui."*

Owner 16.11 (ISO rule, via the coordinator): *"we cant bake anything into iso that i have no right to distribute"* — the
detection runtime (weights, venv, wheel cache, export bundles, job temp) must never be carried into an ISO, and the GUI
install is THE way a fresh install gets detection.

## Investigation

### What exists today (shell only)
- `tools/tracking-detect/setup-venv.sh` (41 lines) creates `~/.local/share/highascg/tracking-venv` (`HIGHASCG_TRACKING_VENV`),
  bootstraps pip with get-pip.py when `python3 -m venv` fails (this box's python3 has no ensurepip — `python3-venv`
  is not installed), `pip install -r requirements.txt` (numpy 2.5.4, onnxruntime 1.31.0 CPU, opencv-python-headless
  5.0.0.93) and prints the import check. No progress, no free-space or network check, `curl | python` on a temp dir.
- `tools/tracking-detect/export-models.sh` (44 lines) makes a throw-away venv in `mktemp -d` (= `/tmp`, a 32 GB tmpfs
  here — the export's GBs land in RAM), installs `ultralytics==8.4.182 onnx onnxslim` (pulls the default CUDA torch:
  this box still has a 3.4 GB `~/.cache/pip` from that), downloads `<m>.pt` from
  `github.com/ultralytics/assets/releases/download/v8.4.0/` and exports ONNX (opset 17, end2end=False). Defaults
  `yolo26n yolo26s`; seg and pose were exported by hand (`export-models.sh yolo26n-seg`, WO-665; `yolo26n-pose`,
  WO-667). Not idempotent (re-exports every model), not resumable (the temp dir dies with the script).
- `tools/tracking-detect/fetch-face-models.sh` fetches three OpenCV Zoo files with pinned sha256 (idempotent already).
- `src/tracking/detect-service.js:171` — the only runtime check: `no Python at … — run tools/tracking-detect/setup-venv.sh`
  (and :172 for a missing model). `exists(python)` only: after the 3.12 → 3.14 OS upgrade (box memory) the venv's
  `bin/python → python3 → /usr/bin/python3` link still resolves — now to 3.14 — so the check passes, but the packages sit
  in `lib/python3.12/site-packages`, which 3.14 never reads: the sidecar dies on `import numpy` in a 1 → 30 s backoff
  loop and the last stderr line is the only signal.
- Godot `detect_section.gd:42` — the master toggle opens "Start person detection?" whatever the runtime state; the
  error string then appears in the status line. No API reports the runtime; About (`src/api/routes-about.js:45`) and
  `THIRD_PARTY_NOTICES:34` say "installed per machine" with no way to do it.

### What each feature needs (models dir `~/.local/share/highascg/models`, `HIGHASCG_TRACKING_MODELS`)
| Feature (what uses it) | Files | Where it comes from | Licence |
|---|---|---|---|
| Core (every feature) | venv: numpy, onnxruntime, opencv-python-headless (+ pip) | PyPI (pip bootstrap: bootstrap.pypa.io get-pip.py) | BSD-3-Clause, MIT, Apache-2.0 (+ pip MIT) |
| Person boxes (pins, Auto follow, zones, fusion) | `yolo26n.onnx` (9.9 MB), `yolo26s.onnx` (38 MB) | Ultralytics `.pt` (github.com/ultralytics/assets v8.4.0) exported locally | **AGPL-3.0** (Ultralytics) |
| Cut-outs (seg, WO-665) | `yolo26n-seg.onnx` (11 MB) | same, exported locally | **AGPL-3.0** |
| Posed dummies / avatar regions (pose, WO-667/1086) | `yolo26n-pose.onnx` (12 MB) | same, exported locally | **AGPL-3.0** |
| Presenters / face pins (WO-675) | `face_detection_yunet_2023mar.onnx` (0.2 MB), `face_recognition_sface_2021dec.onnx` (39 MB), `person_reid_youtu_2021nov.onnx` (107 MB) | OpenCV Zoo (github.com/opencv/opencv_zoo, sha256-pinned) | YuNet MIT; SFace Apache-2.0; youtureid Apache-2.0 files — but trained on research-only datasets (SFace: research face data; youtureid: Market-1501 / DukeMTMC-reID (withdrawn) / MSMT17, WO-675 P2) |
| Traits (WO-1086 looks) | none (computed from boxes + pose) | — | — |
| Export only (temporary venv, deleted after) | ultralytics 8.4.182, torch/torchvision, onnx, onnxslim | PyPI / download.pytorch.org | AGPL-3.0 (ultralytics), BSD-3 (torch), Apache-2.0 (onnx), MIT (onnxslim) |

Upstream LICENSE files re-read 16.11 (`raw.githubusercontent.com/opencv/opencv_zoo/main/models/*/LICENSE`): YuNet
"MIT License, Copyright (c) 2020 Shiqi Yu", SFace and youtureid "Apache License 2.0".
`THIRD_PARTY_NOTICES` named only yolo26n / yolo26s + the three core libraries: seg / pose, the three OpenCV Zoo
models and the export-time tools were missing.

### On this box
`~/.local/share/highascg/tracking-venv` 307 MB (pyvenv.cfg `version = 3.14.4`, recreated with `--clear` after the
3.12 → 3.14 upgrade), `models/` 208 MB (7 files above), imports OK: numpy 2.5.4, cv2 5.0.0, onnxruntime 1.31.0,
providers `AzureExecutionProvider, CPUExecutionProvider` (no CUDA build). The live project has detection **off**
(`GET /api/tracking/detections` → `enabled:false`, camera `cam_1` role `in1`).

### Environment the job runs in
`highascg.service` (system unit, `User=casparcg`, `KillMode=mixed`): env is `PATH HOME USER LANG` + a few HIGHASCG
vars — no `XDG_RUNTIME_DIR`, no DBus, no proxy vars; a node restart SIGKILLs every child (so a running install dies with
node: the job has to be safely re-runnable, not survive). Child stdio are sockets (no tty: pip's progress bar is off by
default; `--progress-bar raw` prints `Progress <n> of <total>` lines).

### ISO
- The ISO build (penguins-eggs 26.10 "coa") reads only `/etc/penguins-eggs.d/custom.exclude.list`, merged from
  `tools/eggs/live-usb/penguins-eggs-exclude-highascg-{fragment,embed-server}.list`. Both carry
  `home/casparcg/.local/share/*` (WO-669, "tracking venv + models (provisioned by tools/tracking-detect/, owner call)"),
  and the deployed `custom.exclude.list:175` has it. `~/.cache/*` is excluded too (`:155-156`).
- Proof on the newest image `highascg-nvidia-615-2026-11-11_1249.iso`: `unsquashfs -o 19075072 -l` (190,017 entries)
  — no `*.onnx`, no `tracking-venv`, no `pyvenv.cfg` under home, nothing under `home/casparcg/.local/share`, no pip
  cache. The only `*.pt` is `usr/share/mc/hints/mc.hint.pt` (Midnight Commander's Portuguese hints) — a verifier must
  not match `.pt` blindly.
- So nothing leaks today, but only by the blanket `share/*` line, with no verifier assertion: narrowing it (WO-669 already
  did that once for `.local`) would ship the AGPL weights and the research-trained face models silently.
- Other seeding paths: the stick bootstrap rsyncs `sim/highascg` with `config/bootstrap-rsync-excludes.txt`; the
  exFAT/bridge sync pairs (`config/exfat-sync.json`) mirror `configs/`, `projects/`, `media/` ↔ the repo; Syncthing
  syncs the repo (`.stignore`). None of them reach `~/.local/share/highascg` — but an export bundle written into the
  repo, a synced pair folder or a stick's `sim/` tree would travel.

## What was done

### Scripts — still the single source of truth (`tools/tracking-detect/`)
- `runtime-lib.sh` (new, sourced): paths under `HIGHASCG_TRACKING_PREFIX` (default `~/.local/share/highascg`:
  `tracking-venv/`, `models/`, `wheels/` = the core wheelhouse, `install-work/` = export venv + pip cache + `.pt`
  downloads, `install-job.json`, `install.log`, `.install.lock`); machine-readable progress `@@ {json}` lines (`plan`,
  `step`+`label`, `pct`, `done`, `error`+`msg`+`apt`, `cancelled`, `ok`); exit codes 10 network, 11 disk, 12 python,
  13 system tool / library, 14 pip, 15 download, 16 checksum, 17 export, 20 busy, 30 bundle; `need_net` (curl -I, 12 s),
  `need_space` (MiB; `HIGHASCG_TRACKING_FREE_MB` test hook), `need_python` (apt `python3` / `python3-venv`), resumable
  `dl` (curl `-C -`), `pip_run` (`--progress-bar raw` → percent inside a range of the step, exit code kept), pip
  bootstrap (ensurepip → the pip wheel from the wheelhouse (offline) → get-pip.py), `flock` (one job; children inherit
  through `HIGHASCG_TRACKING_LOCKED`), TERM → `{"cancelled":true}` + exit 143, `--dry-run` / `HIGHASCG_TRACKING_DRY_RUN`.
- `setup-venv.sh` rewritten: `python3 -m venv --without-pip` (works without python3-venv) + bootstrap, wheels
  downloaded once per Python into `wheels/`, installed `--no-index`; `--clear` (Repair), `--wheels DIR` (offline).
- `export-models.sh` rewritten: skips models already there, the exporter venv lives in `install-work/` (not the /tmp
  tmpfs), **CPU PyTorch** from download.pytorch.org/whl/cpu (210 MB instead of the GBs of CUDA torch) + ultralytics +
  onnx + onnxslim + onnxruntime (without it Ultralytics "AutoUpdate"s it at export time, 19 s), pip / Ultralytics /
  matplotlib caches pointed into `install-work/`, missing libGL / GLib → exit 13 with `sudo apt install libgl1
  libglib2.0-0t64`, ONNX installed as `.part` then renamed + sha256 printed; work dir removed on success, kept on
  failure (Resume continues).
- `fetch-face-models.sh`: same library (progress, lock, dry run); pinned checksums unchanged.
- `install.sh` (new) orchestrates: install `--features person,pose,seg[,face]` (preflight: internet to pypi + github,
  free space core + export + face from `features.json` `space_mb`), `--repair` (venv `--clear`; offline with a local
  wheelhouse it rebuilds from it), `--from DIR` (offline install: the bundle's Python must equal the system's
  major.minor, models sha256-checked, reports what the bundle lacks), `--export-to DIR` (`DIR/highascg-detection-runtime/`
  = wheels + models + `manifest.json` + README with the AGPL note; refuses a DIR inside the repo), `--remove
  [--keep-models]`.
- `features.json` (new): features → models, sources, licences, defaults, links; `space_mb` calibrated on the scratch
  install below (core 700, export 3000, face 300 MiB).

### Server
- `src/tracking/runtime-status.js` (pure): facts → verdict `ready | partial | missing | broken` per feature with the
  reason ("Person detection is not installed on this machine", "venv built for Python 3.12, the system has 3.14 —
  Repair rebuilds it", "cv2 will not import: … — Repair reinstalls it", truncated / incomplete model) and the apt command;
  `summaryLine` for About.
- `runtime-probe.js`: system python3 version, venv facts (pyvenv.cfg, `lib/python3.x` dirs), the import check
  (`python -I -c …`, cached on the venv's mtimes), models, free space (`statfs`), an internet check (HEAD, cached 60 s).
- `runtime-job.js`: one job at a time; `bash install.sh` detached (own process group; Cancel = TERM the group, KILL
  after 5 s); `@@` lines → plan / step / percent (never back within a step) / error / apt, log tail of 60 (ANSI stripped),
  a script dying without its own error line → "<step> stopped unexpectedly (exit n): <last line>"; state persisted to
  `install-job.json` every 2 s and `install.log` appended; after a node restart a "running" job whose pid is gone shows
  as `interrupted`, Resume re-runs the same command (the scripts skip what is done).
- `src/api/routes-tracking-runtime.js`: `GET /api/tracking/runtime[?net=1|?only=job]`, `GET …/folders` (mounted sticks
  / disks + `PREFIX/bundles`, bundles found with their Python), `POST …/install|repair|remove|export|import|resume|cancel`.
  Core routes (answer with the tracking module off). Every route takes `prefix` (scratch; absolute, under home or temp,
  never the repo); `test: {free_mb, proxy}` only with a scratch prefix. Export destinations refused: the repo, every
  exFAT / bridge pair (both sides) and each volume's `drop-update/` + `sim/`.
- About: one `detection` line (`routes-about.js`), credits updated (Ultralytics: also pose + cut-outs; OpenCV Zoo added).
- `detect-service.js`: paths from `runtimePaths()`; the "no Python / no model" errors point at Previs → Tracking → Detect
  (the setup-venv hint stays for the smokes and the shell); `runtime_missing` in the snapshot.

### Godot
- `runtime_section.gd` (new) on top of the Detect page: headline + reason / apt / internet line, per-feature ticks,
  Install… dialog (person locked on, pose + cut-outs on, faces opt-in with their licence line; the two-sentence AGPL
  note with copyable links), Install from folder…, Repair, Export to folder… (bundle note: AGPL files, your own
  machines), Remove… (keep models), Resume, Cancel; progress bar + label + last log line, polled every 1 s while a job
  runs. `runtime_model.gd` (pure) holds the words; no verdict while a job runs (the venv is half-built then).
- `detect_section.gd`: the master switch with the runtime not usable opens the install dialog ("Person detection is not
  installed on this machine. Install it now?") instead of starting into an error; the Model list leaves out face /
  re-ID / pose files (`detect_model.is_aux_model`).
- About: one line next to the notices (`about_model.gd`, 2 lines — WO-1093 left the file alone).
- Dev launch args for pointer-free box checks: `--tracking-mode=detect`, `--runtime-prefix=<scratch>`,
  `--probe-runtime=install|remove|export|import`.

### Never distributed (owner's ISO rule)
- Eggs exclude lists (fragment + embed-server, generated into `custom.exclude.list`): `home/*/.local/share/highascg`,
  `root/.local/share/highascg`, `home/*/.cache/pip`, `root/.cache/pip`, `home/*/.config/Ultralytics`,
  `home/*/highascg-detection-runtime`, each also with `/*`. Home paths: no `lib/` prefix, so no `usr/` twins.
- `verify-iso-detection-runtime.sh` (new; sourced by `verify-iso-squashfs-excludes.sh` → `detection_runtime_check`,
  also standalone on a listing or a `.squashfs`): FAIL on any `*.onnx`, a `.pt` under `home/` or `root/` or named
  `yolo*.pt`, `/.local/share/highascg`, `/tracking-venv`, `/highascg-detection-runtime`, `/.cache/pip`,
  `/.config/Ultralytics`. `mc.hint.pt` passes.
- exFAT / bridge pairs (`exfat-sync-map.isExcluded`): bundle dirs and `*.onnx` / `*.pt` never synced, whatever the map.
- `config/bootstrap-rsync-excludes.txt` and `config/server-update-rsync-excludes.txt` (any-depth on purpose, declared in
  smoke-wo512), `.stignore`, `.gitignore`: `highascg-detection-runtime/`, `*.onnx`, `*.pt`.
- `THIRD_PARTY_NOTICES`: the detection section lists every downloaded component (models with licences and the
  research-dataset caveat, venv packages, pip, export-time tools) — it landed in the tree with WO-1096's commit
  360d1e91, which committed the whole file while this edit was in it.

## What was verified

- **Real install through the API** (node path, `highascg.service` env) into scratch prefixes under
  `~/.local/share/wo1094-scratch*` (removed at the end):
  - clean, uninterrupted, from nothing: **237.6 s**, final **476 MB** (venv 308 + wheels 100 + 4 models 70); peak disk
    **≈ 2.55 GB** during the export (sampled every 2 s); ≈ 510 MB downloaded by pip + ≈ 40 MB of `.pt`.
  - status from the prefix: `ready`, numpy 2.5.4 / cv2 5.0.0 / onnxruntime 1.31.0, CPU; person / pose / seg ready,
    faces missing (opt-in).
  - the real `sidecar.py` from the scratch venv + models, fed `media/testowe/pedestrian_area.yuv` through a scratch
    HASCGSHM surface (seg + pose, 2 threads, `env -i`): 123 tracks messages, 0 errors, 1078 track entries, up to 10 per
    frame, 33 track ids, 775 with keypoints, 857 with masks, median 169 ms.
  - the server's own `createDetectService` (`python`/`modelsDir` from `runtimePaths(scratch)`, role `ch99` →
    `/dev/shm/highascg-ch99`, systemd-like env without XDG_RUNTIME_DIR): sidecar started, 87 of 89 snapshots with
    people, max 10.
- **Cancel mid-download** (torch / exporter step, 29 %): state `cancelled`, `resumable`, group killed; Resume after a node
  restart finished in 130 s (pip cache in `install-work/` reused) → `done`, 4 models.
- **Broken venv** (`lib/python3.14` → `python3.12`, pyvenv.cfg 3.12.3): `broken` — "venv built for Python 3.12, the
  system has 3.14 — Repair rebuilds it", About "needs repair (…)"; Repair: 10 s (offline-capable from `wheels/`) → `ready`.
- **No network** (job-only proxy 127.0.0.1:9): error 10 "no internet: cannot reach pypi.org/simple/pip/ (curl: (7) …) —
  installing needs internet, or install from a folder made on another machine", in 0.1 s, nothing written.
- **Low disk** (`free_mb: 500`): error 11 "needs 5.2 GB free … has 0.4 GB" (before the calibration to 3.7 GB).
  Test hooks without a scratch prefix → 400; prefix inside the repo → 400; export into `projects/` → 400.
- **Export → install from folder offline**: export 3 s, bundle 168 MB (wheels + 4 ONNX + manifest + README); import
  into a second empty prefix with the dead proxy: 6 s → `ready`, "not in the bundle: <3 face models>" reported; a
  bundle for Python 3.12 → error 30 with the plain message.
- **Remove**: venv / models / wheels gone, `missing`.
- **First found bug, fixed**: `bootstrap_pip`'s `whl=$(ls … | sort | tail)` exited the script under `set -o pipefail`
  when no pip wheel was there (first real run died silently after "creating the venv") → `|| true`; the job now says
  which step stopped when a script dies without an error line.
- **ISO**: `verify-iso-squashfs-excludes.sh` on `highascg-nvidia-615-2026-11-11_1249.iso` → "OK: absent (WO-1094) …",
  "Squashfs exclude verification passed."; the standalone verifier on its 190,017-entry listing: OK in 0.02 s.
  `generate-eggs-config.js exclude --embed 1` carries the 12 new lines (176–187). Not built: no eggs produce (owner rule).
- **On glass** (operator GUI relaunched under `flock -o /tmp/highascg-gui.lock` with its own env, setsid, DISPLAY=:0):
  Detect block on the live runtime ("Person detection installed · CPU · Python 3.14.4 · 530 MB", features, buttons);
  a scratch prefix: "Person detection is not installed on this machine." + "Install downloads about 600 MB (needs
  internet)"; the Install dialog (licence sentences, links, feature boxes); live progress ("Installing — Model exporter
  (Ultralytics, CPU PyTorch — temporary) · 37 %", bar, last pip line, Cancel) → "Installing: done." + ready; Remove and
  Export dialogs (bundle note, "bridge (exfat) — 493.8 GB free"). The first Install dialog was window-tall with its
  buttons off screen (wrapped labels) → fitted after layout; mid-install the block said "needs repair: numpy will not
  import" → no verdict while a job runs. Final state: one `godot` (`-- --tab=Previs`), project "90C PGRP Hilton
  Wawer", Previs.
- **Live install untouched**: `~/.local/share/highascg` models dated 19/22.10, no job file, verdict `ready`; detection
  stays off (`enabled:false`).
- **Tests**: `smoke-wo1094-detection-runtime` 24/24 (curated): status verdicts, job state machine with a real child
  (409 second job, cancel, persisted, interrupted restore), install.sh dry run / low disk / refused export / Python
  mismatch, API guards, exclude lists + generated list, verifier on synthetic listings and a real mksquashfs image,
  exFAT, rsync / Syncthing / git lines, notices. Related smokes (about, 616, 979, eggs-exclude, wo512, 675) pass. Offline
  suite 6841 tests, 0 fail (exit 0). Godot `test_tracking_runtime_wo1094.gd` (12 tests) in the full suite: 28907 passed,
  0 failed; `--check` boot OK. Gates: script-paths 0, max-lines 0, unwired-exports 0, `--no-http` 0, lint 0 errors,
  format 0, audit 0.
- **Not verified**: the About line on glass (Settings → About needs the pointer; verified by API + `about_model` test);
  the master switch opening the install dialog (needs a click; code + model tested); a box without `python3-venv` /
  `libgl1` (both present here); a real GPU provider; the next ISO build (verifier only run on the 11.11 image).
- **Owner**: the installed `/etc/penguins-eggs.d/custom.exclude.list` lacks the new lines until
  `sudo bash tools/eggs/live-usb/install-eggs-config.sh --apply` (the eggs build applies it itself via eggs-run-lib;
  `verify-eggs-config.sh` reports the drift until then). The stale 3.4 GB `~/.cache/pip` (CUDA torch from the old export)
  can be deleted.

