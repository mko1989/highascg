'use strict'

/**
 * WO-870 Phase 0.2(b) — locally patched penguins-eggs `coa`.
 *
 * The 26.10 disk-space pre-check ignored every exclude line with '*' or '!' and sized
 * excluded same-filesystem directories by their entries only, so the 730 GiB media tree
 * (excluded as home/casparcg/highascg/media/*) was still counted and remaster died with
 * "Not enough space". The fix is an upstream patch built by scripts/eggs/build-patched-coa.sh.
 *
 * These tests pin what makes that build safe to re-run: a pinned upstream commit, the patch
 * applied before the build, and no privileged or destructive command — the owner installs.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = 'scripts/eggs/build-patched-coa.sh'
const PATCH = 'scripts/eggs/patches/wo870-coa-space-estimate-honours-excludes.patch'
const COMMIT = '0b5e7fa0c5ce94a57c11711c0b8ccc4c7b5b8447' // upstream tag v26.10.30
const src = fs.readFileSync(path.join(ROOT, SCRIPT), 'utf8')
const at = (needle) => src.indexOf(needle)

/** Executable lines only: no comments, no printed owner block (cat <<OWNER … OWNER). */
function codeLines(text) {
	const out = []
	let inOwner = false
	for (const line of text.split('\n')) {
		if (inOwner) {
			if (line.trim() === 'OWNER') inOwner = false
			continue
		}
		if (/<<'?OWNER'?\s*$/.test(line)) {
			inOwner = true
			continue
		}
		if (line.trim().startsWith('#')) continue
		out.push(line)
	}
	return out.join('\n')
}
const code = codeLines(src)
const ownerBlock = src.slice(at('<<OWNER'), src.lastIndexOf('OWNER'))

describe('WO-870 patched coa build', () => {
	it('pins the upstream commit and refuses a moved tag', () => {
		assert.match(src, new RegExp(`UPSTREAM_COMMIT="${COMMIT}"`))
		assert.match(src, /UPSTREAM_TAG="v26\.10\.30"/)
		assert.match(src, /UPSTREAM_URL="https:\/\/github\.com\/pieroproietti\/penguins-eggs"/)
		assert.match(code, /HEAD_COMMIT="\$\(git -C "\$SRC" rev-parse HEAD\)"/)
		assert.match(code, /\[\[ "\$HEAD_COMMIT" == "\$UPSTREAM_COMMIT" \]\] \|\| die/)
	})

	it('applies the repo patch after the pinned checkout and before the build', () => {
		assert.match(src, /PATCH="\$\{ROOT\}\/scripts\/eggs\/patches\/wo870-coa-space-estimate-honours-excludes\.patch"/)
		const check = at('git -C "$SRC" apply --check "$PATCH"')
		const apply = at('git -C "$SRC" apply "$PATCH"')
		assert.ok(check > at('rev-parse HEAD'), 'patch is checked after the commit pin')
		assert.ok(apply > check, 'patch is applied after --check')
		assert.ok(at('go test -count=1 ./pkg/planner/') > apply, 'unit tests run on the patched tree')
		assert.ok(at('go build -ldflags') > apply, 'the build uses the patched tree')
	})

	it('the patch is for that commit and replaces the estimate that ignored wildcards', () => {
		const patch = fs.readFileSync(path.join(ROOT, PATCH), 'utf8')
		assert.ok(patch.startsWith(`From ${COMMIT} `), 'patch header names the pinned commit')
		assert.match(patch, /^\+\+\+ b\/coa\/pkg\/planner\/space-check\.go$/m)
		assert.match(patch, /^\+\+\+ b\/coa\/pkg\/planner\/exclude-match\.go$/m)
		assert.match(patch, /^\+\+\+ b\/coa\/pkg\/planner\/space-check_test\.go$/m)
		assert.match(patch, /^-\t\tif strings\.Contains\(line, "\*"\) \|\| strings\.Contains\(line, "!"\) \{$/m)
		assert.match(patch, /FNM_PATHNAME\|FNM_PERIOD\|FNM_EXTMATCH/, 'mksquashfs matching semantics')
	})

	it('versions the build 26.10.30+highascg1 and repacks the hash-checked official deb', () => {
		assert.match(src, /COA_VERSION="v26\.10\.30\+highascg1"/)
		assert.match(src, /DEB_VERSION="26\.10\.30\+highascg1"/)
		assert.match(code, /-X 'coa\/pkg\/cmd\.AppVersion=\$\{COA_VERSION\}'/)
		assert.match(src, /OFFICIAL_SHA256="dc29749e3d0c66876ca38b6018678cce0cfbf2929b7f930a21c4e64bea17d90f"/)
		assert.match(code, /sha256sum -c --quiet - \|\| die/)
		assert.match(code, /fakeroot -- bash/)
		assert.match(code, /install -m 0755 "\$3" "\$2\/usr\/bin\/coa"/)
	})

	it('never runs sudo; the owner gets the install commands printed', () => {
		assert.ok(!/\bsudo\b/.test(code), 'no sudo outside comments and the printed owner block')
		assert.match(code, /\[\[ "\$\(id -u\)" -ne 0 \]\] \|\| die/, 'refuses to run as root')
		assert.match(ownerBlock, /sudo apt install "\.\/\$\(basename "\$DEB"\)"/)
		assert.match(ownerBlock, /sudo apt-mark hold penguins-eggs/)
		assert.match(ownerBlock, /eggs version/)
	})

	it('never runs eggs remaster/destroy/kill, upstream scripts or make', () => {
		assert.ok(!/\b(remaster|destroy|kill)\b/.test(code), 'no destructive eggs verb in executable lines')
		assert.ok(!/\b(eggs|coa)\s+(remaster|destroy|kill)\b/.test(src), 'nor printed for the owner')
		assert.ok(!/\beggs\s+tools\b|\bmake\b|\.\/(?!\$\(basename)\S+\.sh/.test(code), 'go build only')
		const runs = (code.match(/^\s*"\$\{OUT\}\/coa" \w+/gm) || []).map((r) => r.trim())
		assert.deepEqual(runs, ['"${OUT}/coa" version'], 'the fresh binary only runs `version`')
		assert.ok(!/\bmount\b|\bumount\b|\/home\/eggs/.test(code), 'never touches the nest or mounts')
	})
})
