'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const os = require('os')
const {
	handleRealignPairToken,
	handleApplyPairToken,
	savePeerToken,
} = require('../../src/replication/replication-pair-token')
const { normalizeReplicationConfig } = require('../../src/config/replication-config')

function makeCtx(repl, role = 'leader') {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repl-token-'))
	const cfgPath = path.join(dir, 'replication.json')
	const replication = normalizeReplicationConfig(repl)
	const config = { replication }
	const configManager = {
		get: () => ({ replication: normalizeReplicationConfig(config.replication) }),
		save: (next) => {
			config.replication = normalizeReplicationConfig(next.replication)
			fs.writeFileSync(cfgPath, JSON.stringify(config.replication))
			return true
		},
	}
	const runtime = {
		roleState: { getRole: () => role },
	}
	const ctx = {
		config,
		configManager,
		log: () => {},
		_replication: runtime,
	}
	return { ctx, dir, runtime }
}

test('handleRealignPairToken returns leader token for matching pairId', () => {
	const { ctx, dir } = makeCtx(
		{
			enabled: true,
			role: 'leader',
			leaderAvailable: true,
			pairId: 'pair-1',
			peer: { host: '192.168.0.28', port: 4200, token: 'secret-token' },
		},
		'leader',
	)
	const out = handleRealignPairToken(ctx, { pairId: 'pair-1' }, { socket: { remoteAddress: '192.168.0.28' } })
	assert.equal(out.ok, true)
	assert.equal(out.token, 'secret-token')
	fs.rmSync(dir, { recursive: true, force: true })
})

test('handleApplyPairToken saves token on follower', () => {
	const { ctx, dir } = makeCtx(
		{
			enabled: true,
			role: 'follower',
			pairId: 'pair-1',
			peer: { host: '192.168.0.20', port: 4200, token: 'old-token' },
		},
		'follower',
	)
	const out = handleApplyPairToken(ctx, { pairId: 'pair-1', token: 'new-token' }, null)
	assert.equal(out.ok, true)
	assert.equal(out.updated, true)
	assert.equal(ctx.config.replication.peer.token, 'new-token')
	fs.rmSync(dir, { recursive: true, force: true })
})

test('savePeerToken persists without breaking enabled flag', () => {
	const { ctx, dir } = makeCtx(
		{
			enabled: true,
			role: 'follower',
			pairId: 'pair-1',
			peer: { host: '192.168.0.20', port: 4200, token: 'a' },
		},
		'follower',
	)
	assert.equal(savePeerToken(ctx, 'b'), true)
	assert.equal(ctx.config.replication.peer.token, 'b')
	assert.equal(ctx.config.replication.enabled, true)
	fs.rmSync(dir, { recursive: true, force: true })
})

test('exfat-sync map excludes replication.json on usb-modular-config', () => {
	const { validateMap } = require('../../src/system/exfat-sync-map')
	const raw = JSON.parse(
		fs.readFileSync(path.join(__dirname, '../../config/exfat-sync.json'), 'utf8'),
	)
	const map = validateMap(raw)
	const pair = map.pairs.find((p) => p.id === 'usb-modular-config')
	assert.ok(pair)
	assert.ok(pair.exclude.includes('replication.json'))
	assert.ok(pair.exclude.includes('replication-local-identity.json'))
})
