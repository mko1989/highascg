# WO-368 — `template/shaders` is box-owned for Syncthing but still tracked by git: permanent dirty tree, deleted shaders one `git checkout` from resurrection

**Status: DECIDED 29.07.26 — OPTION B. Unblocked, not yet implemented.**

> Owner, 29.07: *"the shaders that are in the folder rigth now can be added to the repo."* — git owns
> the shader library; commit the 16 files currently on disk (9 untracked, 1 edited) as truth, and the
> 2 tracked-but-deleted files stay deleted. Note what B costs, unchanged from the analysis below:
> every Shader Live save dirties the tree again, so this is a snapshot, not an end to the dirty-tree
> problem — it DOES answer "what backs up my shaders?", which nothing did before.

**Previously: OPEN — investigated 28.07.26. This is the unresolved half of checklist27 item 16 ("Uncommitted runtime diffs — decide"; owner note: "not sure"). No change made.**

## 1. Investigation

### 1a. What was decided, and what it did not cover

`c4e2871` (28.07 09:49) added to `.stignore`:

```
// Owner bug 27.07.26: peers kept pushing stale shader files back (renames reverted, deleted
// templates resurrected, constant mtime churn). The BOX's shader-store owns these — peers
// must neither overwrite nor receive them.
/template/shaders
/data/shaders
```

That fixed the **Syncthing** fight (WO-354 era, and the session-memory note about runtime-written
paths needing `.stignore`). It does not touch **git**, which still tracks the same files. The two
ownership models now disagree permanently.

### 1b. Current divergence (measured 28.07.26 at `637965c`)

`git ls-files template/shaders` → 11 tracked entries. `ls template/shaders/*.html` → 16 on disk.

```
 D template/shaders/sh-ext.html          ← tracked, deleted on the box
 D template/shaders/sh-ios.html          ← tracked, deleted on the box
 M template/shaders/sh-ksbhdgdgb.html    ← tracked, edited on the box
?? template/shaders/sh-3d-meters.html    ┐
?? template/shaders/sh-3d-meters-c2.html │ nine untracked shaders, including the
?? template/shaders/sh-3d-meters-c3.html │ WO-356 "-c2/-c3/-c4" children the Shader
?? template/shaders/sh-3d-meters-c4.html │ Live editor writes when the owner saves
?? template/shaders/sh-bubles.html       │ an edit to the library
?? template/shaders/sh-hexagons.html     │
?? template/shaders/sh-mario.html        │
?? template/shaders/sh-matrix.html       │
?? template/shaders/sh-triangle.html     ┘
```

Consequences, in order of how much they can hurt:

1. **A `git checkout -- template/shaders` (or any branch switch / reset touching it) resurrects
   `sh-ext.html` and `sh-ios.html` and reverts the owner's edit to `sh-ksbhdgdgb.html`** — the
   exact "deleted shaders come back" symptom `.stignore` was written to stop, just via the other
   sync channel. CLAUDE.md already forbids subagents from running git state ops; this makes the
   consequence concrete rather than hypothetical.
2. `git status` is permanently dirty, so "is the tree clean?" stops being a usable signal — this
   is precisely how WO-322/WO-323 were lost in the 22.07→24.07 window ("~43 files of real work
   sitting uncommitted", todos24). Noise here hides the next real loss.
3. The nine untracked shaders exist on exactly one machine, with no backup path: Syncthing is
   told not to replicate them and git is not tracking them. **The owner's whole shader library
   is currently single-copy.** That includes the WO-356 saved children, which the editor creates
   as a matter of normal use.

`config/*.json` shows the same three-way-dirty pattern but is *already* correctly handled —
`.stignore` lists `config/*.json` and the files are machine-local runtime state by design.
Confirm whether they are also git-tracked when fixing; if so the same decision applies.

## 2. The decision the owner has to make (this is why it is not just done)

Three coherent options — they are mutually exclusive and each has a cost:

**A. Box owns shaders; git stops tracking them.**
`git rm --cached template/shaders/sh-*.html` + a `.gitignore` entry, one commit. Ends the dirty
tree and makes resurrection impossible. **Cost:** shaders leave the release payload — a freshly
installed box from the ISO ships with no shader library unless a separate seeding step is added.
Check `tools/eggs/` and the drop-update path (WO-188) before choosing this.

**B. Git owns shaders; commit the current state as truth.**
One commit records the deletions and adds the nine new files. **Cost:** every Shader Live save
dirties the tree again the moment the owner uses the feature, so this is a snapshot, not a fix —
it must be paired with a habit (or a hook) of committing the shader store.

**C. Split: a tracked seed set + an untracked user store.**
Ship a small curated set under `template/shaders/` (tracked, in the ISO) and move
box-written/edited shaders to a `data/shaders`-style user directory that is ignored by both git
and Syncthing, with the loader reading both. **Cost:** a real code change (loader, Shader Live
save target, templates browser listing) — the only option that is not a one-liner, and the only
one that solves backup, release payload, and dirty tree at once.

Recommendation: **C** is right long-term and **A** is the correct stop-gap if a decision is
needed today — but neither should be done without first answering "what backs up the owner's
shaders?", because right now nothing does.

## 3. Also outstanding, same class

`WO-361`'s own status line records residue: *"README edit lives in the module repo,
uncommitted — commit it there."* Verified still true 28.07 —
`/home/casparcg/companion-module-dev/companion-module-highpass-highascg/README.md` is `??`
untracked in that repo (HEAD `b209e09`). The dev-mode loop WO-361 documents therefore exists
only on this box. One commit in that repo closes it.

## 4. Acceptance criteria

- `git status` on a settled box is clean, or every remaining entry is a file the project has
  deliberately decided git must not track (recorded here, with the reason).
- Deleting a shader in the UI cannot be undone by any git operation.
- The owner's shader library — including WO-356 `-cN` children — exists in at least two places.
- A freshly imaged box has a working shader library, or the WO records that it deliberately does
  not and says what seeds it.
- WO-361's README is committed in the module repo and its status line updated.

## 5. What was VERIFIED

- Counts and file lists above are `git ls-files` / `git status --short` / `ls` output at
  `637965c`, 28.07.26.
- `.stignore` contents quoted verbatim; `c4e2871` confirmed as the commit that added the block.
- Companion module repo state confirmed directly (`git status --short` → `?? README.md`).
- Nothing changed: no `git rm`, no `.gitignore` edit, no commit. The whole point of this WO is
  that the choice is the owner's.
