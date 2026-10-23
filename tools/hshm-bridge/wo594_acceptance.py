#!/usr/bin/env python3
"""WO-594 acceptance on a live box: what the shm consumer costs and whether ADD / REMOVE disturbs a channel.

  cpu        alternate windows without / with `ADD <ch>-<index> SHM NAME <name>`; per window the Caspar process CPU
             (/proc/<pid>/stat) and the consumer's own worker thread (the task that appears on ADD). The thread is
             the direct cost; the process delta also catches anything the consumer adds elsewhere (noisier).
  addremove  ADD / REMOVE the consumer N times on a channel while listening to Caspar's OSC copy (UDP :6250):
             per-tick spacing of that channel and the frame counters of its other consumers (port/<i>/file/frame),
             compared with an equal quiet baseline. Also scans the Caspar log for warnings / errors in the window.

Uses index 749 by default (reserved for diagnostics, src/system/video-surfaces.js) so it never collides with a
consumer the server leases (741–748, 751+, 801+). Always REMOVEs what it added, also on Ctrl-C.

  python3 tools/hshm-bridge/wo594_acceptance.py cpu --channel 3 --windows 6 --secs 10
  python3 tools/hshm-bridge/wo594_acceptance.py addremove --channel 1 --cycles 20
"""
import argparse
import collections
import glob
import os
import re
import socket
import struct
import threading
import time

AMCP = ('127.0.0.1', 5250)
OSC_PORT = 6250
LOG_DIR = os.path.expanduser('~/highascg/log')
CLK = os.sysconf('SC_CLK_TCK')


def amcp(cmd, timeout=3.0):
    s = socket.create_connection(AMCP, timeout=timeout)
    try:
        s.sendall((cmd + '\r\n').encode())
        buf = b''
        while not buf.endswith(b'\r\n'):
            d = s.recv(65536)
            if not d:
                break
            buf += d
        return buf.decode(errors='replace').strip()
    finally:
        s.close()


def caspar_pid():
    for p in glob.glob('/proc/[0-9]*/cmdline'):
        try:
            argv = open(p, 'rb').read().split(b'\0')
        except OSError:
            continue
        if argv and argv[0].endswith(b'/casparcg') and len(argv) > 1 and argv[1].endswith(b'.config'):
            return int(p.split('/')[2])
    raise SystemExit('casparcg not running')


def ticks(path):
    f = open(path).read().rsplit(')', 1)[1].split()
    return int(f[11]) + int(f[12])  # utime + stime (fields 14, 15)


def tasks(pid):
    return set(os.listdir(f'/proc/{pid}/task'))


class Consumer:
    def __init__(self, ch, index, name):
        self.ch, self.index, self.name, self.on = ch, index, name, False

    def add(self):
        r = amcp(f'ADD {self.ch}-{self.index} SHM NAME {self.name}')
        if not r.startswith('202'):
            raise SystemExit(f'ADD failed: {r}')
        self.on = True

    def remove(self):
        if self.on:
            amcp(f'REMOVE {self.ch}-{self.index}')
            self.on = False


def cpu(a):
    pid = caspar_pid()
    c = Consumer(a.channel, a.index, a.name)
    res = {'off': [], 'on': [], 'thread': []}
    try:
        for w in range(a.windows * 2):
            state = 'on' if w % 2 else 'off'
            worker = None
            if state == 'on':
                before = tasks(pid)
                c.add()
                time.sleep(1.0)  # first frames fault the mapping in; measure the steady state
                new = sorted(tasks(pid) - before)
                worker = new[0] if len(new) == 1 else None
            else:
                time.sleep(1.0)
            p0, t0 = ticks(f'/proc/{pid}/stat'), time.monotonic()
            w0 = ticks(f'/proc/{pid}/task/{worker}/stat') if worker else 0
            time.sleep(a.secs)
            dt = time.monotonic() - t0
            res[state].append(100.0 * (ticks(f'/proc/{pid}/stat') - p0) / CLK / dt)
            if worker:
                res['thread'].append(100.0 * (ticks(f'/proc/{pid}/task/{worker}/stat') - w0) / CLK / dt)
            print(f'window {w + 1}: {state:3s} process {res[state][-1]:6.1f} %'
                  + (f'  worker thread {res["thread"][-1]:5.2f} %' if worker else ''), flush=True)
            if state == 'on':
                c.remove()
    finally:
        c.remove()
    mean = lambda xs: sum(xs) / len(xs) if xs else float('nan')
    print(f'\nprocess: off {mean(res["off"]):.1f} %  on {mean(res["on"]):.1f} %  delta {mean(res["on"]) - mean(res["off"]):+.1f} % of a core')
    print(f'worker thread (direct cost): mean {mean(res["thread"]):.2f} %  max {max(res["thread"] or [0]):.2f} % of a core')


def osc_messages(b):
    if b.startswith(b'#bundle'):
        i = 16
        while i < len(b):
            n = struct.unpack('>i', b[i:i + 4])[0]
            yield from osc_messages(b[i + 4:i + 4 + n])
            i += 4 + n
        return
    end = b.index(b'\0')
    addr = b[:end].decode(errors='replace')
    i = (end + 4) & ~3
    tend = b.index(b'\0', i)
    tags = b[i + 1:tend].decode()
    i = (tend + 4) & ~3
    args = []
    for t in tags:
        if t in 'ih':
            n = 4 if t == 'i' else 8
            args.append(int.from_bytes(b[i:i + n], 'big', signed=True))
            i += n
        else:
            break
    yield addr, args


class OscWatch(threading.Thread):
    """Per-channel tick times and the other consumers' frame counters (`/channel/<ch>/output/port/<i>/file/frame`)."""

    def __init__(self, ch):
        super().__init__(daemon=True)
        self.ch = ch
        self.stop = False
        self.ticks = []
        self.frames = collections.defaultdict(list)
        self.s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
        # Caspar's OSC is several datagrams per frame; the default buffer drops some while Python is busy and a lost
        # datagram reads as a frame-counter skip (first PGM run: 71 "skips", none tied to an ADD / REMOVE)
        self.s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
        self.s.bind(('0.0.0.0', OSC_PORT))
        self.s.settimeout(0.2)

    def run(self):
        tick_addr = f'/channel/{self.ch}/framerate'
        fr = re.compile(rf'^/channel/{self.ch}/output/port/(\d+)/file/frame$')
        while not self.stop:
            try:
                b, _ = self.s.recvfrom(65535)
            except socket.timeout:
                continue
            now = time.monotonic()
            for addr, args in osc_messages(b):
                if addr == tick_addr:
                    self.ticks.append(now)
                m = fr.match(addr)
                if m and args:
                    self.frames[m.group(1)].append(args[0])

    def mark(self):
        return len(self.ticks), {k: len(v) for k, v in self.frames.items()}

    def report(self, label, m0, m1, period):
        t = self.ticks[m0[0]:m1[0]]
        gaps = [b - a for a, b in zip(t, t[1:])]
        late = [g for g in gaps if g > 1.5 * period]
        skips = 0
        for k, v in self.frames.items():
            seq = v[m0[1].get(k, 0):m1[1].get(k, len(v))]
            skips += sum(1 for a, b in zip(seq, seq[1:]) if b - a > 1)
        print(f'{label}: {len(t)} ticks, max spacing {1000 * max(gaps or [0]):.1f} ms, ticks > 1.5 frames: {len(late)}, '
              f'consumer frame-counter skips: {skips}')
        return len(late), skips


def log_issues(since):
    files = sorted(glob.glob(os.path.join(LOG_DIR, 'caspar_*.log')))
    if not files:
        return []
    stamp = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(since))
    out = []
    for line in open(files[-1], errors='replace'):
        m = re.match(r'\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)', line)
        if m and m.group(1) >= stamp and re.search(r'\[(warning|error|fatal)\]', line):
            out.append(line.rstrip())
    return out


def addremove(a):
    fps = 50.0
    period = 1.0 / fps
    w = OscWatch(a.channel)
    w.start()
    c = Consumer(a.channel, a.index, a.name)
    since = time.time()
    try:
        time.sleep(1.0)
        m0 = w.mark()
        time.sleep(a.cycles * 2 * a.hold)
        m1 = w.mark()
        base = w.report('baseline (no ADD / REMOVE)', m0, m1, period)
        for i in range(a.cycles):
            c.add()
            time.sleep(a.hold)
            c.remove()
            time.sleep(a.hold)
        m2 = w.mark()
        test = w.report(f'{a.cycles} × ADD / REMOVE {a.channel}-{a.index}', m1, m2, period)
    finally:
        c.remove()
        w.stop = True
    issues = log_issues(since)
    print(f'Caspar log warnings / errors in the window: {len(issues)}')
    for line in issues[:20]:
        print('  ' + line)
    verdict = test[0] <= base[0] and test[1] <= base[1] and not issues
    print('PASS' if verdict else 'CHECK — more late ticks / skips than the baseline, or log lines (see above)')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest='cmd', required=True)
    for name in ('cpu', 'addremove'):
        s = sub.add_parser(name)
        s.add_argument('--channel', type=int, required=True)
        s.add_argument('--index', type=int, default=749)
        s.add_argument('--name', default='wo594test')
        if name == 'cpu':
            s.add_argument('--windows', type=int, default=6, help='pairs of off / on windows')
            s.add_argument('--secs', type=float, default=10.0)
        else:
            s.add_argument('--cycles', type=int, default=20)
            s.add_argument('--hold', type=float, default=1.0, help='seconds on, then off, per cycle')
    a = p.parse_args()
    {'cpu': cpu, 'addremove': addremove}[a.cmd](a)


if __name__ == '__main__':
    main()
