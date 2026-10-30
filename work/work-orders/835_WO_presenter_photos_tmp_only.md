# WO-835 — Presenter photos live in /tmp only

**Status: OPEN (30.10)**
**Source:** REPORT §5 Tracking; owner 30.10: *"they were supposed to be uploaded and used from /tmp meaning they have no
chance of surviving reboot."*
**Related:** WO-675 (presenter recognition), WO-708.

## 1. Investigation

The intake page (`src/tracking/presenter-intake.html`) tells the presenter the photo is deleted when the server restarts,
but WO-675 reloads the roster on boot. The owner chose the behaviour, not the text: photos (and anything derived from
them, e.g. face embeddings) must be stored only under /tmp.
