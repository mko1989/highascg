'use strict'

/**
 * WO-261 smoke — stream credentials live in the PROJECT and only there.
 *  - project round-trips credentials (set → preserve on client save → mask on client read)
 *  - stream-time resolution prefers project over config
 *  - one-shot migration moves creds into the project and blanks config, idempotently
 *  - masked API responses (settings-get) carry NO raw key anywhere
 *  - client no longer sends streamKey on start; new route is registered in router.js
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const creds = require('../../src/engine/project-stream-credentials')

const SECRET = 'SUPER_SECRET_KEY_XYZ'
const SC_SECRET = 'SC_SECRET_KEY_123'
const SRT_SECRET = 'SRT_PASSPHRASE_ABCDEFGH' // WO-307

test('withProjectCredential stores per-output creds; empty-keeps semantics', () => {
	let p = { name: 'Show' }
	p = creds.withProjectCredential(p, 'str_1', { rtmpServerUrl: 'rtmp://a/app', streamKey: SECRET })
	assert.equal(creds.readProjectCredential(p, 'str_1').streamKey, SECRET)
	// empty key keeps the stored one
	p = creds.withProjectCredential(p, 'str_1', { rtmpServerUrl: 'rtmp://b/app', streamKey: '' })
	assert.equal(creds.readProjectCredential(p, 'str_1').streamKey, SECRET)
	assert.equal(creds.readProjectCredential(p, 'str_1').rtmpServerUrl, 'rtmp://b/app')
	// explicit clear blanks it
	p = creds.withProjectCredential(p, 'str_1', { clearKey: true })
	assert.equal(creds.readProjectCredential(p, 'str_1').streamKey, '')
})

// WO-307
test('withProjectCredential: srtPassphrase has the same empty-keeps/clear semantics, independent of streamKey', () => {
	let p = { name: 'Show' }
	p = creds.withProjectCredential(p, 'str_2', { srtPassphrase: SRT_SECRET })
	assert.equal(creds.readProjectCredential(p, 'str_2').srtPassphrase, SRT_SECRET)
	assert.equal(creds.projectHasSrtPassphrase(p, 'str_2'), true)
	// empty passphrase keeps the stored one
	p = creds.withProjectCredential(p, 'str_2', { srtPassphrase: '' })
	assert.equal(creds.readProjectCredential(p, 'str_2').srtPassphrase, SRT_SECRET)
	// setting streamKey on the SAME key must not disturb the passphrase
	p = creds.withProjectCredential(p, 'str_2', { streamKey: 'unrelated' })
	assert.equal(creds.readProjectCredential(p, 'str_2').srtPassphrase, SRT_SECRET, 'streamKey write must not clear srtPassphrase')
	// explicit clearPassphrase blanks ONLY the passphrase
	p = creds.withProjectCredential(p, 'str_2', { clearPassphrase: true })
	assert.equal(creds.readProjectCredential(p, 'str_2').srtPassphrase, '')
	assert.equal(creds.readProjectCredential(p, 'str_2').streamKey, 'unrelated', 'clearPassphrase must not clear streamKey')
})

test('preserveProjectCredentials re-applies on-disk creds over a client save', () => {
	const onDisk = { streaming: { credentials: { str_1: { rtmpServerUrl: 'rtmp://a/app', streamKey: SECRET } } } }
	// client sends a project with NO/masked creds
	const clientSave = { name: 'Show', streaming: { credentials: { str_1: { rtmpServerUrl: 'rtmp://a/app', streamKey: '', hasStreamKey: true } } } }
	const merged = creds.preserveProjectCredentials(clientSave, onDisk)
	assert.equal(creds.readProjectCredential(merged, 'str_1').streamKey, SECRET)
	// no on-disk creds → client creds are stripped entirely
	const stripped = creds.preserveProjectCredentials(clientSave, null)
	assert.equal(creds.getCredentialsMap(stripped).str_1, undefined)
})

test('maskProjectStreamCredentials removes raw key, keeps url + hasStreamKey', () => {
	const p = { streaming: { credentials: { str_1: { rtmpServerUrl: 'rtmp://a/app', streamKey: SECRET } } } }
	const masked = creds.maskProjectStreamCredentials(p)
	assert.equal(masked.streaming.credentials.str_1.streamKey, '')
	assert.equal(masked.streaming.credentials.str_1.hasStreamKey, true)
	assert.equal(masked.streaming.credentials.str_1.rtmpServerUrl, 'rtmp://a/app')
	assert.ok(!JSON.stringify(masked).includes(SECRET), 'no raw key in masked JSON')
	// input not mutated
	assert.equal(p.streaming.credentials.str_1.streamKey, SECRET)
})

// WO-307
test('maskProjectStreamCredentials also strips srtPassphrase, keeps hasSrtPassphrase', () => {
	const p = { streaming: { credentials: { str_2: { srtPassphrase: SRT_SECRET } } } }
	const masked = creds.maskProjectStreamCredentials(p)
	assert.equal(masked.streaming.credentials.str_2.srtPassphrase, '')
	assert.equal(masked.streaming.credentials.str_2.hasSrtPassphrase, true)
	assert.ok(!JSON.stringify(masked).includes(SRT_SECRET), 'no raw passphrase in masked JSON')
	assert.equal(p.streaming.credentials.str_2.srtPassphrase, SRT_SECRET, 'input not mutated')
})

test('resolveStreamCredential prefers project over config', () => {
	const config = { streamOutputs: [{ id: 'str_1', rtmpServerUrl: 'rtmp://cfg/app', streamKey: 'CFG_KEY' }] }
	const project = { streaming: { credentials: { str_1: { rtmpServerUrl: 'rtmp://proj/app', streamKey: SECRET } } } }
	const r = creds.resolveStreamCredential(config, project, 'str_1')
	assert.equal(r.streamKey, SECRET)
	assert.equal(r.rtmpServerUrl, 'rtmp://proj/app')
	assert.equal(r.source, 'project')
	// config fallback when project has nothing
	const r2 = creds.resolveStreamCredential(config, {}, 'str_1')
	assert.equal(r2.streamKey, 'CFG_KEY')
	assert.equal(r2.source, 'config')
})

// WO-307
test('resolveStreamCredential: srtPassphrase is PROJECT-ONLY, no config fallback ever', () => {
	const project = { streaming: { credentials: { str_2: { srtPassphrase: SRT_SECRET } } } }
	const r = creds.resolveStreamCredential({}, project, 'str_2')
	assert.equal(r.srtPassphrase, SRT_SECRET)
	// even if something were to put a passphrase-shaped field in config, it must be ignored —
	// readConfigCredential has no srtPassphrase key at all, by construction.
	const configWithBogusField = { streamOutputs: [{ id: 'str_2', srtPassphrase: 'SHOULD_NEVER_BE_READ' }] }
	const r2 = creds.resolveStreamCredential(configWithBogusField, {}, 'str_2')
	assert.equal(r2.srtPassphrase, '', 'no project value and config is not a valid source → empty, never the config field')
})

test('migration moves config creds into project and blanks config, once', () => {
	const config = {
		streamingChannel: { enabled: true, rtmpServerUrl: 'rtmp://sc/app', streamKey: SC_SECRET },
		streamOutputs: [{ id: 'str_1', rtmpServerUrl: 'rtmp://so/app', streamKey: SECRET }],
		deviceGraph: { version: 1, connectors: [{ id: 'str_1', kind: 'stream_out', caspar: { type: 'rtmp', rtmpServerUrl: 'rtmp://so/app', streamKey: SECRET } }] },
	}
	const project = { name: 'Show' }
	const res1 = creds.migrateConfigCredentialsIntoProject(config, project)
	assert.equal(res1.changed, true)
	assert.equal(creds.readProjectCredential(project, 'streamingChannel').streamKey, SC_SECRET)
	assert.equal(creds.readProjectCredential(project, 'str_1').streamKey, SECRET)
	// blanked config slices returned (streamingChannel + streamOutputs + deviceGraph connector)
	assert.equal(res1.streamingChannel.streamKey, '')
	assert.equal(res1.streamOutputs[0].streamKey, '')
	assert.equal(res1.deviceGraph.connectors[0].caspar.streamKey, '')
	assert.equal(res1.deviceGraph.connectors[0].caspar.rtmpServerUrl, '')
	// apply the blanking and run again → no-op (idempotent / one-shot)
	config.streamingChannel = res1.streamingChannel
	config.streamOutputs = res1.streamOutputs
	config.deviceGraph = res1.deviceGraph
	const res2 = creds.migrateConfigCredentialsIntoProject(config, project)
	assert.equal(res2.changed, false)
})

test('settings-get emits streamCredentials with hasStreamKey and NO raw key anywhere', async () => {
	const { handleGet } = require('../../src/api/settings-get')
	const projectStore = require('../../src/engine/project-store')
	const orig = projectStore.loadProjectBySlug
	projectStore.loadProjectBySlug = () => ({
		streaming: {
			credentials: {
				str_1: { rtmpServerUrl: 'rtmp://proj/app', streamKey: SECRET },
				streamingChannel: { rtmpServerUrl: 'rtmp://proj/sc', streamKey: SC_SECRET },
			},
		},
	})
	try {
		const cfg = {
			caspar: { host: '127.0.0.1', port: 5250 },
			server: { httpPort: 3000, bindAddress: '0.0.0.0' },
			osc: { enabled: true, listenPort: 6251, listenAddress: '0.0.0.0', peakHoldMs: 2000, emitIntervalMs: 100, staleTimeoutMs: 5000, wsDeltaBroadcast: true },
			ui: {},
			streaming: { enabled: false, quality: 'medium', fps: 25, resolution: '1080p', maxBitrate: 8000, basePort: 9000, autoRelocateBasePort: false, hardware_accel: '', captureMode: 'udp', ndiNamingMode: 'auto', ndiSourcePattern: 'x', ndiChannelNames: {}, localCaptureDevice: 'auto', x11Display: ':0', drmDevice: '/dev/dri/card0' },
			// config still holds (pre-migration) secrets — must also be masked
			streamingChannel: { enabled: true, rtmpServerUrl: 'rtmp://cfg/sc', streamKey: 'CONFIG_SC_SECRET' },
			streamOutputs: [{ id: 'str_1', label: 'Str1', enabled: true, type: 'rtmp', name: 'Str1', quality: 'medium', rtmpServerUrl: 'rtmp://cfg/app', streamKey: 'CONFIG_STR_SECRET', videoCodec: 'h264', videoBitrateKbps: 4500, encoderPreset: 'veryfast', audioCodec: 'aac', audioBitrateKbps: 128 }],
			composePreview: {}, audioRouting: {}, periodic_sync_interval_sec: 30, periodic_sync_interval_sec_osc: 30, osc_info_supplement_ms: null,
			offline_mode: false, dmx: {}, rtmp: { host: '127.0.0.1', port: 1935 }, companion: {}, screenDestinations: [], deviceGraph: [], gpuPhysicalTopology: [],
			casparServer: { screen_count: 1 }, usbIngest: {}, operatorTools: {}, projectScopedMedia: { enabled: true, location: 'internal' }, screen_count: 1,
			audioOutputs: [], recordOutputs: [], machineProfile: { defaultProjectFps: 25 }, network: { tailscale: { enabled: false } }, security: {},
		}
		const res = await handleGet('/api/settings', { config: cfg, persistence: { get: () => '' } })
		assert.equal(res.status, 200)
		const payload = JSON.parse(res.body)
		const serialized = JSON.stringify(payload)
		for (const leak of [SECRET, SC_SECRET, 'CONFIG_SC_SECRET', 'CONFIG_STR_SECRET']) {
			assert.ok(!serialized.includes(leak), `settings-get payload must not contain raw key ${leak}`)
		}
		assert.equal(payload.streamingChannel.streamKey, '')
		assert.equal(payload.streamOutputs[0].streamKey, '')
		assert.equal(payload.streamOutputs[0].hasStreamKey, true)
		assert.equal(payload.streamCredentials.str_1.hasStreamKey, true)
		assert.equal(payload.streamCredentials.streamingChannel.hasStreamKey, true)
	} finally {
		projectStore.loadProjectBySlug = orig
	}
})

test('maskDeviceGraphConnectorKeys strips connector caspar streamKey', () => {
	const graph = { connectors: [{ id: 'str_1', caspar: { type: 'rtmp', rtmpServerUrl: 'rtmp://a/app', streamKey: SECRET } }] }
	const masked = creds.maskDeviceGraphConnectorKeys(graph)
	assert.equal(masked.connectors[0].caspar.streamKey, '')
	assert.equal(masked.connectors[0].caspar.hasStreamKey, true)
	assert.ok(!JSON.stringify(masked).includes(SECRET))
	assert.equal(graph.connectors[0].caspar.streamKey, SECRET, 'input not mutated')
})

test('new credentials route is registered in router.js', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
	assert.ok(src.includes("'/api/project/streaming-credentials'"), 'router.js registers the credentials route')
})

test('client start-stream action no longer sends streamKey (server-resolved)', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../client/components/device-view-actions.js'), 'utf8')
	const start = src.slice(src.indexOf('export async function startStreamingChannelRtmp'), src.indexOf('export async function stopStreamingChannelRtmp'))
	assert.ok(!/\bstreamKey\b/.test(start), 'startStreamingChannelRtmp must not reference streamKey')
	// WO-307 — same rule for the SRT passphrase: the client must never send one on Start.
	assert.ok(!/passphrase/i.test(start), 'startStreamingChannelRtmp must not reference an SRT passphrase either')
})

// WO-307
test('the SRT start route resolves the passphrase from resolveStreamCredential, not the client body', () => {
	const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-streaming-channel-rtmp.js'), 'utf8')
	const srtBranch = src.slice(src.indexOf("outType === 'srt'"), src.indexOf(': buildStreamingRtmpAddParams('))
	assert.match(srtBranch, /passphrase:\s*resolved\.srtPassphrase/, 'passphrase must come from the resolved (project-first) credential')
	assert.ok(!/passphrase:\s*b\./.test(srtBranch), 'the client request body must never supply a passphrase')
})

test('client-bound payload builders route project emissions through the mask', () => {
	const files = [
		'../../src/api/routes-data-project-handlers.js',
		'../../src/api/routes-data-project-read.js',
		'../../src/api/routes-data-project-sync.js',
	]
	for (const f of files) {
		const src = fs.readFileSync(path.join(__dirname, f), 'utf8')
		assert.ok(src.includes('maskProjectStreamCredentials'), `${f} masks project stream credentials`)
	}
})
