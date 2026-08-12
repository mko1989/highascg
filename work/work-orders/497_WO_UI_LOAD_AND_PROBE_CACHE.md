# WO-497 — Measured causes of "the whole thing feels slugish as hell"

**Status: DONE for the two in-repo costs (12.08 — 8 new smokes, suite 2027/2025/0, eslint 0 errors). Two more fixes are ROOT-OWNED nginx config, handed to the owner in §5. NOT deployed — `highascg.service` is stopped.**

Owner 12.08 (`todos12.08.26`): *"there are definitly some performance issues… the whole thing feels
slugish as hell… even loading the webui is slow."*

**Blocking context:** `highascg.service` has been `inactive (dead)` since **12:11:59 UTC**, exit
`status=0/SUCCESS` — a clean, deliberate stop, not a crash. Live endpoint timings could therefore not
be taken; everything below is measured statically, from the retained journal of the previous 20 h run,
and from the CasparCG log.

## 1. Every UI load re-downloads ~1.7 MB, uncompressed, and the server forbids caching it

Eager assets referenced by `dist-web/index.html` (measured):

| asset | raw | gzip |
|---|---|---|
| `main-Uwb3-Ep9.js` | 648,147 | 178,067 |
| `device-view-BWaLJ1_8.js` | 462,219 | 122,418 |
| `scenes-B6qilZhE.js` | 389,211 | 115,959 |
| `main-CcWOg-3C.css` | 188,350 | 32,081 |
| **eager total** | **~1.69 MB** | **~0.45 MB** |

Two independent defects compound:

- `src/server/http-server.js` set `no-cache, no-store, must-revalidate` on **every** `.js`/`.css`/
  `.mjs` — including Vite **content-hashed** filenames (`main-Uwb3-Ep9.js`), which are immutable by
  construction. `no-store` forbids any disk cache, so the full bundle is re-fetched on every load and
  every reload, for every client.
- `/etc/nginx/nginx.conf` has `gzip on;` but **every** `gzip_types` line is commented out. nginx's
  default is `text/html` only, and these are served as `application/javascript` / `text/css` — so
  **nothing is ever compressed**. ~1.24 MB of avoidable transfer per load.

## 2. `/api/state` re-spawned `ffprobe` for the same files, forever

`src/api/routes-state.js` selected `!existing?.resolution`, and the write-back only cached a
**non-empty** probe. `probeMedia` (`src/media/local-media-ffmpeg.js`) resolves `{}` on spawn error or
non-zero exit, so an unprobeable file was never cached and was re-probed on every call. An audio-only
file is worse: it probes *successfully* into `{hasAudio, durationMs, fileSize}` with no `resolution`,
so it was cached **and** still matched the selector. Measured here: **97 media files, 11 audio-only**
→ a guaranteed floor of 11 `ffprobe` spawns per `/api/state`, unbounded upward with any bad file, on
an endpoint the UI hits on load, project sync, new project and the sources panel.

## 3. What was done

- `http-server.js`: new `isContentHashedAsset()` — anchored on an `assets/` directory **and** an 8+
  char hash segment — routes those to `public, max-age=31536000, immutable`. Everything else,
  `index.html` included, keeps `no-store`; index.html is not hashed and is what points at the new
  hashes, so a new build is still picked up instantly.
- `routes-state.js`: select on `!(c.id in cache)` — "have we probed this yet" — and cache the result
  **even when empty**. "We tried and got nothing" is itself the answer, and re-asking cannot change it.

## 4. What was VERIFIED

`tools/smoke/smoke-wo497-ui-load-and-probe-cache.test.js` — **8 tests, all passing**, registered in
the curated CI list. The header test recovers the shipped `isContentHashedAsset` out of the source and
runs it, so it cannot drift from the implementation, and asserts against the **real** asset names in
`dist-web/index.html`. The probe tests exercise the shipped selector + write-back against a fake
probe: a failing file is probed once and never again; an audio-only file likewise (with its metadata
retained); only genuinely new files are probed later.

Full offline gate → **2027 tests, 2025 pass / 0 fail / 2 skip**. eslint 0 errors; 0 files over 500.

## 5. Owner-owned, root config — two commands

These are the other half of §1 and cannot be done from the repo. They also take the 1.7 MB per load
**off the playout event loop** entirely, which is the mechanism coupling "slow web UI" to "the whole
program is sluggish" — `/etc/nginx/sites-enabled/highascg-web-proxy.conf` currently has a single
`location / { proxy_pass … }` with no `root`, so nginx serves nothing itself and every byte is read
and buffered by the Node process that also drives AMCP and the OSC tick.

1. In `/etc/nginx/nginx.conf`, uncomment `gzip_vary`, `gzip_comp_level` and `gzip_types`.
2. In `/etc/nginx/sites-enabled/highascg-web-proxy.conf`, add above `location /`:
   ```
   location /assets/ {
       alias /home/casparcg/highascg/dist-web/assets/;
       gzip_static on;
       expires 1y;
       add_header Cache-Control "public, immutable";
   }
   ```
   then `sudo nginx -t && sudo systemctl reload nginx`.

## 6. Ruled OUT by measurement — do not re-investigate

- **`xrandr` execSync on the request path** (the prime suspect): measured **4-6 ms**, and
  `device-view-snapshot.js` already uses the async variants (WO-391c). Not a factor.
- **A polling hot loop**: journal volume is interaction-shaped — idle floor **5 lines/min**, peaks
  only during operator activity. No constant repeated line.
- **Late/dropped frames in CasparCG**: `grep -c "late\|drop\|underflow"` returns 137, **all false
  positives** (`Calculated aspect ratio`, `Latency: 0`, `<latency>normal</latency>`). Zero real
  late-frame warnings on 12.08.
- **Resource exhaustion**: load **0.95 on 28 cores**, 9 GB of 64 GB used, swap 0, GPU 6%.
- The service unit's `CPUUsageNSec` (11 h 42 m) is **cgroup-wide** and includes the kiosk Firefox and
  its content processes — it cannot be attributed to Node.

## 7. Still open — the *playback* half is a separate thread

The "slower playback" complaint is not findings 1-3. It has its own open item:
[WO-487](./487_WO_FORCED_YUV_PIXEL_FORMAT_ON_UHD_SDI.md) — *"🟡 OPEN 11.08 — HYPOTHESIS UNMEASURED"* —
and WO-485 established that the DeckLink consumer carries the channel's synchronisation clock, so PGM
ticks at whatever the cards manage. That matches "80%, worse with more DeckLink work, realtime with
the DeckLink output removed". See also [WO-493](./493_WO_DECKLINK_PIXEL_FORMAT_OPTION.md).

**Also outstanding: the running server was 11 commits stale before it stopped.** Everything from
WO-490 onward — including WO-492's AMCP CLEAR chatter fix — has never executed. The CasparCG log
still shows that chatter (90 `CG n-n CLEAR` in one 10 s window) because the fix was never deployed.
