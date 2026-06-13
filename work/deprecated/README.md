# Deprecated

Legacy monolith releases, dev deploy helpers, and unused smoke/utilities. Kept for reference; do not use for new workflows.

| Path | Was used for |
|------|----------------|
| [`tools/release/make-dev-github-release.sh`](tools/release/make-dev-github-release.sh) | Monolith GitHub release + ISO (use `release:github-server` + client release) |
| [`scripts/live-sync.sh`](scripts/live-sync.sh), [`scripts/deploy-tar-to-tmp.sh`](scripts/deploy-tar-to-tmp.sh) | Old deploy paths |
| [`tools/boot-orchestrator.js`](tools/boot-orchestrator.js), [`tools/sequence-tester.js`](tools/sequence-tester.js) | Superseded dev utilities |

Active eggs build: [`../tools/eggs/`](../tools/eggs/). Active client ops: [`../client/tools/`](../client/tools/).
