> **Provenance:** web research by a subagent (2026-10-17) for [WO-593](../../work-orders/593_WO_godot_client_port_epic.md); each item carries its source URL and confidence. Re-verified by hand: latest stable tag `4.7.2-stable` and godot-cpp `10.0.0-stable` (git ls-remote, 2026-10-17). Items marked UNVERIFIED must be measured, not assumed.

# G: Godot ecosystem research for the native port (as of 2026-10-17)

Scope: porting a ~107k LOC JS broadcast-control web UI to a native Godot 4 desktop app. Target: Ubuntu 24.04, X11 + Openbox, no compositor, NVIDIA RTX PRO 4000 Blackwell, driver 595. Live BGRA8 frames come from POSIX shm (1920x1080@50 and 3072x1728@50) through a GDExtension. There is also a 3D previs view. The dev Mac has Godot 4.6.3.stable.

Confidence levels: **High** means confirmed in official docs, engine source or GitHub API. **Medium** means a secondary source, or an inference from primary sources. **Low** means indirect evidence only. **UNVERIFIED** means I could not confirm it.

Method: I read the Godot 4.6 class-reference XML and engine source on the `4.6` branch directly from raw.githubusercontent.com. Copies are in `/private/tmp/claude-501/-Users-marcin-highascg/9363bbd4-dc7d-4038-81d8-27ea731484b3/scratchpad/godot-inv/raw/`. I also used the GitHub REST API for releases, tags and issue states, plus web search and fetch.

---

## 1. Release state, cadence, support policy, compatibility

| Question | Answer | Source | Confidence |
|---|---|---|---|
| Latest stable | **4.7.2-stable, 18 Aug 2026.** 4.7 shipped 18 Jun 2026 and 4.7.1 on 14 Jul 2026. No 4.7.3 found. | https://godotengine.org/download/archive/ | High |
| Next release | **4.8-beta1, 15 Oct 2026.** Feature freeze. Stable is estimated for Q4 2026. 4.8 .NET builds need .NET 10. | https://godotengine.org/article/dev-snapshot-godot-4-8-beta-1/ , https://docs.godotengine.org/en/latest/about/release_policy.html | High |
| 4.6 line | 4.6 shipped 26 Jan 2026. Patches: 4.6.1 (16 Feb), 4.6.2 (1 Apr) and **4.6.3 (20 May 2026)**, which is what's on the Mac. There has been no 4.6 patch since May. | https://godotengine.org/download/archive/ | High |
| Support table (latest docs) | 4.7 and 4.6 get bug, security and platform fixes. **4.5 gets security and platform fixes only.** 4.4 and older are EOL; 4.4 stopped at 4.4.1 and 4.3 at 4.3.0. | https://docs.godotengine.org/en/latest/about/release_policy.html | High |
| Policy wording | "Stable branches are supported *at least* until the next stable branch is released and has received its first patch update", plus best-effort support after that. History shows 4.x minors get **about 2-4 patch releases over roughly 4-6 months**. 4.5.2 shipped in Mar 2026, six months after 4.5.0. Expect 4.6 to drop to security-only after 4.8.x ships, around early 2027. | same as above | High for the policy; Medium for the projection |
| Cadence | A minor release roughly every 4-6 months. Recent dates: 4.4 Mar 2025, 4.5 Sep 2025, 4.6 Jan 2026, 4.7 Jun 2026, 4.8 due Q4 2026. | release_policy page and the archive | High |
| Breaking changes between minors | The policy says "Minor compatibility breakage in very specific areas *may* happen in minor versions." Every minor has a migration guide that lists API breaks; most are C#-binary or GDScript signature changes. Relevant examples: 4.6 moved `StreamPeerTCP` methods to a `StreamPeerSocket` base, added a focus-API parameter, and requires re-saving scenes for unique node IDs. 4.7 moved accessibility enums to a new `AccessibilityServer`, changed `RichTextLabel.add_image` params, changed device IDs for mouse and keyboard events, and made new projects default to `canvas_items` stretch. | https://docs.godotengine.org/en/stable/tutorials/migrating/upgrading_to_godot_4.6.html , https://docs.godotengine.org/en/stable/tutorials/migrating/upgrading_to_godot_4.7.html | High |
| GDExtension compatibility | **Backward compatible only.** An extension built against API 4.N loads on any 4.M where M >= N, but not on older versions. Engine policy requires compatibility shims whenever a method signature changes, "so that users don't have to recompile them". The `.gdextension` file declares `compatibility_minimum`. The one historical ABI break was 4.0 to 4.1. | release_policy page; https://github.com/godotengine/godot-cpp (README); https://godot-rust.github.io/book/toolchain/compatibility.html | High (4.0 to 4.1 break: Medium, from memory of the 4.1 release notes) |

**Recommendation:** start on **4.7.x**. 4.6 is already in the late part of its patch life. Build the GDExtension against `api_version=4.6` or `4.7` so that it also loads on 4.8.

## 2. GDExtension bindings

| Binding | Status | Source | Confidence |
|---|---|---|---|
| **godot-cpp** (official, C++) | **10.0.0-stable was released 15 Sep 2026** (rc1 26 Jan 2026, rc2 25 Aug 2026). Since v10 it is **versioned independently of Godot**. One codebase targets Godot 4.3+ through `scons api_version=4.6`, or through `custom_api_file=extension_api.json` from `godot --dump-extension-api`. There is no `4.6` branch (the last per-engine branch is `4.5`), so **v10 is the route for 4.6+**. The build uses **SCons as the primary system; CMake is also supported** (CMakeLists.txt plus a `cmake/` dir in the repo). Master was still active on 16 Oct 2026, with binary-size reductions. | https://github.com/godotengine/godot-cpp , https://github.com/godotengine/godot-cpp/releases/tag/10.0.0-stable | High |
| **godot-rust gdext** | crate `godot` **0.5.5 (9 Aug 2026)**. 0.5.0 came out 27 Mar 2026. It has feature flags `api-4-2` to **`api-4-7`**, and the minimum Godot is 4.2. The README calls it "usable" for games and tools. It is pre-1.0, with occasional breaking changes that come with migration guides. Its CI includes engine integration tests and sanitizers. The full RenderingDevice and RenderingServer API is exposed through generated classes. | https://crates.io/crates/godot , https://docs.rs/crate/godot/0.5.5/features , https://github.com/godot-rust/gdext | High |
| **SwiftGodot** | The README says it targets Godot 4.7 on Linux, macOS, Windows and iOS. Community-maintained. | https://github.com/migueldeicaza/SwiftGodot | Medium |
| Others | Community bindings exist for Go, Zig, Nim, Odin and C#. None is relevant here. | https://docs.godotengine.org/en/stable/tutorials/scripting/gdextension/ | Medium |

**Recommendation for a ~200-line shm reader that calls RD/RS every frame:** use **godot-cpp 10.x**, for four reasons:
1. It is the official binding, with the same API names as the engine.
2. The C++ RenderingDevice code maps 1:1 to engine source. Precedent: godot-ndi does exactly this, as described in item 3.
3. You only need `shm_open`, `mmap`, a `memcpy` into a `PackedByteArray`, and `RenderingDevice::texture_update`.
4. It adds no extra toolchain to the ISO build.

gdext is a reasonable alternative if the team prefers Rust, but it is pre-1.0. Confidence: Medium (this is a judgement).

## 3. Per-frame CPU-to-GPU texture updates

### API facts (Godot 4.6 class reference and source)

**(a) `ImageTexture.update(image)`**
- The image must keep the same size, format and mipmaps.
- This path goes through `RenderingServer.texture_2d_update`, then `RD::texture_update`.
- Per frame it costs one `Image` copy (shm to PackedByteArray to Image) plus the RD staging copy.
- `Image` has **no BGRA format**, so either swizzle on the CPU or upload BGRA as `FORMAT_RGBA8` and swap `.bgra` in a shader. A swizzle-in-shader prevents using a plain StandardMaterial3D.
- Known perf history:
  - #57147 (open): 1080p `ImageTexture.update` ran at about 1 fps in 4.0-dev. Calinou said video "requires a ProxyTexture-style API".
  - #76994 (closed/archived): RGB formats are much slower than RGBA because RGB needs padding conversion. **Always use 4-byte formats.**
- Sources: https://github.com/godotengine/godot/blob/4.6/doc/classes/ImageTexture.xml , https://github.com/godotengine/godot/issues/57147 , https://github.com/godotengine/godot/issues/76994
- Confidence: High

**(b) `RenderingServer.texture_2d_update(rid, image, layer)`**
- Same path as (a) minus the Resource wrapper. It still needs an `Image`, the same size and format, and has no BGRA.
- **This is the only option that also works on the Compatibility (OpenGL) renderer.**
- Source: RenderingServer.xml (4.6)
- Confidence: High

**(c) `Texture2DRD` + `RenderingDevice.texture_update(rid, layer, PackedByteArray)`**
- **Recommended.** Create the RD texture with `DATA_FORMAT_B8G8R8A8_UNORM` and usage `SAMPLING_BIT | CAN_UPDATE_BIT`, wrap it in `Texture2DRD`, and use it anywhere a `Texture2D` is accepted: TextureRect, StandardMaterial3D albedo, shader uniforms.
- There is no CPU swizzle and no Image object.
- **Production precedent:** `unvermuthet/godot-ndi` (MPL-2.0, v1.2.6, Mar 2026) does exactly this for BGRA/BGRX NDI frames. It uses `rd = RenderingServer::get_rendering_device()`, then `memcpy` into a `PackedByteArray`, then `rd->texture_update(...)`, recreating the texture only when the size changes.
- Requires Forward+ or Mobile. Compatibility has no RenderingDevice.
- Sources: Texture2DRD.xml; RenderingDevice.xml; https://github.com/unvermuthet/godot-ndi/blob/main/src/video_stream_playback_ndi.cpp ; https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html
- Confidence: High

**(d) `RenderingDevice.texture_create_from_extension(type, format, samples, usage, VkImage, ...)`**
- Wraps a foreign `VkImage`. That enables true zero-copy: for example, import the shm pages with `VK_EXT_external_memory_host`, or a dma-buf, and record your own copy.
- You get the VkDevice and queue through `RD.get_driver_resource()`, and **you own memory, layout transitions and queue synchronisation**.
- There is also `RenderingServer.texture_create_from_native_handle`.
- Used in the wild by godot-lunastream (Linux dma-buf importer; "not yet run on hardware") and the OpenXR module.
- Open proposal #15116 (Jul 2026): `texture_create_from_extension` hard-codes the aspect, so multi-planar NV12 imports are not possible yet.
- Sources: RenderingDevice.xml; https://github.com/godotengine/godot-proposals/issues/15116 ; https://github.com/xrarlenal/godot-lunastream
- Confidence: High for the API; Medium for the feasibility

### How `RD::texture_update` actually works in 4.6

From `servers/rendering/rendering_device.cpp`, lines 1614-1740:

- It is **render-thread guarded**: `ERR_RENDER_THREAD_GUARD_V`. Since 4.4, RD texture functions return `ERR_UNAVAILABLE` from other threads (#99750, closed by PR #100110).
  - With the default thread model (`rendering/driver/threads/thread_model` = Safe), the render thread is the main thread, so calling it from `_process` is fine.
  - From a worker thread, use `RenderingServer.call_on_render_thread(callable)`.
  - The "Separate" thread model is marked **experimental: "several known bugs ... not recommended for use in production"**.
- It **synchronously `memcpy`s the data into staging buffers** in tiles of `rendering/rendering_device/staging_buffer/texture_upload_region_size_px` (default **64 px**). Tile size is capped by `staging_buffer/block_size_kb` (default **256 KB**). It then records buffer-to-texture copies into the frame graph. A 3072x1728 frame is therefore about 1,296 tiles and about 83k small row copies per frame.
  - **Mitigation:** raise `block_size_kb` (for example 8192-32768) and `texture_upload_region_size_px` (for example 1024-2048).
  - Make sure `staging_buffer/max_size_mb` (default 128) is at least `frames_in_flight x frame_bytes`. If it is too small, "the GPU will stall and wait for previous frames to finish".
  - These numbers are an inference from the source code. **Benchmark them.**
- It is forbidden while a draw or compute list is open, and while the texture is bound as a framebuffer.

Sources: https://github.com/godotengine/godot/blob/4.6/servers/rendering/rendering_device.cpp , ProjectSettings.xml (4.6), https://github.com/godotengine/godot/issues/99750. Confidence: High for the code facts; Medium for the tuning advice.

### Bandwidth sanity check (arithmetic)

| Source | Bytes per frame | At 50 fps |
|---|---|---|
| 1080p BGRA | 8.3 MB | 415 MB/s |
| 3072x1728 BGRA | 21.2 MB | 1.06 GB/s |

Path (c) does 2 CPU copies (shm to PackedByteArray, then to staging) plus a GPU DMA. That is roughly 2-4 ms of main-thread memcpy per 3K frame on a modern CPU. **UNVERIFIED: measure on the target box.** Showing two or more streams multiplies this.

### Other facts

| Topic | Answer | Source | Confidence |
|---|---|---|---|
| BGRA sampled on NVIDIA Vulkan | `VK_FORMAT_B8G8R8A8_UNORM` is in the Vulkan spec's **mandatory format support** table, with SAMPLED_IMAGE, linear filter, COLOR_ATTACHMENT and BLIT. Every conformant driver supports it, including NVIDIA. Godot exposes `RD.texture_is_format_supported_for_usage()` for a runtime check. The godot-ndi precedent uses it. | https://registry.khronos.org/vulkan/specs/latest/html/vkspec.html#features-required-format-support | High |
| Async readback (the reverse direction) | 4.4 added `texture_get_data_async` / `buffer_get_data_async` (PR #100110). | https://github.com/godotengine/godot/pull/100110 | High |
| Partial texture update | Proposal #13012, "Readd support for partial texture updates in RenderingServer", is **open**. | https://github.com/godotengine/godot-proposals/issues/13012 | High |
| DrawableTexture2D (4.7) | A drawing helper, not a CPU-upload path. | https://godotengine.org/releases/4.7/ | High |

### Existing video-ingest addons

| Addon | What it does | Platforms | Repo and status | Confidence |
|---|---|---|---|---|
| **godot-ndi** | NDI in as a `VideoStream`, out as `NDIOutput`. Godot 4.4+. BGRA through Texture2DRD. | Win/macOS/Linux; needs the NDI runtime; Linux Flatpak not supported | https://github.com/unvermuthet/godot-ndi , MPL-2.0, v1.2.6 (Mar 2026), pushed Sep 2026 | High |
| godot-spout (buresu) | Spout in/out | Windows only (D3D12/Vulkan) | https://github.com/buresu/godot-spout , MIT, pushed Jul 2026 | High |
| spout-gd (you-win) | Spout2 | Windows only | https://github.com/you-win/spout-gd , MPL-2.0, last push Dec 2025 | High |
| godot-syphon (buresu) | Syphon | macOS only, Forward+/Metal | https://github.com/buresu/godot-syphon , MIT | High |
| Native Spout/Syphon in core | Proposal #13143, open | — | https://github.com/godotengine/godot-proposals/issues/13143 | Medium |
| gd-desktop-caster | Linux screen capture (PipeWire / X11 MIT-SHM). Copies into an ImageTexture on the main thread. | Linux | https://store.godotengine.org/asset/nekitori17/gd-desktop-caster/ | Medium |
| POSIX-shm-to-texture addon | **None found.** We write our own; it is about 200 lines, modelled on godot-ndi. | — | — | Medium (absence of evidence) |

## 4. Video decoding (for a future remote client)

**Built-in support**
- **Only Ogg Theora** in core. Decoding is on the CPU. The docs recommend "1080p at most (preferably at 30 FPS)".
- Core cannot ship H.264/H.265 because of patents. "Extensions can add other formats".
- Source: https://docs.godotengine.org/en/stable/tutorials/animation/playing_videos.html
- Confidence: High

**Third-party extensions**

| Extension | Details | Platforms | License and maintenance | Source | Confidence |
|---|---|---|---|---|---|
| **EIRTeam.FFmpeg** | FFmpeg `VideoStream` for Godot >4.1. Builds from source (`make gdextension PLATFORM=...`). No prebuilt releases. Hardware decode not documented. | Linux, macOS, Android build targets; Windows not documented | MIT wrapper (FFmpeg itself LGPL/GPL depending on build). 318 stars, pushed 7 Oct 2026. | https://github.com/EIRTeam/EIRTeam.FFmpeg | High |
| **GDE GoZen** | FFmpeg video and audio. Godot 4.3+. Hardware decode exists, but the author advises against it except for slow codecs. | Linux, Windows, macOS, Android | LGPL-2.1. Moved to Codeberg. Releases on itch and Ko-fi. Active in 2026. | https://codeberg.org/gozen/gde_gozen | Medium |
| **gd-hwvideo** | FFmpeg 5.1-8.x. Godot 4.5+. Hardware decode via VideoToolbox (macOS) and **VAAPI (Linux)**; NVDEC not mentioned. VAAPI on NVIDIA needs the community `nvidia-vaapi-driver` (UNVERIFIED for 595/Blackwell). | Linux, macOS | — | https://codeberg.org/gllm/gd-hwvideo | Medium |
| **godot-lunastream** | FFmpeg RTSP/RTMP/HTTP/local playback into Texture2DRD with a compute NV12-to-RGB pass. Hardware decode only on Windows (D3D11VA). Linux is software decode plus a dma-buf importer, "cross-compiles; not yet run on hardware". Bundles LGPL FFmpeg. | Windows, macOS, Linux | MIT. Small project (14 stars). | https://github.com/xrarlenal/godot-lunastream | High (per its README) |
| **godot-native-video** | Zero-copy H.264/HEVC via AVFoundation / Media Foundation. **Linux not supported yet.** | macOS, Windows | MIT | https://github.com/claytercek/godot-native-video | High |
| **godot-ndi** | NDI receive. Viable remote transport on a LAN. | see item 3 | see item 3 | https://github.com/unvermuthet/godot-ndi | High |

**WebRTC**
- The official `webrtc-native` GDExtension provides **data channels only, no media tracks**.
- **UNVERIFIED for 2026.** Based on my knowledge; not re-checked.

**Pragmatic remote-preview fallback**
- Send JPEG/WebP frames over WebSocket and decode with `Image.load_jpg_from_buffer` / `load_webp_from_buffer`.
- Built in, no licence issues, CPU cost moderate at 720p.
- Source: https://docs.godotengine.org/en/stable/tutorials/io/runtime_file_loading_and_saving.html
- Confidence: High for the APIs; Medium for the suitability

## 5. Godot as an application framework

**Official stance**
- The FAQ says Godot's UI system and small size "can make it a suitable alternative to frameworks like Electron or Qt".
- But: "Godot is a game engine first and foremost ... creating applications ... is a byproduct ... not its primary focus".
- Sources: https://docs.godotengine.org/en/stable/about/faq.html , https://github.com/godotengine/godot-docs/blob/master/tutorials/ui/creating_applications.rst
- Confidence: High

**Notable apps**
- The Godot editor itself, Material Maker, Pixelorama, Lorien, GodSVG, Arrow, RPG in a Box, PixelOver, Heavy Paint and Uniform.
- Dungeondraft and Wonderdraft are commercial and Godot 3-based.
- Broadcast and virtual production:
  - The Skylark media server has a Godot render module: https://wiki.skylark.tv/modules/godot_engine
  - godot-ndi's author is building a broadcast-graphics tool.
  - I found **no shipping Godot-based broadcast control UI, VJ app or media server.** We would be early adopters.
- Sources: https://gamefromscratch.com/godot-developed-non-game-applications/ , https://github.com/godotengine/awesome-godot , https://github.com/godotengine/godot-proposals/discussions/4783
- Confidence: Medium

**LibGodot (new in 4.6)**
- You can embed the engine as a library in your own host app on Linux, Windows and macOS.
- Source: https://godotengine.org/releases/4.6/
- Confidence: High

**Feature by feature**

| Feature | Answer | Source | Confidence |
|---|---|---|---|
| `low_processor_mode` | `application/run/low_processor_mode` redraws only when needed and sleeps `low_processor_mode_sleep_usec` (default 6900 µs) between frames. It is **global, not per window**. While live video is visible, the app redraws every frame anyway, so this only helps when previews are hidden. Issue #101058 is open: "low_processor_usage_mode increases CPU usage on empty scene". | ProjectSettings.xml (4.6); https://github.com/godotengine/godot/issues/101058 | High |
| Multi-window (`embed_subwindows=false`) on X11 | Supported (`FEATURE_SUBWINDOWS`: Windows, macOS, Linux X11). Every popup and tooltip becomes a real X11 window, which "can be a slow operation". Closing the main window quits the app. Each window has its own swapchain. Open #115663 reports random crashes in 4.6 on Linux X11 multi-window with Intel HD 5500. Open #93014 reports high CPU with a native subwindow on the Compatibility renderer only. | ProjectSettings.xml; DisplayServer.xml; creating_applications.rst; https://github.com/godotengine/godot/issues/93014 | High |
| Multi-monitor placement | `DisplayServer.get_screen_count`, `screen_get_position`, `screen_get_size`, `screen_get_refresh_rate`, `window_set_current_screen`, `window_set_position`, and `Window.current_screen`. All work on X11. | DisplayServer.xml (4.6) | High |
| Native file dialogs on Linux | `DisplayServer.file_dialog_show` / `FileDialog.use_native_dialog`. On Linux this is implemented **only through XDG Desktop Portal over D-Bus** (`org.freedesktop.portal.FileChooser`). `has_feature(FEATURE_NATIVE_DIALOG_FILE)` is true only if the portal is running and exposes FileChooser. **On a bare Openbox session you must ship `xdg-desktop-portal` plus a backend such as `-gtk`, and a D-Bus session.** Otherwise use Godot's built-in FileDialog, which is the default. | https://github.com/godotengine/godot/blob/4.6/platform/linuxbsd/freedesktop_portal_desktop.cpp ; display_server_x11.cpp (has_feature) | High |
| OS drag-and-drop | `Window.files_dropped(PackedStringArray)`. On X11 it comes through XDND `text/uri-list`. Folders: `uri-list` carries directory paths too, so a directory path should arrive, but **UNVERIFIED** (not tested). No drag *out* to the OS. | Window.xml; display_server_x11.cpp | High (files); UNVERIFIED (folders) |
| Clipboard | `clipboard_get` / `set`, `clipboard_get_image`, `clipboard_has_image`, and the X11 PRIMARY selection (`FEATURE_CLIPBOARD_PRIMARY`). Image paste means pixel data, not files copied in a file manager. | DisplayServer.xml | High |
| IME | `FEATURE_IME` on Windows, macOS, X11 and Wayland. | DisplayServer.xml | High |
| Accessibility | AccessKit screen-reader support arrived in **4.5, labelled experimental**. On Linux it works through AT-SPI, X11 and Wayland, controlled by `accessibility/general/accessibility_support` (Auto by default). You must set `accessibility_name` / `accessibility_description` on Controls. 4.7 added landmark navigation and a separate `AccessibilityServer`. | https://godotengine.org/releases/4.5/ ; https://godotengine.org/releases/4.7/ ; ProjectSettings.xml | High |
| Large lists and tables | `Tree` with 10k+ items was unusable in 4.0 (#70869). The closing fix landed in 4.4 (closed Nov 2024, milestone 4.4); I did not find a measured figure after the fix. Neither Tree nor ItemList is **virtualized**: every row is an engine object. The maintainers recommended pagination or a custom "virtual window". For log or rundown tables with 10k+ rows, write a virtualized list Control that draws visible rows itself (`_draw`) or recycles row nodes. | https://github.com/godotengine/godot/issues/70869 | High (history); Medium (current performance) |
| Text rendering and font fallback | TextServerAdvanced: HarfBuzz shaping, BiDi, ICU. `Font.fallbacks[]` for an explicit fallback chain. `SystemFont` (Linux supported, fontconfig) for OS fonts and automatic system fallback. MSDF, subpixel positioning and LCD AA are available. | Font.xml; SystemFont.xml (4.6) | High (APIs); Medium (quality judgement) |
| HiDPI / fractional scaling on X11 | **On X11, `FEATURE_HIDPI` is commented out and `screen_get_scale()` always returns 1.0.** Only Wayland, macOS, Android, iOS and Web report a scale. Use `screen_get_dpi()` and set `Window.content_scale_factor` yourself, following the "non-game application" section of the multiple-resolutions doc. 4.7 changed new projects to default to `canvas_items` / `expand` stretch. | display_server_x11.cpp (4.6); DisplayServer.xml; creating_applications.rst | High |
| Theming | A `Theme` resource holds colors, constants, fonts, font sizes, icons and StyleBoxes per control type. It also supports type variations, per-node overrides and theme inheritance down the tree. **No CSS, no selectors, no layout-by-stylesheet.** All 107k LOC of CSS-driven layout must be rebuilt with Containers. | https://docs.godotengine.org/en/stable/tutorials/ui/gui_skinning.html | High (from knowledge of the docs) |
| 2D/UI rendering cost | The RD renderers gained 2D batching in 4.4 (PR #92797), so UI cost is comparable across renderers. | https://github.com/godotengine/godot/pull/92797 | High |
| Tray icon / notifications | `StatusIndicator` (tray icon) is Windows and macOS only. Linux has no native notifications: the docs suggest `OS.execute("notify-send")`. | creating_applications.rst | High |

## 6. Networking

| Topic | Answer | Source | Confidence |
|---|---|---|---|
| HTTPRequest concurrency | One request in flight per node: `request()` returns `ERR_BUSY` while busy. Get concurrency by pooling several HTTPRequest nodes. `use_threads=true` moves I/O to a thread. | HTTPRequest.xml (4.6) | High |
| Keep-alive | **HTTPRequest closes the connection after every request** (`client->close()` in `cancel_request`), so there is no keep-alive. `HTTPClient` is the low-level class meant to be reused for many requests on one connection, but you poll it yourself. | https://github.com/godotengine/godot/blob/4.6/scene/main/http_request.cpp ; HTTPClient.xml | High (code read); Medium (that close runs on every completion) |
| Multipart uploads | No helper. Build the `multipart/form-data` body by hand into a `PackedByteArray` and pass it to `request_raw`. | HTTPRequest.xml / HTTPClient.xml | High |
| Streaming large uploads | **Not supported.** `HTTPClient.request_raw` takes the entire body as one `PackedByteArray` with Content-Length; there is no chunked or streamed request body. Multi-GB video uploads need one of three options: a resumable chunked-upload endpoint on the server (many small `request_raw`s); a hand-written HTTP/1.1 over `StreamPeerTCP`/`StreamPeerTLS`; or `OS.execute`/`create_process` of `curl`. Downloads can stream to disk (`download_file`, `download_chunk_size`). | https://github.com/godotengine/godot/blob/4.6/core/io/http_client_tcp.cpp | High |
| WebSocketPeer message size | `inbound_buffer_size` and `outbound_buffer_size` **default to 65535 bytes** and `max_queued_packets` to 4096. Raise them before connecting, for example 64 MB, for multi-MB state snapshots. Binary frames: `send(PackedByteArray, WRITE_MODE_BINARY)`. | https://github.com/godotengine/godot/blob/4.6/modules/websocket/doc_classes/WebSocketPeer.xml | High |
| WebSocket compression | **Not supported** (no permessage-deflate). See #103230 (open) and proposal #13179 (open). Make sure the server (Node `ws`) does not require it. | https://github.com/godotengine/godot/issues/103230 , https://github.com/godotengine/godot-proposals/issues/13179 | High |
| WebSocket threading | You must call `poll()` regularly. The peer is not documented as thread-safe, so poll and read from a single thread. Open #123184 hits ERR_BUG when calling from another thread on Web. | WebSocketPeer.xml; https://github.com/godotengine/godot/issues/123184 | Medium |
| UDP / OSC | `PacketPeerUDP` and `UDPServer` are built in. There is no built-in OSC codec. The GDScript addon `godOSC` (CC0, active Jul 2026) exists, or write a small OSC encoder (~150 lines). | https://github.com/dfcompose/godOSC | High |
| JSON on large payloads | `JSON.parse_string` / `JSON.stringify` are native C++. `stringify` got faster in 4.3 (#93783). Caveats: all JSON numbers become **float**; large int64 values were mis-parsed before a fix (#102588, closed 2025); parsing builds Variant Dictionaries, which allocates a lot. **No benchmark found for multi-MB payloads (UNVERIFIED).** Mitigation: parse on `WorkerThreadPool`, prefer deltas, keep IDs as strings. | https://github.com/godotengine/godot/issues/93783 , https://github.com/godotengine/godot/issues/102588 | Medium |

## 7. 3D (previs)

| Topic | Answer | Source | Confidence |
|---|---|---|---|
| Runtime glTF | First-class in exported builds. Use `GLTFDocument.append_from_file(path, state)` or `append_from_buffer(bytes, base_path, state)`, then `generate_scene(state)`. When loading from a buffer, set `GLTFState.base_path` so external textures resolve. Prefer `.glb`. | GLTFDocument.xml (4.6); https://docs.godotengine.org/en/stable/tutorials/io/runtime_file_loading_and_saving.html | High |
| Runtime FBX | `FBXDocument` / `FBXState` (ufbx-based) can **load but not save** FBX at runtime since 4.3. The class is marked `experimental`. | FBXDocument.xml; runtime-loading doc | High |
| Runtime OBJ | Not available at runtime. The OBJ importer is editor-only, and the runtime-loading doc doesn't list it. Convert to glb offline or write a small parser. | runtime-loading doc (omission) | Medium |
| Dynamic texture on one mesh surface | After `generate_scene`, find the `MeshInstance3D` (by node or material name) and call `set_surface_override_material(idx, mat)` with a `StandardMaterial3D` whose `albedo_texture` (or `emission_texture`, with unshaded mode for LED walls) is the Texture2DRD from item 3. The same RID can feed many materials. | MeshInstance3D / BaseMaterial3D docs | High |
| Renderer choice | **Forward+ and Mobile both use RenderingDevice; Compatibility has "no RenderingDevice access"**, so the Texture2DRD path from item 3 requires Forward+ or Mobile. Forward+ has the "highest base cost, low scaling cost"; Mobile has a medium base cost and medium scaling. Compatibility lacks Mailbox/Adaptive vsync and HDR output. No NVIDIA-Linux benchmark found (**UNVERIFIED**). Expect Mobile to have the lowest per-frame overhead for a mostly-2D UI plus a simple previs scene. | https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html | High (capabilities); UNVERIFIED (numbers) |
| NVIDIA Linux driver issues | No Godot issue mentions drivers 580/590/595 or Blackwell on Linux (GitHub search, Oct 2026). Related reports below. | see below | Medium (absence of evidence) |

Related NVIDIA reports:
- #118772: RTX 50-series dithering artifacts with Forward+ on Windows. Closed (completed) Apr 2026.
- #116652: Vulkan crash on multi-GPU Linux, 4.6.1. Open.
- #109686: Forward+ vsync stutter (Windows). Open.
- #104029: 4.4 crash on driver 550.120, fixed by changing driver. Historical.
- #75953 and #82161: older NVIDIA hangs.
- **#62821, the important one for broadcast:** on X11 with **mixed-refresh monitors and V-Sync (FIFO), NVIDIA presents at the lowest refresh and stutters**. vkcube reproduces it, so it is not Godot-specific. It is closed, but the root cause is in X11/Vulkan.

Links: https://github.com/godotengine/godot/issues/118772 , https://github.com/godotengine/godot/issues/116652 , https://github.com/godotengine/godot/issues/62821 , https://github.com/godotengine/godot/issues/104029

## 8. Testing and CI

| Tool | Status | Source | Confidence |
|---|---|---|---|
| **gdUnit4** | Moved to the `godot-gdunit-labs` org. v6.2.x (latest **v6.2.2, 7 Oct 2026**) supports 4.5-4.7.1, and master (v7) targets 4.7 and 4.8. There is an official GitHub Action (`godot-gdunit-labs/gdUnit4-action`) and C# support (gdUnit4Net). | https://github.com/godot-gdunit-labs/gdUnit4 | High |
| **GUT** | 9.6.1 for 4.6.x, 9.7.1 (Jul 2026, `godot_4_7` branch) for 4.7.x. Active. | https://github.com/bitwes/Gut | High |
| Headless | `--headless` is the same as `--display-driver headless --audio-driver Dummy`, and is "**required** on platforms that do not have GPU access (such as continuous integration)". Also: `--import` to pre-import resources; `--script` + `--check-only` for parse-only checks; `--quit-after N`. RenderingDevice is not available headless, so **shm/RD GDExtension tests need a GPU runner or must be mocked**. | https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html | High (CLI); Medium (no RD headless) |
| Headless export | `godot --headless --export-release "Linux" out.x86_64` needs an **editor binary plus export templates** installed under `~/.local/share/godot/export_templates/<ver>/`, or a custom template in the preset. Maintained actions and images: `chickensoft-games/setup-godot` (v2.4.3, Oct 2026), `firebelley/godot-export` (v8.0.0, May 2026), `abarichello/godot-ci` Docker images (tags up to 4.7.2-stable). | command-line doc; https://github.com/chickensoft-games/setup-godot ; https://github.com/firebelley/godot-export ; https://github.com/abarichello/godot-ci | High |
| **gdtoolkit (gdlint / gdformat)** | `pip install "gdtoolkit==4.*"`. **Last release 4.5.0 on 9 Oct 2025; no commits since.** It may not parse 4.6/4.7-era syntax (**UNVERIFIED**). Alternatives: `GDQuest/GDScript-formatter` (Rust/tree-sitter, active Oct 2026) and `atelico/gdstyle` (Rust linter and formatter, active). Also use the engine's own `--check-only` and treat GDScript warnings as errors. | https://github.com/Scony/godot-gdscript-toolkit ; https://github.com/GDQuest/GDScript-formatter ; https://github.com/atelico/gdstyle | High (dates) |

## 9. Licensing

| Component | Answer | Source | Confidence |
|---|---|---|---|
| Godot | MIT. You must make the license text available to users; a licenses file installed with the app is fine. Godot bundles third-party code with its own notices: ship `COPYRIGHT.txt` (suggested name `GODOT_COPYRIGHT.txt`), or generate it from `Engine.get_license_info()` / `get_copyright_info()`. | https://docs.godotengine.org/en/stable/about/complying_with_licenses.html | High |
| godot-cpp | MIT. | https://github.com/godotengine/godot-cpp | High |
| gdext | MPL-2.0. File-level copyleft: modified gdext files stay MPL, and your code is unaffected. | https://github.com/godot-rust/gdext | Medium (from memory; the API returned no license field) |
| FFmpeg addons | FFmpeg is **LGPL-2.1+ by default and GPL if built with `--enable-gpl`** (x264, x265 and others). In an ISO: link dynamically, ship the source (or an offer) for the exact FFmpeg build, and allow relinking. GoZen is LGPL-2.1; EIRTeam and lunastream wrappers are MIT around LGPL FFmpeg. H.264/HEVC **patent** licensing is a separate issue that Godot core avoids. | playing_videos doc; addon READMEs; https://ffmpeg.org/legal.html | High (licenses); Medium (patent advice: not legal advice) |
| NDI | The NDI SDK and runtime are proprietary: you must comply with the NDI SDK license and trademark rules. Redistributing the runtime in an ISO needs checking against the NDI license (**UNVERIFIED**). godot-ndi itself is MPL-2.0. | https://github.com/unvermuthet/godot-ndi | Medium |
| Shipping in a Linux ISO | Nothing in Godot's MIT terms prevents it. Include the notices from the rows above. | — | High |

## 10. Wayland

| Topic | Answer | Source | Confidence |
|---|---|---|---|
| Default driver | Godot 4.6 registers **X11 first, then Wayland**, so exports run on X11 (or XWayland) unless `display/display_server/driver.linuxbsd=wayland`, `--display-driver wayland`, or the editor's `prefer_wayland` (honoured only when `WAYLAND_DISPLAY` is set). | https://github.com/godotengine/godot/blob/4.6/platform/linuxbsd/os_linuxbsd.cpp ; main/main.cpp | High |
| Native Wayland status | Supported since 4.3. 4.5 added native sub-windows (PR #101774). 4.7 added initial touch support and **HDR output (Wayland only on Linux)**. Tracker #88346 is still open, and open issues remain: fullscreen on Hyprland, UI scale across mixed-DPI monitors (#124125), and others. | https://github.com/godotengine/godot/pull/101774 ; https://godotengine.org/releases/4.7/ ; https://github.com/godotengine/godot/issues/88346 | High |
| Positioning limits | `DisplayServerWayland::window_set_position()` is an empty stub ("Unsupported with toplevels"). Apps **cannot place windows at coordinates or on a chosen monitor** except through fullscreen on an output. `screen_get_position` is unreliable. Fractional scale is only accurate for the main window's screen. The "Creating applications" doc still says multiple windows are "X11/XWayland only, not in native Wayland mode", which is stale since 4.5's sub-windows, but positioning really is missing. | display_server_wayland.cpp (4.6); DisplayServer.xml; creating_applications.rst | High |
| HDR output | X11 is not listed (4.7). | 4.7 release page | High |

**Implication:** a multi-monitor operator layout should stay on X11, or XWayland if the box ever moves to a Wayland session.

## 11. GDScript vs C#

| Topic | Answer | Source | Confidence |
|---|---|---|---|
| Typed GDScript | "Typed GDScript improves performance by using optimized opcodes when operand/argument types are known". | https://docs.godotengine.org/en/stable/tutorials/scripting/gdscript/static_typing.html | High |
| GDScript vs C# vs C++ | "the performance of C# and GDScript is within the same order of magnitude, and C++ is faster than both". C# wins on heavy computation with few engine calls, can lose on many API calls (interop and marshalling), and its GC can stutter. | https://docs.godotengine.org/en/stable/about/faq.html | High |
| C# on Linux desktop | Supported: desktop export since 4.0. 4.5/4.6/4.7 need .NET 8+; **4.8 needs .NET 10**. Web export is not supported. Trade-offs: separate .NET editor build, bundled .NET runtime (larger ISO), interop costs on Godot objects, and string-to-StringName/NodePath conversions. The 4.6 and 4.7 migration guides contain several C#-binary-only breaks. | https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/c_sharp_basics.html ; 4.8 beta 1 post | High |

**Recommendation:** typed GDScript for UI and app logic, plus C++ GDExtension for the hot paths: the shm reader, OSC, and heavy parsing if it becomes necessary. That avoids shipping the .NET runtime. Confidence: Medium (judgement).

---

## Risks for this project (ranked by severity)

1. **Upload cost and frame pacing for 3K@50 (critical)**
   - Each 3072x1728 BGRA frame is 21 MB, about 1.06 GB/s. `RD::texture_update` is synchronous on the render (main) thread: two CPU copies, plus tiling in 64 px regions by default. Godot has a history of slow video uploads (#57147 is still open).
   - *Mitigation:*
     - Use Texture2DRD + `DATA_FORMAT_B8G8R8A8_UNORM` + `texture_update` (the godot-ndi pattern).
     - Raise `staging_buffer/block_size_kb` and `texture_upload_region_size_px`, and make sure `max_size_mb` is at least 2-3 frames.
     - Upload only the visible streams, and consider a downscaled preview shm from CasparCG.
     - Benchmark in week 1 on the RTX PRO 4000 box.
     - Fallback: zero-copy via `texture_create_from_extension` + `VK_EXT_external_memory_host` from the GDExtension. This is more code, and you own the Vulkan synchronisation.

2. **50 Hz content vs monitor refresh, and mixed-refresh X11 vsync (high)**
   - With FIFO vsync on X11/NVIDIA, mixed-refresh monitors stutter to the slowest one (#62821, reproducible with vkcube). 50 fps video on 60 Hz panels judders.
   - *Mitigation:* run every operator monitor at 50 Hz (xrandr in the ISO), or drive pacing from the shm frame clock with vsync Mailbox/off plus `Engine.max_fps`. Test multi-window plus vsync early.

3. **Renderer lock-in (high)**
   - The RD/Texture2DRD path does not exist in the Compatibility renderer. Forward+/Mobile have a higher base cost and need Vulkan.
   - *Mitigation:* commit to Forward+ or Mobile (benchmark both). Keep a degraded `RenderingServer.texture_2d_update` RGBA path with a shader swizzle for Compatibility, for diagnostics only.

4. **Port scale and UI paradigm gap (high)**
   - There is no CSS or DOM, and no virtualized Tree/ItemList (10k-row lists were a known pain point, #70869). Theming is Theme/StyleBox-based. Accessibility is experimental. HiDPI is not automatic on X11 (`screen_get_scale()` = 1.0).
   - *Mitigation:*
     - Build a small widget kit first: a virtualized table Control, a theme, and a scale manager using `content_scale_factor` from `screen_get_dpi`.
     - Prototype the 3 heaviest screens before committing.
     - Set `accessibility_name` from day one.

5. **Engine version churn (medium-high)**
   - 4.6 has had no patch since May 2026 and will drop to security-only once 4.8 ships (Q4 2026). Every minor has small API breaks: 4.7 moved accessibility enums, changed RichTextLabel image params and input device IDs.
   - *Mitigation:* target 4.7.x now and pin the exact engine plus templates in CI. Build the GDExtension with godot-cpp 10 `api_version=4.6/4.7`; it is forward-compatible. Budget one upgrade per minor and read each migration guide.

6. **Networking gaps vs a browser stack (medium)**
   - HTTPRequest: one request per node, no keep-alive, no multipart helper, **no streaming uploads**.
   - WebSocket: buffers default to 64 KB, there is no permessage-deflate, and you must poll.
   - JSON numbers become floats, and parsing big snapshots blocks the main thread.
   - *Mitigation:*
     - Raise `inbound_buffer_size`/`outbound_buffer_size` to 64 MB or more, and disable compression on the server.
     - Pool HTTPRequest nodes, or use one `HTTPClient` per host.
     - Upload video through server-side chunked/resumable endpoints, or `curl` via `OS.create_process`.
     - Parse JSON in `WorkerThreadPool`, send deltas, keep IDs as strings.

7. **Openbox desktop integration (medium)**
   - Native file dialogs need xdg-desktop-portal plus a backend over D-Bus. There is no tray icon or notification API on Linux. Each popup in multi-window mode is a separate X11 window.
   - *Mitigation:* either add `xdg-desktop-portal` + `xdg-desktop-portal-gtk` to the ISO and test, or use the built-in FileDialog everywhere. Keep `embed_subwindows=true` except for real detachable panels. Use `notify-send` if needed.

8. **NVIDIA Blackwell + driver 595 on Linux is untested by the community (medium)**
   - No Godot reports exist for this combination; the RTX 50 Forward+ artifact issue (#118772) was Windows-only and is closed.
   - *Mitigation:* a smoke test on the actual box (Forward+ and Mobile, multi-window, vsync, 3K uploads). Pin the driver version in the ISO. Run `--verbose` logging and keep the Vulkan validation layers available.

9. **Tooling gaps (medium-low)**
   - gdtoolkit (gdlint/gdformat) has been stale since Oct 2025. RD-dependent GDExtension code can't run under `--headless`.
   - *Mitigation:* use gdUnit4 v6.2+/GUT 9.7 for logic tests, and GDQuest GDScript-formatter or gdstyle plus `--check-only` for linting. Add a self-hosted GPU runner, or mock the RD layer behind an interface for CI.

10. **Remote client video and licensing (medium-low, future)**
    - Core plays only Theora. FFmpeg addons are young on Linux: hardware decode is VAAPI-only, NVDEC on NVIDIA is unclear, and lunastream's Linux path is untested on hardware. FFmpeg is LGPL/GPL with codec patent questions. NDI is proprietary.
    - *Mitigation:* for remote preview, start with JPEG/WebP over WebSocket (built-in decoders, no licensing). Evaluate EIRTeam.FFmpeg, gd-hwvideo or godot-ndi later. If FFmpeg is used, ship it as LGPL-only, dynamically linked, with source.

11. **Wayland migration (low now, high if the box moves to Wayland)**
    - Native Wayland cannot position windows or choose monitors for windowed toplevels.
    - *Mitigation:* stay on X11 (the default driver), or XWayland under a Wayland session. Design the operator layout around fullscreen-per-output if Wayland is ever forced.
