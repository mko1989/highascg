#!/usr/bin/env python3
"""WO-974 — LTC (SMPTE 12M linear timecode) encode/decode via libltc (ctypes, no build step).

libltc is the Ubuntu `libltc11` package (`sudo apt install libltc11`). HIGHASCG_LIBLTC overrides the
library path (offline verification against an extracted .deb).

decode  stdin: s16le PCM (--channels N, LTC on --channel k, 1-based)
        stdout: one JSON line per decoded frame
            {"tc":"HH:MM:SS:FF","h":..,"m":..,"s":..,"f":..,"df":0|1,"start":n,"end":n,"rev":0|1,"vol":dBFS}
encode  stdin: control lines  `locate TC` | `align TC EPOCH_MS` (TC starts playing at that wall time) | `slew N`
        (stretch +N / shrink -N samples, ≤ 1 % per frame) | `run` | `hold` (repeat the frame) | `stop` (silence) | `quit`
        output: --alsa PCM (in-process libasound), --sink-cmd (a player on a 4 KiB pipe) or stdout (--realtime: paced
        by the clock); LTC on each --channel of --channels, silence elsewhere and while stopped.
        stderr: {"ready":true} once the sink is open, then every --report frames {"out":TC,"running":bool,"frames":n,
        "at":epoch_ms the frame plays,"delayMs":..,"xruns":n,"slew":n}; {"aligned":TC,..}; {"error":..,"phase":..} before
        exit 5 (sink did not open) / 4 (sink went away).
probe   prints {"ok":true,"lib":path} or {"ok":false,"error":...} and exits 0/1.
"""

import argparse
import ctypes
import ctypes.util
import fcntl
import json
import os
import select
import subprocess
import sys
import termios
import threading
import time
from array import array

LTC_TV_525_60, LTC_TV_625_50, LTC_TV_1125_60, LTC_TV_FILM_24 = 0, 1, 2, 3
F_SETPIPE_SZ = 1031


class LTCFrame(ctypes.Structure):
    _fields_ = [("w", ctypes.c_uint * 3)]  # 80 bit-fields packed into 3 unsigned ints (sizeof 12)


class LTCFrameExt(ctypes.Structure):
    _fields_ = [("ltc", LTCFrame), ("off_start", ctypes.c_longlong), ("off_end", ctypes.c_longlong),
                ("reverse", ctypes.c_int), ("biphase_tics", ctypes.c_float * 80), ("sample_min", ctypes.c_ubyte),
                ("sample_max", ctypes.c_ubyte), ("volume", ctypes.c_double)]


class SMPTETimecode(ctypes.Structure):
    _fields_ = [("timezone", ctypes.c_char * 6)] + [(n, ctypes.c_ubyte) for n in ("years", "months", "days", "hours", "mins", "secs", "frame")]


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
    if abs(fps - 24) < 0.05:  # 24 and 23.976
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
    nch = max(1, a.channels)
    ch = parse_channels(a.channel, nch)[0]
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


_emit_lock = threading.Lock()
EPIPE, ESTRPIPE, EINTR, EAGAIN = 32, 86, 4, 11


def emit(rec):
    with _emit_lock:
        sys.stderr.write(json.dumps(rec) + "\n")
        sys.stderr.flush()


class SinkError(Exception):
    """phase 'open' (exit 5: the device is not there / busy) or 'write' (exit 4: it went away while playing)."""

    def __init__(self, phase, text, code=0):
        super().__init__(text)
        self.phase, self.text, self.code = phase, text, code


class AlsaSink:
    """WO-1092: in-process ALSA playback (libasound via ctypes) instead of an `aplay` child. The blocking writei paces
    the encoder; snd_pcm_delay says when the next sample will play, so every report carries the frame's real play
    time (aplay's buffer + a 4 KiB pipe were a guess: LTC landed 53-109 ms behind the playhead, varying per start);
    an under-run is counted and recovered in place instead of killing the stream."""

    def __init__(self, device, nch, rate, latency_ms):
        a = self.a = ctypes.CDLL("libasound.so.2")
        vp = ctypes.c_void_p
        a.snd_strerror.restype = ctypes.c_char_p
        a.snd_pcm_open.argtypes = [ctypes.POINTER(vp), ctypes.c_char_p, ctypes.c_int, ctypes.c_int]
        a.snd_pcm_set_params.argtypes = [vp, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_int, ctypes.c_uint]
        a.snd_pcm_writei.restype = ctypes.c_long
        a.snd_pcm_writei.argtypes = [vp, vp, ctypes.c_ulong]
        a.snd_pcm_delay.argtypes = [vp, ctypes.POINTER(ctypes.c_long)]
        a.snd_pcm_recover.argtypes = [vp, ctypes.c_int, ctypes.c_int]
        a.snd_pcm_close.argtypes = [vp]
        self.pcm, self.nch, self.rate, self.xruns, self.device = vp(), nch, rate, 0, device
        r = a.snd_pcm_open(ctypes.byref(self.pcm), device.encode(), 0, 0)
        if r < 0:
            raise SinkError("open", self.err(r), r)
        r = a.snd_pcm_set_params(self.pcm, 2, 3, nch, rate, 1, int(latency_ms * 1000))  # S16_LE, RW interleaved
        if r < 0:
            a.snd_pcm_close(self.pcm)
            raise SinkError("open", self.err(r), r)

    def err(self, r):
        return self.a.snd_strerror(r).decode("utf-8", "replace")

    def delay_ms(self):
        d = ctypes.c_long(0)
        return max(0, d.value) * 1000.0 / self.rate if self.a.snd_pcm_delay(self.pcm, ctypes.byref(d)) >= 0 else 0.0

    def write(self, data):
        buf = ctypes.create_string_buffer(bytes(data), len(data))
        frames, off, step = len(data) // (2 * self.nch), 0, 2 * self.nch
        while off < frames:
            n = self.a.snd_pcm_writei(self.pcm, ctypes.byref(buf, off * step), frames - off)
            if n in (-EAGAIN,):
                continue
            if n < 0:
                if n in (-EPIPE, -ESTRPIPE, -EINTR):
                    self.xruns += 1 if n == -EPIPE else 0
                    r = self.a.snd_pcm_recover(self.pcm, int(n), 1)
                    if r >= 0:
                        continue
                    n = r
                raise SinkError("write", self.err(int(n)), int(n))
            off += n


class PipeSink:
    """A sink process (--sink-cmd, e.g. a test's fake player) on a REAL pipe shrunk to 4 KiB: node/libuv stdio are
    socketpairs, F_SETPIPE_SZ fails there and ~1 s of socket buffer let the encoder run ahead in bursts (WO-1058).
    Delay = what sits in the pipe (FIONREAD) + --sink-latency-ms for the player's own buffer."""

    def __init__(self, sink_cmd, nch, rate, extra_ms):
        self.nch, self.rate, self.extra, self.xruns = nch, rate, extra_ms, 0
        r, self.fd = os.pipe()
        try:
            fcntl.fcntl(self.fd, F_SETPIPE_SZ, 4096)
        except OSError:
            pass
        self.proc = subprocess.Popen(json.loads(sink_cmd), stdin=r, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        os.close(r)
        self.last_err = ""

        def relay():  # the sink's complaints (e.g. "No such device") become error records
            for raw in self.proc.stderr:
                text = raw.decode("utf-8", "replace").strip()
                if text:
                    self.last_err = text[:240]
                    emit({"error": "sink: " + self.last_err})

        self.relay = threading.Thread(target=relay, daemon=True)
        self.relay.start()

    def delay_ms(self):
        b = array("i", [0])
        try:
            fcntl.ioctl(self.fd, termios.FIONREAD, b)
        except OSError:
            b[0] = 0
        return b[0] / (2.0 * self.nch) * 1000.0 / self.rate + self.extra

    def write(self, data):
        try:
            write_all(self.fd, data)
        except BrokenPipeError:
            self.proc.wait()
            self.relay.join(1.0)
            raise SinkError("write", self.last_err or "sink exited", -EPIPE)


class FdSink:
    """stdout (a FIFO's `dd`, a test reader). --realtime paces by the system clock 2 frames ahead: no audio clock
    behind such a sink; the delay is how far ahead of the clock the written samples reach."""

    def __init__(self, realtime, rate, frame_s, nch):
        self.fd, self.realtime, self.rate, self.frame_s, self.nch, self.xruns = sys.stdout.fileno(), realtime, rate, frame_s, nch, 0
        try:
            fcntl.fcntl(self.fd, F_SETPIPE_SZ, 4096)
        except OSError:
            pass  # not a pipe (file / tty / socket)
        self.t_end = time.monotonic()

    def delay_ms(self):
        return max(0.0, self.t_end - time.monotonic()) * 1000.0 if self.realtime else 0.0

    def write(self, data):
        now = time.monotonic()
        if self.t_end < now - 1.0:
            self.t_end = now  # stalled reader: do not burst to catch up
        if self.realtime:
            lag = self.t_end - 2 * self.frame_s - now
            if lag > 0:
                time.sleep(lag)
        self.t_end = max(self.t_end, now - 1.0) + len(data) / (2.0 * self.nch * self.rate)
        try:
            write_all(self.fd, data)
        except BrokenPipeError:
            raise SinkError("write", "reader closed", -EPIPE)


def parse_channels(text, nch):
    """--channel "3" or "7,8" (1-based) → 0-based positions inside --channels."""
    out = []
    for part in str(text).split(","):
        if part.strip().isdigit():
            out.append(min(max(1, int(part)), nch) - 1)
    return sorted(set(out)) or [0]


def slew_frame(mono, k):
    """Stretch (k > 0) or shrink (k < 0) one encoded frame by k samples, spread over the whole frame (nearest-index
    resampling: each bit cell changes by at most one sample — a speed change of ≤ 1 %, inside any reader's lock range)."""
    n = len(mono)
    m = n + k
    return array("h", (mono[(i * n) // m] for i in range(m)))


def cmd_encode(lib, a):
    std = standard_for(a.fps)
    enc = lib.ltc_encoder_create(float(a.rate), float(a.fps), std, 0)
    lib.ltc_encoder_set_volume(enc, float(a.volume))
    stime = SMPTETimecode()
    stime.timezone = b"+0000"
    stime.years, stime.months, stime.days = 0, 1, 1
    ub = int(a.userbits, 16) if a.userbits else 0
    frame = LTCFrame()

    def fix_frame():  # drop-frame flag + user bits (libltc sets DF itself at 29.97, which NDF must undo)
        if a.df is None and not ub:
            return
        lib.ltc_encoder_get_frame(enc, ctypes.byref(frame))
        if a.df is not None:
            frame.w[0] = (frame.w[0] & ~(1 << 10)) | (int(a.df) << 10)
        for g, at in enumerate((4, 12, 20, 28, 36, 44, 52, 60)):  # user-bit groups 1..8, group 1 = first hex digit
            nib = (ub >> (4 * (7 - g))) & 0xF
            w, b = divmod(at, 32)
            frame.w[w] = (frame.w[w] & ~(0xF << b)) | (nib << b)
        lib.ltc_frame_set_parity(ctypes.byref(frame), std)
        lib.ltc_encoder_set_frame(enc, ctypes.byref(frame))

    def locate(text):
        h, m, s, f = parse_tc(text)
        stime.hours, stime.mins, stime.secs, stime.frame = h, m, s, f
        lib.ltc_encoder_set_timecode(enc, ctypes.byref(stime))
        fix_frame()

    locate(a.start)
    running = not a.stopped
    hold = False  # `hold`: keep sending the current frame (a parked deck), `run` resumes
    nch = max(1, a.channels)
    pos = parse_channels(a.channel, nch)
    frame_s = 1.0 / a.fps
    try:
        if a.alsa:
            sink = AlsaSink(a.alsa, nch, a.rate, a.latency_ms)
        elif a.sink_cmd:
            sink = PipeSink(a.sink_cmd, nch, a.rate, a.sink_latency_ms)
        else:
            sink = FdSink(a.realtime, a.rate, frame_s, nch)
    except SinkError as e:
        emit({"error": e.text, "phase": "open", "code": e.code})
        sys.exit(5)
    except OSError as e:
        emit({"error": str(e), "phase": "open", "code": -(e.errno or 0)})
        sys.exit(5)
    emit({"ready": True, "delayMs": round(sink.delay_ms(), 2)})
    fd_in = sys.stdin.fileno()
    linebuf = b""
    ptr = ctypes.POINTER(ctypes.c_ubyte)()
    silence_len = int(round(a.rate / a.fps))
    frames = 0
    slew = 0
    align = None  # (tc, epoch_ms): that frame must START playing at that wall time
    # A receiver completes an LTC frame on the NEXT bit edge: going straight to silence left our last frame pending
    # until the signal came back (box 06.11: emitted 1.04 s late at -24.6 dB). Stopping ends on one bit cell of the
    # opposite level, so the last frame decodes on time.
    edge_len = max(1, int(round(a.rate / (80.0 * a.fps))))
    last_level = 0

    def silence(n):
        nonlocal last_level
        mono = array("h", bytes(2 * n))
        if last_level:
            edge = max(-32767, min(32767, -last_level))
            for i in range(min(edge_len, n)):
                mono[i] = edge
            last_level = 0
        return mono

    def out(mono):
        if nch > 1 or pos != [0]:
            pcm = array("h", bytes(2 * len(mono) * nch))
            for c in pos:
                pcm[c::nch] = mono
            return pcm.tobytes()
        return mono.tobytes()

    while True:
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
                try:
                    if words[0] == "quit":
                        return
                    if words[0] == "locate" and len(words) > 1:
                        locate(words[1])
                    elif words[0] == "align" and len(words) > 2:
                        align = (words[1], float(words[2]))
                        running, hold = True, False
                    elif words[0] == "slew" and len(words) > 1:
                        slew = max(-48000, min(48000, slew + int(float(words[1]))))
                    elif words[0] == "run":
                        running, hold = True, False
                    elif words[0] == "hold":
                        running, hold = True, True
                    elif words[0] == "stop":
                        running, hold, slew = False, False, 0
                except ValueError as e:
                    emit({"error": str(e)})
        pad = None
        if align is not None:
            tc, epoch = align
            align = None
            locate(tc)
            t_play = time.time() * 1000.0 + sink.delay_ms()  # when the next sample we write will play
            k = 0
            if epoch < t_play:  # already late for that frame: start on the first frame still ahead
                k = min(250, int((t_play - epoch) / (frame_s * 1000.0)) + 1)
                for _ in range(k):
                    lib.ltc_encoder_inc_timecode(enc)
            pad_ms = min(2000.0, epoch + k * frame_s * 1000.0 - t_play)
            pad = silence(int(round(pad_ms * a.rate / 1000.0))) if pad_ms > 0 else None
            slew = 0
            emit({"aligned": tc, "skipped": k, "padMs": round(max(0.0, pad_ms), 2)})  # reports before this one are stale
        if running:
            lib.ltc_encoder_get_timecode(enc, ctypes.byref(stime))
            cur = fmt_tc(stime.hours, stime.mins, stime.secs, stime.frame)
            lib.ltc_encoder_encode_frame(enc)
            n = lib.ltc_encoder_get_bufferptr(enc, ctypes.byref(ptr), 1)
            mono = array("h", ((ptr[i] - 128) * 256 for i in range(n)))
            if not hold:
                lib.ltc_encoder_inc_timecode(enc)
            if slew:
                k = max(-(n // 100), min(n // 100, slew))
                if k:
                    mono = slew_frame(mono, k)
                    slew -= k
            last_level = mono[-1] if len(mono) else 0
        else:
            cur = None
            mono = silence(silence_len)
        try:
            if pad is not None:
                sink.write(out(pad))
            at_ms = time.time() * 1000.0 + sink.delay_ms()  # the first sample of this frame plays then
            sink.write(out(mono))
        except SinkError as e:
            emit({"error": e.text, "phase": "write", "code": e.code})
            sys.exit(4)
        frames += 1
        if a.report and frames % a.report == 0:
            emit({"out": cur, "running": running, "frames": frames, "at": round(at_ms, 2),
                  "delayMs": round(sink.delay_ms(), 2), "xruns": sink.xruns, "slew": slew})


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("mode", choices=["decode", "encode", "probe"])
    p.add_argument("--rate", type=int, default=48000)
    p.add_argument("--fps", type=float, default=25.0)
    p.add_argument("--channels", type=int, default=1)
    p.add_argument("--channel", default="1", help="1-based; encode: a list puts the same LTC on each (7,8)")
    p.add_argument("--volume", type=float, default=-18.0, help="encode level, dBFS")
    p.add_argument("--start", default="00:00:00:00")
    p.add_argument("--stopped", action="store_true", help="encode: start silent until `run`")
    p.add_argument("--realtime", action="store_true", help="encode: pace by the system clock (FIFO/file sinks)")
    p.add_argument("--report", type=int, default=25, help="encode: status line every N frames (0 = off)")
    p.add_argument("--sink-cmd", default="", help="encode: JSON argv of a sink to start on a real 4 KiB pipe (tests)")
    p.add_argument("--sink-latency-ms", type=float, default=0.0, help="encode: the --sink-cmd player's own buffer")
    p.add_argument("--alsa", default="", help="encode: play to this ALSA PCM in-process (libasound)")
    p.add_argument("--latency-ms", type=float, default=60.0, help="encode: ALSA buffer")
    p.add_argument("--df", type=int, choices=[0, 1], default=None, help="encode: force the drop-frame flag")
    p.add_argument("--userbits", default="", help="encode: 8 hex digits, user-bit group 1 first")
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
