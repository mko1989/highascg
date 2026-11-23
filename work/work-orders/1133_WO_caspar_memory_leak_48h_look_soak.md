# WO-1133 — Caspar memory leak: 48 h look-cycling soak + NVIDIA driver check
**Area:** caspar-build, engine, os-iso
**Status: IN PROGRESS (soak restarted 23.11.26 10:07 CET as user unit `caspar-leak-soak`, ends 25.11 ~10:07, GUI left in the looks editor; report owed)**

Owner, 23.11: *"check if there is any updated version of nvidia drivers as there was a memory leak in the ones we use …
create a script or automated thingy that will drive different looks for 48h in the current project so we can test
against the memory leak in casparcg i had issues with and catch what causes it."*

Follow-up to WO-1132 (commit 8138417a: Caspar RSS once a minute → `~/.highascg/log/caspar-memory.jsonl`, burst
warnings in the node log). WO-1132's own history: OOM-killed at ~50 GB after two days (20.11); 30.7 GB in 3.6 h
(13.11); 15 GB in 1.8 h (17.11); a 13 h run flat at 2 GB.

## Investigation

**Driver.** Box: RTX PRO 4000 Blackwell, `nvidia-driver-615-open` **615.71.09** (open kernel module), Ubuntu 26.04.1,
kernel 7.0.0-43. Nothing newer in the Ubuntu archive (`apt-cache policy`: candidate = installed; the newest
`nvidia-driver-*` metapackage is 615). Upstream (23.11):
- Production branch **R620**: 620.70.06 (04.11, changelog has no leak / fence / GL-memory fix), 620.73.04 (~18.11,
  changelog is "minor bug fixes"). New feature branch: 615.78.08.
- Known 615 host-memory leak: NVIDIA forum *"615.78.08: glFenceSync leaks host memory, never freed"* (also confirmed on
  615.71.09) and the niri issue #2 analysis say it grows per GL submission in `libnvidia-eglcore`, fed by the
  power-daemon telemetry collector. The undocumented switch `__GL_4718a5=0` stops it (verified by them on 615.78.08 only).
  Nobody reports whether R620 fixed it, and NVIDIA has not replied. Their rate is ~0.9 GB/day for a compositor.
  That is far too slow for our 15–30 GB bursts, but could explain a slow floor. Note: Caspar has **no D-Bus**
  (journal: `Failed to connect to the bus: dbus-launch terminated abnormally`), so that collector can never deliver.
  That is untested.

**Existing history.** `caspar-memory.jsonl` (20.11 19:08 → 23.11): run pid 1737481 went 2.8 → 6.2 GB over 19 h in steps
of 0.3–0.8 GB/min. The largest step, 21.11 07:56–08:00 local (+1.5 GB in 3 min), lines up with look editing on the
**preview channel** (ch 3: ~12 LOADBG/PLAY, ~400 MIXER, CLEAR 3 ×13 in five minutes). The program channel was ch 2.
In the same minutes the DeckLink inputs logged `Excessive A/V sync drift detected (41960119ms), recreating filters`.

**4-minute dry run of the soak (23.11 09:43, pid 5201, 49 takes, 0 failed).** RSS 4.47 → 5.90 GB.
`smaps` growth: `/dev/nvidiactl` +463 MB (+100 mappings), `[anon]` +161 MB, shmem +490 MB, Caspar GPU memory
1032 → 1788 MiB, map count 2084 → 2287. This could be pool warm-up (Caspar's OGL device keeps texture/buffer pools per
size) or the leak. The 48 h run tells which: a plateau means warm-up, steady growth per take or per look means a leak.

## What was done

`tools/soak/` (new, standalone, read-only except the takes it sends):
- `caspar-leak-soak.js`: cycles the current project's looks through `POST /api/scene/take-look`
  (stage on PRV, then take to PGM, as the Godot client does). Each ~90 min cycle has three phases:
  **hold** (live look untouched 20 min = baseline per-frame growth), **rapid** (shuffled looks, a take every 20 s for
  20 min = cost per take), **per-look** (each look held 5 min = growth while that look plays). Writes
  `samples.csv` every 15 s, `events.jsonl` (every take: look, target, ms, RSS before) and `smaps.jsonl` every 10 min.
  Samples cover Caspar RSS / anon / file / shmem / threads / fds / map count, Caspar GPU MiB, CEF children, node RSS,
  MemAvailable. `smaps.jsonl` holds per-mapping-class Rss. Survives Caspar / node restarts by logging the pid change and
  carrying on. On deadline or SIGTERM it takes back the look that was live at start.
- `soak-sample.js`: /proc + nvidia-smi sampler (`-q -d PIDS`, because graphics processes are missing from
  `--query-compute-apps`). CEF children rewrite their process title, so the space-joined cmdline is split.
- `soak-report.js <dir>`: per-run slopes, median slope per phase kind, KB per take, per-look hold slopes,
  RSS step 60 s after each PGM take by look, bursts (≥ 500 MB in 10 min) with the takes around them, top smaps
  growth. Works while a run is going.

Run: `systemd-run --user --unit=caspar-leak-soak … node tools/soak/caspar-leak-soak.js --hours 48`. Data:
`~/.highascg/soak/2026-11-23T09-07-54/` (the 08-48-27 run was stopped after 13 min, see below).

**Run 1 blacked out PGM (23.11 09:48–10:00).** "Look 10" is an **overlay look** (browser-URL template on CG host
700, node log `[overlay-look] PGM ch=2 … hold=until stop`). By design it stays on PGM above every later look take
until the deck's Stop (`POST /api/scene/overlay/stop`). With no URL set its page is opaque black, so PGM went black
after the dry run's last look. The look layers under it were intact: a red test layer on 2-990 showed and an image
on 2-990 drew, and `CG 2-700 CLEAR` brought PGM back. The soak now remembers takes answered with `overlay: true` and
stops that overlay before the next take and on exit. It also has a `--looks` filter. Checked: Look 10 + kurtyna run,
4 overlay stops, no 700 layer left, PGM back on TŁO BAZWE (screenshot of the GUI PGM tile).

**Edit phase** (`soak-edit.js`, `--edit-min 15`): replays the looks editor's drags (`POST /api/preview/mixer-nudge`
at 10 Hz) on PRV for 45 s, then takes the look and drags it on PGM ("PGM edit") for 20 s. This is the traffic of the 21.11 burst.
Checked: 1038 nudges, 0 refused, 907 MIXER FILL lines on ch3 and 212 on ch2.

**What the real editor adds (owner, 23.11: "you are editing looks without actually being in the looks editor").**
Opening the Godot looks editor sends `REMOVE 3-742` + `ADD 3-742 SHM NAME prv1`, a shared-memory consumer on the PRV
channel that stays up while the editor is open and is recreated on every open. The API soak cannot create it, so the
48 h run goes with the GUI left in the looks editor. This custom shm consumer (WO-742 / WO-1120) is a leak suspect.
If the report shows growth only while the editor is open, A/B it by opening and closing the editor.

## What was VERIFIED

- 4-minute compressed run on the box: 49 takes, 0 failures, all 10 looks taken, original look restored, report
  printed all sections. CEF detection fixed after it (9 children found, 1.2 GB RSS).
- `npx eslint tools/soak/` clean; files 212 / 285 / 287 lines.
- Owed: the 48 h report, and from it the next step. If growth is per frame and look-independent, A/B with
  `__GL_4718a5=0` in Caspar's env, then try R620. If it is per take or per look, bisect that look's layers.
