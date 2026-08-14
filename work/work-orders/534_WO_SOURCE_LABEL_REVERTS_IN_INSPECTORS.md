# WO-534 — A renamed DeckLink input reverted to its old name in both inspectors

**Status: FIXED in repo (14.08.2026) — 7 smokes, suite 2235 / 2233 pass / 0 fail / 2 skip. Owner QA owed (§5).**
**Priority:** High (looks like data loss on a write that actually succeeded)
**Source:** `work/work-orders/todos14.08.26` line 14: *"the decklink labels are still not applying
correctly, i just changed a label on decklink4 in host channel, it somehow applyed on the compose
preview but went back to the previous label in host ch and sdi port inspectors."*
**Related:** [WO-530](./530_WO_COMPOSE_SURFACES_AND_SOURCE_LABELS.md) (§3 — the compose label bar half,
which is the half that worked), WO-525 (the shared control), WO-506 (source labels), WO-436 (the same
two stacked caches, one inspector earlier)

---

## 1. The write was never the problem

Read off the running box while the owner's rename was still in place:

```
GET /api/state        sourceLabels {"dlsdi_3": "Cam1", "dlsdi_4": "Cam Szeroka"}
                      extraLiveSources  dlsdi_4  label="Cam Szeroka"  generatedLabel="DeckLink 4"  labelIsCustom=true
GET /api/device-view  extraLiveSources  dlsdi_4  label="Cam Szeroka"  generatedLabel="DeckLink 4"  labelIsCustom=true
```

Both payloads are correct and both are enriched (`enrichExtraLiveSources` →
`applySourceLabels`, `src/api/get-state.js:136` and `src/api/routes-device-view.js:109`). The
compose label bar showed the new name because WO-530 §3 taught it to resolve through the broadcast
`sourceLabels`. So: server right, store right, one consumer right.

**What reverted was the two inspectors**, each of which renders the field from an
`extraLiveSources` *snapshot* that the save does not refresh. Two different snapshots, two different
reasons — which is why fixing one would not have closed the report.

## 2. (a) The ports inspector — the 5s payload cache

`device-view-inspector-decklink-input.js:40`:

```js
onSaved: () => load?.(),
```

`ctx.load` defaults `forceRefresh` to false, and `device-view-render.js` then takes the
`shouldUseCache` branch: *render from `lastPayload`, skip the fetch entirely*. Inside the 5s window —
which a blur-triggered save is always inside — the inspector re-renders from the **pre-rename**
snapshot, straight over the field the operator just typed into.

This is WO-436's finding exactly. WO-436 forced all nine inspector reloads it knew about; this call
site is WO-525-era and arrived after that sweep, so it inherited the old default.

## 3. (b) The host-channel inspector — a snapshot nothing ever updates

`device-view-destinations-inspector-host-channel.js:104`:

```js
onApplied: (r) => { if (Array.isArray(r?.extraLiveSources)) lastPayload.extraLiveSources = r.extraLiveSources },
```

and the label control's hand-off, `inspector-decklink-host.js:74`:

```js
onSaved: () => onApplied?.({ message: 'Label saved.' }),
```

`{ message }` carries no `extraLiveSources`, so the guard never fires and `lastPayload` keeps the
pre-rename array indefinitely. There is no re-fetch on this path at all — the field shows the old
name on whatever re-render comes next (re-selecting the destination, returning to the tab).

## 4. The fix — use the echo the server already sends

`POST /api/sources/label` has always replied with the authoritative post-save value:

```js
jsonBody({ ok: true, sourceId, label: res.sourceLabels[sourceId] ?? '', sourceLabels: res.sourceLabels })
```

The control discarded it. It now folds that echo into the array it was handed — and that array **is**
`lastPayload.extraLiveSources`, passed by reference from both callers — before `onSaved` runs:

```js
const res = await api.post('/api/sources/label', { sourceId: key, label: input.value })
applySavedSourceLabel(sources, key, res?.label)
```

`applySavedSourceLabel` mirrors the server's own rule from `src/config/source-labels.js`: a blank
label **clears** the override (absence, not a blank name), so the entry drops back to
`generatedLabel` with `labelIsCustom: false`.

This makes the snapshot correct *however* it is subsequently read — cached, re-rendered, or
re-fetched — which is why it fixes both inspectors with one change instead of patching each
caller's plumbing.

The ports inspector additionally gets `load?.({ forceRefresh: true })`, finishing WO-436's sweep.
That is not redundant with the above: everything *else* on that panel should also be post-save
fresh, not just the label.

## 5. What is NOT the cause

- **Not the endpoint, the store, or the enrichment.** Probed live, §1.
- **Not the WS broadcast.** A rename broadcasts only `sourceLabels`, which is a real limitation
  (recorded in WO-530 §3), but it is not what reverted these fields — they never read it.
- **Not the WO-530(b) double mount.** That was one field too many; this is one field showing the
  wrong value.

## 6. What was VERIFIED

- `tools/smoke/smoke-wo534-source-label-survives-save.test.js` — 7 tests, curated CI list: the real
  `applySavedSourceLabel` + `readSourceLabelState` round-trip a rename, clear an override back to
  the generated name, leave sibling sources alone and no-op on an unknown id; the control applies
  the echo *before* `onSaved`; the ports inspector forces a fresh payload; and the server still
  sends the echo the client fix depends on.
- Live probes of `/api/state` and `/api/device-view` quoted in §1.
- Suite **2235 / 2233 pass / 0 fail / 2 skip**. Lint 0 errors. Line limit 0 over. Client builds.

## 7. Owner QA on the kiosk

Client-only — rebuild + kiosk reload, no server restart.

1. Rename DeckLink 4 in the **host channel** inspector. Tab away and back: the new name stays.
2. Open the **SDI ports** inspector for the same input: the same new name, immediately.
3. Clear the field to empty: it must fall back to "DeckLink 4" in both places, not to the old name.
4. The compose preview label bar must keep tracking the rename live, as it already did.

## 8. Work log

- 2026-08-14 — Rename proved correct on the wire; the fault was two stale client snapshots. Closed
  at the control by applying the server's echo, plus WO-436's missing `forceRefresh` on the
  WO-525-era call site. 7 smokes.
