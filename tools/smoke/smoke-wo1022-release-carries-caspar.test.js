'use strict'

/**
 * WO-1022 — server releases carry the hand-built Caspar (owner 09.11) and point at its complete source (the project is
 * fully open source). Pins: the pin file, the publish script's guards, CI fetching + verifying the asset before the
 * tarball, the tarball members, the drop-apply hook, the sweep check, and the licence notes.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const HEX64 = /^[0-9a-f]{64}$/

test('caspar/PINNED.json: binary, asset, CEF and the public source, one key per line for the shell', () => {
	const text = read('caspar/PINNED.json')
	const p = JSON.parse(text)
	assert.match(p.sha, /^[0-9a-f]{40}$/)
	assert.equal(p.shortSha, p.sha.slice(0, 9))
	assert.ok(p.version.includes(` ${p.shortSha} `), 'VERSION line carries the sha')
	for (const k of ['binarySha256', 'assetSha256', 'libcefSha256']) assert.match(p[k], HEX64, k)
	assert.ok(p.libcefSha256.startsWith('fa0993fab321ee4e'), 'the owner no-root CEF 142 (WO-234)')
	assert.equal(p.releaseTag, `caspar-${p.shortSha}`)
	assert.equal(p.asset, `casparcg-${p.shortSha}-linux-x64.tar.zst`)
	assert.equal(p.tarballPath, 'caspar/bin/casparcg')
	assert.equal(p.source.commit, p.sha)
	assert.equal(p.source.base, 'v2.5.1-stable')
	assert.equal(p.source.repo, 'https://github.com/mko1989/casparcg-server')
	assert.equal(p.source.tag, `highascg-${p.shortSha}`)
	assert.equal(p.source.treeUrl, `${p.source.repo}/tree/${p.source.tag}`)
	assert.equal(p.source.sourceAsset, `casparcg-source-${p.shortSha}.tar.gz`)
	// highascg-caspar-swap.sh reads top-level strings with sed: each on its own line
	for (const k of ['shortSha', 'binarySha256', 'libcefSha256', 'version', 'cefVersion'])
		assert.match(text, new RegExp(`^\\t"${k}": "[^"]+",?$`, 'm'), k)
})

test('publish-caspar-build.sh: never runs the binary, checks the fork + tag, reproducible assets, dry run stops before gh', () => {
	const sh = read('tools/release/publish-caspar-build.sh')
	assert.ok(!/"\$BINARY" --version/.test(sh), '`casparcg --version` starts a server when a file of that name exists')
	assert.ok(sh.includes('strings -n 6 "$BINARY" | grep -m1 -E "^[0-9]+\\.[0-9]+\\.[0-9]+ ${SHORT} "'))
	assert.ok(sh.includes("grep 'not found' | grep -v 'libcef\\.so'"))
	assert.ok(sh.includes('ls-remote --heads "$REMOTE" highascg-main'))
	assert.ok(sh.includes('refs/tags/${SRC_TAG}^{}'))
	assert.ok(sh.includes('this script never pushes'))
	assert.ok(!/^\s*(git|gh)\b[^\n]*\bpush\b/m.test(sh), 'no git push is executed (only printed for the lead)')
	assert.ok(sh.includes('--sort=name --mtime="@${COMMIT_TIME}" --owner=0 --group=0 --numeric-owner'))
	assert.ok(sh.includes('git -C "$SRC" archive --format=tar --prefix="casparcg-source-${SHORT}/"'))
	assert.ok(sh.includes('cp "${SRC}/LICENSE" "${STAGE}/LICENSE"'), 'GPL text inside the binary tarball')
	assert.ok(sh.includes('--prerelease'), 'never Latest; prune-auto-releases ignores it (no server tarball)')
	const dry = sh.indexOf('if [[ "$DRY_RUN" -eq 1 ]]; then')
	assert.ok(dry > 0 && dry < sh.indexOf('release_lib_check_gh'), 'the dry run exits before any gh call')
})

test('publish-caspar-build.sh refuses a binary that is not the --src commit (no network, no upload)', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1022-pub-'))
	try {
		const git = (...a) => spawnSync('git', ['-C', tmp, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' })
		git('init', '-q')
		fs.writeFileSync(path.join(tmp, 'LICENSE'), 'GPL\n')
		git('add', '-A')
		git('commit', '-qm', 'init')
		git('tag', 'v0.0.1')
		git('remote', 'add', 'highascg', 'https://example.invalid/casparcg-server.git') // never contacted: the binary check fails first
		const r = spawnSync('bash', [path.join(ROOT, 'tools/release/publish-caspar-build.sh'), '/usr/bin/true', '--src', tmp, '--dry-run', '--out-dir', path.join(tmp, 'out'), '--pin', path.join(tmp, 'PINNED.json')], { encoding: 'utf8' })
		assert.equal(r.status, 1, r.stdout + r.stderr)
		assert.match(r.stderr, /does not embed/)
		assert.ok(!fs.existsSync(path.join(tmp, 'PINNED.json')))
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('CI: the release job fetches + verifies the pinned asset, then packs with --require-caspar', () => {
	const ci = read('.github/workflows/ci.yml')
	const job = ci.slice(ci.indexOf('\n  release:\n'))
	const fetch = job.indexOf('bash tools/release/fetch-pinned-caspar.sh')
	const pack = job.indexOf('bash tools/release/make-github-release-server.sh --no-godot-clients --require-caspar')
	assert.ok(fetch > 0 && pack > fetch)
	for (const other of ['\n  verify:', '\n  godot:', '\n  build-client:']) {
		const i = ci.indexOf(other)
		if (i < 0) continue
		const body = ci.slice(i, ci.indexOf('\n  ', i + other.length + 1))
		assert.ok(!body.includes('fetch-pinned-caspar'), `${other.trim()} must not depend on the Caspar asset`)
	}
	const f = read('tools/release/fetch-pinned-caspar.sh')
	assert.ok(f.includes('[[ "$GOT" == "$ASSET_SHA" ]] || die'))
	assert.ok(f.includes('[[ "$GOT" == "$BIN_SHA" ]] || die'))
	const m = read('tools/release/make-github-release-server.sh')
	assert.ok(m.includes('_p+=(caspar/PINNED.json caspar/README.md caspar/patches caspar/bin)'))
	assert.ok(m.includes('is not the pinned ${want}'))
	assert.ok(m.includes('${CASPAR_NOTE}'), 'the server release notes say where the Caspar source is')
})

test('fetch-pinned-caspar.sh: a tampered asset fails', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1022-fetch-'))
	try {
		fs.writeFileSync(path.join(tmp, 'bad.tar.zst'), 'not the asset')
		const r = spawnSync('bash', [path.join(ROOT, 'tools/release/fetch-pinned-caspar.sh'), '--from', path.join(tmp, 'bad.tar.zst'), '--dest', path.join(tmp, 'bin')], { encoding: 'utf8' })
		assert.equal(r.status, 1)
		assert.match(r.stderr, /sha256 .* ≠ pinned/)
		assert.ok(!fs.existsSync(path.join(tmp, 'bin/casparcg')))
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})

test('the drop apply hands the swap to the helper that came with the drop; it never fails the update', () => {
	const a = read('scripts/exfat/highascg-apply-server-drop.sh')
	assert.ok(a.includes('local caspar_swap="${HIGHASCG_CASPAR_SWAP_SH:-${dest}/scripts/exfat/highascg-caspar-swap.sh}"'))
	assert.ok(a.includes('bash "$caspar_swap" apply --root "$dest" --user "$user_name" --verify detach ||'))
	const s = read('scripts/exfat/highascg-caspar-swap.sh')
	assert.ok(s.includes('http://127.0.0.1:${PORT}/api/state'), 'VERSION through node')
	assert.ok(!/5250/.test(s.replace(/^#.*$/gm, '')), 'never a socket to Caspar :5250 (WO-990)')
	assert.ok(s.includes('mv -f "${BIN}.new" "$BIN"'))
	assert.ok(s.includes('.highascg/caspar-hold'))
})

test('sweep caspar.pinned: pass on the pin, warn with the reason otherwise', () => {
	const apps = require(path.join(ROOT, 'tools/sweep/checks-app.js'))
	assert.ok(apps.some((c) => c.id === 'caspar.pinned'))
	const { pinnedStatus } = require(path.join(ROOT, 'tools/sweep/check-caspar-pinned.js'))
	const pin = { shortSha: '5c3373ec5', version: '2.5.1 5c3373ec5 Stable' }
	const on = (v) => ({ connected: true, versionLine: v })
	assert.equal(pinnedStatus({ pin, caspar: on('2.5.1 5c3373ec5 Stable') }).status, 'pass')
	assert.equal(pinnedStatus({ pin: null, caspar: on('x') }).status, 'skip')
	assert.equal(pinnedStatus({ pin, caspar: { connected: false } }).status, 'skip')
	const held = pinnedStatus({ pin, caspar: on('2.5.1 2476644c4 Stable'), held: true })
	assert.equal(held.status, 'warn')
	assert.match(held.summary, /caspar-hold/)
	const rb = pinnedStatus({ pin, caspar: on('2.5.1 2476644c4 Stable'), swap: { result: 'rolled-back', reason: 'never reported' } })
	assert.match(rb.summary, /rolled-back: never reported/)
	assert.match(pinnedStatus({ pin, caspar: on('2.5.1 2476644c4 Stable') }).summary, /next update installs it/)
})

test('licences: THIRD_PARTY_NOTICES names CasparCG (GPL-3), CEF (BSD) and the GPL FFmpeg it loads', () => {
	const n = read('THIRD_PARTY_NOTICES')
	assert.match(n, /CasparCG Server[^\n]*https:\/\/github\.com\/mko1989\/casparcg-server/)
	assert.match(n, /GNU General Public License v3\.0 or later/)
	assert.match(n, /Chromium Embedded Framework[\s\S]{0,400}BSD/)
	assert.match(n, /FFmpeg[\s\S]{0,600}--enable-gpl/)
	assert.match(read('caspar/README.md'), /## Source\n[\s\S]{0,800}highascg-<sha9>/)
})
