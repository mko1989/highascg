# WO-376 — route the virtual camera into shader channels (Shadertoy's webcam input)

**Status: OPEN — investigated 28.07.26 (feasibility established on this box, no blocker found). Not implemented: this is a feature with a routing decision the owner should make, and it cannot be proven without watching real video land in a shader.**

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

## 5. What was VERIFIED (investigation only)

- `/dev/video10` exists and is the v4l2loopback "Virtual cam"; `GET /api/virtual-camera` reports
  it enabled, bridging channel 1 at 1920×1080@50.
- The three channel vocabularies were read at `0816c5c`; line references above are exact.
- The audio texture path (`addTexture` + per-frame upload in `setOnDraw`) was read in
  `player.js` — it is the template a camera texture should follow.
- Nothing was changed: no channel value added, no device opened, no shader modified.
