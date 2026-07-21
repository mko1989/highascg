# WO-307 — SRT passphrase via project credentials (encrypted SRT)

**Status: DONE — 2026-07-21, commit 92978c3.**

Delivered per spec below, plus two secret-leak gaps found and fixed while verifying it
end-to-end (not scoped originally, but directly implicated by shipping a new secret):
  1. amcp-client-transport.js logged the raw command at 9 sites the original stream-key
     fix never reached (debug trace, on-disk history, timeout warn/Error — x2 send paths
     + 1 replication branch). New leaf module `stream-secret-redact.js` wraps all nine.
  2. `srt:` was missing from `isPassthroughAmcpClip`'s network-scheme allowlist, so a PLAY
     of an srt:// clip through /api/raw got mangled as if it were a media filename.

Verified live: a real SRT start writes `passphrase=****` to data/amcp-last50.txt and to
the JSON response; settings-get exposes `hasSrtPassphrase` with no raw value anywhere.
Not verified: an actual SRT listener requiring the passphrase (no such receiver on this
box) — the URL construction and end-to-end redaction are proven, the handshake itself
needs real hardware, per the acceptance criteria below.

Gate: 1198 tests, 0 fail.

---

## Context
SRT output shipped 2026-07-21 (587ab14): latency-ms/streamid/mode persisted per stream output,
Start wired through the RTMP encoder pipeline with mpegts container. The passphrase was
deliberately NOT added: it is a secret, and after the YouTube-key-in-cleartext incident
(2026-07-20, fixed in stream-key redaction + WO-261) no credential goes into plaintext settings.

## Task
Wire `srtPassphrase` through the SAME WO-261 project-credentials mechanism as the RTMP key:
- Store per outputId in the ACTIVE project only (project-stream-credentials.js), never in config.
- Client: password field with "saved in project — leave blank to keep" + clear checkbox,
  exactly mirroring the RTMP key UI in device-view-inspector-stream.js.
- Server start path (routes-streaming-channel-rtmp.js srt branch): resolveStreamCredential-style
  lookup; append `passphrase=...&pbkeylen=16` to the URL in buildSrtOutputUrl ONLY server-side.
- REDACTION: passphrase must be masked in every log site (redactStreamUrl must strip srt query
  secrets) — add to the stream-key redaction smoke.

## Acceptance
- Passphrase never appears in /api/settings responses, journal, caspar log, or amcp history.
- Start with passphrase works against an srt listener requiring one (owner verifies on hardware).
- smoke: redaction + credential resolution, non-vacuous.
