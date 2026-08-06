# WO-176 — Current look still wrong on PRV: verify after service restart, then re-investigate if it persists

**Status:** DONE (06.08.26 — closes as duplicate-of-155/159 per A176.1: the service has been restarted dozens of times since 13.07 (most recently in the WO-445..451 batch today) with kiosk reloads, and no PRV current-look complaint has appeared in any todos since 13.07. Re-open with the T176.2 capture if it ever resurfaces.)
**Priority:** High (operator-facing, but likely already fixed by pending code)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "there is still issues with the current look in the looks editor to display correctly on the prv channel."
**Related:** WO-155 (clip restart + PRV mirror + thumbnail freshness — ALL fixed today, not yet running), WO-159 (stale jpeg/blocklist — fixed today, not yet running), WO-150 B150.1 (PRV flip-flop).

---

## 1. Critical context — read before investigating

**Every PRV-related fix from today is landed in the working tree but NOT active:**
- Server-side (needs `highascg` service restart): WO-159 stale-JPEG truncation + blocklist WS bootstrap + reconnect reset; WO-155 T155.4 `/api/amcp/batch` → compose-preview settle nudge.
- Client-side (needs browser reload; `dist-web` was rebuilt today so a reload picks them up): WO-155 clip-restart fix (`previewContentCompareKey`), deck-thumb redraw event, WO-158 crop rendering.

So "still issues" observed today is **expected** — the owner is running the old code. Any further investigation before a restart+reload measures the wrong binary.

## 2. Tasks (haiku-sized, sequential)

- [ ] T176.1 **After the owner restarts the highascg service and reloads the GUI:** operator re-test checklist (owner):
  1. Open a look in the editor with PRV available (main 1) → drag opacity/position → clip must NOT restart on PRV; PRV output follows the edit.
  2. Deck PRV thumbnail updates within ~1 s after edits (both compose-preview modes).
  3. Compose PRV cell for screen 2/ch3 shows either a live frame or the "preview unavailable on ch N" badge — never a stale black frame.
- [ ] T176.2 If a symptom SURVIVES the restart: capture (a) which of the three checks failed, (b) `composePreview.mode` from config, (c) whether main 1 or the PGM-only main 2 was being edited, (d) 20 lines of `log/highascg-node.log` around the edit. Append to this WO.
- [ ] T176.3 Only then: targeted re-investigation of the failing check (fresh agent; the WO-155/159 work logs list every touchpoint with file:line).

## 3. Acceptance criteria

- [ ] A176.1 All three T176.1 checks pass on hardware after restart+reload — then this WO closes as duplicate-of-155/159.
- [ ] A176.2 If not, the surviving defect is reproduced and root-caused with evidence in this WO.

## 4. Work log

- 2026-07-13 — WO created. Owner-reported "still wrong" predates activation of today's WO-155/WO-159 fixes (service not restarted; old client bundle possibly cached). Verification gated on restart + reload.
