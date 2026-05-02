# WO-33e — Device view: EDID / timing match, warn, suggest, and apply flow

**Parent:** [WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** [33c](./33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md); [33d](./33d_WO_DEVICE_VIEW_PIXELHUE_CABLING.md) for PH-reported **sink** timing

---

## 1. Objective

When a **cable** connects Caspar/PC **output** to a **sink** (PixelHue input, or a display), the UI must **show** the **intended** format (resolution, progressive/interlace, **frame rate**) on **both** ends, **flag mismatches**, and offer a **suggested** set of **HighAsCG + Caspar generator** fields to match the **authoritative sink** (usually the **receiving** device — often PixelHue input).

**Apply** = user confirms → patch settings → **`POST /api/caspar-config/apply`** (existing) → same UX as 33c.

**No** second restart pipeline.

---

## 2. Data model (extends 33a / edges)

`EdidHint` (already sketched in 33a) **normative fields:**

| Field | Type | Description |
|-------|------|-------------|
| `width` | int | e.g. 1920 |
| `height` | int | 1080 |
| `interlaced` | bool | |
| `fps` | number or `{ n, d }` | e.g. 50, 30000/1001 — pick one project convention and stick to it |
| `source` | string | `ph_reported` \| `user` \| `caspar_consumer` \| `inherited` |
| `label` | string? | e.g. “EIZO 1080p50” |

- **Per edge:** one `edid` on the **sink** side of the link (or store on `Edge` with `role: sinkTiming`).
- **Per connector:** optional `targetFormat` for displays without edge.

---

## 3. Server logic

### 3.1 `GET` enrichment

- Add endpoint or field e.g. `GET /api/device-view` → `viewModel.edges[].match`:
  - `state`: `ok` \| `warn` \| `unknown`
  - `details`: `{ source: EdidHint, dest: EdidHint, message: string }`  
- **Source of “Caspar side”** — from **current HighAsG settings** that the generator would use for the bound screen/consumer (same code path that writes `<consumer>` / `<device>`) — *not* from AMCP at runtime (optional future: `INFO` compare).

### 3.2 `POST` suggest

- Optional: `POST /api/device-view/suggest-edge` body `{ edgeId }` — returns a **list of config patches** (key paths in `highascg.config` or logical patch ops) to align Caspar with **sink**; **idempotent** and **does not apply** until user saves + apply.

**Security:** same auth as other device APIs; no arbitrary path writes — only whitelisted `patch` keys.

---

## 4. Web UI (Inspector)

- On selected **edge** (or when selecting sink connector of a connected edge):
  - **Side-by-side** cards: **Caspar (generator)** vs **Sink (PH/display)**.
  - **State badge:** green / amber / red + short text.
  - **“Apply suggestion”** (optional): pre-fills inspector fields, user still **Save** + **Apply &amp; restart**.
- **“Suggest from sink”** overwrites only **consumer/screen** fields for **that** path — list exact keys in implementation PR for review.

---

## 5. Tasks (checklist)

- [ ] Implement **comparator** in `src/config/` or `src/api/` — `compareEdid(casparHint, sinkHint)`.
- [ ] Read **PH** timing from 33d `live.pixelhue` response (or per-interface detail call if needed).
- [ ] Add `viewModel` builder for device view (server-side) or compute in client from `GET` with clear **single source of truth** (prefer **server** to avoid double logic).
- [ ] Wire **Apply** in edge inspector to same apply route as 33c.
- [ ] **Unit tests** for compare: 1080p50 vs 1080i50; 25 vs 25; fractional.
- [ ] **UX copy** for `unknown` when one side is missing: “EDID not reported; enter format manually (below).”

---

## 6. Acceptance criteria

1. For a cabled path with **known** both sides, UI shows **match** or **warn** consistent with `compareEdid` tests.
2. Suggestion changes **only** whitelisted config keys; a diff review in PR **lists** them.
3. **Apply** path is `POST /api/caspar-config/apply` only; response surfaces `restartSent` in UI.
4. No new Caspar **restart** route in `amcp` module.

---

## 7. Out of scope (33e)

- **Automatic** apply without user confirm.
- Deeper **Color** / **HDR** metadata unless PH API exposes in v1.
- **DeckLink** sub-frame timecode — v1: resolution + fps is enough.

---

*End of WO-33e*
