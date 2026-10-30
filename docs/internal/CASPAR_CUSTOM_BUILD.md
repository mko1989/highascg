# Custom CasparCG server build (PRs #1718–#1720)

HighAsCG can generate `casparcg.config` XML for a **custom** CasparCG build. The box's own build (`~/caspar-build/src-v2`,
deployed as `~/highascg/bin/casparcg`) carries all three: they arrived with the CasparCG_Enhanced base (WO-233/234) and
are newer there than the PR branches. Upstream closed the three PRs unmerged on 2026-05-31; #1719 was withdrawn for
#1714, which 2.5.1 ships. Full comparison: [WO-847](../../work/work-orders/847_WO_casparcg_server_prs_1718_1720_consumers_audio.md).

- **PR #1718** — Screen consumer: `aspect-ratio` (`16:9`, `3840:1080`, `3840/1080` or a decimal; empty = the channel
  format, since WO-847), `enable-mipmaps`, `borderless` / `always-on-top` / explicit `x`/`y`/`width`/`height` for
  spanning. The fork also keeps `force-linear-filter`; brightness/saturation were dropped (use MIXER). On NVIDIA hosts
  keep **`<vsync>true</vsync>`** and **Sync to VBlank off** in NVIDIA Settings — [screen-consumer-vsync-nvidia.md](../reference/screen-consumer-vsync-nvidia.md).
- **PR #1719** — OAL (`<system-audio>`): the Enhanced consumer gates the channel on OpenAL's playback (deferred future),
  downmixes to stereo and reads only `<device-name>`. Since WO-847 several `<system-audio>` consumers work side by side
  (one OpenAL context per device, selected per thread); consumers on the same device share it. 2.5.1's `<delay>` is not
  in this build (WO-613 decision).
- **PR #1720** — **PortAudio**: one consumer, settings in the root `<portaudio>` block (`device-name`, `host-api`
  auto/ALSA/JACK, `output-channels`, `buffer-size-frames`, `latency-compensation-ms`, `fifo-ms`). `auto-tune-latency`
  is accepted but does nothing in this build: no timing samples are ever collected (WO-847 §1).

## Settings

1. Open **Application Settings** (gear icon) → **System** tab. Under **Caspar config deploy**, set **Caspar server build** to **Custom build (PRs #1718–#1720)**. (It is not on the Connection tab; per-screen extras are on **Screens**.)
2. On the **Screens** tab, per main screen (PGM), optional:
   - **Aspect ratio** — e.g. `16:9`, `3840:1080` (inside `<screen>`).
   - **Enable mipmaps** — for LED walls.
   - **PortAudio** — check **Enable PortAudio consumer**, pick an **output device** from the autocomplete list (**Refresh list**) or type a name. Enumeration uses the optional native module **`naudiodon`** when it builds; if it does not (toolchain/Node version), **Linux** falls back to **`aplay -L`** via `alsa-utils` — names usually match PortAudio’s ALSA backend. You can always type a device string manually. The list reflects the **machine running HighAsCG**; if Caspar runs elsewhere, match names on the playout host. This **disables** OpenAL **program** `<system-audio>` for that screen to avoid duplicate PGM audio consumers.

3. **Write & restart** or **Download** `casparcg.config` as usual.

## Stock Caspar

If **Caspar server build** is **Stock**, the generator does **not** emit `<portaudio>` or the extra screen tags. Use this for official CasparCG 2.5 releases.

## Troubleshooting

### `No consumer factory registered for element name portaudio`

Caspar is loading a `casparcg.config` that contains `<portaudio>…</portaudio>`, but the **`casparcg-server` binary you are running was not linked with the PortAudio consumer** (PR #1720). Typical cases:

- Official **CasparCG 2.5** packages — no PortAudio consumer.
- A **custom build** that only merged screen/OAL changes but not PR #1720, or CMake built without that module.

**Fix:** Either install and run a binary that **includes** the PortAudio consumer, **or** in HighAsCG disable **Enable PortAudio consumer** for every screen (and/or set **Caspar server build** to **Stock**), then **Write & restart** so the config no longer contains `<portaudio>`.

The **screen** / **aspect-ratio** / **mipmaps** parts (PR #1718) use a different code path — if those work but PortAudio does not, the problem is specifically the PortAudio plugin in your Caspar build.

## References

- [WO-847](../../work/work-orders/847_WO_casparcg_server_prs_1718_1720_consumers_audio.md) — PR comparison and the fork commits; [WO-613](../../work/work-orders/613_WO_next_caspar_build_on_v2_5_1.md) — the 2.5.1 build and the OAL decision.
- GitHub PRs: [#1718](https://github.com/CasparCG/server/pull/1718), [#1719](https://github.com/CasparCG/server/pull/1719), [#1720](https://github.com/CasparCG/server/pull/1720).
