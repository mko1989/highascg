# WO-507 — An output consumer was emitted on a DeckLink bound as an INPUT → Caspar restart loop

**Status: DONE in repo (13.08.2026 — 5 smokes, suite 2078/2076/0, eslint 0, prettier clean). NOT deployed.**
**Priority:** HIGH (restart loop = no picture at all)
**Source:** owner `todos13.08.26`: *"just now wanted to test output of ch1 to two decklinks 1&2, somehow it also tried to open a cosumer on decklink 3 at 2160p50 even though its used as an input in the config. this makes the casparcg go into restart loop."*
**Related:** [WO-491](./491_WO_REMOVE_DESTINATION_LEAVES_DECKLINK_BOUND.md), [WO-494](./494_WO_REMOVE_MAPPING_NODE_LEAVES_DECKLINK_BOUND.md), [WO-496](./496_WO_APPLY_READS_ACTUAL_CABLING.md), [WO-442](./442_WO_custom_dims_fossil_keys.md) — the family of stale-binding bugs this one backstops.

## 1. Root cause

**There was no reservation of input devices anywhere in the repo.** Verified by grep: no
`decklinkInputDevices`, no `reservedInputDevices`, no `isDecklinkInputDevice` — the output generator
had no way to know which cards were already claimed by input producers.

A card cannot be an input and an output at once. Asking Caspar to open an output consumer on a
device already bound to an input producer fails at card-open, and because that happens during
**channel construction** the server dies, systemd restarts it, and it fails identically — a restart
loop with no picture.

How a stale binding reaches the generator is the WO-491/494/496/442 family: `screen_N_decklink_tiles`
is generate-time-only state (WO-494) and `screen_N_decklink_device` survives re-mapping (WO-442). The
owner's 2160p50 on device 3 has exactly that shape — a fossil of the earlier UHD config surviving into a
config whose device 3 is now an input.

## 2. What was done — a backstop, not another path fix

Chasing every path that can leave a fossil behind has now failed four times (WO-275 → 491 → 494 →
496). This adds the invariant at the **single point every screen's DeckLink output passes through**,
`buildScreenPairChannels` in `config-generator-consumer-attach-screen.js`:

- `resolveDecklinkInputSlots(config)` (existing, tested, device-graph-SSOT aware) gives the reserved set.
- Tiles whose `device` is reserved are filtered out; a reserved `screen_N_decklink_device` resolves to 0.
- Each drop emits a generator warning naming the screen and device.

**Asymmetric by design:** an output we wrongly drop costs one dark SDI port and is obvious and
recoverable. One we wrongly emit costs the entire server, repeatedly. With no input declarations at
all, nothing is dropped — absent config must never silently disable outputs.

## 3. What was VERIFIED

`tools/smoke/smoke-wo507-wo508-decklink-io-collision-and-single-instance.test.js` — 5 WO-507 tests
driving the **real** `buildScreenPairChannels`:

- the fixture genuinely resolves slots 3 and 4 as inputs (guards the test itself);
- a 3-tile layout with one tile on input device 3 emits **no `2160p5000`** and still emits the
  legitimate outputs — the regression guard for the reported bug;
- a single `screen_1_decklink_device: 3` emits no `<decklink>` at all;
- device 1 (a declared output) is untouched;
- with no input declarations, nothing is dropped.

Full gate **2078 tests, 2076 pass / 0 fail / 2 skip**; eslint 0; prettier clean; 0 files over 500.

**NOT verified:** the live Apply. Owner QA — re-create the ch1 → DeckLink 1&2 setup and confirm the
generated config contains no consumer on device 3 and Caspar starts once.

## 4. Not done

The **fossil itself is not cleaned**. This stops it reaching Caspar; it does not remove the stale
`screen_N_decklink_tiles` / `screen_N_decklink_device` entry from the saved config. The generator
warning is the breadcrumb. Cleaning fossils on write is the WO-496 provenance work and is a separate
decision.

## 5. Work log

- 2026-08-13 — Opened, confirmed no input reservation existed anywhere, added the generator-level
  invariant + 5 smokes.
