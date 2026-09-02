# WO-542 — Flag jump-time fields showed raw ms; the jump-to-flag dropdown showed "label @ Nms"

**Status: FIXED in repo (02.09.2026). 10 smokes, suite 2282/2280/0/2 → 2292/2290/0/2. Needs a
client rebuild (`npm run build:client` + kiosk F5) before it's visible on the box.**
**Priority:** Medium (editorial UX, not on-air-breaking)
**Source:** `work/work-orders/todos14.08.26` lines 8–9: *"flags in timeline should be using
timecode values of hh:mm:ss:ms and not straight ms as it is now."* / *"also in a jump flag when
choosing which flag to jump to it should be label - time."*

---

## 1. Investigation

A flag's own position field (`inspector-panel-timeline-flag.js:56`, via the shared
`appendTimelineInspectorPosition`) already showed a frame-based SMPTE string (`HH:MM:SS:FF`) plus
a small `N ms` hint — that's been true since 2026-07-04 (`git log -S`), a month before this todo
was written, and it's shared with the clip inspector, so it was left untouched (out of scope, and
changing a shared frame-accurate display used for clip editing isn't what was asked).

The two things that actually WERE still raw milliseconds, unambiguously, in the same panel:

- `inspector-panel-timeline-flag.js:114` (pre-fix) — label *"Jump to time (ms)"*, a plain
  math-expression input (`parseNumberInput`) storing/reading `flag.jumpTimeMs` as a bare number.
- `inspector-panel-timeline-flag.js:141` (pre-fix) — the "Or jump to flag" `<select>`'s option
  text: `(f.label || f.type || 'flag') + ' @ ' + Math.round(f.timeMs) + 'ms'`.

Neither of these is meaningfully "at" any frame rate the way a clip in/out point is — a flag's
jump target is a wall-clock instant on the timeline — so reusing the existing frame-based
`fmtSmpte`/`parseTcInput` (which format the last segment as a frame count) would just replace one
wrong unit with another. Added a millisecond-native counterpart instead.

## 2. What was done

`client/components/timeline-canvas-utils.js` — new `fmtHms(ms)` (→ `HH:MM:SS:mmm`) and
`parseHmsInput(str, currentMs, totalMs)` (accepts `HH:MM:SS:mmm`, shorter `M:SS:mmm` / `SS:mmm`
forms, `++500`/`--500` relative offsets matching `parseTcInput`'s convention, or a bare ms number;
clamps to `[0, totalMs]`). Re-exported through the `timeline-canvas.js` barrel alongside the
existing `fmtSmpte`/`parseTcInput`.

`inspector-panel-timeline-flag.js`:
- "Jump to time" field relabeled *"Jump to time (hh:mm:ss:ms)"*, now reads/writes via
  `fmtHms`/`parseHmsInput` instead of `parseNumberInput` — same optional/clearable behavior
  (empty commits `jumpTimeMs: undefined`), invalid input reverts the field rather than committing
  garbage (matching the position field's own commit-guard pattern).
- "Or jump to flag" dropdown options now read `label - HH:MM:SS:mmm` instead of `label @ Nms`.
- The hint paragraph below both fields updated to match.

## 3. What was VERIFIED

- `tools/smoke/smoke-wo542-flag-timecode-and-jump-label.test.js` — 10 tests: `fmtHms` formatting
  (zero, sub-second/seconds/minutes/hours, rounding, negative-clamped), `parseHmsInput`
  (round-trips through `fmtHms`, shorter forms, `++`/`--` offsets, duration-clamping, rejects
  garbage), and source-level assertions that the dropdown/field/labels actually changed (and that
  `parseNumberInput` is no longer imported for this field).
- Full offline suite: 2292/2290 pass, 0 fail, 2 pre-existing skips. Lint 0 errors/warnings on
  every changed file. 0 files over the 500-line limit.
- **Not done:** `npm run build:client` + kiosk reload (this session's deploy step, see work log),
  and owner QA on the actual inspector panel.
