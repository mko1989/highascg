# WO-830 — LAN hardening: remote crash, injection, secrets (sweep §2, without the auth switch)

**Status: OPEN (30.10)**
**Source:** the 29.10 code sweep, `work/sweep-29.10.2026/REPORT.md` §2 (items 1–24). Owner 30.10: *"yes we need better
auth handling. im putting that off till last … id like it to be hardened"* and *"there are a lot of bugs to fix"*.
**Related:** WO-811 (the auth switch itself stays there and comes last), REVIEW-2026-08-03, WO-418/419.

Three commits, none needs the auth decision:

- **830a — crash class (items 1–8):** each is a one-request remote restart, because process-guards exits(1) on any
  uncaught exception.
- **830b — injection and validation (items 9–15, 23):** root command injection via the vcam label, arbitrary file write
  via caspar-config apply, unchecked update asset, plugin id traversal, replication host/rsync, nuclear password fail-open,
  AMCP CR/LF.
- **830c — secrets and UI (items 16–22, 24):** nuclear password field autosave, redacted GET echo, open redirect,
  malformed cookie, support-bundle redaction, SRT passphrase drop, config dump in the journal, release from a dirty tree.

Item 25 (nuclear routes open to the LAN) is the WO-811 decision.

## 1. Investigation

See REPORT §2 tables and the batch MDs named there; each item carries file:line and how it was checked ([V] verified, [A] agent-read).
