# PGM look take — AMCP pipeline

`POST /api/scene/take` runs `runSceneTakeLbg` on the Caspar program channel (and optionally the paired preview channel). This document is the **command order** for a standard crossfade take to PGM.

## Routing (channel 1 PGM, channel 2 PRV)

| Step | HTTP / API | Caspar channel |
|------|------------|----------------|
| Send look to **preview** | `POST /api/scene/take` with `"target": "preview"` (or `"bus": "prv"`) and `channel` = PGM (1) | Incoming look built on **PRV** (2) |
| Send look to **program** | `POST /api/scene/take` with `channel` = PGM (1), no `target` | Incoming on **PGM** (1); previous PGM copied to **PRV** (2) |

Preview-only takes use `skipLayerVisualEquality: true` so layers always load even when live JSON already matches.

## Physical layer banks (PGM)

Logical look layer `N` uses two physical layers on the **same** Caspar channel:

| Bank | Physical layer | When |
|------|----------------|------|
| A | `N` (e.g. `10`) | Off-air or on-air depending on `programLayerBankByChannel` |
| B | `N + 100` (e.g. `110`) | Opposite bank |

**Rule:** never `MIXER FILL` / `MIXER CLEAR` on the **active** (on-air) bank while preparing a new look. Incoming media is prepared on the **inactive** bank, then opacity crossfade swaps visibility.

See also [amcp-clean-look-fade.md](./amcp-clean-look-fade.md).

## Phase 0 — Planning (no AMCP)

1. `diffScenes(currentScene, incomingScene)` → exit / update / enter.
2. `buildTakeJobs` → per-layer `LOADBG` + mixer lines + `PLAY` plan.
3. Orphan layers still on Caspar but not in the incoming look are added to the exit list.
4. `shouldRunBankCrossfade` = transition duration &gt; 0, previous look non-empty, not `MERGE/+Animate`.

## Phase 1 — Exit fade (optional)

When there are exiting media layers, transition duration &gt; 0, and **no** bank crossfade:

```text
MIXER 1-<activeBank> OPACITY 0 <frames> <tween>
MIXER 1 COMMIT
```

## Phase 2 — Stale off-air bank cleanup

On the **inactive** bank only, `STOP` + `MIXER CLEAR` any look-stack layer not in the incoming look (prevents leftovers after a prior swap).

## Phase 3 — Global border (optional)

CG `ADD` / `UPDATE` on layer `998` (or `996`), sometimes at opacity `0` before a linked fade.

## Phase 4 — Per incoming layer (inactive bank)

For each layer in the incoming look (example: logical `10` → physical `110` when bank B is on air):

```text
MIXER 1-110 CLEAR
LOADBG 1-110 "clip.mov" MIX 75 linear
MIXER 1-110 OPACITY 0 0
MIXER 1-110 FILL <x> <y> <scaleX> <scaleY> 0
MIXER 1-110 ROTATION <deg> 0
… other DEFER mixer lines (volume, keyer, effects) …
```

Then PIP overlay CG lines if configured.

**Important:** `OPACITY 0 0` is sent **before** `FILL` so geometry changes are not visible on program during prep.

## Phase 5 — Bank crossfade + PLAY (when `shouldRunBankCrossfade`)

After a short preroll (~80–180 ms):

```text
MIXER 1 COMMIT
PLAY 1-110
MIXER 1-110 OPACITY 0 0
MIXER 1-110 OPACITY 1 <frames> <tween>
MIXER 1-10 OPACITY 0 <frames> <tween>
MIXER 1 COMMIT
```

Outgoing physical layer `10` is the **active** bank; incoming `110` is the **inactive** bank prepared above.

## Phase 5b — Cut / no crossfade

```text
MIXER 1 COMMIT
PLAY 1-110
MIXER 1 COMMIT
```

## Phase 6 — Teardown (after fade time)

```text
STOP 1-10
MIXER 1-10 CLEAR
MIXER 1 COMMIT
```

Bank pointer flips: inactive becomes active for the next take.

## MERGE / +Animate path (same physical layer)

No bank swap: incoming uses logical layer `N` on the **same** slot as the outgoing clip, `LOADBG` with transition, `MIXER OPACITY` with `DEFER`, then `MIXER COMMIT` + `PLAY`. Outgoing-only layers fade on `N` (and ghost `N+100` cleared in teardown).

## PGM + PRV dual-channel summary

1. **Preview** (`target: "preview"`): phases 0–6 on **PRV** only (uses `forceCut` from the request unless you need a faded preview).
2. **Program** (default): **hard-cut** incoming onto **PRV** first (`forceCut: true` always), then run the look transition on **PGM** only. Set `stageOnPreview: false` to skip PRV staging. After PGM take, **previous** PGM is copied onto **PRV** (hard cut).

## What causes visible FILL changes (avoid)

- `MIXER FILL` on the **active** bank during prep.
- Animated `MIXER FILL` with a non-zero duration on an on-air layer (`MERGE` path).
- `FILL` before `OPACITY 0` on the incoming (off-air) layer.

Current code applies immediate `FILL` (tail `0`) and hides the inactive bank with `OPACITY 0 0` before `FILL`.
