# WO-833 — On-air engine one-liners (sweep §3e–3i, 3k–3m)

**Status: OPEN (30.10)**
**Source:** REPORT §3. Owner 30.10: *"there are a lot of bugs to fix"*.
**Related:** WO-829 (3a–3d, 3j), WO-545, WO-787.

- 3e +Animate exit fade goes to the logical layer, not the active bank's physical layer.
- 3f Phase B PLAY batch failure still flips the bank and returns ok.
- 3g Shader Live "clear from stack" calls `ctx.amcp.send` (does not exist).
- 3h `POST /api/swap` → TypeError (AmcpClient has only `basic.swap`).
- 3i media delete/move/LOADBG resolve the ACTIVE project's copy first; stem fallback maps `B/INTRO` to `a/intro.mp4`
  (data-destructive).
- 3k web PRV look push sends dB to the linear MIXER VOLUME.
- 3l the streaming channel route ignores `channel_<N>`.
- 3m a malformed JSON body to `POST /api/clear` parses to `{}` and clears PGM; `GET /api/mixer/clear` runs the POST handler.

## 1. Investigation

See REPORT §3 and the batch MDs.
