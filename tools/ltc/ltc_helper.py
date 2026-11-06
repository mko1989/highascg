#!/usr/bin/env python3
"""WO-974 — LTC (SMPTE 12M linear timecode) encode/decode via libltc (ctypes, no build step).

libltc is the Ubuntu `libltc11` package (`sudo apt install libltc11`). HIGHASCG_LIBLTC overrides the
library path (offline verification against an extracted .deb).

decode  stdin: s16le PCM (--channels N, LTC on --channel k, 1-based)
        stdout: one JSON line per decoded frame
            {"tc":"HH:MM:SS:FF","h":..,"m":..,"s":..,"f":..,"df":0|1,"start":n,"end":n,"rev":0|1,"vol":dBFS}
encode  stdin: control lines  `locate HH:MM:SS:FF` | `run` | `stop` | `quit`
        stdout: continuous s16le PCM (LTC on --channel k of --channels N, silence elsewhere and while stopped).
        Paced by the sink's back-pressure (the stdout pipe is shrunk to one page), or by the system clock with
        --realtime (a FIFO/file sink has no audio clock).
        stderr: JSON status lines {"out":"HH:MM:SS:FF","running":bool,"frames":n} every --report frames.
probe   prints {"ok":true,"lib":path} or {"ok":false,"error":...} and exits 0/1.
"""

import argparse
import ctypes
import ctypes.util
import fcntl
import json
import os
import select
import sys
import time
from array import array

LTC_TV_525_60, LTC_TV_625_50, LTC_TV_1125_60, LTC_TV_FILM_24 = 0, 1, 2, 3
F_SETPIPE_SZ = 1031


class LTCFrame(ctypes.Structure):
    _fields_ = [("w", ctypes.c_uint * 3)]  # 80 bit-fields packed into 3 unsigned ints (sizeof 12)


class LTCFrameExt(ctypes.Structure):
    _fields_ = [
        ("ltc", LTCFrame),
        ("off_start", ctypes.c_longlong),
        ("off_end", ctypes.c_longlong),
        ("reverse", ctypes.c_int),
        ("biphase_tics", ctypes.c_float * 80),
        ("sample_min", ctypes.c_ubyte),
        ("sample_max", ctypes.c_ubyte),
        ("volume", ctypes.c_double),
    ]


class SMPTETimecode(ctypes.Structure):
    _fields_ = [
        ("timezone", ctypes.c_char * 6),
        ("years", ctypes.c_ubyte),
        ("months", ctypes.c_ubyte),
        ("days", ctypes.c_ubyte),
        ("hours", ctypes.c_ubyte),
        ("mins", ctypes.c_ubyte),
        ("secs", ctypes.c_ubyte),
        ("frame", ctypes.c_ubyte),
    ]


assert ctypes.sizeof(LTCFrameExt) == 368 and ctypes.sizeof(SMPTETimecode) == 13  # libltc 1.3.x x86_64/arm64


def load_lib():
    cands = [os.environ.get("HIGHASCG_LIBLTC") or "", "libltc.so.11", ctypes.util.find_library("ltc") or ""]
    err = None
    for c in cands:
        if not c:
            continue
        try:
            lib = ctypes.CDLL(c)
            break
        except OSError as e:
            err = e
    else:
        raise OSError(f"libltc not found ({err}) - install it: sudo apt install libltc11")
    vp = ctypes.c_void_p
    lib.ltc_decoder_create.restype = vp
    lib.ltc_decoder_create.argtypes = [ctypes.c_int, ctypes.c_int]
    lib.ltc_decoder_write_s16.argtypes = [vp, ctypes.POINTER(ctypes.c_short), ctypes.c_size_t, ctypes.c_longlong]
    lib.ltc_decoder_read.argtypes = [vp, ctypes.POINTER(LTCFrameExt)]
    lib.ltc_frame_to_time.argtypes = [ctypes.POINTER(SMPTETimecode), ctypes.POINTER(LTCFrame), ctypes.c_int]
    lib.ltc_encoder_create.restype = vp
    lib.ltc_encoder_create.argtypes = [ctypes.c_double, ctypes.c_double, ctypes.c_int, ctypes.c_int]
    lib.ltc_encoder_set_timecode.argtypes = [vp, ctypes.POINTER(SMPTETimecode)]
    lib.ltc_encoder_get_timecode.argtypes = [vp, ctypes.POINTER(SMPTETimecode)]
    lib.ltc_encoder_set_volume.argtypes = [vp, ctypes.c_double]
    lib.ltc_encoder_encode_frame.argtypes = [vp]
    lib.ltc_encoder_inc_timecode.argtypes = [vp]
    lib.ltc_encoder_get_bufferptr.argtypes = [vp, ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)), ctypes.c_int]
    lib._path = c
    return lib


def standard_for(fps):
    if abs(fps - 25) < 0.01:
        return LTC_TV_625_50
    if abs(fps - 24) < 0.01:
        return LTC_TV_FILM_24
    return LTC_TV_525_60


def fmt_tc(h, m, s, f, df=False):
    return f"{h:02d}:{m:02d}:{s:02d}{';' if df else ':'}{f:02d}"


def parse_tc(text):
    parts = text.replace(";", ":").replace(".", ":").split(":")
    if len(parts) != 4:
        raise ValueError(f"bad timecode {text!r}")
    return [int(p) for p in parts]


def write_all(fd, data):
    view = memoryview(data)
    while view:
        n = os.write(fd, view)
        view = view[n:]


def cmd_decode(lib, a):
    apv = int(round(a.rate / a.fps))
    dec = lib.ltc_decoder_create(apv, 64)
    frame, stime = LTCFrameExt(), SMPTETimecode()
    fd_in = sys.stdin.fileno()
    nch, ch = max(1, a.channels), min(max(1, a.channel), max(1, a.channels)) - 1
    chunk = 1024 * nch * 2
    pending = b""
    pos = 0
    out = sys.stdout
    while True:
        data = os.read(fd_in, chunk)
        if not data:
            break
        data = pending + data
        usable = len(data) - (len(data) % (2 * nch))
        pending = data[usable:]
        samples = array("h", data[:usable])
        if nch > 1:
            samples = samples[ch::nch]
        n = len(samples)
        if not n:
            continue
        buf = (ctypes.c_short * n).from_buffer(samples)
        lib.ltc_decoder_write_s16(dec, buf, n, pos)
        pos += n
        while lib.ltc_decoder_read(dec, ctypes.byref(frame)):
            lib.ltc_frame_to_time(ctypes.byref(stime), ctypes.byref(frame.ltc), 0)
            df = (frame.ltc.w[0] >> 10) & 1
            rec = {
                "tc": fmt_tc(stime.hours, stime.mins, stime.secs, stime.frame, df),
                "h": stime.hours, "m": stime.mins, "s": stime.secs, "f": stime.frame, "df": df,
                "start": frame.off_start, "end": frame.off_end, "rev": 1 if frame.reverse else 0,
                "vol": round(frame.volume, 1),
            }
            out.write(json.dumps(rec, separators=(",", ":")) + "\n")
        out.flush()


def cmd_encode(lib, a):
    std = standard_for(a.fps)
    enc = lib.ltc_encoder_create(float(a.rate), float(a.fps), std, 0)
    lib.ltc_encoder_set_volume(enc, float(a.volume))
    stime = SMPTETimecode()
    stime.timezone = b"+0000"
    stime.years, stime.months, stime.days = 0, 1, 1

    def locate(text):
        h, m, s, f = parse_tc(text)
        stime.hours, stime.mins, stime.secs, stime.frame = h, m, s, f
        lib.ltc_encoder_set_timecode(enc, ctypes.byref(stime))

    locate(a.start)
    running = not a.stopped
    fd_out = sys.stdout.fileno()
    try:
        fcntl.fcntl(fd_out, F_SETPIPE_SZ, 4096)  # keep the lead small: back-pressure ≈ the sink buffer
    except OSError:
        pass  # not a pipe (file / tty)
    nch, ch = max(1, a.channels), min(max(1, a.channel), max(1, a.channels)) - 1
    fd_in = sys.stdin.fileno()
    linebuf = b""
    ptr = ctypes.POINTER(ctypes.c_ubyte)()
    silence_len = int(round(a.rate / a.fps))
    frames = 0
    frame_s = 1.0 / a.fps
    t_next = time.monotonic()
    while True:
        if a.realtime:  # no audio clock behind the sink (FIFO / file): pace by the system clock, 2 frames ahead
            t_next += frame_s
            lag = t_next - 2 * frame_s - time.monotonic()
            if lag > 0:
                time.sleep(lag)
            elif lag < -1.0:
                t_next = time.monotonic()  # stalled reader: do not burst to catch up
        while select.select([fd_in], [], [], 0)[0]:
            got = os.read(fd_in, 4096)
            if not got:
                return
            linebuf += got
            while b"\n" in linebuf:
                line, linebuf = linebuf.split(b"\n", 1)
                words = line.decode("ascii", "replace").strip().split()
                if not words:
                    continue
                if words[0] == "quit":
                    return
                if words[0] == "locate" and len(words) > 1:
                    try:
                        locate(words[1])
                    except ValueError as e:
                        sys.stderr.write(json.dumps({"error": str(e)}) + "\n")
                elif words[0] == "run":
                    running = True
                elif words[0] == "stop":
                    running = False
        if running:
            lib.ltc_encoder_get_timecode(enc, ctypes.byref(stime))
            cur = fmt_tc(stime.hours, stime.mins, stime.secs, stime.frame)
            lib.ltc_encoder_encode_frame(enc)
            n = lib.ltc_encoder_get_bufferptr(enc, ctypes.byref(ptr), 1)
            mono = array("h", ((ptr[i] - 128) * 256 for i in range(n)))
            lib.ltc_encoder_inc_timecode(enc)
        else:
            cur = None
            mono = array("h", bytes(2 * silence_len))
        if nch > 1:
            pcm = array("h", bytes(2 * len(mono) * nch))
            pcm[ch::nch] = mono
        else:
            pcm = mono
        try:
            write_all(fd_out, pcm.tobytes())
        except BrokenPipeError:
            return
        frames += 1
        if a.report and frames % a.report == 0:
            sys.stderr.write(json.dumps({"out": cur, "running": running, "frames": frames}) + "\n")
            sys.stderr.flush()


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("mode", choices=["decode", "encode", "probe"])
    p.add_argument("--rate", type=int, default=48000)
    p.add_argument("--fps", type=float, default=25.0)
    p.add_argument("--channels", type=int, default=1)
    p.add_argument("--channel", type=int, default=1)
    p.add_argument("--volume", type=float, default=-18.0, help="encode level, dBFS")
    p.add_argument("--start", default="00:00:00:00")
    p.add_argument("--stopped", action="store_true", help="encode: start silent until `run`")
    p.add_argument("--realtime", action="store_true", help="encode: pace by the system clock (FIFO/file sinks)")
    p.add_argument("--report", type=int, default=25, help="encode: status line every N frames (0 = off)")
    a = p.parse_args()
    try:
        lib = load_lib()
    except OSError as e:
        print(json.dumps({"ok": False, "error": str(e)}))
        sys.exit(1 if a.mode == "probe" else 3)
    if a.mode == "probe":
        print(json.dumps({"ok": True, "lib": lib._path}))
        return
    try:
        (cmd_decode if a.mode == "decode" else cmd_encode)(lib, a)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
