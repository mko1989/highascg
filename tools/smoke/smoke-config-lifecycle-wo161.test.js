'use strict'

/**
 * WO-161 T161.7 — config lifecycle smokes:
 *  - atomic XML write (tmp + rename) never leaves a torn/partial target file
 *  - writeCasparConfigToDisk serializes concurrent writers (promise-chain mutex)
 *  - ConfigManager.save() concurrent calls apply in order
 *  - configVersion stamps on load, migrations gated (run for v0, skipped for v1+),
 *    loud warning when the config is newer than the code
 */

// Never trigger real exFAT pushes from smoke saves on a production box.
process.env.HIGHASCG_EXFAT_SYNC_ON_SAVE = '0'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { atomicWriteFile } = require('../../src/utils/atomic-file-write')
const { ConfigManager, CONFIG_VERSION } = require('../../src/config/config-manager')
const { writeCasparConfigToDisk } = require('../../src/api/routes-caspar-config')

const quietLogger = () => {
	const warns = []
	const infos = []
	return {
		warns,
		infos,
		info(msg) {
			infos.push(String(msg))
		},
		warn(msg) {
			warns.push(String(msg))
		},
		error() {},
	}
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wo161-'))

test('atomicWriteFile replaces content fully and leaves no .tmp residue', async () => {
	const dir = tmpDir()
	const target = path.join(dir, 'casparcg.config')
	fs.writeFileSync(target, '<old/>', 'utf8')
	const next = `<?xml version="1.0"?><configuration>${'x'.repeat(64 * 1024)}</configuration>`
	await atomicWriteFile(target, next)
	assert.equal(fs.readFileSync(target, 'utf8'), next)
	assert.equal(fs.existsSync(`${target}.tmp`), false)
})

test('atomicWriteFile: interrupted write (tmp create fails) leaves old target byte-identical', async () => {
	const dir = tmpDir()
	const target = path.join(dir, 'casparcg.config')
	const oldXml = '<?xml version="1.0"?><configuration><ok/></configuration>'
	fs.writeFileSync(target, oldXml, 'utf8')
	// Read-only dir: the helper cannot create its tmp file, simulating a write
	// that dies before completing. The target must never be opened for writing.
	fs.chmodSync(dir, 0o555)
	try {
		await assert.rejects(
			() => atomicWriteFile(target, '<partial'),
			(e) => e && (e.code === 'EACCES' || e.code === 'EPERM'),
			'error code must surface unchanged so callers keep the EACCES hint',
		)
	} finally {
		fs.chmodSync(dir, 0o755)
	}
	assert.equal(fs.readFileSync(target, 'utf8'), oldXml, 'old config intact after interrupted write')
	assert.equal(fs.existsSync(`${target}.tmp`), false, 'no tmp residue')
})

test('writeCasparConfigToDisk is atomic and serializes concurrent writers in order', async () => {
	const dir = tmpDir()
	const target = path.join(dir, 'casparcg.config')
	const ctx = {
		config: { offline_mode: false, casparServer: { configPath: target } },
		log() {},
	}
	const bigXml = `<?xml version="1.0"?><configuration>${'a'.repeat(2 * 1024 * 1024)}</configuration>`
	const smallXml = '<?xml version="1.0"?><configuration><final/></configuration>'
	const order = []
	// Fire both without awaiting the first — the module-level chain must run them FIFO.
	const p1 = writeCasparConfigToDisk(ctx, { xml: bigXml }).then((r) => {
		order.push('first')
		return r
	})
	const p2 = writeCasparConfigToDisk(ctx, { xml: smallXml }).then((r) => {
		order.push('second')
		return r
	})
	const [r1, r2] = await Promise.all([p1, p2])
	assert.equal(r1.ok, true)
	assert.equal(r2.ok, true)
	assert.deepEqual(order, ['first', 'second'], 'writes complete in call order')
	assert.equal(fs.readFileSync(target, 'utf8'), smallXml, 'last writer wins, no interleaving')
	assert.equal(fs.existsSync(`${target}.tmp`), false, 'no tmp residue')
})

test('ConfigManager.save: concurrent saves apply in order (last call wins, both succeed)', async () => {
	const dir = tmpDir()
	const file = path.join(dir, 'highascg.config.json')
	const cm = new ConfigManager(file, quietLogger())
	cm.load() // bootstraps defaults
	const a = { ...cm.get(), screen_count: 41 }
	const b = { ...cm.get(), screen_count: 42 }
	const results = await Promise.all([
		(async () => cm.save(a, { emitChange: false }))(),
		(async () => cm.save(b, { emitChange: false }))(),
	])
	assert.deepEqual(results, [true, true])
	await ConfigManager._saveChain // chain settles after both saves
	const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
	assert.equal(onDisk.screen_count, 42)
	assert.equal(cm.get().screen_count, 42)
})

test('configVersion: fresh bootstrap is born at CONFIG_VERSION', () => {
	const dir = tmpDir()
	const file = path.join(dir, 'highascg.config.json')
	const cm = new ConfigManager(file, quietLogger())
	cm.load()
	assert.equal(cm.get().configVersion, CONFIG_VERSION)
	const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
	assert.equal(onDisk.configVersion, CONFIG_VERSION)
})

test('configVersion: v0 config runs migrations once, then stamps and persists on save', () => {
	const dir = tmpDir()
	const file = path.join(dir, 'highascg.config.json')
	fs.writeFileSync(
		file,
		JSON.stringify({
			mediaMount: { uuid: 'dead-beef' },
			ui: { nuclearPassword: 'hunter2' },
		}),
		'utf8',
	)
	const log = quietLogger()
	const cm = new ConfigManager(file, log)
	cm.load()
	// migrations ran (v0):
	assert.equal(cm.get().mediaMount, undefined, 'legacy mediaMount stripped')
	assert.equal(String(cm.get().ui.nuclearPassword || ''), '', 'plaintext nuclear password migrated')
	assert.ok(String(cm.get().ui.nuclearPasswordHash || '').length > 0, 'hash present')
	// stamped in memory, persisted by the migration save:
	assert.equal(cm.get().configVersion, CONFIG_VERSION)
	const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
	assert.equal(onDisk.configVersion, CONFIG_VERSION, 'version persisted with the migration save')

	// second load: migrations must be skipped (version gate)
	const cm2 = new ConfigManager(file, quietLogger())
	const cfg2 = cm2.load()
	assert.equal(cfg2.configVersion, CONFIG_VERSION)
})

test('configVersion: v>=1 config skips retired migrations', () => {
	const dir = tmpDir()
	const file = path.join(dir, 'highascg.config.json')
	fs.writeFileSync(
		file,
		JSON.stringify({
			configVersion: 1,
			mediaMount: { uuid: 'kept-because-versioned' },
		}),
		'utf8',
	)
	const cm = new ConfigManager(file, quietLogger())
	cm.load()
	assert.deepEqual(cm.get().mediaMount, { uuid: 'kept-because-versioned' }, 'v1 load does not run the v0 strip')
	assert.equal(cm.get().configVersion, 1)
})

test('configVersion: newer-than-code config warns loudly and is not downgraded', () => {
	const dir = tmpDir()
	const file = path.join(dir, 'highascg.config.json')
	fs.writeFileSync(file, JSON.stringify({ configVersion: CONFIG_VERSION + 1 }), 'utf8')
	const log = quietLogger()
	const cm = new ConfigManager(file, log)
	cm.load()
	assert.ok(
		log.warns.some((w) => w.includes('CONFIG IS NEWER THAN THIS BUILD')),
		`expected loud warning, got: ${JSON.stringify(log.warns)}`,
	)
	assert.equal(cm.get().configVersion, CONFIG_VERSION + 1, 'newer version preserved, not downgraded')
})

test('configVersion: modular directory config stamps into general.json', () => {
	const dir = tmpDir()
	fs.writeFileSync(path.join(dir, 'general.json'), JSON.stringify({ screen_count: 2 }), 'utf8')
	const cm = new ConfigManager(dir, quietLogger())
	cm.load()
	assert.equal(cm.get().configVersion, CONFIG_VERSION)
	cm.save(cm.get(), { emitChange: false })
	const general = JSON.parse(fs.readFileSync(path.join(dir, 'general.json'), 'utf8'))
	assert.equal(general.configVersion, CONFIG_VERSION, 'version persisted in general.json')
	// reload skips migrations and keeps the stamp
	const cm2 = new ConfigManager(dir, quietLogger())
	assert.equal(cm2.load().configVersion, CONFIG_VERSION)
})
