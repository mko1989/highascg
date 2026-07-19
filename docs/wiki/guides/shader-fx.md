# Shader FX — audio-reactive shader templates

Paste a **Shadertoy-style GLSL shader**, save it, and play it like any other template. Saved shaders export as self-contained Caspar HTML templates in **`template/shaders/`** — fullscreen visuals or transparent overlays, optionally driven by live audio.

## Create a shader

1. **Sources → Media** tab → **`+`** button (bottom of the media list) → **New shader…** — opens the **Shader FX** modal.
2. Click **+ New shader** and enter a **Name**. The saved id becomes `sh-<name-slug>` (Caspar path `shaders/sh-<name-slug>`).
3. Tick **audio reactive** if the shader should react to sound; tick **alpha** for a transparent background (overlay use). Default is opaque black (fullscreen use).
4. Paste the Shadertoy **Image** tab GLSL into **Image (required)**. Optional: paste the **Common** tab into Common, and **Buffer A–D** tabs into their sections (multipass).
5. Wire each pass's inputs: **iCh0–iCh3** dropdowns map `iChannel0–3` to a buffer output (**A/B/C/D**) or the **audio** texture. Leave `—` for unused channels.
6. **Save & export** — the status line shows the Caspar template path and the preview pane renders the exported page.
7. **Templates** tab → **Refresh** — the shader appears with an **FX** pill (and a ♪ badge in the modal list when audio-reactive).

## Put it on air

Drag the shader from the **Templates** tab onto PGM/PRV like any other template — no special playback path.

**CG path needs GPU:** Caspar's CEF templates render shaders only when GPU is enabled. In the Caspar device view (Settings), tick **"Enable GPU in CEF templates (WebGL / Shader FX)"**, then **Apply Caspar config + restart**. Without it the template has no WebGL2 and the layer stays black. Alternative for best audio: play the exported URL (`/templates/shaders/sh-<id>.html`) via a **browser_display** source.

## Editing and deleting

- **Templates** tab → **Edit** button on any FX row opens the shader in the modal; or open the modal from the `+` menu and pick it from the list.
- **Save & export** with the same shader re-exports in place (same id/path). The config is baked into the exported template at save time — re-save after any change.
- **Delete** removes both the config (`data/shaders/<id>.json`) and the exported template (`template/shaders/<id>.html`).

## What a shader can use

Standard Shadertoy entry point `mainImage(out vec4 fragColor, in vec2 fragCoord)` and uniforms:

| Uniform | Notes |
|---------|-------|
| `iResolution`, `iTime`, `iTimeDelta`, `iFrameRate`, `iFrame` | as on Shadertoy |
| `iChannel0–3` | only **buffer A–D outputs** or the **audio** texture (wired via the iCh dropdowns) |
| `iChannelTime[4]`, `iChannelResolution[4]`, `iDate` | as on Shadertoy |
| `iMouse` | exists but there is no mouse on air — treat as zero |

**Audio texture** (channel wired to `audio`): 512×2, same layout as Shadertoy's audio input — row 0 = FFT spectrum, row 1 = waveform; sample the `.x`/`.r` component (e.g. `texture(iChannel0, vec2(f, 0.25)).x` for spectrum, `y ≈ 0.75` for waveform).

**Audio reactivity by playback path** (auto-selected):

| Path | Audio quality |
|------|---------------|
| browser_display source | **Real FFT** via getUserMedia — picks an ALSA monitor/loopback input automatically; `?audioDev=<substring>` overrides |
| Caspar CG / CEF template | **Coarse** — level from the playout OSC meters, synthesized into a plausible spectrum; `?ch=<caspar channel>` picks the meter source (default 1) |
| No audio available | Shader still renders; audio texture stays silent |

**Not supported** (v1): Shadertoy texture/video/cubemap/keyboard/webcam channel assets (channels are buffers + audio only), sound shaders, VR, mouse interaction. CG `UPDATE` accepts `{ "paused": true|false }` only — everything else is baked in at export.

## Limits and gotchas

- **Name** and a non-empty **Image** pass are required to save.
- Each pass source (and Common) is limited to **256 KB**.
- Rendering needs **WebGL2** — see the GPU note above for the CG path.
- CEF GPU is a global Caspar setting — turn it off if **other channels stutter or tear**, and use browser_display for shaders instead.
- New/renamed shaders show in the Templates tab only after a **Refresh** (Caspar TLS).

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Layer black on air | CEF GPU disabled — enable + Apply Caspar config + restart, or play via browser_display |
| Shader missing from Templates | **Refresh** the Templates tab (Caspar TLS) |
| No audio reaction | A channel must be wired to **audio** *and* **audio reactive** ticked; CG path gives coarse levels only — use browser_display for real FFT |
| Save fails | Missing name, empty Image pass, or a pass over 256 KB — the status line shows the reason |
| Preview blank in the modal | Shader compile error — check the browser console for the GLSL error |

## Related

- CG template contract: [../api/cg.md](../api/cg.md)
- Work orders: `work/work-orders/266_WO_SHADER_FX_AUDIO_REACTIVE.md`, `268_WO_SHADER_CEF_WEBGL_AND_CG_CONTINUITY.md`
