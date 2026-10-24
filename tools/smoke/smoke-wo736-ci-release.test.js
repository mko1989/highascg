'use strict'

/**
 * WO-736 — every push to main that passes CI becomes a server prerelease the second server updates from. Pins the
 * guards: the release job waits for all three CI jobs, runs only for pushes to main, tags the commit it tested, keeps
 * the desktop client exports out, and the prune only ever selects automatic prereleases (no operator builds).
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

test('the release job: after verify + godot + build-client, pushes to main only, the tested commit', () => {
	const ci = read('.github/workflows/ci.yml')
	const job = ci.slice(ci.indexOf('\n  release:\n'))
	assert.ok(job.length > 20, 'release job exists')
	assert.ok(job.includes('needs: [verify, godot, build-client]'))
	assert.ok(job.includes("if: github.event_name == 'push' && github.ref == 'refs/heads/main'"))
	assert.ok(job.includes('RELEASE_TARGET: ${{ github.sha }}'))
	assert.ok(job.includes('contents: write'))
	assert.ok(job.includes('bash tools/release/make-github-release-server.sh --no-godot-clients'))
	assert.ok(job.includes('bash tools/release/prune-auto-releases.sh 10'))
	assert.ok(read('tools/release/release-lib.sh').includes('[[ -n "${RELEASE_TARGET:-}" ]] && kind+=(--target "$RELEASE_TARGET")'))
})

test('the prune selects only automatic server prereleases and keeps the newest', () => {
	const sh = read('tools/release/prune-auto-releases.sh')
	assert.ok(sh.includes('select(.prerelease and (.draft | not))'))
	assert.ok(sh.includes('select(all(.assets[]; .name | startswith("highascg-operator_") | not))'), 'manual releases carry operator builds')
	assert.ok(sh.includes('sort_by(.created_at) | reverse'))
	assert.ok(sh.includes('for tag in "${auto[@]:KEEP}"; do'))
})

test('the tarball carries the kiosk client (WO-735) so an update reaches it', () => {
	const a = read('scripts/lib/archive-common.sh')
	assert.ok(a.includes('\t\tgodot/client\n\t\tgodot/GODOT_VERSION\n'))
	assert.ok(a.includes('--exclude=godot/client/.godot'))
})
