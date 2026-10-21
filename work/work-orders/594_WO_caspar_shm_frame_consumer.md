**Status: IN PROGRESS (2026-10-17) — built INTO Caspar for the first time on the shop dev box (v1+shm, then `highascg-build-v2` = v2.5.1, WO-613) and running there; ADD/REMOVE, probe, reader-stall and restart checks PASS; **CPU target MISSED (+5.2 % of a core at 1080p50 vs < 3 %)**; 1 h soak + on-air ADD/REMOVE still open. Parent: [WO-593](./593_WO_godot_client_port_epic.md).**

# WO-594 — CasparCG `shm` frame consumer (highascg-build-v1): channel frames → POSIX shared memory

Owner, 16–17.10: "keeping the operator screen consumer is a good idea but I'd like the client to be
built around it not on top of it" → shared-memory approach chosen ("one frame of delay is totally
acceptable and the whole approach seems the best") → Godot client ([WO-593](./593_WO_godot_client_port_epic.md)).

This WO adds a new Caspar consumer that publishes every channel frame into a POSIX shared-memory
segment, so a local native client (Godot, WO-596) can draw the channel *inside its own scene*
instead of punching X SHAPE holes over a Caspar screen-consumer window.

## Investigation

Read against upstream `CasparCG/server` master **`fe19ac0` (2026-10-15)**, shallow clone in the
session scratchpad. Our binary is `highascg-build-v1` (base `firecraftgaming/caspar-server`
`improved-artnet` = upstream PR #1752, HEAD `b96e58d`, reports `2.6.0 Dev Revision: 253c16c` —
`docs/CASPARCG_BUILD_PROVENANCE.md`). **Re-verify every line ref below against the build kit
(`~/Downloads/caspar-build-kit/` on the box) before coding**; the consumer API has been stable
across 2.4→2.6, but line numbers will differ.

### 1. The CPU copy of every frame already exists — the consumer is one memcpy

`src/accelerator/ogl/image/image_mixer.cpp:103-106`:

```cpp
auto target_texture = ogl_->create_texture(format_desc.width, format_desc.height, 4, depth_);
draw(target_texture, std::move(layers), format_desc);
return {ogl_->copy_async(target_texture), target_texture};
```

Every mixed channel frame is rendered on the GPU **and always read back** (`copy_async`), so each
`core::const_frame` handed to consumers carries both `image_data(0)` (CPU, BGRA) and `texture()`
(GPU) — `src/core/frame/frame.h:84,88`. NDI and DeckLink consume the CPU copy today
(`newtek_ndi_consumer.cpp:257,261`). **A shm consumer adds zero GPU work**; it costs one memcpy.

Compared to today's operator screen consumer (ch5), Caspar's GPU/GL-thread work goes *down*: the
screen consumer owns a GL window, uploads/binds per frame (`screen_consumer.cpp:625-660`, or binds
`in_frame.texture()` at `:729-735` when `gpu-texture` is on — WO-502), and swaps with vsync. A shm
consumer has no window and no GL at all.

### 2. Consumer API

`src/core/consumer/frame_consumer.h`:

```cpp
virtual std::future<bool> send(const core::video_field field, const_frame frame) = 0;
virtual void initialize(const video_format_desc& format_desc, const core::channel_info& channel_info, int port_index) = 0;
virtual std::future<bool> call(const std::vector<std::wstring>& params);
virtual core::monitor::state state() const = 0;
virtual std::wstring print() const = 0;
virtual std::wstring name() const  = 0;
virtual bool has_synchronization_clock() const { return false; }
virtual int  index() const = 0;
```

### 3. ⚠️ The channel blocks on every consumer, every frame

`src/core/consumer/output.cpp:171-189`: `output` collects each consumer's `send()` future into
`futures` and then calls `p.second.get()` on each. **A consumer that does its work inside the
returned future stalls the channel.** NDI returns its executor future
(`newtek_ndi_consumer.cpp:275-277`), i.e. it *is* on the channel's critical path.

Design consequence (non-negotiable): `send()` hands the `const_frame` (ref-counted — holding it
keeps its pixel buffer alive) to a dedicated worker and returns `make_ready_future(true)`
immediately. If the worker is still busy with the previous frame, **drop** the new one (count it).
The channel never waits on shm, and a slow/hung/dead reader can never reach the channel because
readers never signal the writer at all.

### 4. Pixel format and depth

- BGRA, 4 bytes/pixel, premultiplied alpha (Caspar's mixer convention).
- 16-bit channels: `screen_consumer.cpp:797` sets `high_bitdepth` when `channel_info.depth !=
  common::bit_depth::bit8`. NDI simply refuses non-8-bit (`newtek_ndi_consumer.cpp:332-333`).
  **v1 = 8-bit only, same refusal**; all our GUI/PGM channels are 8-bit today.
- Interlaced formats call `send()` per field (`output.cpp:206-209`: `video_field::a`, `::b`,
  `::progressive`). v1 publishes on `progressive` and on field `b` only (one full frame).

### 5. Registration pattern

`src/modules/newtek/newtek.cpp:40-41`:
```cpp
dependencies.consumer_registry->register_consumer_factory(L"NDI Consumer", create_ndi_consumer);
dependencies.consumer_registry->register_preconfigured_consumer_factory(L"ndi", create_preconfigured_ndi_consumer);
```
→ shm gets the same two: AMCP `ADD <ch>-<idx> SHM NAME <name>` and `<shm><name>…</name></shm>`
inside a channel's `<consumers>` in `casparcg.config`.

### 6. The channels it will serve on this box

From `work/LOCALHOST_CHANNEL_VIEW.md` §2.4 (measured 2026-07):

| ch | role | mode | shm use |
|----|------|------|---------|
| 5 | Operator GUI channel | 1920×1080@50p | **always on** (replaces its screen consumer) |
| 1 | PGM screen 1 (on air) | 3072×1728@50p | lazily, while previs 3D is open (WO-607) |
| 2 | PRV screen 1 | 3072×1728@50p | lazily, previs PRV source |
| 3 | PGM screen 2 (DeckLink, on air) | 1080p50 | lazily, previs |

Bandwidth per side (Caspar memcpy in; client upload out):

| Raster | MB/frame | @50 fps |
|--------|----------|---------|
| 1920×1080 | 8.3 | 0.41 GB/s |
| 3072×1728 | 21.2 | 1.06 GB/s |

Box: i7-14700KF (28 threads), RTX PRO 4000 Blackwell, driver 595.71.05. A few % of DDR5 bandwidth.

Measured on the dev Mac (i5-1038NG7 laptop, 2026-10-17) as a *lower bound* for the reader side:
GDScript `FileAccess.get_buffer` of one frame from a tmpfs-like page-cached file:
1920×1080 avg **1.46 ms** (best 1.17), 3072×1728 avg **7.77 ms** (best 6.49), 300 reads each
(`work/godot-port/desk-checks/bench_read.gd`). Native memcpy will be several× faster; the box CPU too.

### 7. Repo guard rails that apply

- **Consumer indices:** HighAsCG pins explicit `ADD ch-idx` indices: 710 (v4l2 bridge,
  `src/virtual-output/v4l2-bridge-consumer.js:16`), 711 (v4l2 audio, `v4l2-bridge-audio.js:12`);
  `work/CASPAR_OUTPUT_TO_BROWSER.md` §4b: "do not reuse 96–98/700s". Screen consumer default index
  is `600 + screen_index` (`screen_consumer.cpp:773`). **Reserve 740–749 for shm** (one per channel
  role), document in this WO, grep before landing.
- **Consumer removal latency on air:** provenance row #8 notes STREAM's disconnect thread-join
  latency on the primary DeckLink channel. Our destructor joins a worker that only ever does one
  memcpy → bounded by one copy (~1–4 ms). Must be measured on ch1/ch3 add/remove (acceptance).
- **Provenance doc:** new row in `docs/CASPARCG_BUILD_PROVENANCE.md` ("11 | shm consumer | in-house").
- **Syncthing:** `/dev/shm` is not in the repo — no `.stignore` impact. Module source in repo IS synced.

## Design

### Module layout

New, self-contained — **no core changes**, so it rebases cleanly when `highascg-build-v1` moves:

```
caspar/modules/shm/            ← versioned in THIS repo (new dir), copied into the build kit tree
  CMakeLists.txt
  shm.cpp / shm.h               (module init: the two registrations above)
  consumer/shm_consumer.cpp/.h  (~300–400 LOC; NDI consumer is 370 — the closest template)
  hshm_abi.h                    (the ABI below — single source of truth, also #included by WO-596)
tools/hshm-probe/hshm-probe.c   (~150 LOC C CLI reader: fps, seq gaps, latency histogram)
```
Build kit: add `add_subdirectory(modules/shm)` + module init in `src/modules/CMakeLists.txt` /
the module list, same as `newtek`. Linux only (`shm_open`, `CLOCK_MONOTONIC`).

### Shared-memory ABI v1 (`hshm_abi.h`)

> **Implemented ABI = [`caspar/modules/shm/hshm_abi.h`](../../caspar/modules/shm/hshm_abi.h) (source of truth).**
> Two changes vs the draft below, made while implementing: (1) each slot header is a full 4096-byte
> page, so **pixel data is page-aligned** (required by zero-copy Vulkan host-memory import, WO-596
> plan B); (2) the slot header carries `publish_realtime_ns` (CLOCK_REALTIME) next to `publish_ns`
> (CLOCK_MONOTONIC), because GDScript/Python readers cannot read the writer's monotonic clock.
> Header also gained `published`. Draft kept for history:

```c
#define HSHM_MAGIC "HASCGSHM"
#define HSHM_ABI_VERSION 1
#define HSHM_SLOTS 3
// page 0: header (4096 B). Little-endian, naturally aligned. Readers map PROT_READ only.
struct hshm_header {
    char     magic[8];
    uint32_t abi_version;          // 1
    uint32_t header_size;          // 4096
    uint32_t width, height;
    uint32_t stride;               // bytes per row = width * 4
    uint32_t pixel_format;         // 1 = BGRA8 premultiplied
    uint32_t fps_num, fps_den;
    uint32_t slot_count;           // 3
    uint32_t channel;              // Caspar channel number (diagnostics)
    uint64_t slot_offset[HSHM_SLOTS]; // page-aligned
    uint64_t slot_size;            // 64 + stride*height, rounded to page
    uint64_t generation;           // ++ on every (re)initialize → reader remaps
    uint64_t producer_pid;
    _Atomic uint64_t latest;       // (frame_seq << 8) | slot_index — stored LAST, release
    _Atomic uint64_t heartbeat_ns; // CLOCK_MONOTONIC at each publish
    _Atomic uint64_t dropped;      // frames dropped because the worker was busy
};
struct hshm_slot_header {          // first 64 B of each slot; pixels follow at +64
    _Atomic uint64_t seq;          // seqlock: odd = writing, even = stable (== 2 * frame_seq)
    uint64_t publish_ns;           // CLOCK_MONOTONIC at publish → reader computes latency
    uint64_t frame_number;         // channel frame counter (gap detection)
};
```

Writer (worker thread), per frame: choose the slot that is neither `latest` nor the one before it
(the oldest) → `seq = 2n+1` → memcpy `image_data(0)` (stride-aware) → `publish_ns`,
`frame_number` → `seq = 2n+2` (release) → `latest = (n << 8) | slot` (release) → `heartbeat_ns`.

Reader contract (documented for WO-596): once per vsync, `latest` (acquire); unchanged → nothing.
Else read slot `seq` (acquire, must be even) → copy/upload → re-read `seq`; changed → discard and
keep the previous texture (only possible if the reader is >~2 frames late). Heartbeat older than
500 ms, `generation` change, or inode change → "signal lost", unmap, reopen loop.

**No notification primitive in v1** — the client renders on vsync anyway; one atomic load per
frame. A shared futex on `latest` can be added later for event-driven readers.

### Naming, permissions, lifecycle

- Segment name: `/highascg-<name>` (→ `/dev/shm/highascg-<name>`), `<name>` from the consumer's
  `NAME` param (`opgui`, `ch1`, …). Mode `0600`; Caspar runs as `casparcg`, the client too.
- `initialize()`: `shm_open(O_CREAT|O_RDWR, 0600)` → `ftruncate` → `mmap` → fill header →
  `generation++` (if the segment already existed with the same geometry, reuse and bump).
- Destructor: stop + join worker (bounded: one memcpy), `munmap`, `shm_unlink`.
- `state()`: `shm/name`, `shm/width`, `shm/height`, `shm/dropped`, `shm/published` → OSC/INFO.
- `print()`: `shm[<name>|<w>x<h>]`. `index()`: from `ADD ch-idx`, preconfigured default 740.

## Tasks

- [ ] T1 — Re-verify the API/line refs above against the build-kit tree (`highascg-build-v1`).
- [ ] T2 — `caspar/modules/shm/` module + `hshm_abi.h`; build in the kit (docker + bare-metal
      variants); binary as `bin/casparcg.new`, owner swaps in a maintenance window (house rule).
- [ ] T3 — `tools/hshm-probe` reader CLI (fps, gaps, p50/p99 latency from `publish_ns`).
- [ ] T4 — Offline unit test of the writer/reader seqlock (C, no Caspar): writer at 50 Hz, reader
      jittered 0–40 ms, assert no torn frame is ever accepted (pattern-filled frames, checksum).
- [ ] T5 — Provenance row in `docs/CASPARCG_BUILD_PROVENANCE.md`; index reservation 740–749
      recorded here + grep guard smoke in `tools/smoke/` (no other code uses 740–749).
- [ ] T6 — Live acceptance on the box (below), on ch5 first; ch1/ch3 only in a maintenance window.

## Acceptance (to be proven on the box, recorded in "Verified")

| Check | Pass if |
|-------|---------|
| `ADD 5-740 SHM NAME opgui` / `REMOVE 5-740` | segment appears/disappears; Caspar log clean |
| `hshm-probe opgui` 1 h soak | 0 seq gaps (reader not stalled), fps = 50.00 |
| Channel frame time with vs without the consumer (OSC profiler / `INFO`) | no measurable change |
| Caspar CPU added (pidstat) | < 3 % of one core at 1080p50; < 6 % at 3072×1728@50 |
| `kill -STOP` the reader for 10 s | channel unaffected; `dropped` stays 0 (writer never waits) |
| ADD/REMOVE on ch1 (PGM) in maintenance window | no dropped/late frame on DeckLink/screen out |
| Caspar restart | client sees `generation` bump / new inode, reattaches |

## What was done (2026-10-17)

| File | What |
|------|------|
| `caspar/modules/shm/hshm_abi.h` | ABI v1 (offsets, structs, atomic helpers, size math, static_asserts) |
| `caspar/modules/shm/hshm_writer.h` | header-only writer (POSIX shm or file), seqlock publish, generation bump on re-init, magic-last init |
| `caspar/modules/shm/hshm_reader.h` | header-only reader (lap/torn detection, generation/inode change) — reused by WO-596 |
| `caspar/modules/shm/consumer/shm_consumer.{h,cpp}` | Caspar consumer: `send()` returns `make_ready_future(true)`, worker thread copies, newest frame wins (drops counted), progressive + field b only, 8-bit only, `writer_mutex_` so `initialize()` (format change) never remaps under a copy, `state()` from atomics (never touches the mapping), index 740 |
| `caspar/modules/shm/shm.{h,cpp}`, `CMakeLists.txt` | module init (`register_consumer_factory("Shared Memory Consumer")`, preconfigured `<shm>`), links `rt` |
| `caspar/modules/shm/tests/hshm_seqlock_test.cpp` | T4 test |
| `caspar/modules/shm/README.md` | build-kit integration (one `add_subdirectory(shm)` line) + smoke commands |
| `tools/hshm-bridge/` | Python writer/probe with the same ABI (T3 probe = `hshm_probe.py`) |

## What was VERIFIED (dev Mac, clang 16)

- `hshm_seqlock_test`: **PASS** — fast writer 500 fps/jittery reader: 694 accepted, **0 torn**;
  1080p50 + reader 0–40 ms late: 98 accepted, **0 torn**; busy reader: 100/100, 0 gaps;
  **deterministic lap**: 0/1/2 publishes during a copy → accepted, 3 → rejected as lapped;
  generation bump on re-init → reader reports geometry change.
- `shm_consumer.cpp` and `shm.cpp` compile **syntax-clean** (`c++ -std=c++20 -fsyntax-only`) against
  upstream CasparCG headers at `fe19ac0` + Boost (Homebrew); every Caspar API used (`array::begin/size`,
  `monitor::data_t` int64/wstring, `u8/u16`, `CASPAR_LOG_CURRENT_EXCEPTION`, `make_ready_future`,
  `register_*_consumer_factory`, `video_field`) checked in the headers.
- Python bridge ↔ probe with the same ABI: 1080p50 300/300 frames 0 torn; 3072×1728 0 torn (WO-595).
- **Not verified:** build inside `highascg-build-v1`, behaviour inside Caspar (channel timing, ADD/REMOVE
  on air, CPU) — the WO-594 acceptance table runs on the box.

## What was VERIFIED on the box (2026-10-17, shop dev box, 1 channel 1080p50, RTX PRO 4000)

Built with no source change into v1 (`~/caspar-build/build`, one `add_subdirectory(shm)`) and into
`highascg-build-v2` (WO-613); gcc, no warnings in `modules/shm`. Note the box has **one channel**, so the
smoke ran on ch1 (`ADD 5-740` correctly answers 400 here — no ch5).

| Check | Result |
|-------|--------|
| `ADD 1-740 SHM NAME opgui` / `REMOVE 1-740` | **PASS** — `/dev/shm/highascg-opgui` 24 899 584 B; log `shm[opgui|1920x1080] publishing … Initialized` / `Uninitialized`, clean |
| `hshm_probe` (5 s) | **PASS** — 50.2 fps, 0 gaps, 0 lapped, 0 torn, latency p50 1.41 / p95 2.34 ms, writer_dropped 0 |
| Pixel correctness | **PASS** — `PLAY 1-900 #FFFF8000` arrives orange in Godot (BGRA order right); real clip incl. MIXER blur/grain visible |
| `kill -STOP` reader 10 s | **PASS** — writer_dropped 0, torn 0 after CONT (gaps = frames missed while stopped) |
| Caspar restart | **PASS** — reader reopened (`reopens 1`) after each of 3 RESTARTs |
| Caspar CPU added | **FAIL vs target** — 4 alternating 8 s windows, clip playing: off 63–67 %, on 68–72 % → **+5.2 % of one core** (target < 3 %). Next: profile the worker copy (page faults on the mapping? `MAP_POPULATE`/hugepages; non-temporal copy) |
| 1 h soak (21.10, `opgui`, build v2, Godot client reading alongside) | **fps PASS, gaps 8 vs 0** — 3600 s, 179 990 frames (180 000 expected), fps 50.00, lapped 0, torn 0, latency p50 2.61 / p95 3.71 ms; 8 skipped seqs (the python probe polling late, once per ~7.5 min on average — `lapped 0` means no slot was overwritten under it). `writer_dropped` read **169** at the end and stayed 169 through a 60 s probe right after; Caspar had been up since 20.10 17:43, so the soak cannot place them — a second hour with per-window lines is running to tell |
| ADD/REMOVE on an on-air PGM, channel frame-time delta | not run (maintenance window) |
