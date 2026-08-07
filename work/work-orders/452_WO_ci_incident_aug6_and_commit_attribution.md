# WO-452 — Aug 6 Actions red burst (GitHub incident) + commits attributed to a stranger

**Status: IN PROGRESS (2026-08-07 — fixes landed, CI green on this push pending)**

## Investigation FIRST

### Commits flagged as "shimonenator"

`.git/config` carried `user.name = Antigravity`, `user.email = antigravity@google.com` —
written by Google's Antigravity IDE, not by the owner. GitHub attributes commits by author
email, and `antigravity@google.com` resolves to the unrelated account "shimonenator". Every
commit authored on this box since that config landed (through `2f737dc`, WO-450 round 5) shows
that identity as both author and committer. Global git config had no identity set, so the
repo-local value was the only source.

### "Actions fail at every push"

Not true historically and not a code problem. Run history: Pages and CI solid green through
Aug 4–5 and the morning of Aug 6. All failures fall in one window, **Aug 6 ~11:30–17:00 UTC —
a GitHub-side incident**, with two distinct signatures:

- **Pages deploy timeouts** (12:30, 13:58, 14:12 runs): `build` succeeded, `deploy` polled
  `deployment_in_progress` for 10 minutes then `Timeout reached, aborting!`
  (actions/deploy-pages default timeout). Artifact size is ~29 MB — not a size problem.
  CI passed at the same timestamps, ruling out repo breakage.
- **Runner starvation** (16:13, 16:44, 17:03 runs): `Service Unavailable`, `Failed to resolve
  action download info`, `The job was not acquired by Runner of type hosted even after
  multiple attempts`. Head-commit CI run 31121973364 sat **queued 15+ h with zero jobs** and
  is wedged GitHub-side: both `gh run cancel`/`rerun` and the `force-cancel` API 409 with
  "Cannot cancel a workflow re-run that has not yet queued".

Consequence of the zombie: `ci.yml` had no `workflow_dispatch` trigger, so there was **no way
to run CI on a commit whose push run is wedged** — WO-450 rounds 3–5 shipped with zero CI
verification.

## What was done

- `.git/config`: identity set to `mko1989 <mkoqaz13@gmail.com>` (repo-local; global left
  unset). History NOT rewritten — old commits keep the wrong attribution; a rewrite would
  force-push and fight the Syncthing peers.
- Reran the head-commit Pages run (`gh run rerun 31121973393 --failed`).
- `.github/workflows/ci.yml`: added `workflow_dispatch` trigger so CI can be launched
  manually when a push run is lost to an incident. Prettier's CI scope
  (`tools/ci eslint.config.js .prettierrc.json`) does not cover `.github/`, so no format gate
  is affected.

## What was VERIFIED to work

- Pages rerun **31121973393 completed success in 1m30s** (2026-08-07 ~08:15 UTC) — same
  artifact that timed out during the incident deploys instantly now; site live for `2f737dc`.
- New identity confirmed via `git config user.name/user.email`; the commit landing this WO is
  the attribution proof (must show as mko1989 on GitHub).
- PENDING → DONE gate: the push of this commit must produce a green CI run (that run is also
  the first CI verification of WO-450 rounds 3–5 code). Zombie run 31121973364 is left for
  GitHub to garbage-collect; it cannot be acted on.
