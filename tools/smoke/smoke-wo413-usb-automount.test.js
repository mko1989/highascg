'use strict'

/**
 * WO-413 smoke — USB auto-mount: plug a drive → mounted without terminal.
 *
 * The watcher polls for unmounted removable filesystem partitions and mounts each
 * via the WO-29 udisks2 path. Pins the state machine (injected deps, no real lsblk):
 * multiple drives mount independently, an ejected drive is NOT remounted until
 * replug, failures back off, the config gate works, and the wiring/source pins.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { startUsbAutoMount } = require('../../src/media/usb-automount')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function makeHarness({ ctx = {}, mountImpl } = {}) {
	const calls = []
	let candidates = []
	let mounted = []
	const stop = startUsbAutoMount(ctx, {
		force: true,
		intervalMs: 10,
		listCandidates: async () => candidates,
		listMounted: async () => mounted,
		mount: async (dev) => {
			calls.push(dev)
			return mountImpl ? mountImpl(dev) : { ok: true, mountpoint: `/media/casparcg/${dev.split('/').pop()}` }
		},
	})
	return {
		calls,
		stop,
		setCandidates: (c) => { candidates = c },
		setMounted: (m) => { mounted = m },
	}
}

test('WO-413: mounts every unmounted removable partition (multiple drives)', async () => {
	const h = makeHarness()
	h.setCandidates([
		{ blockDevice: '/dev/sdb1', label: 'STICK-A', fsType: 'exfat' },
		{ blockDevice: '/dev/sdc1', label: 'STICK-B', fsType: 'vfat' },
	])
	await sleep(50)
	h.stop()
	assert.deepEqual([...h.calls].sort(), ['/dev/sdb1', '/dev/sdc1'], 'both drives mounted')
	assert.equal(h.calls.length, 2, 'each drive mounted exactly once')
})

test('WO-413: broadcasts usb:automounted and skips fs-less partitions', async () => {
	const events = []
	const h = makeHarness({ ctx: { _wsBroadcast: (type, payload) => events.push({ type, payload }) } })
	h.setCandidates([
		{ blockDevice: '/dev/sdb1', label: 'STICK', fsType: 'exfat' },
		{ blockDevice: '/dev/sdb2', label: 'raw', fsType: '' },
	])
	await sleep(50)
	h.stop()
	assert.deepEqual(h.calls, ['/dev/sdb1'], 'unformatted partition never mounted')
	assert.equal(events.length, 1)
	assert.equal(events[0].type, 'usb:automounted')
	assert.equal(events[0].payload.blockDevice, '/dev/sdb1')
	assert.match(String(events[0].payload.mountpoint), /sdb1/)
})

test('WO-413: an ejected drive is NOT remounted until unplug + replug', async () => {
	const h = makeHarness()
	// Plug: candidate → mounted.
	h.setCandidates([{ blockDevice: '/dev/sdb1', label: 'STICK', fsType: 'exfat' }])
	await sleep(40)
	assert.equal(h.calls.length, 1, 'mounted on plug')
	// Mounted: no longer a candidate, still present via listMounted.
	h.setCandidates([])
	h.setMounted([{ device: '/dev/sdb1' }])
	await sleep(40)
	// Eject: unmounted again → candidate again, but device never left → must NOT remount.
	h.setCandidates([{ blockDevice: '/dev/sdb1', label: 'STICK', fsType: 'exfat' }])
	h.setMounted([])
	await sleep(40)
	assert.equal(h.calls.length, 1, 'no remount after eject')
	// Unplug (gone from lsblk entirely), then replug → mounts fresh.
	h.setCandidates([])
	await sleep(40)
	h.setCandidates([{ blockDevice: '/dev/sdb1', label: 'STICK', fsType: 'exfat' }])
	await sleep(40)
	h.stop()
	assert.equal(h.calls.length, 2, 'replug mounts again')
})

test('WO-413: mount failures back off instead of retrying every tick', async () => {
	const h = makeHarness({ mountImpl: () => ({ ok: false, message: 'nope' }) })
	h.setCandidates([{ blockDevice: '/dev/sdb1', label: 'STICK', fsType: 'exfat' }])
	await sleep(60)
	h.stop()
	assert.equal(h.calls.length, 1, 'one attempt, then 30s backoff (not one per 10ms tick)')
})

test('WO-413: config gate — usbIngest.autoMount=false disables mounting, re-read live', async () => {
	const ctx = { config: { usbIngest: { enabled: true, autoMount: false } } }
	const h = makeHarness({ ctx })
	h.setCandidates([{ blockDevice: '/dev/sdb1', label: 'STICK', fsType: 'exfat' }])
	await sleep(40)
	assert.equal(h.calls.length, 0, 'no mount while autoMount=false')
	ctx.config.usbIngest.autoMount = true
	await sleep(40)
	h.stop()
	assert.equal(h.calls.length, 1, 'mounts after the setting flips on (no restart needed)')
})

test('WO-413: wiring + defaults + sanitizer passthrough (source pins)', () => {
	const idx = read('index.js')
	assert.match(idx, /appCtx\._stopUsbAutoMount = startUsbAutoMount\(appCtx/, 'watcher started at boot')

	const shutdown = read('src/bootstrap/shutdown.js')
	assert.match(shutdown, /_stopUsbAutoMount === 'function'\) appCtx\._stopUsbAutoMount\(\)/, 'watcher stopped on shutdown')

	const defaults = read('src/config/defaults-core.js')
	assert.match(defaults, /autoMount: true/, 'autoMount defaults on')

	// The settings sanitizer rebuilds usbIngest field-by-field — it must not eat
	// autoMount (same class of bug as the WO-406 role incident).
	const settingsPost = read('src/api/settings-post.js')
	assert.match(settingsPost, /autoMount: u\.autoMount !== false/, 'sanitizer keeps autoMount')

	// The settings modal rebuilds usbIngest from its controls; with no autoMount control
	// it must carry the stored value forward or every modal save re-enables auto-mount.
	const modalLogic = read('client/components/settings-modal-logic.js')
	assert.match(modalLogic, /autoMount: \(prevAll\.usbIngest \|\| \{\}\)\.autoMount !== false/, 'modal save preserves autoMount')
})
