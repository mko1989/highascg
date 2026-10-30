'use strict'

/**
 * WO-830c — secrets and UI items from the 29.10 sweep (REPORT §2b items 16-22, 24): nuclear-password set action,
 * redaction echo guard, open redirect, malformed cookie, support-bundle redaction, SRT passphrase refusal, config log
 * redaction, release dirty-tree guard. Every test runs on mocks / temp dirs, never on live state.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')

// --- 16 + 17 (client) -------------------------------------------------------------------------------------------------

test('16: new nuclear password needs a matching repeat; the settings payload never carries the typed value', () => {
	const { validateNewNuclearPassword: v } = require('../../client/lib/settings-nuclear-shared.js')
	assert.equal(v('', ''), 'Type the new password first.')
	assert.match(v('hunter2', 'hunter3'), /differ/)
	assert.match(v('hunter2', undefined), /differ/)
	assert.equal(v('hunter2', 'hunter2'), '')

	const logic = read('client/components/settings-modal-logic.js')
	const payload = logic.slice(logic.indexOf('ui: {', logic.indexOf('osc: {')), logic.indexOf('companion: {'))
	assert.ok(!/nuclearPassword/.test(payload), 'buildSettingsPayload must not read #set-nuclear-password into ui.nuclearPassword')
	const modal = read('client/components/settings-modal.js')
	assert.ok(modal.includes("e.target.closest('#set-nuclear-password-fields')) return"), 'the password fields are never autosaved')
	assert.ok(modal.includes("#set-nuclear-newpass-apply"), 'explicit Set password action')
	assert.ok(read('client/components/settings-modal-templates.js').includes('id="set-nuclear-newpass2"'), 'repeat field exists')
})

test('17: stripRedacted drops the GET mask at any depth; settings-state.save and the modal autosave use it', () => {
	const { stripRedacted } = require('../../client/lib/settings-redacted.js')
	const got = stripRedacted({
		ui: { nuclearPassword: '[REDACTED]', nuclearPasswordHash: '[REDACTED]', nuclearRequirePassword: true },
		streamOutputs: [{ id: 'a', passphrase: '[REDACTED]', n: 1 }],
		security: { apiToken: '[REDACTED]' },
	})
	assert.deepEqual(got, { ui: { nuclearRequirePassword: true }, streamOutputs: [{ id: 'a', n: 1 }], security: {} })
	assert.match(read('client/lib/settings-state.js'), /api\.post\('\/api\/settings', stripRedacted\(this\.settings\)\)/)
	assert.match(read('client/components/settings-modal.js'), /api\.post\('\/api\/settings', stripRedacted\(settings\)\)/)
})

test('17: the settings POST never stores the mask or a client-supplied hash, and an omitted password keeps the hash', async () => {
	const { handlePost } = require('../../src/api/settings-post')
	const { hashNuclearPassword, mergeUiNuclearPasswordSettings } = require('../../src/utils/nuclear-password')
	const defaults = require('../../src/config/defaults')
	const mk = (ui) => {
		const cfg = JSON.parse(JSON.stringify(defaults))
		cfg.streaming = cfg.streaming || { enabled: false, quality: 'medium', basePort: 10000 }
		cfg.caspar = cfg.caspar || { host: '127.0.0.1', port: 5250 }
		cfg.ui = { ...cfg.ui, ...ui }
		return cfg
	}
	// The old merge, fed the echoed GET copy on a box with NO stored hash, kept the mask as the hash (the bug).
	const old = mergeUiNuclearPasswordSettings(
		{ nuclearRequirePassword: true, nuclearPassword: '[REDACTED]', nuclearPasswordHash: '[REDACTED]' },
		{ nuclearPasswordHash: '' },
	)
	assert.equal(old.nuclearPasswordHash, '[REDACTED]', 'documents the failure the handler now prevents')

	const noHash = mk({ nuclearRequirePassword: true, nuclearPassword: '', nuclearPasswordHash: '' })
	const post = (cfg, body) => handlePost('/api/settings', JSON.stringify(body), { config: cfg, log() {} })
	let r = await post(noHash, { ui: { nuclearRequirePassword: true, nuclearPassword: '[REDACTED]', nuclearPasswordHash: '[REDACTED]' } })
	assert.equal(r.status, 200)
	assert.notEqual(noHash.ui.nuclearPasswordHash, '[REDACTED]')
	assert.equal(noHash.ui.nuclearPasswordHash, '')

	const hash = hashNuclearPassword('abcdef')
	const withHash = mk({ nuclearRequirePassword: false, nuclearPassword: '', nuclearPasswordHash: hash })
	await post(withHash, { ui: { invertTouchpadScroll: true } })
	assert.equal(withHash.ui.nuclearPasswordHash, hash, 'a POST that says nothing about the password keeps the hash')
	await post(withHash, { ui: { nuclearPasswordHash: 'evil' } })
	assert.equal(withHash.ui.nuclearPasswordHash, hash, 'a client cannot set the hash directly')
	await post(withHash, { ui: { nuclearPassword: 'newpass12' } })
	assert.match(withHash.ui.nuclearPasswordHash, /^scrypt\$/)
	assert.notEqual(withHash.ui.nuclearPasswordHash, hash, 'an explicit new password replaces it')
})

// --- 18 open redirect -------------------------------------------------------------------------------------------------

test('18: safeNext keeps same-origin paths only (raw and percent-decoded)', () => {
	const { safeNext, loginRedirect } = require('../../src/server/login-page')
	for (const bad of ['/%09/evil.example', '/\t/evil.example', '//evil.example', '/\\evil.example', '/%5Cevil.example',
		'/%2F%2Fevil.example', 'https://evil.example', 'javascript:alert(1)', '/%0d%0aLocation:x', '/%E0%A4%A', '']) {
		assert.equal(safeNext(bad), '/', JSON.stringify(bad))
	}
	for (const good of ['/', '/intake', '/audio?x=1&y=2', '/a/b%20c']) assert.equal(safeNext(good), good)
	assert.equal(loginRedirect('/%09/evil.example').headers.Location, '/login?next=%2F')
})

test('18: the served sign-in script applies the same rule before location.replace', () => {
	const { loginPageHtml } = require('../../src/server/login-page')
	const script = loginPageHtml().match(/<script>([\s\S]*)<\/script>/)[1]
	const run = (search) => {
		let target = null
		let onSubmit
		const el = { style: {}, value: 'pw', addEventListener: (_e, f) => { onSubmit = f } }
		const ctx = {
			location: { search, replace: (u) => { target = u } },
			URLSearchParams, decodeURIComponent,
			document: { getElementById: () => el },
			fetch: () => ({ then(f) { f({ ok: true }); return { catch() {} } } }),
		}
		vm.runInNewContext(script, ctx)
		onSubmit({ preventDefault() {} })
		return target
	}
	assert.equal(run('?next=/%09/evil.example'), '/')
	assert.equal(run('?next=//evil.example'), '/')
	assert.equal(run('?next=/%5Cevil.example'), '/')
	assert.equal(run('?next=%2Fintake%3Fa%3D1'), '/intake?a=1')
})

// --- 19 malformed cookie ----------------------------------------------------------------------------------------------

test('19: a malformed %-escape in the cookie is "no token", not a throw', () => {
	const { extractAuthTokenFromRequest } = require('../../src/server/auth')
	const req = (cookie) => ({ url: '/', headers: { cookie } })
	assert.doesNotThrow(() => extractAuthTokenFromRequest(req('highascg_session=%E0%A4%A')))
	assert.equal(extractAuthTokenFromRequest(req('highascg_session=%E0%A4%A')), '')
	assert.equal(extractAuthTokenFromRequest(req('bad=%zz; highascg_session=ab%20c')), 'ab c', 'other cookies still parse')
})

// --- 20 support-bundle redaction --------------------------------------------------------------------------------------

test('20: support redaction covers passphrase, stream key/id, PSK, URLs; keeps flags and public keys', () => {
	const { redactObject, SENSITIVE_KEY_RE } = require('../../src/support/redact-settings')
	assert.ok(SENSITIVE_KEY_RE.test('apiToken') && !SENSITIVE_KEY_RE.test('srtStreamId'), 'base (GET) regex unchanged')
	const { redactStreamUrl } = require('../../src/streaming/stream-secret-redact')
	const cfg = {
		streamOutputs: [{
			id: 'o', url: 'rtmp://a.rtmp.youtube.com/live2/abcd-1234', passphrase: 'hunter2hunter2', streamKey: 'KEY',
			srt: { streamId: 'publish:K' }, hasStreamKey: true, keyframe: 50,
		}],
		wifi: { psk: 'x' },
		note: 'pushed to srt://h:9000?streamid=publish%3AK&passphrase=hunter2hunter2&latency=1',
		peerSshPublicKey: 'ssh-ed25519 AAAA',
	}
	const out = JSON.stringify(redactObject(cfg, { forSupport: true }))
	for (const leak of ['abcd-1234', 'hunter2hunter2', '"KEY"', 'publish', '"x"']) assert.ok(!out.includes(leak), `leaked ${leak}`)
	const plain = JSON.stringify(redactObject(cfg))
	assert.ok(plain.includes('"srt":{"streamId":"publish:K"}') && plain.includes('abcd-1234'), 'the settings GET path (no opts) is unchanged: round-trip fields stay readable')
	assert.ok(out.includes('"hasStreamKey":true') && out.includes('"keyframe":50') && out.includes('ssh-ed25519 AAAA'))
	assert.equal(redactStreamUrl('srt://h:9?streamid=a%3Ab&passphrase=p'), 'srt://h:9?streamid=****&passphrase=****')
	assert.equal(redactStreamUrl('rtmp://a/live2/KEY'), 'rtmp://a/live2/****')
	assert.ok(!redactStreamUrl('rtmp://a/live2/app?key=KEY').includes('KEY'))
})

test('20: buildSupportBundleFiles masks stream secrets in the config JSON', async () => {
	const defaults = JSON.parse(JSON.stringify(require('../../src/config/defaults')))
	defaults.streamOutputs = [{ id: 'o', url: 'rtmp://a.rtmp.youtube.com/live2/KEYSECRET1', passphrase: 'PASSSECRET12', srtStreamId: 'publish:IDSECRET' }]
	const { buildSupportBundleFiles } = require('../../src/support/build-support-bundle')
	const { files, manifest } = await buildSupportBundleFiles(
		{ config: defaults, getChannelCount: () => 1, _casparStatus: { connected: false } },
		{ logLines: 10, casparLines: 5 },
	)
	const cfg = files['config/highascg-redacted.json']
	for (const leak of ['KEYSECRET1', 'PASSSECRET12', 'IDSECRET']) assert.ok(!cfg.includes(leak), `config leaked ${leak}`)
	assert.ok(manifest.redactedKeyPatterns.includes('passphrase'))
})

// --- 21 SRT passphrase ------------------------------------------------------------------------------------------------

test('21: a passphrase libsrt would reject refuses the start with a clear 400 (never an unencrypted stream)', async () => {
	const ff = require('../../src/streaming/streaming-channel-ffmpeg')
	for (const bad of ['short', 'x'.repeat(80)]) {
		assert.throws(() => ff.buildStreamingSrtAddParams('srt://h:9000', 'medium', { passphrase: bad }),
			(e) => e.code === ff.SRT_PASSPHRASE_INVALID && !e.message.includes(bad))
	}
	assert.match(ff.buildSrtOutputUrl('srt://h:9000', { passphrase: 'a-real-passphrase' }), /passphrase=a-real-passphrase&pbkeylen=16/)

	const projectStore = require('../../src/engine/project-store')
	const origLoad = projectStore.loadProjectBySlug
	const { handlePostRtmp } = require('../../src/api/routes-streaming-channel-rtmp')
	const { applyDestinationOutputEdgesToCasparConfig } = require('../../src/api/device-view-apply')
	const config = {
		screenDestinations: { version: 1, destinations: [{ id: 'dst_1', label: 'S1', mainScreenIndex: 0, mode: 'pgm_prv' }] },
		deviceGraph: { version: 1, devices: [], connectors: [
			{ id: 'dst_in_1', kind: 'destination_in', externalRef: 'dst_1' }, { id: 'str_1', kind: 'stream_out', label: 'Str1', caspar: {} }],
		edges: [{ id: 'e1', sourceId: 'dst_in_1', sinkId: 'str_1' }] },
		streamingChannel: { enabled: true, videoSource: 'program_1' },
		streamOutputs: [{ id: 'o1', type: 'srt', srtUrl: 'srt://h:9000' }],
		recordOutputs: [], casparServer: {},
	}
	const store = JSON.parse(JSON.stringify(config))
	const ctx = { config, configManager: { get: () => store, save: (n) => Object.assign(store, n) } }
	applyDestinationOutputEdgesToCasparConfig(ctx, { actions: [], warnings: [] })
	const calls = []
	const logs = []
	ctx.amcp = { raw: (c) => { calls.push(c); return Promise.resolve({ ok: true, data: '' }) } }
	ctx.log = (...a) => logs.push(a.join(' '))
	try {
		projectStore.loadProjectBySlug = () => ({ streaming: { credentials: { o1: { srtPassphrase: 'short' } } } })
		const res = await handlePostRtmp(JSON.stringify({ action: 'start', outputId: 'o1' }), ctx)
		assert.equal(res.status, 400)
		assert.match(JSON.parse(res.body).error, /10-79 characters/)
		assert.equal(calls.length, 0, 'no ADD STREAM went to Caspar')
		assert.ok(!res.body.includes('"short"'), 'the passphrase itself is not echoed')
		projectStore.loadProjectBySlug = () => ({ streaming: { credentials: { o1: { srtPassphrase: 'a-real-passphrase' } } } })
		const ok = await handlePostRtmp(JSON.stringify({ action: 'start', outputId: 'o1' }), ctx)
		assert.equal(ok.status, 200)
		assert.match(calls[0], /passphrase=a-real-passphrase/)
	} finally {
		projectStore.loadProjectBySlug = origLoad
		require('../../src/api/routes-streaming-channel-rtmp').stopStreamingStatusPoll(ctx)
	}
})

// --- 22 config log ----------------------------------------------------------------------------------------------------

test('22: index.js logs the REDACTED config', () => {
	const src = read('index.js')
	const line = src.split('\n').find((l) => l.includes("logger.info('Config: '"))
	assert.ok(line && line.includes('redact-settings') && line.includes('redactObject'), 'Config log goes through redactObject')
	const { redactObject } = require('../../src/support/redact-settings')
	const cfg = { security: { apiToken: 'TOPSECRET' }, ui: { nuclearPasswordHash: 'scrypt$aa$bb' }, streaming: { enabled: true } }
	const text = JSON.stringify(redactObject(cfg, { forSupport: true }))
	assert.ok(!text.includes('TOPSECRET') && !text.includes('scrypt$'))
})

// --- 24 release guard -------------------------------------------------------------------------------------------------

test('24: the release script refuses a dirty tracked tree (temp git repo)', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo830c-rel-'))
	try {
		fs.mkdirSync(path.join(tmp, 'tools/release'), { recursive: true })
		fs.mkdirSync(path.join(tmp, 'scripts/lib'), { recursive: true })
		for (const f of ['make-github-release-server.sh', 'release-lib.sh']) fs.copyFileSync(path.join(ROOT, 'tools/release', f), path.join(tmp, 'tools/release', f))
		fs.copyFileSync(path.join(ROOT, 'scripts/lib/archive-common.sh'), path.join(tmp, 'scripts/lib/archive-common.sh'))
		fs.writeFileSync(path.join(tmp, 'package.json'), '{"version":"1.0.0"}\n')
		const git = (...a) => spawnSync('git', ['-C', tmp, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' })
		git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'init')
		const run = (...a) => spawnSync('bash', [path.join(tmp, 'tools/release/make-github-release-server.sh'), ...a], { encoding: 'utf8', cwd: tmp })

		fs.appendFileSync(path.join(tmp, 'package.json'), ' \n')
		const dirty = run('--no-godot-clients')
		assert.equal(dirty.status, 1)
		assert.match(dirty.stderr, /uncommitted tracked changes - refusing/)
		assert.match(dirty.stderr, /git worktree add/)
		const dry = run('--dry-run', '--no-godot-clients')
		assert.match(dry.stderr, /WARNING: working tree has uncommitted tracked changes/)

		git('checkout', '--', 'package.json')
		const clean = run('--dry-run', '--no-godot-clients')
		assert.ok(!/uncommitted/.test(clean.stderr + clean.stdout), 'a clean tree passes the guard')
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true })
	}
})
