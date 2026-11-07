'use strict'

// Regression contracts for the WO-984 resource fixes.
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

function load(file, deps, globals = {}) {
	const module = { exports: {} }
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../..', file), 'utf8'), {
		module,
		Buffer,
		require: (id) => {
			assert.ok(Object.hasOwn(deps, id), id)
			return deps[id]
		},
		...globals,
	}, { filename: file })
	return module.exports
}

test('regression: rsync deadline escalates to SIGKILL and exit clears timers', async () => {
	const child = new EventEmitter()
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	const signals = []
	child.kill = (signal) => { signals.push(signal); return true }
	const timers = new Set()
	const { runRsync } = load('src/replication/rsync-exec.js', {
		child_process: { spawn: () => child },
	}, {
		process: { env: {} },
		setTimeout: (fn) => {
			const timer = { fn, unref() {} }
			timers.add(timer)
			return timer
		},
		clearTimeout: (timer) => timers.delete(timer),
	})
	const pending = runRsync('/tmp', [], { timeoutMs: 10 })
	for (const timer of [...timers]) timer.fn()
	assert.equal((await pending).timedOut, true)
	assert.deepEqual(signals, ['SIGTERM'])
	assert.equal(timers.size, 1, 'escalation deadline remains')
	for (const timer of [...timers]) timer.fn()
	assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
	assert.equal(child.stdout.listenerCount('data'), 1, 'output capture survives settlement')
	child.stdout.emit('data', { toString: () => assert.fail('settled capture must ignore output') })
	child.emit('close', 0) // no real process was started
	assert.equal(timers.size, 0)
})

test('regression: expired USB browse identities are pruned', async () => {
	let now = 100000
	const api = load('src/api/routes-usb-ingest.js', {
		path: require('node:path'),
		'../config/defaults': {},
		'./response': { JSON_HEADERS: {}, jsonBody: JSON.stringify, parseBody: JSON.parse },
		'../media/usb-drives': {},
		'../media/project-media-root': {},
		'../utils/persistence': {},
	}, { Date: { now: () => now } })
	const ctx = { config: {} }
	for (let i = 0; i < 1000; i++) {
		const response = await api.handle('GET', '/api/usb/browse', {}, '', ctx,
			{ socket: { remoteAddress: `192.0.${Math.floor(i / 256)}.${i % 256}` } })
		assert.equal(response.status, 400) // no drive ID; never touches disk
	}
	now += 60000
	await api.handle('GET', '/api/usb/browse', {}, '', ctx, { socket: { remoteAddress: 'new-client' } })
	assert.equal(ctx._usbBrowseHits.size, 1)
	assert.equal(ctx._usbBrowseHits.has('192.0.0.0'), false)
})

test('regression: test-agent remote EOF immediately rejects once', async () => {
	const socket = new EventEmitter()
	socket.setEncoding = () => {}
	socket.destroy = () => {}
	let deadline
	let cleared = 0
	const remote = load('tools/test-agent/lib/remote.js', { net: { connect: () => socket } }, {
		setTimeout: (fn) => { deadline = fn; return 1 },
		clearTimeout: () => cleared++,
	})
	const pending = remote.send(1234, { cmd: 'ping' }, 100)
	const rejection = assert.rejects(pending, /closed before/)
	socket.emit('end')
	socket.emit('close')
	assert.equal(cleared, 1)
	deadline()
	await rejection
})

test('regression: STOP batch rejection warns and still resolves', async () => {
	let callback
	let commits = 0
	const logs = []
	const calls = []
	const exit = load('src/engine/scene-exit-layers.js', {
		'../caspar/amcp-batch': {},
		'../caspar/amcp-utils': {},
		'../config/routing': {},
		'./look-layer-ranges': { isPgmAudioTrackPhysicalLayerOnChannel: () => false },
		'../state/live-scene-state': {},
		'./program-layer-bank': { normalizeProgramLayerBank: () => 'a' },
		'../state/playback-tracker': {},
		'./caspar-channel-clear': {},
	}, { setTimeout: (fn) => { callback = fn } })
	const pending = exit.runExitLayersStopAndClear({
		batchSendChunked: async (lines) => {
			calls.push(...lines)
			throw new Error('AMCP transport failed')
		},
		mixerCommit: async () => commits++,
	}, 1, [{ layerNumber: 10 }], 50, { duration: 0 }, true, { log: (...args) => logs.push(args) })
	await callback()
	assert.equal(await pending, undefined)
	assert.deepEqual(calls, ['STOP 1-10', 'MIXER 1-10 CLEAR'])
	assert.equal(commits, 0)
	assert.equal(logs.length, 1)
	assert.equal(logs[0][0], 'warn')
	assert.match(logs[0][1], /1-10.*AMCP transport failed/)
	const success = exit.runExitLayersStopAndClear({
		batchSendChunked: async (lines) => calls.push(...lines),
		mixerCommit: async () => commits++,
	}, 1, [{ layerNumber: 10 }], 50, { duration: 0 }, true, { log: (...args) => logs.push(args) })
	await callback()
	await success
	assert.equal(commits, 1)
	assert.equal(logs.length, 1)
})

test('regression: module boot observes async rejection in bootOne and bootAll', async () => {
	const registry = load('src/module-registry.js', {})
	const logs = []
	const failure = Promise.reject(new Error('optional module boot failed'))
	// Observe it here so the reproduction does not itself trigger an unhandled rejection.
	const observed = assert.rejects(failure, /optional module boot failed/)
	registry.register({ name: 'offline-probe', onBoot: () => failure })
	assert.equal(registry.bootOne('offline-probe', { log: (...args) => logs.push(args) }), true)
	await observed
	await new Promise(setImmediate)
	assert.equal(logs.length, 1)
	assert.match(logs[0][1], /optional module boot failed/)
	registry.bootAll({ log: (...args) => logs.push(args) })
	await new Promise(setImmediate)
	assert.equal(logs.length, 2)
	registry.register({ name: 'sync-fail', onBoot: () => { throw new Error('sync failure') } })
	assert.equal(registry.bootOne('sync-fail', {}), false)
	assert.equal(registry.bootOne('missing', {}), false)
})

test('regression: network mode lookup caches synchronous commands', () => {
	const calls = []
	let now = 10000
	const inventory = load('src/system/network-inventory.js', {
		fs: {}, crypto: {}, os: {},
		child_process: { execFileSync: (command, args, options) => {
			calls.push({ command, args, timeout: options.timeout })
			if (args.includes('--active')) return ''
			return args.includes('NAME,DEVICE') ? 'wired:eth0\n' : 'ipv4.method:auto\n'
		} },
		'../config/network-settings': {},
	}, { Date: { now: () => now } })
	assert.equal(inventory.readNmcliMode('eth0').mode, 'dhcp')
	assert.equal(inventory.readNmcliMode('eth0').mode, 'dhcp')
	assert.equal(calls.length, 3)
	now += 5000
	inventory.readNmcliMode('eth0')
	assert.equal(calls.length, 6)
	inventory.invalidateNmcliModeCache()
	inventory.readNmcliMode('eth0')
	assert.equal(calls.length, 9)
	assert.ok(calls.every((call) => call.command === 'nmcli' && call.timeout === 5000))
})

test('rsync bounds output, ignores late chunks, and clears deadlines on normal exit', async () => {
	const child = new EventEmitter()
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	child.kill = () => assert.fail('successful child must not be killed')
	const timers = new Set()
	const { runRsync } = load('src/replication/rsync-exec.js', {
		child_process: { spawn: () => child },
	}, {
		process: { env: {} },
		setTimeout: (fn) => { const t = { fn, unref() {} }; timers.add(t); return t },
		clearTimeout: (t) => timers.delete(t),
	})
	const pending = runRsync('/tmp', [], { timeoutMs: 10 })
	child.stdout.emit('data', Buffer.alloc(1024 * 1024, 'a'))
	child.stderr.emit('data', Buffer.alloc(1024 * 1024, 'b'))
	child.emit('exit', 0)
	assert.equal(timers.size, 1, 'the deadline survives exit: a grandchild can hold the pipes, then close never comes')
	child.emit('close', 0)
	const out = await pending
	assert.equal(out.ok, true)
	assert.equal(Buffer.byteLength(out.stdout), 256 * 1024)
	assert.equal(Buffer.byteLength(out.stderr), 256 * 1024)
	const late = { toString: () => assert.fail('late output must not be decoded') }
	child.stdout.emit('data', late)
	child.stderr.emit('data', late)
	assert.equal(timers.size, 0)
})

test('rsync that exits while a grandchild holds the pipes still settles at the deadline', async () => {
	const child = new EventEmitter()
	child.stdout = new EventEmitter()
	child.stderr = new EventEmitter()
	child.kill = () => true
	const timers = new Set()
	const { runRsync } = load('src/replication/rsync-exec.js', {
		child_process: { spawn: () => child },
	}, {
		process: { env: {} },
		setTimeout: (fn) => { const t = { fn, unref() {} }; timers.add(t); return t },
		clearTimeout: (t) => timers.delete(t),
	})
	const pending = runRsync('/tmp', [], { timeoutMs: 10 })
	child.emit('exit', 0) // no 'close': ssh still holds stdout
	for (const timer of [...timers]) timer.fn()
	assert.equal((await pending).timedOut, true, 'the promise settles instead of hanging')
})

test('network apply/reset invalidate mode cache even on partial helper failure', () => {
	let invalidations = 0
	let fail = false
	const network = { primaryInterface: 'eth0', mode: 'dhcp', static: {} }
	const api = load('src/api/system-hardware-network.js', {
		fs: { existsSync: () => true, mkdirSync() {}, writeFileSync() {} },
		path: require('node:path'),
		child_process: { execFileSync: () => { if (fail) throw new Error('partial apply'); return 'ok' } },
		'./response': { JSON_HEADERS: {}, jsonBody: JSON.stringify, parseBody: JSON.parse },
		'../config/network-settings': {
			normalizeNetworkSettings: () => network, isAllowedEthernetIface: () => true, isValidIpv4: () => true,
		},
		'../system/network-inventory': {
			invalidateNmcliModeCache: () => invalidations++,
			buildNetworkStatus: () => { assert.ok(invalidations > 0); return {} },
		},
		'../system/network-interfaces': { listNetworkInterfaces: () => [] },
	}, { __dirname: path.join(__dirname, '../../src/api') })
	for (const method of ['handleNetworkApplyPost', 'handleNetworkResetPost']) {
		assert.equal(api[method]('{"interface":"eth0"}', { config: {} }).status, 200)
	}
	assert.equal(invalidations, 2)
	fail = true
	for (const method of ['handleNetworkApplyPost', 'handleNetworkResetPost']) {
		assert.equal(api[method]('{"interface":"eth0"}', { config: {} }).status, 500)
	}
	assert.equal(invalidations, 4)
})
