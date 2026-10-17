"""Python mirror of caspar/modules/shm/hshm_abi.h (WO-594 ABI v1) — writer + reader.

Spike/test tooling only (WO-595): the production writer is the CasparCG `shm` consumer and the
production reader is the Godot `hshm` GDExtension. Offsets MUST match hshm_abi.h.
Python has no memory fences; on x86-64 (TSO) aligned 8-byte struct stores/loads are sufficient for
this seqlock, and every reader re-validates `seq`, so a torn frame is never accepted.
"""
import mmap
import os
import struct
import sys
import tempfile
import time

MAGIC = b"HASCGSHM"
ABI_VERSION = 1
SLOTS = 3
PAGE = 4096
HEADER_SIZE = 4096
SLOT_HEADER_SIZE = 4096
PIXEL_FORMAT_BGRA8_PREMULT = 1

OFF_MAGIC = 0
OFF_ABI_VERSION = 8
OFF_HEADER_SIZE = 12
OFF_WIDTH = 16
OFF_HEIGHT = 20
OFF_STRIDE = 24
OFF_PIXEL_FORMAT = 28
OFF_FPS_NUM = 32
OFF_FPS_DEN = 36
OFF_SLOT_COUNT = 40
OFF_CHANNEL = 44
OFF_SLOT_OFFSET = 48
OFF_SLOT_SIZE = 72
OFF_GENERATION = 80
OFF_PRODUCER_PID = 88
OFF_LATEST = 96
OFF_HEARTBEAT_NS = 104
OFF_DROPPED = 112
OFF_PUBLISHED = 120

SLOT_OFF_SEQ = 0
SLOT_OFF_PUBLISH_NS = 8
SLOT_OFF_FRAME_NUMBER = 16
SLOT_OFF_PUBLISH_REALTIME_NS = 24

U32 = struct.Struct("<I")
U64 = struct.Struct("<Q")


def default_path(name):
    """/dev/shm/highascg-<name> on Linux (same object the Caspar consumer creates);
    a temp-dir file elsewhere (macOS has no /dev/shm)."""
    if sys.platform.startswith("linux") and os.path.isdir("/dev/shm"):
        return f"/dev/shm/highascg-{name}"
    d = os.path.join(tempfile.gettempdir(), "highascg-shm")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"highascg-{name}")


def slot_size(stride, height):
    b = SLOT_HEADER_SIZE + stride * height
    return (b + PAGE - 1) // PAGE * PAGE


def segment_size(stride, height):
    return HEADER_SIZE + SLOTS * slot_size(stride, height)


class Writer:
    def __init__(self, path, width, height, fps_num, fps_den=1, channel=0):
        self.path, self.width, self.height = path, width, height
        self.stride = width * 4
        size = segment_size(self.stride, height)
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
        prev_gen = 0
        if os.fstat(fd).st_size >= 128:
            old = os.pread(fd, 128, 0)
            if old[:8] == MAGIC:
                prev_gen = U64.unpack_from(old, OFF_GENERATION)[0]
        os.ftruncate(fd, size)
        self.mm = mmap.mmap(fd, size, mmap.MAP_SHARED, mmap.PROT_READ | mmap.PROT_WRITE)
        os.close(fd)
        mm = self.mm
        U64.pack_into(mm, OFF_LATEST, 0)
        mm[0:8] = b"\0" * 8
        mm[8:HEADER_SIZE] = b"\0" * (HEADER_SIZE - 8)
        for off, v in ((OFF_ABI_VERSION, ABI_VERSION), (OFF_HEADER_SIZE, HEADER_SIZE), (OFF_WIDTH, width),
                       (OFF_HEIGHT, height), (OFF_STRIDE, self.stride), (OFF_PIXEL_FORMAT, PIXEL_FORMAT_BGRA8_PREMULT),
                       (OFF_FPS_NUM, fps_num), (OFF_FPS_DEN, fps_den), (OFF_SLOT_COUNT, SLOTS), (OFF_CHANNEL, channel)):
            U32.pack_into(mm, off, v)
        self.slot_size = slot_size(self.stride, height)
        self.slot_offsets = [HEADER_SIZE + s * self.slot_size for s in range(SLOTS)]
        for s, off in enumerate(self.slot_offsets):
            U64.pack_into(mm, OFF_SLOT_OFFSET + 8 * s, off)
            mm[off:off + 32] = b"\0" * 32
        U64.pack_into(mm, OFF_SLOT_SIZE, self.slot_size)
        U64.pack_into(mm, OFF_PRODUCER_PID, os.getpid())
        U64.pack_into(mm, OFF_HEARTBEAT_NS, time.monotonic_ns())
        U64.pack_into(mm, OFF_GENERATION, prev_gen + 1)
        mm[0:8] = MAGIC  # last: a half-written header never validates
        self.n = 0
        self.last = -1
        self.prev = -1
        self._writing = None

    def pixels_offset(self, slot):
        return self.slot_offsets[slot] + SLOT_HEADER_SIZE

    def begin(self):
        """Claim the oldest slot and mark it as being written. Returns the pixel byte offset."""
        self.n += 1
        slot = next(s for s in range(SLOTS) if s not in (self.last, self.prev))
        U64.pack_into(self.mm, self.slot_offsets[slot] + SLOT_OFF_SEQ, 2 * self.n - 1)
        self._writing = slot
        return self.pixels_offset(slot)

    def commit(self, frame_number):
        slot, n, mm = self._writing, self.n, self.mm
        base = self.slot_offsets[slot]
        mono = time.monotonic_ns()
        U64.pack_into(mm, base + SLOT_OFF_PUBLISH_NS, mono)
        U64.pack_into(mm, base + SLOT_OFF_FRAME_NUMBER, frame_number)
        U64.pack_into(mm, base + SLOT_OFF_PUBLISH_REALTIME_NS, time.time_ns())
        U64.pack_into(mm, base + SLOT_OFF_SEQ, 2 * n)
        U64.pack_into(mm, OFF_LATEST, (n << 8) | slot)
        U64.pack_into(mm, OFF_HEARTBEAT_NS, mono)
        U64.pack_into(mm, OFF_PUBLISHED, n)
        self.prev, self.last, self._writing = self.last, slot, None

    def close(self, unlink=True):
        try:
            self.mm.close()
        finally:
            if unlink:
                try:
                    os.unlink(self.path)
                except FileNotFoundError:
                    pass


class Reader:
    def __init__(self, path):
        self.path = path
        fd = os.open(path, os.O_RDONLY)
        st = os.fstat(fd)
        self.inode = st.st_ino
        self.mm = mmap.mmap(fd, st.st_size, mmap.MAP_SHARED, mmap.PROT_READ)
        os.close(fd)
        mm = self.mm
        if mm[0:8] != MAGIC or U32.unpack_from(mm, OFF_ABI_VERSION)[0] != ABI_VERSION:
            raise ValueError("not a HASCGSHM v1 segment")
        self.width = U32.unpack_from(mm, OFF_WIDTH)[0]
        self.height = U32.unpack_from(mm, OFF_HEIGHT)[0]
        self.stride = U32.unpack_from(mm, OFF_STRIDE)[0]
        self.fps_num = U32.unpack_from(mm, OFF_FPS_NUM)[0]
        self.fps_den = U32.unpack_from(mm, OFF_FPS_DEN)[0]
        self.generation = U64.unpack_from(mm, OFF_GENERATION)[0]
        self.slot_offsets = [U64.unpack_from(mm, OFF_SLOT_OFFSET + 8 * s)[0] for s in range(SLOTS)]
        self.last_latest = 0

    def poll(self):
        """Returns ('none'|'lapped'|'geometry'|'frame', info, pixels_bytes)."""
        mm = self.mm
        if U64.unpack_from(mm, OFF_GENERATION)[0] != self.generation:
            return "geometry", None, None
        latest = U64.unpack_from(mm, OFF_LATEST)[0]
        if latest == 0 or latest == self.last_latest:
            return "none", None, None
        n, slot = latest >> 8, latest & 0xFF
        base = self.slot_offsets[slot]
        if U64.unpack_from(mm, base + SLOT_OFF_SEQ)[0] != 2 * n:
            return "lapped", None, None
        pix = base + SLOT_HEADER_SIZE
        data = mm[pix:pix + self.stride * self.height]
        info = {
            "seq": n,
            "frame_number": U64.unpack_from(mm, base + SLOT_OFF_FRAME_NUMBER)[0],
            "publish_ns": U64.unpack_from(mm, base + SLOT_OFF_PUBLISH_NS)[0],
            "publish_realtime_ns": U64.unpack_from(mm, base + SLOT_OFF_PUBLISH_REALTIME_NS)[0],
        }
        if U64.unpack_from(mm, base + SLOT_OFF_SEQ)[0] != 2 * n:
            return "lapped", None, None
        self.last_latest = latest
        return "frame", info, data

    def dropped_by_writer(self):
        return U64.unpack_from(self.mm, OFF_DROPPED)[0]

    def heartbeat_ns(self):
        return U64.unpack_from(self.mm, OFF_HEARTBEAT_NS)[0]

    def close(self):
        self.mm.close()
