#!/usr/bin/env python3
"""artcap.py <dir> — listen on 127.0.0.2:6454 and keep the latest ArtDmx frame per universe in <dir>/latest.json"""
import socket, sys, json, time, os
d = sys.argv[1]; s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.2', 6454)); s.settimeout(0.5)
U = {}; last = 0; n = 0
while True:
    try:
        p, _ = s.recvfrom(1024)
        if p[:8] == b'Art-Net\0' and p[8] == 0x00 and p[9] == 0x50:
            u = p[14] | (p[15] << 8); ln = (p[16] << 8) | p[17]; U[u] = list(p[18:18 + ln]); n += 1
    except socket.timeout: pass
    if time.time() - last > 0.5:
        last = time.time(); json.dump({'t': last, 'packets': n, 'u': U}, open(d + '/latest.tmp', 'w')); os.replace(d + '/latest.tmp', d + '/latest.json')
