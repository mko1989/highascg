/*
 * hshm_abi.h — HighAsCG shared-memory frame ABI v1 (WO-594). Single source of truth.
 *
 * One writer (the Caspar `shm` consumer, or tools/hshm-bridge for tests) publishes channel frames
 * into a file-backed or POSIX shared-memory segment; any number of readers (Godot `hshm`
 * GDExtension, tools/hshm-probe, the M0 GDScript reader) map it read-only. Readers never write and
 * there are no locks: the writer cannot be slowed down or blocked by a reader (WO-594 §3).
 *
 * Layout (little-endian, all offsets in bytes):
 *   [0, 4096)                       header page (struct hshm_header)
 *   slot_offset[i]                  slot i: 4096-byte slot header page (struct hshm_slot_header)
 *   slot_offset[i] + 4096           pixels: height rows of `stride` bytes, BGRA8 premultiplied
 * Pixel data is page-aligned on purpose: zero-copy importers (Vulkan VK_EXT_external_memory_host,
 * WO-596 plan B) need host pointers aligned to the import alignment (4096 on NVIDIA).
 *
 * Publish protocol (writer, per frame n = 1, 2, 3 …):
 *   pick slot s = the slot that is neither `latest` nor the one published before it (the oldest)
 *   slot.seq = 2n-1  (odd: being written)           — release
 *   copy pixels; slot.publish_ns, publish_realtime_ns, frame_number
 *   slot.seq = 2n    (even: stable)                 — release
 *   header.latest = (n << 8) | s                    — release
 *   header.heartbeat_ns, header.published           — relaxed
 * Read protocol (reader, once per render frame):
 *   v = latest (acquire); v == 0 → no frame yet; v unchanged → nothing to do
 *   n = v >> 8, s = v & 0xff; check slot.seq == 2n (acquire) → copy/upload → re-check slot.seq == 2n
 *   if the re-check fails the writer lapped the reader: discard, keep the previous frame.
 *   Signal lost = `latest` unchanged for > 500 ms of reader time, magic/abi mismatch,
 *   or `generation` changed (geometry change → remap).
 */
#ifndef HIGHASCG_HSHM_ABI_H
#define HIGHASCG_HSHM_ABI_H

#include <stdint.h>

#define HSHM_MAGIC "HASCGSHM"
#define HSHM_MAGIC_LEN 8
#define HSHM_ABI_VERSION 1u
#define HSHM_SLOTS 3u
#define HSHM_PAGE 4096u
#define HSHM_HEADER_SIZE 4096u
#define HSHM_SLOT_HEADER_SIZE 4096u
#define HSHM_PIXEL_FORMAT_BGRA8_PREMULT 1u
#define HSHM_SEGMENT_PREFIX "/highascg-"

/* Byte offsets — readers in other languages (Python, GDScript) use these, not the structs. */
#define HSHM_OFF_MAGIC 0
#define HSHM_OFF_ABI_VERSION 8
#define HSHM_OFF_HEADER_SIZE 12
#define HSHM_OFF_WIDTH 16
#define HSHM_OFF_HEIGHT 20
#define HSHM_OFF_STRIDE 24
#define HSHM_OFF_PIXEL_FORMAT 28
#define HSHM_OFF_FPS_NUM 32
#define HSHM_OFF_FPS_DEN 36
#define HSHM_OFF_SLOT_COUNT 40
#define HSHM_OFF_CHANNEL 44
#define HSHM_OFF_SLOT_OFFSET 48 /* 3 × u64 */
#define HSHM_OFF_SLOT_SIZE 72
#define HSHM_OFF_GENERATION 80
#define HSHM_OFF_PRODUCER_PID 88
#define HSHM_OFF_LATEST 96
#define HSHM_OFF_HEARTBEAT_NS 104
#define HSHM_OFF_DROPPED 112
#define HSHM_OFF_PUBLISHED 120

#define HSHM_SLOT_OFF_SEQ 0
#define HSHM_SLOT_OFF_PUBLISH_NS 8           /* CLOCK_MONOTONIC of the writer */
#define HSHM_SLOT_OFF_FRAME_NUMBER 16
#define HSHM_SLOT_OFF_PUBLISH_REALTIME_NS 24 /* CLOCK_REALTIME — for readers without a shared monotonic clock */

struct hshm_header {
    char     magic[HSHM_MAGIC_LEN];
    uint32_t abi_version;
    uint32_t header_size;
    uint32_t width;
    uint32_t height;
    uint32_t stride;
    uint32_t pixel_format;
    uint32_t fps_num;
    uint32_t fps_den;
    uint32_t slot_count;
    uint32_t channel;
    uint64_t slot_offset[HSHM_SLOTS];
    uint64_t slot_size;
    uint64_t generation;
    uint64_t producer_pid;
    uint64_t latest;       /* atomic: (frame_seq << 8) | slot_index; 0 = nothing published yet */
    uint64_t heartbeat_ns; /* atomic: writer CLOCK_MONOTONIC at the last publish */
    uint64_t dropped;      /* atomic: frames the writer skipped because it was still copying */
    uint64_t published;    /* atomic: frames published */
};

struct hshm_slot_header {
    uint64_t seq; /* atomic seqlock: odd = writing, even = stable (== 2 * frame_seq) */
    uint64_t publish_ns;
    uint64_t frame_number;
    uint64_t publish_realtime_ns;
};

/* Atomic accessors usable from C and C++ (GCC/Clang builtins; the segment is shared memory). */
static inline uint64_t hshm_load_acquire(const uint64_t* p) { return __atomic_load_n(p, __ATOMIC_ACQUIRE); }
static inline void     hshm_store_release(uint64_t* p, uint64_t v) { __atomic_store_n(p, v, __ATOMIC_RELEASE); }
static inline void     hshm_store_relaxed(uint64_t* p, uint64_t v) { __atomic_store_n(p, v, __ATOMIC_RELAXED); }

static inline uint64_t hshm_slot_size(uint32_t stride, uint32_t height)
{
    uint64_t bytes = (uint64_t)HSHM_SLOT_HEADER_SIZE + (uint64_t)stride * height;
    return (bytes + HSHM_PAGE - 1) / HSHM_PAGE * HSHM_PAGE;
}

static inline uint64_t hshm_segment_size(uint32_t stride, uint32_t height)
{
    return (uint64_t)HSHM_HEADER_SIZE + (uint64_t)HSHM_SLOTS * hshm_slot_size(stride, height);
}

#ifdef __cplusplus
static_assert(sizeof(hshm_header) == 128, "hshm_header layout");
static_assert(sizeof(hshm_slot_header) == 32, "hshm_slot_header layout");
#endif

#endif /* HIGHASCG_HSHM_ABI_H */
