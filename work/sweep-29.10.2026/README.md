# Code sweep — 29.10.2026

Owner request (29.10): analyse **every code file** of the HighAsCG project, one by one, for bugs, dead code and
anything below a high standard. Write the findings into MD files here, then a full report for the owner to decide on.

- **Scope:** 3184 tracked code files (`.js .mjs .cjs .gd .sh .py .cpp .h .css .html .ts`), about 469k lines.
  Excluded: `docs/`, `vendor/`, `dist*`, `work/`, `template/`, `node_modules`, godot-cpp / build trees, `*.min.js`.
- **Batches:** `_batches/NNN.txt` lists each batch's files: one area (directory), at most ~7000 lines. Every batch
  writes exactly one findings file, `<area>[--partN].md`, named on the batch's first line.
- **Coverage:** `COVERAGE.md` is the index: batch → MD file → files → status.
- **Report:** `REPORT.md` is the owner's decision list: the confirmed high-severity bugs first, then dead code, then
  quality themes, each with a recommendation.

## The contract every sweep agent follows

1. **Read every file in your batch in full.** Do not sample, and do not skip a file because it "looks fine".
2. **Read-only on code.** Write only your batch's MD file(s) in `work/sweep-29.10.2026/`.
   - Never edit code or config.
   - Never run git state commands (add, commit, stash, checkout, reset, rm …).
   - Never restart services, never send AMCP or Art-Net, never POST to the API. Read-only GETs are fine.
3. **Verify before you report.**
   - **Dead code:** grep the whole repo (`client/`, `src/`, `godot/`, `tools/`, `scripts/`, `index.js`, html
     `<script>` tags, `package.json` scripts, dynamic `import()` / `require` by string concat, Godot `preload` /
     `load` / signal-by-name / `call("name")`, CI workflows) before you call anything unused. Say what you grepped.
   - **Bugs:** a concrete failing input or state and the wrong outcome, with `file:line`. If you can't build one,
     report it as a `QUALITY` or `RISK` finding, not a `BUG`.
   - Many smoke tests `readFileSync` production files and pin exact text. Code that only a smoke test "uses" by
     reading it as text still counts as live.
4. **Know the repo's conventions before calling something wrong.** Read `CLAUDE.md` and `RULES.md`, and for an area,
   `rg -il <topic> work/work-orders/` (a WO often explains an odd-looking choice). Each of these is deliberate:
   - the 500-line limit;
   - Syncthing (`.stignore`);
   - WO-341, where no server write echoes from a remote import;
   - the X SHAPE input contracts;
   - AMCP escaping.
5. **Severity tags:**
   - `BUG-HIGH`: wrong on-air output, data loss, security hole, crash on a normal path.
   - `BUG`: a real defect on a less common path.
   - `DEAD`: unused export, file, function, branch or CSS selector, with the grep proof.
   - `RISK`: fragile, but no failing case shown.
   - `QUALITY`: duplication, misleading name or comment, missing error handling, perf waste, stale comment.
   - `OK`: the file was read and nothing was found.

## Findings file format (one per batch)

```
# <area> — sweep 29.10.2026 (batch NNN)

Files: N · lines: L · findings: B BUG-HIGH, B BUG, D DEAD, R RISK, Q QUALITY

## path/to/file.js
- `BUG` path/to/file.js:123 — what is wrong. Failing case: … → … Fix: …
- `DEAD` path/to/file.js:45 `fooBar()` — unused. grep: `rg -n "fooBar" client src godot tools` → only the definition.
## path/to/other.gd
- `OK`
```

Every file in the batch gets a `##` heading, including `OK` files, so coverage can be checked mechanically.
