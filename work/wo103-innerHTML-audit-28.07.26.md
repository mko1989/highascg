# WO-103 innerHTML audit — 2026-07-28 (all 86 rule warnings reviewed)

The `no-restricted-syntax` WO-103 rule is SYNTACTIC — it flags every innerHTML template with
interpolations, escaped or not. All 86 current sites were audited (Haiku classification pass +
manual verification of every non-obvious interpolation). The warnings STAY as edit-time guards;
this file records why the remaining ones are accepted.

## Verdicts

- **2 real fixes applied (28.07):**
  - `device-view-caspar-render-markers.js` — user-set connector label + kind now escaped
    (`it.labelHtml || escapeHtml(it.label)`, `escapeAttr(kind)`).
  - `publish-modal.js` — `value="${escapeAttr(savedTarget)}"` (localStorage-backed host field).
- **The rest are safe by construction**, falling into: static templates / literal ternaries
  (~31); interpolations already through escapeHtml/escapeAttr or pre-escaped builders like
  fontOpts, modCell/srvCell, showRows (~12); numeric/internal-id interpolations — px values,
  counts, idPrefix, `q`+index field ids, validated shader ids, uiIcon/tlIcon SVG builders
  (~35); HTML-fragment builders whose own interpolations were spot-verified escaped (~6).
- **Notable near-misses reviewed and cleared:** replication-status-banner parts (role escaped,
  rest numeric/local), header-bar-config-strip cells (pre-escaped), lower-third fontOpts
  (escapeAttr'd), sources-live-render hints (literal strings), presets-modes names (set via
  .textContent — the safe pattern).

## Rule of engagement going forward

A NEW warning from this rule = a NEW template = review it then (escape user/server strings,
`.textContent` for pure text, builders must escape internally). Do not blanket-disable the rule
and do not treat this audit as covering future sites.
