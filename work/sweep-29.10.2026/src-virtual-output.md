# src/virtual-output — sweep 29.10.2026 (batch 105)

Files: 10 · lines: 1501 · findings: 1 BUG-HIGH, 2 BUG, 5 DEAD, 2 RISK, 7 QUALITY

Method: every file read in full. Repros ran against the real modules with scratchpad files only (nothing under /run, config/ or
projects/ was written; the root-wrapper repro replicates the 3-line `shellConfQuote` + body builder into a scratchpad file and
`source`s it with a harmless `echo`). Dead-code proof: `grep -rnw` over client src godot tools scripts index.js test + the
unwired-exports baseline. WO context: WO-137 (virtual camera), WO-145 (stream mode), WO-399 (stream default), WO-401 F5-revised (fps).

## src/virtual-output/v4l2-bridge-args.js
- `DEAD` src/virtual-output/v4l2-bridge-args.js:202,204,212 — export-only (baseline): `V4L2_BRIDGE_FPS_MAX`, `V4L2_BRIDGE_STREAM_PORT_DEFAULT`, `buildV4l2BridgeCasparFfmpegArgs` (used by `buildV4l2BridgeCasparAddParams` in the same file).
- `QUALITY` src/virtual-output/v4l2-bridge-args.js:140-149 vs :185-199 — the scale/pixfmt/fps/quality filter assembly is duplicated between the jpeg and stream builders; `-q:v:v` is copied from compose-preview-ffmpeg-args.js:100 (the Caspar `-name:stream` syntax, same working string on both paths, so not flagged as wrong).

## src/virtual-output/v4l2-bridge-audio-sink.js
- `QUALITY` src/virtual-output/v4l2-bridge-audio-sink.js:9-33,115-150 — `ensureAlsaLoopback` tries a plain, non-root `modprobe snd-aloop` (always fails for the `casparcg` user; the root path is the sudo wrapper in v4l2-kernel-modules.js, which already ran before this); a second `execFirst`/`MODPROBE_BINS` copy lives in v4l2-kernel-modules.js:12-31. `releaseAlsaLoopback` (:158) is an `async` no-op.

## src/virtual-output/v4l2-bridge-audio.js
- `QUALITY` src/virtual-output/v4l2-bridge-audio.js:21-25 — `if (vc.audioEnabled === false) return false; return vc.audioEnabled !== false` is one expression written twice. `isVirtualCameraAudioEnabled` is export-only (baseline). `releaseAlsaLoopback()` in `stopV4l2BridgeAudio` does nothing but reset a cache.

## src/virtual-output/v4l2-bridge-cache.js
- `DEAD` src/virtual-output/v4l2-bridge-cache.js:25-27,67 — `getV4l2BridgeJpgAmcpPath` has no caller (baseline); `buildV4l2BridgeCasparAddParams` (args.js:167-171) re-derives the same `media/<basename>` string.

## src/virtual-output/v4l2-bridge-config-validate.js
- `BUG` src/virtual-output/v4l2-bridge-config-validate.js:12-13,22,26-31 (called from api/routes-virtual-camera.js:34) — `validateVirtualCameraConfig` checks `src.mode` and `src.streamPort` on the RAW input, but the only production caller validates `next = patchVirtualCameraConfig(...)`, which has already been through `normalizeVirtualCameraConfig` (mode → 'jpeg'|'stream', port → clamped to 5555). Failing input (repro): `patchVirtualCameraConfig({}, {mode:'mjpeg', streamPort:80})` → `{mode:'stream', streamPort:5555}`; `validateVirtualCameraConfig(next).errors` → `[]`, whereas `validateVirtualCameraConfig({mode:'mjpeg',streamPort:80}).errors` → both errors. So POST /api/virtual-camera/config {mode:"mjpeg"} saves 200 with a silently swapped mode instead of the intended 400. Fix: validate the patch before normalising (or have the patcher keep the raw values).
- `QUALITY` src/virtual-output/v4l2-bridge-config-validate.js:21,42-44 — the comment says normalisation "falls back to 'jpeg'" (it falls back to 'stream', WO-399); the `fps > 60` warning is unreachable because normalise clamps to 60 (args.js:61); `nr < 0` (:34) cannot occur after the `/dev/video\d+` check.

## src/virtual-output/v4l2-bridge-config.js
- `BUG` src/virtual-output/v4l2-bridge-config.js:28,48,58 — `VIRTUAL_CAMERA_DEFAULTS.fps = 25` is merged into every normalised config, and callers persist the normalised object (`config.virtualCamera = normalize…` in config/device-graph-output-mapping.js:265, routes-virtual-camera.js:41/120/135 via `patchVirtualCameraConfig`). `resolveV4l2BridgeFps` (args.js:127-133) treats any non-empty `vc.fps` as the operator's explicit choice, so after the first such write the WO-401 F5-revised derivation ("half of the source rate, but 25/30 sources stay as they are", owner 30.07) is bypassed forever. Repro: `resolveV4l2BridgeFps({machineProfile:{defaultProjectFps:30}})` → 30, but with `virtualCamera: normalizeVirtualCameraConfig({channel:1})` → 25; for a 60p source raw → 30, after normalise → 25. Fix: leave `fps` out of the defaults (resolve at use) or store `fps: null`.

## src/virtual-output/v4l2-bridge-consumer.js
- `RISK` src/virtual-output/v4l2-bridge-consumer.js:49 — `ports.some((p) => u.includes(`:${p}`))` is a substring test: with the default port 5555 it also matches an operator's own stream consumer such as `udp://…:55550` or `rtmp://host:5555/live`, and `removeV4l2BridgeConsumer` then issues `REMOVE ch STREAM <that uri>` on every attach/detach. Match the parsed port exactly.
- `DEAD` src/virtual-output/v4l2-bridge-consumer.js:152 — `removeV4l2BridgeConsumer` export-only (baseline; used by attach/detach in the file).

## src/virtual-output/v4l2-bridge-relay.js
- `QUALITY` src/virtual-output/v4l2-bridge-relay.js:100-109 — `entry.onExit` is stored on the map entry but never read (the exit handler closes over `opts.onExit`, :130); the JSDoc type of `_relays` (:11) does not list it. `fps` is computed (:46) but only used in the jpeg branch; width/height are re-normalised here (:47-48) instead of using `normalizeVirtualCameraConfig` (config.js:56-57).
- `DEAD` src/virtual-output/v4l2-bridge-relay.js:210 — `resolveV4l2Device` export-only (check-unwired-exports.js knows it).

## src/virtual-output/v4l2-bridge.js
- `QUALITY` src/virtual-output/v4l2-bridge.js:16,85-90 — `_starting` can never be true when `startV4l2BridgeInternal` begins because every start/stop is serialised through `enqueue`; the guard is dead (it only feeds the `starting` stat). `resolveVirtualCameraChannel` is export-only (baseline).
- `RISK` src/virtual-output/v4l2-bridge.js:95 + v4l2-kernel-modules.js:75-86 — `ensureVcamKernelModules` calls `writeVcamModulesConf` (sync `mkdirSync`/`writeFileSync` on `/run/highascg`) outside any try/catch, so an EACCES/ENOSPC rejects `startV4l2Bridge` instead of returning `{ok:false, reason:'kernel_modules'}`; routes-virtual-camera.js:112 awaits it outside its try block.

## src/virtual-output/v4l2-kernel-modules.js
- `BUG-HIGH` src/virtual-output/v4l2-kernel-modules.js:64-66,77-86,106-107 (+ tools/runtime/highascg-vcam-modules-up.sh:14-17) — root command injection through the camera label. Node writes `CARD_LABEL=<shellConfQuote(label)>` to `/run/highascg/vcam-modules.conf`, then runs `sudo -n /usr/local/lib/highascg/highascg-vcam-modules-up.sh` (NOPASSWD, scripts/setup/12-passwordless-sudo.sh:61) which does `source "$CONF"` as ROOT. `shellConfQuote` double-quotes and escapes only `\` and `"`; `$( )`, backticks and `$VAR` still expand inside double quotes. `label` is only trimmed and cut to 120 chars (config.js:50) and `validateVirtualCameraConfig` never checks it. Repro (`j51-conf.js` + `source`, harmless echo): `label: "$(echo INJECTED_BY_LABEL)"` → validate says ok, conf contains `CARD_LABEL="$(echo INJECTED_BY_LABEL)"`, `bash -c 'source ./conf; echo $CARD_LABEL'` prints `INJECTED_BY_LABEL` — i.e. the command ran. Any authenticated caller of POST /api/virtual-camera/config {label:"$(…)"} (or a project/settings import carrying `virtualCamera.label`) gets root the next time `/dev/video10` or the ALSA loopback is missing (`needVideo`/`needAudio`). Independent of the label: `/run/highascg` is owned by `casparcg` (checked: `drwxr-xr-x casparcg casparcg`), so any process running as the service user can write the conf and run the sudo wrapper → root. The wrapper validates VIDEO_NR/ALSA_* AFTER `source`, which is too late. Fix: the wrapper must parse the conf with `grep`/`sed` (never `source`), and Node should reject labels outside `[A-Za-z0-9 ._-]` (single-quote it as well). ALSA_ID is written unquoted too (:81) — safe only because validate's regex is applied on the API path.
- `DEAD` src/virtual-output/v4l2-kernel-modules.js:158-161 — `VCAM_MODULES_WRAPPER`, `resolveV4l2LoopbackConfig`, `v4l2DevicePresent` are export-only (baseline); `VCAM_CONF_PATH`/`writeVcamModulesConf` smoke-only.
- `QUALITY` src/virtual-output/v4l2-kernel-modules.js:5 — `execFileSync` is imported and never used; the non-root `modprobe v4l2loopback` fallback (:113-118) omits the `exclusive_caps=0` the wrapper passes, so the two paths create differently-behaving devices.
