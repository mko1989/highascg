# Custom CasparCG server build (PRs #1718–#1720)

HighAsCG can generate `casparcg.config` XML for a **custom** `casparcg-server` binary that includes:

- **PR #1718** — Screen consumer: flexible `aspect-ratio`, `enable-mipmaps`, multi-display spanning (see upstream PR for full behavior).
- **PR #1719** — OAL consumer: video-scheduled audio (no extra HighAsCG XML; use stock OpenAL / system-audio paths).
- **PR #1720** — **PortAudio** consumer: ASIO multi-channel output with configurable `device-name`, `output-channels`, buffer/latency/FIFO, `auto-tune-latency`.

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

- [WO-07](./WO-07_CasparCG_Server_PRs_1718-1720_Consumers_Audio.md) — upstream integration work order.
- GitHub PRs: [#1718](https://github.com/CasparCG/server/pull/1718), [#1719](https://github.com/CasparCG/server/pull/1719), [#1720](https://github.com/CasparCG/server/pull/1720).
