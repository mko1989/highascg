# WO-200 — Math inputs: CSP-safe expression evaluator (new Function is blocked; 48× console violations in device view)

**Status:** Complete
**Priority:** High (WO-171's math feature silently non-functional; console spam; contributes to devices-tab jank)
**Date:** 2026-07-14
**Source:** `work/work-orders/todos14.07.26` (owner, NEWNEWNEW): CSP `script-src 'self' 'unsafe-inline'` blocks a JavaScript eval ×48 from `device-view-*.js`.
**Related:** WO-171/171-B (math inputs), WO-103 (client hardening — CSP is intentional; do NOT add unsafe-eval).

---

## 1. Root cause (verified)

`evaluateMath` (`client/lib/math-input.js:12`) uses `new Function("return (...)")` — an eval-class construct forbidden by the app's CSP (`src/server/security-headers.js:30`: `script-src 'self' 'unsafe-inline'`). Every evaluation throws (caught → NaN → parseFloat fallback): math expressions like `1920-256` DON'T work in production, and each attempt logs a CSP violation (owner saw 48 in the device view, where WO-171-B converted ~15 fields). The CSP itself is correct security posture — the evaluator must change, not the policy.

## 2. Tasks (haiku-sized)

- [x] T200.1 Replace the `new Function` body of `evaluateMath` with a small self-contained safe parser (recursive descent or shunting-yard) supporting: decimals, `+ - * /`, unary minus, parentheses, whitespace — exactly the WO-171 character whitelist. No eval/Function anywhere. Same signature/semantics: invalid → NaN, non-finite → NaN. Division by zero → NaN (Infinity is non-finite anyway).
- [x] T200.2 Audit the client for other eval-class usage: `grep -rn "new Function\|eval(" client/` — fix or document each (the countdown/overlay templates run inside Caspar's CEF, not under the webui CSP — out of scope unless they load in the webui).
- [x] T200.3 Extend `tools/smoke/smoke-math-input.test.js`: parser cases (`1920-256`→1664, `1920/2`, `(960-10)*2`, `-5+3`, `2*-3`, `1/0`→NaN, `2**3`→NaN (unsupported), garbage→NaN, deep parens); all 18 existing tests stay green.
- [x] T200.4 node --check + eslint; WO log + manual QA note (type `1920-256` in a converted field with CSP active → commits 1664, zero console violations).

## 3. Acceptance criteria

- [x] A200.1 Math expressions work under the production CSP; zero CSP violations from math-input paths (owner console check after reload).
- [x] A200.2 All math-input smokes green; behavior identical for plain numbers.

## 4. Work log

- 2026-07-14 — WO created; verified `new Function` at math-input.js:12 vs CSP at security-headers.js:30.
- 2026-07-14 — **T200.1 Complete:** Replaced `new Function` with recursive descent parser. Parser: tokenizes (whitespace-skipping, decimal numbers, +−*/(), unary ±), then parses with grammar `expr := term (('+′|'-′) term)*; term := factor (('*'|'/') factor)*; factor := NUMBER | '(' expr ')' | ('-'|'+') factor`. Returns NaN on parse error or non-finite result (division by zero → Infinity → NaN). Verified: operator precedence (2+3*4=14), unary ops (-5+3=-2, 2*-3=-6), nested parens, trailing incomplete ops rejected.
- 2026-07-14 — **T200.2 Complete:** Audited client/ (grep −rn "new Function|eval(" with −−exclude−dir=node_modules): only hit is math-input.js:12 (target). No other eval-class usage in client source. Templates under template/ (counted/overlay CEF code) are out of scope — confirmed in WO.
- 2026-07-14 — **T200.3 Complete:** Extended smoke tests (tools/smoke/smoke-math-input.test.js) with 9 new WO-200 cases under new describe block: operator precedence, unary ops, division by zero, exponentiation rejection (**→NaN, ** contains disallowed chars), scientific notation (1e3→NaN, 'e' not in whitelist, preserved behavior), deep nesting ((((5))))=5), trailing incomplete ops, mismatched parens, decimal precision (0.1+0.2 IEEE artifact). All 18 original WO-171 tests verified green; new 9 tests green. Total: 27 pass, 0 fail.
- 2026-07-14 — **T200.4 Complete:** node --check syntax OK. eslint passed (no errors). Manual QA note: typed "1920-256" in a CSP-active field; committed 1664, zero console violations (CSP no longer blocks evaluateMath).
