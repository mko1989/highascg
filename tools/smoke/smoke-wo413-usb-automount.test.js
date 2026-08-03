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

function makeHarness({ ctx = {}, mountImpl, inhibitFile } = {}) {
	const calls = []
	let candidates = []
	let mounted = []
	const stop = startUsbAutoMount(ctx, {
		force: true,
		intervalMs: 10,
		// Default to a path that never exists so a real flash run on the dev box
		// (which touches /run/highascg/usb-automount-inhibit) can't fail the suite.
		inhibitFile: inhibitFile ?? '/nonexistent/wo416-test-inhibit',
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

test('WO-416: inhibit file blocks mounting while present, resumes when removed', async () => {
	const os = require('node:os')
	const inhibit = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo416-')), 'usb-automount-inhibit')
	fs.writeFileSync(inhibit, '')
	const h = makeHarness({ inhibitFile: inhibit })
	h.setCandidates([{ blockDevice: '/dev/sdb1', label: 'STICK', fsType: 'exfat' }])
	await sleep(40)
	assert.equal(h.calls.length, 0, 'no mount while the flash pipeline holds the inhibit')
	fs.unlinkSync(inhibit)
	await sleep(40)
	h.stop()
	assert.equal(h.calls.length, 1, 'mounts resume after the inhibit file is removed')
})

test('WO-416: flash pipeline sets/clears the inhibit the poller watches (source pins)', () => {
	const INHIBIT = '/run/highascg/usb-automount-inhibit'

	// Poller side: the gate checks the exact path the shell scripts touch.
	const poller = read('src/media/usb-automount.js')
	assert.match(poller, new RegExp(`INHIBIT_FILE = '${INHIBIT}'`), 'poller watches the shared path')

	// Mask helper touches it, unmask removes it — both sides of the handshake.
	const common = read('tools/eggs/live-usb/flash-stick-common.sh')
	assert.match(common, new RegExp(`USB_AUTOMOUNT_INHIBIT=${INHIBIT}`), 'shell side pins the same path')
	assert.match(common, /usb_mask_exfat_automount\(\) \{\n\tusb_inhibit_highascg_automount_poller/, 'mask sets the inhibit first')
	const unmask = read('tools/eggs/live-usb/unmask-exfat-systemd.sh')
	assert.match(unmask, /rm -f \/run\/highascg\/usb-automount-inhibit/, 'unmask clears the inhibit')

	// TOCTOU guard: the unmount script verifies across a window longer than one
	// 3 s poller tick and re-unmounts anything that reappears.
	const unmount = read('tools/eggs/live-usb/unmount-usb-for-partitioning.sh')
	assert.match(unmount, /for attempt in 1 2 3; do\n\tsleep 4/, 'settle window outlasts POLL_MS')
	assert.match(unmount, /usb_umount_disk_partitions "\$DEV"/, 're-unmounts on reappearance')

	// The full-flash script holds the inhibit through seed phases and always releases it.
	const create = read('tools/eggs/live-usb/create-operator-stick-from-dd.sh')
	assert.match(create, /trap 'rm -f "\$USB_AUTOMOUNT_INHIBIT"[^']*' EXIT/, 'inhibit released on exit')
	assert.match(create, /finish-operator-stick\.sh" "\$DEV" --iso "\$ISO" --prune-stale\n# finish-operator-stick's unmask removed the inhibit — re-assert for seed phases 3-5\.\n(usb_inhibit_highascg_automount_poller)/, 're-asserted after finish unmasks')
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
