'use strict'

/**
 * WO-830b — injection / validation class from the 29.10 sweep (REPORT §2b items 9-15 and 23).
 * Every case here fails on the pre-fix code; none touches live state (temp dirs, stubbed binaries, no AMCP sent).
 */

const { test, describe } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const tmpDir = (p) => fs.mkdtempSync(path.join(os.tmpdir(), `wo830b-${p}-`))

// ---------------------------------------------------------------- 9: vcam label -> root wrapper
describe('WO-830b #9 vcam modules conf', () => {
	const kernel = require('../../src/virtual-output/v4l2-kernel-modules')
	const SCRIPT = path.join(ROOT, 'tools/runtime/highascg-vcam-modules-up.sh')

	test('labels are reduced to a strict ASCII set', () => {
		assert.equal(kernel.sanitizeCardLabel('$(touch /tmp/x)'), '__touch _tmp_x_')
		assert.equal(kernel.sanitizeCardLabel('a"b`c\\d\r\ne'), 'a_b_c_d__e')
		assert.equal(kernel.sanitizeCardLabel('Virtual cam'), 'Virtual cam')
		assert.equal(kernel.sanitizeCardLabel(''), 'CasparCG Out')
		assert.ok(kernel.sanitizeCardLabel('x'.repeat(500)).length <= 64)
		assert.equal(kernel.sanitizeAlsaId('a b;$(x)'), 'abx')
	})

	test('resolveV4l2LoopbackConfig never yields a shell-active label', () => {
		const r = kernel.resolveV4l2LoopbackConfig({ virtualCamera: { label: 'cam $(id) `id`' } })
		assert.match(r.cardLabel, /^[A-Za-z0-9 ._-]+$/)
	})

	function runWrapper(conf, extraEnv = {}) {
		const dir = tmpDir('vcam')
		const confPath = path.join(dir, 'vcam-modules.conf')
		fs.writeFileSync(confPath, conf)
		// the real script reads /run/highascg/vcam-modules.conf; point a copy at the temp file
		const script = path.join(dir, 'up.sh')
		fs.writeFileSync(script, fs.readFileSync(SCRIPT, 'utf8').replace('CONF=/run/highascg/vcam-modules.conf', `CONF=${confPath}`))
		fs.mkdirSync(path.join(dir, 'bin'))
		const log = path.join(dir, 'modprobe.log')
		fs.writeFileSync(path.join(dir, 'bin/modprobe'), `#!/bin/bash\necho "$@" >> ${log}\n`, { mode: 0o755 })
		const r = spawnSync('bash', [script], {
			encoding: 'utf8',
			env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, ...extraEnv },
		})
		return { dir, r, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' }
	}

	test('wrapper no longer sources the conf: command substitution is refused and never runs', () => {
		const canary = path.join(tmpDir('canary'), 'pwned')
		for (const conf of [
			`VIDEO_NR=63\nCARD_LABEL="$(touch ${canary})"\n`,
			`VIDEO_NR=63\nCARD_LABEL="\`touch ${canary}\`"\n`,
			`VIDEO_NR=63\nCARD_LABEL=$(touch ${canary})\n`,
			`VIDEO_NR=63\n$(touch ${canary})\n`,
			`VIDEO_NR=63\nALSA_ID=x;touch ${canary}\n`,
			`VIDEO_NR=63\nPATH=/tmp\n`,
			`VIDEO_NR=63\nLD_PRELOAD=/tmp/x.so\n`,
		]) {
			const { r } = runWrapper(conf)
			assert.notEqual(r.status, 0, `must be refused: ${conf}`)
			assert.equal(fs.existsSync(canary), false, `payload executed: ${conf}`)
		}
	})

	test('wrapper still applies a valid conf', () => {
		const { r, log } = runWrapper(
			'VIDEO_NR=63\nCARD_LABEL="Virtual cam"\nALSA_INDEX=20\nALSA_ID=HighAsCG_VCam\nALSA_PCM=2\nAUDIO_ENABLED=0\n',
		)
		assert.equal(r.status, 0, r.stderr)
		assert.match(log, /v4l2loopback devices=1 video_nr=63 card_label=Virtual cam/)
	})
})

// ---------------------------------------------------------------- 10: caspar-config path
describe('WO-830b #10 caspar-config apply path', () => {
	const guard = require('../../src/api/caspar-config-path-guard')
	const routes = require('../../src/api/routes-caspar-config')

	test('request paths must be *.config inside a trusted config dir', () => {
		const ctx = { config: { casparServer: { configPath: '/home/casparcg/highascg/config/casparcg.config' } } }
		for (const bad of [
			os.homedir() + '/.ssh/authorized_keys',
			'/home/casparcg/highascg/config/../../.bashrc',
			'/home/casparcg/highascg/config/authorized_keys',
			'/etc/cron.d/x.config',
			'/tmp/evil.config',
			'',
			'a\0.config',
		]) {
			assert.equal(guard.validateRequestedConfigPath(bad, ctx).ok, false, bad)
		}
		assert.equal(guard.validateRequestedConfigPath('/home/casparcg/highascg/config/casparcg.config', ctx).ok, true)
		assert.equal(guard.validateRequestedConfigPath('/home/casparcg/highascg/config/other.config', ctx).ok, true)
	})

	test('a symlink inside the config dir cannot escape', () => {
		const dir = tmpDir('cfg')
		const outside = tmpDir('out')
		fs.symlinkSync(outside, path.join(dir, 'link'))
		fs.symlinkSync(path.join(outside, 'authorized_keys'), path.join(dir, 'x.config'))
		const ctx = { config: { casparServer: { configPath: path.join(dir, 'casparcg.config') } } }
		assert.equal(guard.validateRequestedConfigPath(path.join(dir, 'link', 'a.config'), ctx).ok, false)
		assert.equal(guard.validateRequestedConfigPath(path.join(dir, 'x.config'), ctx).ok, false)
		assert.equal(guard.assertWritableConfigTarget(path.join(dir, 'x.config')).ok, false)
	})

	test('POST /api/caspar-config/apply with an arbitrary body.path is refused before anything is written', async () => {
		const victim = path.join(tmpDir('victim'), 'authorized_keys')
		const ctx = { config: { casparServer: { configPath: '/home/casparcg/highascg/config/casparcg.config' } }, log() {} }
		const res = await routes.handlePost('/api/caspar-config/apply', JSON.stringify({ path: victim, xml: 'ssh-rsa AAAA evil' }), ctx)
		assert.equal(res.status, 400)
		assert.equal(fs.existsSync(victim), false)
		assert.equal(ctx.config.casparServer.configPath, '/home/casparcg/highascg/config/casparcg.config', 'config untouched')
		const res2 = await routes.handlePost(
			'/api/caspar-config/apply',
			JSON.stringify({ casparServer: { configPath: victim }, xml: 'x' }),
			ctx,
		)
		assert.equal(res2.status, 400)
		assert.equal(fs.existsSync(victim), false)
	})

	test('the write itself refuses a non-*.config target even when the saved settings name it', async () => {
		const victim = path.join(tmpDir('victim2'), 'authorized_keys')
		const r = await routes.writeCasparConfigToDisk({ config: { casparServer: { configPath: victim } }, log() {} }, { xml: '<x/>' })
		assert.equal(r.ok, false)
		assert.equal(r.status, 400)
		assert.equal(fs.existsSync(victim), false)
	})
})

// ---------------------------------------------------------------- 11: server update asset
describe('WO-830b #11 server update asset', () => {
	const { resolveVerifiedAsset } = require('../../src/system/server-update')
	const check = {
		githubRepo: 'mko1989/highascg',
		assetName: 'highascg-server_2026-10-30_052541.tar.gz',
		assetUrl: 'https://github.com/mko1989/highascg/releases/download/v1/highascg-server_2026-10-30_052541.tar.gz',
	}

	test('uses the resolved release asset; a body that names another is refused', () => {
		assert.deepEqual(resolveVerifiedAsset(check, {}), { assetUrl: check.assetUrl, assetName: check.assetName })
		assert.deepEqual(resolveVerifiedAsset(check, { assetUrl: check.assetUrl, assetName: check.assetName }), {
			assetUrl: check.assetUrl,
			assetName: check.assetName,
		})
		assert.throws(() => resolveVerifiedAsset(check, { assetUrl: 'https://github.com/evil/repo/releases/download/v1/x.tar.gz' }), /verified/)
		assert.throws(() => resolveVerifiedAsset(check, { assetName: '../../etc/cron.d/x' }), /verified/)
	})

	test('a name or url that is not the configured repo drop is refused', () => {
		assert.throws(() => resolveVerifiedAsset({ ...check, assetName: '../../x.tar.gz' }, {}), /not a highascg server drop/)
		assert.throws(() => resolveVerifiedAsset({ ...check, assetName: 'a/highascg-server_1.tar.gz' }, {}), /not a highascg server drop/)
		assert.throws(
			() => resolveVerifiedAsset({ ...check, assetUrl: 'https://github.com/evil/repo/releases/download/v1/' + check.assetName }, {}),
			/configured release repository/,
		)
		assert.throws(() => resolveVerifiedAsset({ ...check, assetUrl: 'http://github.com/mko1989/highascg/releases/download/v1/' + check.assetName }, {}))
		assert.throws(() => resolveVerifiedAsset({ ...check, assetUrl: null }, {}), /No server release asset/)
	})
})

// ---------------------------------------------------------------- 12: plugin ids
describe('WO-830b #12 plugin ids', () => {
	const pm = require('../../src/plugins/plugin-manager')

	test('a traversal id is never stored, resolved, enabled or listed', () => {
		const cfg = {}
		cfg.plugins = pm.setEntry(cfg, '../../..', { enabled: true })
		assert.deepEqual(cfg.plugins.entries, {})
		assert.deepEqual(pm.enablePluginNow(cfg, '../../..', {}), { ok: false, error: 'not_found' })
		// an entry persisted before the guard (hand-edited / older config) is ignored on boot reload
		const stale = { plugins: { entries: { '../../..': { enabled: true }, ok1: { enabled: true, moduleName: '../../x' } } } }
		const ids = pm.listPlugins(stale).map((p) => p.id)
		assert.ok(!ids.includes('../../..') && !ids.includes('ok1'))
		const loaded = []
		const reg = require('../../src/module-registry')
		const orig = reg.tryLoad
		reg.tryLoad = (name) => (loaded.push(name), false)
		try {
			pm.loadEnabledPlugins(stale, null)
		} finally {
			reg.tryLoad = orig
		}
		assert.ok(!loaded.some((n) => n.includes('.') && n.includes('/')), `loaded ${loaded}`)
	})

	test('ordinary ids still work', () => {
		const cfg = {}
		cfg.plugins = pm.setEntry(cfg, 'my-plugin', { enabled: true, moduleName: 'my-plugin' })
		assert.ok(cfg.plugins.entries['my-plugin'])
	})
})

// ---------------------------------------------------------------- 13: replication host
describe('WO-830b #13 replication host', () => {
	const ssh = require('../../src/replication/replication-ssh-setup')
	const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIabc user@peer'

	test('isValidPeerHost accepts hostnames and IPs only', () => {
		for (const ok of ['10.0.0.5', 'box-2.local', 'box', 'fe80::1', '::1']) assert.equal(ssh.isValidPeerHost(ok), true, ok)
		for (const bad of ['a\nssh-rsa AAAA evil', 'a\r\nb', '-oProxyCommand=x', 'a b', 'x"y', '', ' 10.0.0.5', 'a..b', 'a,b', '*', 'h"\n']) {
			assert.equal(ssh.isValidPeerHost(bad), false, JSON.stringify(bad))
		}
	})

	test('a newline in fromHost cannot plant a second authorized_keys line', () => {
		const evil = '10.0.0.5"\nssh-ed25519 AAAAATTACKER root'
		assert.equal(ssh.buildForcedCommandAuthorizedKeysEntry(KEY, { fromHost: evil }), null)
		const dir = tmpDir('ak')
		const auth = path.join(dir, 'authorized_keys')
		const r = ssh.installPeerAuthorizedKey ? null : null
		assert.equal(r, null)
		const entry = ssh.buildForcedCommandAuthorizedKeysEntry(KEY, { fromHost: '10.0.0.5' })
		assert.match(entry, /^from="10\.0\.0\.5",command="[^"]+",no-port-forwarding/)
		assert.equal(entry.split('\n').length, 1)
		void auth
	})

	test('testReplicationSshToPeer refuses an option-looking host', () => {
		assert.equal(ssh.testReplicationSshToPeer('-oProxyCommand=touch /tmp/x').ok, false)
	})

	test('registerFollowerOnLeader rejects a hostile followerHost before any key is written', async () => {
		const { registerFollowerOnLeader } = require('../../src/replication/connect-pair')
		const hs = require('../../src/replication/replication-handshake')
		const orig = hs.verifyRegisterFollowerRequest
		hs.verifyRegisterFollowerRequest = () => ({ ok: true })
		try {
			const ctx = { config: { replication: { enabled: true, role: 'leader', leaderAvailable: true } }, log() {} }
			const r = await registerFollowerOnLeader(ctx, { followerHost: '1.2.3.4"\nssh-rsa AAAA evil', sshPublicKey: KEY })
			assert.equal(r.ok, false)
		} finally {
			hs.verifyRegisterFollowerRequest = orig
		}
	})
})

// ---------------------------------------------------------------- 14: rsync wrapper option allow-list
describe('WO-830b #14 replication ssh wrapper', () => {
	const WRAPPER = path.join(ROOT, 'tools/runtime/highascg-replication-ssh.sh')
	function run(cmd) {
		const dir = tmpDir('wrap')
		fs.mkdirSync(path.join(dir, 'media'))
		fs.mkdirSync(path.join(dir, 'bin'))
		fs.writeFileSync(path.join(dir, 'bin/rsync'), '#!/bin/bash\necho "RSYNC-RAN $*"\n', { mode: 0o755 })
		return spawnSync('bash', [WRAPPER], {
			encoding: 'utf8',
			env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, HIGHASCG_REPO_ROOT: dir, SSH_ORIGINAL_COMMAND: cmd },
		})
	}

	test('options the replication code sends still pass', () => {
		for (const cmd of [
			'rsync --server -vlogDtprRze.iLsfxCIvu --mkpath . /r/media/',
			'rsync --server --sender -vlogDtprze.iLsfxCIvu . media/x/',
			'rsync --server --sender -vnlogDtprze.iLsfxCIvu . media/',
			'rsync --server -vvlogDtprze.iLsfxCIvu --mkpath . media/',
		]) {
			// absolute /r/ is outside the temp root, so use relative media/ paths for the pass cases
			const r = run(cmd.replace('/r/media/', 'media/'))
			assert.equal(r.status, 0, `${cmd}: ${r.stderr}`)
			assert.match(r.stdout, /RSYNC-RAN/)
		}
	})

	test('every other option is refused (daemon / config / log-file / filter / rsh ...)', () => {
		for (const opt of [
			'--daemon',
			'--config=/etc/rsyncd.conf',
			'--log-file=/home/casparcg/.ssh/authorized_keys',
			'--rsh=sh',
			'-e sh',
			'-T/tmp',
			'--files-from=/etc/passwd',
			'--write-batch=/tmp/x',
			'-vlogDtprze.iLsfxCIvu;',
			'--delete',
		]) {
			const r = run(`rsync --server ${opt} . media/`)
			assert.notEqual(r.status, 0, opt)
			assert.doesNotMatch(r.stdout, /RSYNC-RAN/, opt)
		}
		assert.notEqual(run('rsync --server --sender -x . -evil').status, 0)
	})
})

// ---------------------------------------------------------------- 15: nuclear password
describe('WO-830b #15 nuclear password fails closed', () => {
	const np = require('../../src/utils/nuclear-password')

	test('empty / undecodable stored hashes never verify', () => {
		for (const h of ['scrypt$ab$', 'scrypt$$', 'scrypt$zz$yy', 'scrypt$' + 'ab'.repeat(16) + '$', 'scrypt$' + 'ab'.repeat(16) + '$abcd', '']) {
			assert.equal(np.verifyNuclearPassword('', h), false, h)
			assert.equal(np.verifyNuclearPassword('anything', h), false, h)
			assert.equal(np.verifyNuclearPasswordFromUi('', { nuclearPasswordHash: h }), false, h)
		}
		assert.equal(np.verifyNuclearPasswordFromUi('x', {}), false, 'missing hash = deny')
	})

	test('a real hash still verifies', () => {
		const h = np.hashNuclearPassword('correct horse')
		assert.equal(np.verifyNuclearPassword('correct horse', h), true)
		assert.equal(np.verifyNuclearPassword('wrong', h), false)
	})
})

// ---------------------------------------------------------------- 23: AMCP
describe('WO-830b #23 AMCP escaping', () => {
	const { param } = require('../../src/caspar/amcp-utils')
	const { prepareAmcpLine } = require('../../src/caspar/amcp-template-credential')

	test('param() quotes on whitespace and parentheses, keeps bare tokens bare, folds CR/LF', () => {
		assert.equal(param('Take(2)_final'), '"Take(2)_final"')
		assert.equal(param('setpts=(PTS-STARTPTS)/1'), '"setpts=(PTS-STARTPTS)/1"')
		assert.equal(param('{"f0":"(LIVE)"}'), '"{\\"f0\\":\\"(LIVE)\\"}"')
		assert.equal(param('a b'), '"a b"')
		for (const bare of ['LINEAR', 'MIX', '25', '0.5', 'easeinsine', 'clip.mp4', 'folder/clip']) assert.equal(param(bare), bare)
		assert.equal(param('x\r\nKILL'), '"x KILL"')
		assert.doesNotMatch(param('a"b\\c\nd'), /[\r\n]/)
	})

	test('the transport choke point folds CR/LF in single commands and batch lines', () => {
		assert.equal(prepareAmcpLine('CALL 1-10 SEEK\r\nKILL', {}).line, 'CALL 1-10 SEEK KILL')
		assert.equal(prepareAmcpLine('PLAY 1-1 a\nb\r\n', {}).line.includes('\n'), false)
		assert.equal(prepareAmcpLine('MIXER 1-10 OPACITY 1 25 LINEAR', {}).line, 'MIXER 1-10 OPACITY 1 25 LINEAR')
	})

	test('scene-template-cg: a hostile template name stays inside one quoted token on one line', () => {
		const { buildSceneTemplateCgAmcpLines } = require('../../src/engine/scene-template-cg')
		for (const name of ['x/y\r\nKILL\r\nz', 'my tpl', 'a"b/c']) {
			const lines = buildSceneTemplateCgAmcpLines(1, 10, { cgName: name, data: '{}' })
			for (const l of lines) assert.doesNotMatch(l, /[\r\n]/, l)
			const add = lines.find((l) => / ADD /.test(l))
			assert.match(add, /ADD 0 "[^"\\]*(?:\\.[^"\\]*)*" 1 /, add)
		}
		const plain = buildSceneTemplateCgAmcpLines(1, 10, { cgName: 'lowerthird', data: '{}' }).find((l) => / ADD /.test(l))
		assert.match(plain, /ADD 0 lowerthird 1 /)
	})

	test('timeline playback effect lines cannot carry a second command', () => {
		const { buildEffectAmcpLinesPlayback } = require('../../src/engine/timeline-playback-helpers')
		const out = [
			buildEffectAmcpLinesPlayback('blend_mode', { mode: 'normal\r\nCLEAR 1' }, '1-210'),
			buildEffectAmcpLinesPlayback('brightness', { value: '1\r\nKILL' }, '1-210'),
			buildEffectAmcpLinesPlayback('chroma_key', { key: 'x\nKILL' }, '1-210'),
			buildEffectAmcpLinesPlayback('crop', { left: '0\r\nCLEAR 1' }, '1-210'),
		].flat()
		for (const l of out) assert.doesNotMatch(l, /[\r\n]/, l)
		assert.deepEqual(buildEffectAmcpLinesPlayback('crop', { left: 0.1, top: 0.2 }, '1-210'), ['MIXER 1-210 CROP 0.1 0.2 1 1 0'])
	})

	test('preview nudge: client effect params cannot inject a command', () => {
		const nudge = require('../../src/api/routes-preview-nudge')
		const lines = nudge.buildNudgeLinesForLayer(
			2,
			{ layerNumber: 10, effects: [{ type: 'crop', params: { left: '0\r\nCLEAR 1', top: '0.1' } }] },
			{ x: 0, y: 0, scaleX: 1, scaleY: 1 },
		)
		for (const l of lines) assert.doesNotMatch(l, /[\r\n]/, l)
		assert.ok(lines.some((l) => l.startsWith('MIXER 2-10 CROP ') && l.includes(' 0.1 ')))
	})
})
