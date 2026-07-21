# WO-307 — SRT passphrase via project credentials (encrypted SRT)

**Status: OPEN** (deliberately deferred in 587ab14)

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
