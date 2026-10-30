# WO-773 — PGM audio silent on both boxes: PortAudio aborts its init when no PulseAudio server runs

**Area:** audio
**Status: IN PROGRESS (25.10) — fixed and proven on this box (portaudio consumer up, ALSA hw:1,3 RUNNING 48 kHz/8 ch);
.4 waits for one user-level command by the owner (no SSH from here), then an AMCP RESTART from here**

Found by the WO-772 playout check ("include checking of playout").

## Investigation

- Caspar log, both boxes, at every start with the `<portaudio/>` channel consumer (first ever start with it here:
  2026-10-25 20:49:55; .4: 22:02:13):
  `portaudio_consumer.cpp(317): Throw in function caspar::portaudio::portaudio_initializer —
  PortAudio initialization failed: Unanticipated host error`. AMCP `INFO 1` then lists no portaudio consumer (here
  only the ffmpeg udp meter; on .4 none) → PGM has no sound on either box. Predates the WiVRn install (21:12) and
  the pipewire client libs (21:28), so neither caused it.
- Caspar links the system `/usr/lib/x86_64-linux-gnu/libportaudio.so.2` = Ubuntu 26.04 `libportaudio2
  19.7.0+git20260206.e1b70d33-0ubuntu1`, built with the new PulseAudio host API. It has no env knob to skip a host API
  (`strings` shows no getenv names).
- Repro outside Caspar (ctypes `Pa_Initialize` with run.sh's `LD_LIBRARY_PATH`): `-9999 Unanticipated host error`,
  host api type 0, `PulseAudio_Initialize: Can't connect to server`. PortAudio's front end aborts the whole init when
  any one host API's init fails, and these boxes run no PulseAudio server on purpose (Caspar owns ALSA; DM3 is
  single-open; never install pipewire/wireplumber/pulse daemons here).
- Ubuntu fixed exactly this in `0ubuntu2` (changelog, 2026-10-08, Sebastien Bacher):
  `debian/patches/pulseaudio-no-server-not-fatal.patch: don't fail Pa_Initialize() for all host APIs when no
  PulseAudio server is reachable, just skip the PulseAudio host API (upstream issue #900)`. Published in 26.10
  (tenacious) only; deleted from 26.04-proposed as "not meant for an SRU" → apt on 26.04 will never deliver it.
- The 0ubuntu2 deb needs libc6 ≥ 2.38 (box: 2.43), libasound2t64, libjack, libpulse0 — all present; `ldd` clean.
  Same repro with it: `Pa_Initialize -> 0 Success`, 9 devices, `HDA NVidia: HDMI 0 (hw:1,3) out 8`.

## What was done

- `~/highascg/lib/libportaudio.so.2{,.0.0}` from
  `libportaudio2_19.7.0+git20260206.e1b70d33-0ubuntu2_amd64.deb` (sha256 `ee09ff6c40c1597d7c4a1d818efc94b873eb797251227
  819ab060c004daf9a47`, deb kept in `~/highascg-noble-compat-debs/`), noted in `lib/PORTAUDIO-FIX-MANIFEST.txt`.
  `lib/` is run.sh's `LD_LIBRARY_PATH` (git/stignored, like the noble compat libs, see the 26.04 upgrade notes), so
  only Caspar picks it up; the system package is untouched and no root is needed. Chosen over: installing the deb
  system-wide (mixes releases in dpkg), the noble 19.6 lib (older code, no pulse at all — fine too, but 0ubuntu2 is
  the same source as the system lib plus the one fix), rebuilding Caspar against a static pulse-free PortAudio
  (needs a binary swap on every box).
- Remove the two files once the system package is ≥ 0ubuntu2 (upgrade to 26.10).

## What was VERIFIED

- This box: Caspar restarted (AMCP `RESTART`, 22:19:16) → log `PortAudio stream started successfully`,
  `portaudio[1|3840x1792|8ch] Initialized.`; no "Unanticipated host error". Look 2 re-taken to PGM →
  `/proc/asound/card1/pcm3p/sub0/status` `state: RUNNING`, hw_ptr advancing ~48k/s, hw_params S32_LE 8 ch 48000 Hz.
  Hearing it on the HDMI sink is owner QA.
- .4: still failing (log 22:02:13). Needs, as casparcg on .4:
  ```
  cd /tmp && curl -sO http://archive.ubuntu.com/ubuntu/pool/universe/p/portaudio19/libportaudio2_19.7.0+git20260206.e1b70d33-0ubuntu2_amd64.deb \
    && echo "ee09ff6c40c1597d7c4a1d818efc94b873eb797251227819ab060c004daf9a47  libportaudio2_19.7.0+git20260206.e1b70d33-0ubuntu2_amd64.deb" | sha256sum -c \
    && dpkg-deb -x libportaudio2_19.7.0+git20260206.e1b70d33-0ubuntu2_amd64.deb pa && cp -P pa/usr/lib/x86_64-linux-gnu/libportaudio.so.2* ~/highascg/lib/
  ```
  then AMCP `RESTART` on 192.168.0.4:5250 and the same log/INFO checks.
