'use strict'

/**
 * WO-1106 iso-release rows (review of WO-1094 … WO-1096):
 *   B65 — the licence collector reads the playout user's home under sudo; WayVR is a required licence row; the build
 *         checks the licence rows against the host BEFORE the produce (verify-iso-redistribution.sh --host);
 *   B66 — the HighAsCG commit in SOURCES.md is checked (on a remote branch? dirty?) and `git describe` is recorded;
 *   B69 — the npm gate judges dev dependencies with --include-dev (the release tarball ships them) and fails a
 *         notice-required package THIRD_PARTY_NOTICES does not name;
 *   B70 — the embed=0 fragment excludes the optional modules too, and the verifier has a needle for them;
 *   B72 — PortAudio's MIT text is in THIRD_PARTY_NOTICES, the collector and the required licence rows;
 *   B73 — an empty `unsquashfs -l` listing fails the person-detection check instead of reading as "absent".
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '../..')
const LIVE_USB = path.join(ROOT, 'tools/eggs/live-usb')
const STACK = path.join(ROOT, 'tools/release/collect-licenses-stack.sh')
const REDIST = path.join(LIVE_USB, 'verify-iso-redistribution.sh')
const DETECT = path.join(LIVE_USB, 'verify-iso-detection-runtime.sh')
const CLI = path.join(ROOT, 'tools/ci/check-npm-licenses.js')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const gen = require(path.join(LIVE_USB, 'generate-eggs-config.js'))
const { compileExcludes, excludedBy } = require(path.join(LIVE_USB, 'exclude-match.js'))
const { checkLockLicenses, missingNotices } = require('../ci/check-npm-licenses')

/** env without git's per-repo variables (node --test may run inside a hook) */
const cleanEnv = (extra = {}) => {
	const env = { ...process.env, ...extra }
	for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k]
	return env
}
const bash = (script, args = [], env = {}) => spawnSync('bash', ['-c', script, 'x', ...args], { encoding: 'utf8', env: cleanEnv(env) })
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `wo1106-${tag}-`))
const touch = (root, rel) => {
	fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
	fs.writeFileSync(path.join(root, rel), '')
}

describe('WO-1106 B65: collector home under sudo, WayVR row, host check before the produce', () => {
	const home = (uid, env) => bash(`source "$1"; collect_licenses_home ${uid}`, [STACK], env).stdout.trim()

	it('as root reads SUDO_USER\'s home, else /home/casparcg; the override still wins', () => {
		const me = os.userInfo()
		assert.equal(home(0, { SUDO_USER: '', HIGHASCG_LICENSES_HOME: '' }), '/home/casparcg')
		assert.equal(home(0, { SUDO_USER: 'root', HIGHASCG_LICENSES_HOME: '' }), '/home/casparcg')
		assert.equal(home(0, { SUDO_USER: me.username, HIGHASCG_LICENSES_HOME: '' }), me.homedir)
		assert.equal(home(1000, { HOME: '/srv/x', HIGHASCG_LICENSES_HOME: '' }), '/srv/x')
		assert.equal(home(0, { SUDO_USER: me.username, HIGHASCG_LICENSES_HOME: '/t/h' }), '/t/h')
		assert.match(read('tools/release/collect-licenses-stack.sh'), /^\thome="\$\(collect_licenses_home\)"$/m)
	})

	it('the ISO verifier requires the WayVR GPL-3 text once the AppImage ships', () => {
		const dir = tmp('wayvr')
		try {
			const listing = path.join(dir, 'l.txt')
			const run = (paths) => {
				fs.writeFileSync(listing, paths.join('\n') + '\n')
				return bash('bad(){ echo "BAD $*"; }; ok(){ echo "OK $*"; }; source "$1"; licence_tree_check "$2"', [REDIST, listing])
			}
			const app = 'home/casparcg/.local/opt/wayvr/WayVR-v26.8.0-x86_64.AppImage'
			assert.match(run([app]).stdout, /BAD licence text missing \(WO-1096\): WayVR GPL-3 text/)
			assert.match(run([app, 'usr/share/doc/highascg/licenses/third-party/GPL-3.0.txt']).stdout, /OK licence present \(WO-1096\): WayVR GPL-3 text/)
			assert.match(run(['etc/x']).stdout, /OK licence \(WO-1096\): WayVR GPL-3 text .*component not on the image/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('--host checks a host tree (exit 1 naming the missing texts, 0 once they are there)', () => {
		const root = tmp('host')
		try {
			for (const p of [
				'home/casparcg/highascg/bin/casparcg',
				'home/casparcg/highascg/lib/libportaudio.so.2',
				'home/casparcg/.local/opt/wayvr/WayVR-v26.8.0-x86_64.AppImage',
				'home/casparcg/companion/main.js',
				'usr/share/doc/highascg/licenses/SOURCES.md',
				'usr/share/doc/highascg/licenses/COMPLIANCE-ISO.md',
				'usr/share/doc/highascg/licenses/third-party/godot-COPYRIGHT.txt',
			])
				touch(root, p)
			const bad = spawnSync('bash', [REDIST, '--host', root], { encoding: 'utf8' })
			assert.equal(bad.status, 1, bad.stdout)
			for (const what of ['CasparCG GPL-3 text next to bin/casparcg', 'WayVR GPL-3 text', 'PortAudio MIT text', 'Companion MIT text']) {
				assert.match(bad.stderr, new RegExp(`licence text missing \\(WO-1096\\): ${what}`), what)
			}
			assert.match(bad.stderr, /host licence check FAILED/)
			for (const p of [
				'home/casparcg/highascg/bin/LICENSE',
				'home/casparcg/highascg/bin/SOURCE.txt',
				'home/casparcg/companion/LICENSE.md',
				'usr/share/doc/highascg/licenses/third-party/casparcg-server-GPL-3.0.txt',
				'usr/share/doc/highascg/licenses/third-party/GPL-3.0.txt',
				'usr/share/doc/highascg/licenses/third-party/portaudio-LICENSE.txt',
			])
				touch(root, p)
			const good = spawnSync('bash', [REDIST, '--host', root], { encoding: 'utf8' })
			assert.equal(good.status, 0, good.stderr)
			assert.match(good.stdout, /host licence check passed/)
		} finally {
			fs.rmSync(root, { recursive: true, force: true })
		}
	})

	it('the build runs the host check after the collector and before the produce', () => {
		const b = read('tools/eggs/live-usb/build-highascg-egg.sh')
		const at = (s) => {
			const i = b.indexOf(s)
			assert.ok(i >= 0, s)
			return i
		}
		const host = at('bash "${HERE}/verify-iso-redistribution.sh" --host /')
		assert.ok(at('collect-third-party-licenses.sh"') < host)
		assert.ok(at('scripts/setup/15-licenses-install.sh"') < host)
		assert.ok(host < at('bash "${HERE}/pre-produce-preflight.sh"'))
		assert.ok(host < at('highascg_eggs_build_iso "${BASENAME}"'))
	})
})

describe('WO-1106 B66: SOURCES.md commit state', () => {
	it('warns when HEAD is on no remote branch or the tree is dirty, and reports describe', () => {
		const repo = tmp('git')
		try {
			const git = (...a) => spawnSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: cleanEnv() })
			git('init', '-q')
			fs.writeFileSync(path.join(repo, 'a.txt'), '1')
			git('add', 'a.txt')
			git('commit', '-q', '-m', 'one')
			const state = () =>
				bash('source "$1"; collect_source_state "$2"; echo "D=$LIC_DESCRIBE R=$LIC_REMOTE N=$LIC_DIRTY"', [STACK, repo])
			let r = state()
			assert.match(r.stderr, /on NO remote branch — push it/)
			assert.doesNotMatch(r.stderr, /DIRTY/)
			assert.match(r.stdout, /D=[0-9a-f]{7,} R= N=0/)
			fs.writeFileSync(path.join(repo, 'a.txt'), '2')
			r = state()
			assert.match(r.stderr, /the tree is DIRTY \(1 tracked files changed\)/)
			assert.match(r.stdout, /D=[0-9a-f]{7,}-dirty /)
			fs.writeFileSync(path.join(repo, 'a.txt'), '1')
			git('update-ref', 'refs/remotes/origin/main', 'HEAD')
			r = state()
			assert.match(r.stdout, /R=origin\/main N=0/)
			assert.doesNotMatch(r.stderr, /WARN/)
			assert.match(r.stderr, /on a remote branch: origin\/main; tree: clean/)
		} finally {
			fs.rmSync(repo, { recursive: true, force: true })
		}
	})

	it('collect_stack_licenses records describe in SOURCES.md and writes the PortAudio text (B72)', () => {
		const dir = tmp('lic')
		try {
			const lic = path.join(dir, 'licenses')
			fs.mkdirSync(path.join(lic, 'third-party'), { recursive: true })
			const r = bash(
				`set -euo pipefail; log(){ :; }; LIC="$1"; TP="$1/third-party"; REPO_ROOT="$2"; GENERATED_AT=2026-11-17T00:00:00Z
				 source "$2/tools/release/collect-licenses-stack.sh"; collect_stack_licenses "$1/extra.tsv"`,
				[lic, ROOT],
				{ HIGHASCG_LICENSES_HOME: path.join(dir, 'home'), HIGHASCG_LICENSES_NEXT_TO_BINARIES: '0' },
			)
			assert.equal(r.status, 0, r.stderr)
			const src = fs.readFileSync(path.join(lic, 'SOURCES.md'), 'utf8')
			assert.match(src, /### HighAsCG build tree\n\n`git describe --always --dirty` when this image was built: `[0-9a-f]{7,}(-dirty)?`/)
			assert.match(r.stderr, /HighAsCG source for SOURCES\.md: commit [0-9a-f]{40}/)
			const pa = fs.readFileSync(path.join(lic, 'third-party/portaudio-LICENSE.txt'), 'utf8')
			assert.match(pa, /Copyright \(c\) 1999-2009 Ross Bencina[\s\S]*Permission is hereby granted, free of charge/)
			assert.match(fs.readFileSync(path.join(lic, 'extra.tsv'), 'utf8'), /^portaudio\t[^\n]*\tMIT\taudio\tthird-party\/portaudio-LICENSE\.txt\t/m)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe('WO-1106 B69: npm gate covers dev dependencies and checks THIRD_PARTY_NOTICES', () => {
	const lock = {
		lockfileVersion: 3,
		packages: {
			'': { name: 'x' },
			'node_modules/plain': { version: '1.0.0', license: 'MIT' },
			'node_modules/mplx': { version: '1.0.0', license: 'MPL-2.0', dev: true },
			'node_modules/mplx-linux-x64': { version: '1.0.0', license: 'MPL-2.0', dev: true, optional: true },
		},
	}

	it('--include-dev judges dev packages; names must appear whole in the notices', () => {
		assert.equal(checkLockLicenses(lock).rows.length, 1, 'production only by default')
		const all = checkLockLicenses(lock, { includeDev: true }).rows
		assert.deepEqual(all.map((r) => r.name).sort(), ['mplx', 'mplx-linux-x64', 'plain'])
		assert.deepEqual(missingNotices(all, 'nothing').map((r) => r.name).sort(), ['mplx', 'mplx-linux-x64'])
		assert.deepEqual(missingNotices(all, 'see mplx-linux-x64 here').map((r) => r.name), ['mplx'], 'a longer name does not name the base package')
		assert.deepEqual(missingNotices(all, 'mplx 1.0.0 and mplx-linux-x64.'), [])
	})

	it('the CLI fails an un-noticed copyleft package and passes once it is named', () => {
		const dir = tmp('npm')
		try {
			const lockFile = path.join(dir, 'package-lock.json')
			fs.writeFileSync(lockFile, JSON.stringify(lock))
			const notices = path.join(dir, 'NOTICES')
			fs.writeFileSync(notices, 'nothing yet\n')
			const run = (...extra) => spawnSync(process.execPath, [CLI, '--lock', lockFile, '--notices', notices, ...extra], { encoding: 'utf8' })
			assert.equal(run().status, 0, 'dev packages are out of scope without the flag')
			const bad = run('--include-dev')
			assert.equal(bad.status, 1)
			assert.match(bad.stderr, /NOT NOTICED: mplx@1\.0\.0 \(MPL-2\.0\)/)
			fs.writeFileSync(notices, 'mplx, mplx-linux-x64 — MPL-2.0\n')
			const good = run('--include-dev')
			assert.equal(good.status, 0, good.stderr)
			assert.match(good.stdout, /OK: 3 packages \(dev included\)/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('the real tree passes with dev dependencies, and the release script uses the flag', () => {
		const r = spawnSync(process.execPath, [CLI, '--include-dev'], { cwd: ROOT, encoding: 'utf8' })
		assert.equal(r.status, 0, r.stderr)
		const notices = read('THIRD_PARTY_NOTICES')
		assert.match(notices, /lightningcss 1\.32\.0[\s\S]*Mozilla Public License 2\.0/)
		assert.match(read('tools/release/make-github-release-server.sh'), /check-npm-licenses\.js" --include-dev/)
	})
})

describe('WO-1106 B70: optional modules are out of every ISO', () => {
	const MODULE_PATHS = [
		'home/casparcg/highascg/modules/rc-game/server/rc-game.js',
		'home/casparcg/.highascg/modules/stage-salad/module.json',
		'home/casparcg/.highascg/modules.json',
	]

	it('both embed modes exclude them (the fragment mirrors the embed-server lines)', () => {
		for (const embedServer of [true, false]) {
			const c = compileExcludes(gen.buildExcludeList({ embedServer }).split('\n'))
			for (const p of MODULE_PATHS) assert.ok(excludedBy(c, p), `embed=${embedServer}: ${p}`)
		}
	})

	it('the verifier needle fires on liveroot paths and leaves look-alikes alone', () => {
		const dir = tmp('needle')
		try {
			const run = (paths) => {
				const listing = path.join(dir, 'listing.txt')
				// `unsquashfs -l` form: squashfs-root/<liveroot path>
				fs.writeFileSync(listing, ['squashfs-root', ...paths.map((p) => `squashfs-root/${p}`)].join('\n') + '\n')
				return bash(
					'bad(){ echo "BAD $*"; }; ok(){ echo "OK $*"; }; source "$1"; fake(){ cat "$2"; }; UNSQ=(fake); SQ="$2"; redistribution_check',
					[REDIST, listing],
				).stdout
			}
			for (const p of MODULE_PATHS) assert.match(run([p]), /BAD not ours to ship \/ host-private \(WO-1096\): optional modules/, p)
			const clean = run([
				'home/casparcg/highascg/node_modules/x/modules/a.js',
				'home/casparcg/highascg/src/modules/a.js',
				'home/casparcg/.highascg/modules-cache.txt',
			])
			assert.match(clean, /OK absent \(WO-1096\): optional modules/)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe('WO-1106 B72: PortAudio notice', () => {
	it('THIRD_PARTY_NOTICES carries the PortAudio MIT text', () => {
		assert.match(read('THIRD_PARTY_NOTICES'), /PortAudio 19\.7\.0[\s\S]*Ross Bencina[\s\S]*Permission is hereby granted, free of charge/)
	})
})

describe('WO-1106 B73: empty listing is not "absent"', () => {
	it('detection_runtime_check fails when unsquashfs lists nothing', () => {
		const r = bash('bad(){ echo "BAD $*"; }; ok(){ echo "OK $*"; }; source "$1"; UNSQ=(false); SQ=/nope.squashfs; detection_runtime_check', [DETECT])
		assert.match(r.stdout, /^BAD person-detection check \(WO-1094\): cannot list \/nope\.squashfs/m)
		assert.doesNotMatch(r.stdout, /^OK /m)
	})

	it('the CLI fails an empty listing and an unreadable squashfs', () => {
		const dir = tmp('detect')
		try {
			const empty = path.join(dir, 'empty.txt')
			fs.writeFileSync(empty, '')
			const r = spawnSync('bash', [DETECT, empty], { encoding: 'utf8' })
			assert.equal(r.status, 1)
			assert.match(r.stderr, /empty listing/)
			const junk = path.join(dir, 'junk.squashfs')
			fs.writeFileSync(junk, 'not a squashfs')
			assert.equal(spawnSync('bash', [DETECT, junk], { encoding: 'utf8' }).status, 1)
			const fine = path.join(dir, 'fine.txt')
			fs.writeFileSync(fine, 'usr/bin/ls\n')
			assert.equal(spawnSync('bash', [DETECT, fine], { encoding: 'utf8' }).status, 0)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
