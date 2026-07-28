# WO-376 — route the virtual camera into shader channels (Shadertoy's webcam input)

**Status: IMPLEMENTED 28.07.26 — owner chose option A with an explicit opt-in. Server + client + runtime done and fail-soft proven headless; the LIVE camera image is not yet verified (needs the restart, the tick on, and a browser that can open the device) — §7.**

Source: `work/work-orders/todos28.07.26`, owner line added 28.07:

> some shaders allow camera input. make it possible to route the virtual cam output to the shaders.

Sibling items from the same batch, both implemented today:
[WO-374](./374_WO_shader_alpha_keying.md) (alpha) and
[WO-375](./375_WO_shader_audio_channel_autobind.md) (audio binding).

## 1. Investigation

### 1a. What "camera input" means in a Shadertoy shader

Shadertoy exposes a webcam as an ordinary `iChannelN` sampler — the shader does
`texture(iChannel0, uv)` and gets a video frame. Nothing in the GLSL is camera-specific, so a
shader pasted from Shadertoy with a webcam channel needs exactly one thing from us: **a channel
whose texture is refreshed from a video source every frame**.

That is the same shape as the audio channel WO-266 already built (`addTexture(tex, 'audio', …)`
uploaded in `setOnDraw`) — the audio texture is a 512×2 R8 upload per frame; a camera texture is
an RGBA `texImage2D` from a `<video>` element per frame. **The mechanism exists; only a video
source and a channel name are missing.**

### 1b. The channel vocabulary is closed and shared — three places

`'camera'` has to be added to all three or the value is dropped on the way through:

- `src/shaderfx/shader-store.js:29` — `const CHANNEL_VALUES = ['A', 'B', 'C', 'D', 'audio']`;
  anything not in this list is normalised to `null` on save.
- `client/components/shader-fx-modal.js:23` — `const CHANNEL_OPTIONS = ['', 'A', 'B', 'C', 'D', 'audio']`
  (the per-pass iChannel selects).
- `template/shaders/player.js` — `passConfig()` passes the channel name through to ShaderToyLite,
  which resolves it against textures registered with `toy.addTexture(tex, name, …)`.

### 1c. The virtual camera is real, running, and already a V4L2 device

Verified live on this box, 28.07:

```
$ v4l2-ctl --list-devices
Virtual cam (platform:v4l2loopback-000):
	/dev/video10

$ GET /api/virtual-camera
{"ok":true,"enabled":true,"config":{"channel":1,"device":"/dev/video10","mode":"jpeg",
 "width":1920,"height":1080,"fps":50,"streamPort":5555, …}}
```

So the PGM bus is already published as a normal capture device. A browser can open it with
`getUserMedia({ video: { deviceId } })` — the same route `player.js` already uses for **audio**
tier A (`initTierA()` enumerates devices and picks by label), so the device-picking code pattern
is in the file already.

### 1d. Where it will and will not work — this is the load-bearing constraint

| Shader runs as | getUserMedia video | Notes |
|----------------|--------------------|-------|
| **browser_display** (WO-258 Firefox on the virtual display) | **yes** | The path WO-266 documents as "the one with real getUserMedia audio". A camera channel should work the same way. |
| **Caspar CG / CEF** (`PLAY [HTML]`) | **needs proving** | CEF auto-grants on a file:// secure context for audio (WO-333c) — video permission and device enumeration in this CEF build are NOT established. Must be tested before promising it. |
| **look-deck thumbnails** (headless Chrome) | **no** | No capture device; WO-344 already disables getUserMedia there. A camera shader must thumb as its non-camera fallback rather than hanging. |

**A self-route hazard:** the virtual camera carries **PGM** (`channel: 1`). A shader taking the
camera as input, playing out *on* PGM, is a feedback loop — the same class the WO-156 self-route
guard exists for. Whatever routing the owner picks has to say what happens here: either forbid it,
or accept it as an intentional video-feedback effect (some Shadertoy shaders want exactly that).

## 2. The decision the owner has to make

**Which source does "camera" mean?**

- **A. The virtual camera only** (`/dev/video10`, PGM). Simplest: one well-known device, already
  running, no new config. Carries the feedback hazard above.
- **B. Any V4L2 capture device** — the virtual cam *and* the USB cameras the box already
  enumerates (`client/lib/v4l2-inputs.js`, the "USB video" group in Device View). A per-shader
  device picker in the modal. More UI, and the shader config becomes machine-specific (a shader
  moved to another box points at a device that may not exist).
- **C. A Caspar channel chosen per shader**, delivered through the existing virtual-camera bridge
  by re-pointing it. Most "HighAsCG-native", but the bridge is a single global sink today
  (`virtualCamera.channel`), so this means either one shader dictates the bridge for everyone, or
  a second bridge instance.

**Recommendation: A**, with the channel value named `camera` (not `vcam`) so B can be added later
as a device *option* without changing the stored vocabulary. Then decide the feedback question
explicitly — a warning in the modal when the shader's own look plays on the bridged channel is
probably enough.

### DECIDED 28.07.26 — owner

> i need to be able to choose camera from a drop down in shader channels the same way audio is now
> implemented. maybe a tick in the virtual camera output inspector to send to shaders as camera

Option **A**, plus an explicit opt-in the WO had not proposed: the virtual camera decides whether
shaders may see it at all. The feedback question answered itself — after
[WO-377](./377_WO_host_channel_cable_ignored_by_output_mapping.md) the bridge shows *whatever is
cabled to it in Device View* (currently DeckLink input 4, not PGM), so the operator steers it with
a cable and no hard guard was added.

## 3. Implementation plan (once the decision is made)

1. Add `'camera'` to the three vocabularies in §1b.
2. `player.js`: create an RGBA texture, a hidden `<video>` fed by
   `getUserMedia({ video: { deviceId } })` (pick by label `Virtual cam` / `?camDev=` override,
   mirroring `pickAudioDevice()`), and `texImage2D` from the video element in the existing
   `setOnDraw` hook — the same place the audio rows upload. Register it as `toy.addTexture(tex, 'camera', w, h)`.
3. Fail soft, in the WO-268 tradition: no device, denied permission, or headless → leave the
   texture black and let the shader render. It must never block first paint or throw past the
   Caspar template contract.
4. Thumbnails: `?shaderThumb=1` (WO-344) must skip the camera entirely, like it already skips
   getUserMedia audio.
5. Prove it on the **CEF path** before claiming it there (§1d) — if CEF cannot open video,
   document the browser_display route as the supported one.

## 4. Acceptance criteria

- A shader whose iChannel is set to `camera` shows live PGM video inside the shader on the
  browser_display path, and the CEF path is either working or documented as unsupported.
- Selecting `camera` survives a save/reload round-trip (the value is not normalised away).
- A shader with a camera channel still renders when no device is available (black texture, no hang)
  — including in the look-deck thumbnail renderer.
- The self-route/feedback case is either blocked or deliberately allowed, and says which.

## 6. What was BUILT

| piece | file |
|---|---|
| `camera` accepted + persisted | `src/shaderfx/shader-store.js` — added to `CHANNEL_VALUES` |
| offered in the dropdown, next to `audio` | `client/components/shader-fx-modal.js` — `CHANNEL_OPTIONS` |
| the owner's tick | `src/virtual-output/v4l2-bridge-config.js` (`shaderCamera`, default **false**) + `client/components/device-view-inspector-virtual-cam.js` ("Send to shaders as camera") |
| the live texture | `template/shaders/player-camera.js` (new), lazily loaded by `player.js` |

**Two gates before any device opens**, both required:
1. a pass actually binds `camera` — otherwise the companion script is never even fetched;
2. `virtualCamera.shaderCamera` is ON — read live from `/api/virtual-camera`.

Read strictly (`=== true`): an opt-in that opens a capture device should not be satisfied by a
truthy string.

**Fail-soft everywhere** (WO-268's rule that nothing may break the Caspar template contract): the
companion registers a **black 1×1** texture immediately so the pass compiles and samples something
from frame 1, then fills it only if the device arrives. No device, denied permission, headless
thumbnail (WO-344's `?shaderThumb=1`), or a missing companion file → the camera contribution is
black and the shader still renders.

`iChannelResolution` is kept truthful: the texture is re-registered with the real video dimensions
on the first frame, so shaders that correct aspect from `iChannelResolution[i].xy` are not fed a
1×1 lie.

**Why a separate file:** `player.js` hit the repo's 500-line limit. The companion is loaded
lazily *and relatively*, which has a second benefit — already-exported `sh-*.html` reference only
`player.js`, and they pick this up with no re-export; if the file is somehow absent, the channel
just stays black.

## 7. What was VERIFIED

- **The value survives the round trip:** `normalizeShaderConfig` keeps `['camera', …]` (the running
  server still strips it — that is the pending restart, not the code), and the exported template
  embeds `"channels":["camera"…]`.
- **Rendered headless with the tick OFF**, which is the case that must not break: a shader doing
  `texture(iChannel0, uv)` plus a blue tint on the right half measured
  **left `[0,0,0]` / right `[0,64,128]`** — i.e. the pass compiled, the camera channel bound, the
  camera contribution was black, and everything else drew exactly right. The Caspar contract
  (`play`/`stop`/`update`) was intact on the page. Re-run after the file split with identical
  numbers.
- **`camera` and `audio` coexist**: WO-375's auto-bind takes the first FREE channel and does not
  evict a camera on iChannel0.
- **The tick normalises correctly** (off by default, strict true) and the inspector saves it.
- New smoke `tools/smoke/smoke-wo376-shader-camera-channel.test.js` (7 tests, curated list),
  including that the companion never references `player.js` scope — it carried a stale
  `usesCameraChannel()` reading `config` during the split, which would have been a ReferenceError
  the moment a camera shader loaded.
- **Full suite: 1659 tests, 1657 pass / 0 fail / 2 skip.** Lint 0, 500-line gate 0, unwired-export
  gate clean, `npm run build:client` OK. A test shader created for the render probe was deleted
  again — the shader store is exactly as it was.

**NOT verified:** an actual camera image inside a shader. That needs the highascg restart (so the
API stops stripping `camera`), the tick ON, and a browser that can open the device. On the Caspar
CEF path video permission is still unproven (§1d) — the browser_display route is the supported one
until someone checks.

## 8. What was VERIFIED (original investigation)

- `/dev/video10` exists and is the v4l2loopback "Virtual cam"; `GET /api/virtual-camera` reports
  it enabled, bridging channel 1 at 1920×1080@50.
- The three channel vocabularies were read at `0816c5c`; line references above are exact.
- The audio texture path (`addTexture` + per-frame upload in `setOnDraw`) was read in
  `player.js` — it is the template a camera texture should follow.
- Nothing was changed: no channel value added, no device opened, no shader modified.
