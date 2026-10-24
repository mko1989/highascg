#!/usr/bin/env bash
# WO-736 — keep the newest KEEP automatic server prereleases (the per-push CI ones: a server tarball, no operator
# client builds) and delete the older ones with their tags. Manual releases (operator clients attached), full
# releases and other assets (Caspar builds, scanner, CEF) are never touched.
#
#   GH_TOKEN=… bash tools/release/prune-auto-releases.sh [KEEP]      (default 10)
set -euo pipefail

KEEP="${1:-10}"
repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}"

mapfile -t auto < <(gh api "repos/${repo}/releases?per_page=100" --jq '
	[.[] | select(.prerelease and (.draft | not))
	     | select(any(.assets[]; .name | test("^highascg-server_.+\\.tar\\.gz$")))
	     | select(all(.assets[]; .name | startswith("highascg-operator_") | not))]
	| sort_by(.created_at) | reverse | .[].tag_name')

echo "automatic server prereleases: ${#auto[@]} (keeping ${KEEP})"
for tag in "${auto[@]:KEEP}"; do
	echo "deleting ${tag}"
	gh release delete "$tag" --repo "$repo" --yes --cleanup-tag
done
