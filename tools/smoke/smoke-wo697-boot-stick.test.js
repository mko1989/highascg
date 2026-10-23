'use strict'
/**
 * WO-697 — the box syncs with a HighAsCG stick on its own only when it booted from it; any other stick is a drive
 * the operator saves to / loads from by hand. Fake sysfs + /proc/mounts from .64 (Ventoy live boot, 23.10) and from
 * this installed box; manual save / load against temp dirs; the gates pinned in the automatic paths.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { stickState, mountSource, diskOf } = require('../../src/system/boot-stick')
const pvs = require('../../src/engine/project-volume-sync')
const { stickStatus, saveToStick, loadFromStick } = require('../../src/system/stick-transfer')

const SRC = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

/** sysfs as a map: path → realpath / children / file text */
function fakeFs({ mounts, links = {}, dirs = {}, files = {}, devs = {} }) {
	return {
		mounts: () => mounts,
		realpath: (p) => {
			if (devs[p]) return devs[p]
			if (links[p]) return links[p]
			throw new Error('ENOENT')
		},
		readdir: (p) => {
			if (dirs[p]) return dirs[p]
			throw new Error('ENOENT')
		},
		exists: (p) => p in links || p in dirs || p in files,
		read: (p) => {
			if (p in files) return files[p]
			throw new Error('ENOENT')
		},
	}
}

const B = '/sys/class/block'
// .64: ISO mapped out of the Ventoy partition (no /dev/mapper/ventoy node), data volume sda3 on the same stick
const VENTOY = {
	mounts: '/dev/mapper/ventoy /run/live/medium iso9660 ro 0 0\n/dev/sda3 /home/casparcg/exfat exfat rw 0 0\n',
	devs: { '/dev/sda3': '/dev/sda3' },
	links: {
		[`${B}/dm-0`]: '/sys/devices/virtual/block/dm-0',
		[`${B}/sda1`]: '/sys/devices/pci/usb/block/sda/sda1',
		[`${B}/sda3`]: '/sys/devices/pci/usb/block/sda/sda3',
		[`${B}/sda`]: '/sys/devices/pci/usb/block/sda',
		[`${B}/sdb2`]: '/sys/devices/pci/usb/block/sdb/sdb2',
		[`${B}/sdb`]: '/sys/devices/pci/usb/block/sdb',
	},
	dirs: { [B]: ['dm-0', 'sda', 'sda1', 'sda3', 'sdb', 'sdb2'], [`${B}/dm-0/slaves`]: ['sda1'] },
	files: { [`${B}/dm-0/dm/name`]: 'ventoy\n', [`${B}/sda1/partition`]: '1', [`${B}/sda3/partition`]: '3', [`${B}/sdb2/partition`]: '2' },
}

describe('WO-697 boot stick detection', () => {
	it('mountSource: last stacked mount wins, \\040 is a space', () => {
		const t = '/dev/a /mnt/x ext4 rw 0 0\n/dev/b /mnt/my\\040stick exfat rw 0 0\n/dev/c /mnt/x ext4 rw 0 0\n'
		assert.equal(mountSource('/mnt/x', t), '/dev/c')
		assert.equal(mountSource('/mnt/my stick', t), '/dev/b')
		assert.equal(mountSource('/mnt/none', t), null)
	})

	it('Ventoy live boot from the same stick → boot stick (dm name found through sysfs)', () => {
		const fsx = fakeFs(VENTOY)
		assert.equal(diskOf('/dev/mapper/ventoy', fsx), 'sda')
		assert.deepEqual(stickState('/home/casparcg/exfat', fsx), { mounted: true, bootStick: true, disk: 'sda', bootDisk: 'sda' })
	})

	it('a second HighAsCG stick on a live-booted box → not the boot stick', () => {
		const fsx = fakeFs({ ...VENTOY, mounts: VENTOY.mounts.replace('/dev/sda3 /home', '/dev/sdb2 /home'), devs: { '/dev/sdb2': '/dev/sdb2' } })
		assert.equal(stickState('/home/casparcg/exfat', fsx).bootStick, false)
	})

	it('installed box (no /run/live/medium) → never a boot stick; unmounted → not mounted', () => {
		const fsx = fakeFs({ ...VENTOY, mounts: '/dev/sda3 /home/casparcg/exfat exfat rw 0 0\n' })
		assert.deepEqual(stickState('/home/casparcg/exfat', fsx), { mounted: true, bootStick: false, disk: 'sda', bootDisk: null })
		assert.equal(stickState('/home/casparcg/exfat', fakeFs({ ...VENTOY, mounts: '' })).mounted, false)
	})

	it('the automatic paths are gated (config sync, project push / pull / catalog, private folder, network, drop-update)', () => {
		const sync = SRC('src/system/exfat-sync.js')
		assert.match(sync, /if \(!manual && foreignStick\(p, exfatRoot\)\)/)
		assert.match(sync, /if \(foreignStick\(p, exfatRoot\)\) \{\n\t\tlog\('info', `\[exfat-sync\] \$\{id\}: the stick/)
		const pv = SRC('src/engine/project-volume-sync.js')
		assert.match(pv, /return !!\(roots\.usb && isVolumeMountedSync\(roots\.usb\) && isBootStick\(roots\.usb\)\)/)
		assert.equal(pv.match(/usbAutoSync\(roots\)/g).length, 5, 'definition + catalog, push, pull, autosave pull')
		assert.doesNotMatch(pv, /roots\.usb && isVolumeMountedSync\(roots\.usb\)\)\s*\{/)
		assert.match(SRC('src/system/private-volume-sync.js'), /if \(key === 'usb' && !isBootStick\(vol\.mount\)\)/)
		for (const f of ['scripts/exfat/highascg-exfat-network-apply.sh', 'scripts/exfat/highascg-exfat-server-update.sh']) {
			assert.match(SRC(f), /! highascg_exfat_is_boot_stick "\$EXFAT_(MP|ROOT)"; then/, f)
		}
		assert.match(SRC('scripts/exfat/install-exfat-systemd-units.sh'), /install -m 0644 -o root -g root "\$BOOT_STICK_LIB_SRC" "\$BOOT_STICK_LIB_DST"/)
	})
})

describe('WO-697 save to / load from a stick by hand', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo697-'))
	const stick = path.join(tmp, 'exfat')
	const local = path.join(tmp, 'projects')
	fs.mkdirSync(path.join(stick, 'projects', '_autosave'), { recursive: true })
	fs.mkdirSync(path.join(local, '_autosave'), { recursive: true })
	const put = (f, o) => fs.writeFileSync(f, JSON.stringify(o))
	put(path.join(local, 'show_a.json'), { name: 'Show A', savedAt: '2026-10-23T10:00:00Z' })
	put(path.join(local, '_autosave', 'show_a.json'), { name: 'Show A', savedAt: '2026-10-23T10:05:00Z' })
	put(path.join(stick, 'projects', 'gig.json'), { name: 'Gig', savedAt: '2026-10-20T18:00:00Z' })
	put(path.join(local, 'gig.json'), { name: 'Gig (box)', savedAt: '2026-10-22T09:00:00Z' })
	put(path.join(local, '_autosave', 'gig.json'), { name: 'Gig (box autosave)' })

	const roots = pvs.getProjectRoots
	const deps = { mounts: () => `/dev/sdb2 ${stick} exfat rw 0 0\n`, realpath: () => '/dev/sdb2' }
	const withRoots = async (fn) => {
		pvs.getProjectRoots = () => ({ usb: stick, bridge: null, local })
		try {
			return await fn()
		} finally {
			pvs.getProjectRoots = roots
		}
	}

	it('status lists the stick projects and which are on the box', async () => {
		const st = await withRoots(() => stickStatus(deps))
		assert.equal(st.mounted, true)
		assert.equal(st.bootStick, false)
		assert.deepEqual(st.projects.map((p) => [p.slug, p.onBox]), [['gig', true]])
	})

	it('save copies every project + its autosave (settings off here: the real map is not under test)', async () => {
		const r = await withRoots(() => saveToStick({ settings: false, deps }))
		assert.equal(r.projects, 2)
		assert.equal(JSON.parse(fs.readFileSync(path.join(stick, 'projects', 'show_a.json'), 'utf8')).name, 'Show A')
		assert.ok(fs.existsSync(path.join(stick, 'projects', '_autosave', 'show_a.json')))
		assert.equal(JSON.parse(fs.readFileSync(path.join(stick, 'projects', 'gig.json'), 'utf8')).name, 'Gig (box)')
	})

	it('load replaces the box copy, keeps the old file + autosave aside (not .json), refuses bad names', async () => {
		put(path.join(stick, 'projects', 'gig.json'), { name: 'Gig (stick)', savedAt: '2026-10-23T12:00:00Z' })
		fs.rmSync(path.join(stick, 'projects', '_autosave', 'gig.json')) // a stick with only the project file
		const r = await withRoots(() => loadFromStick('gig', { deps }))
		assert.equal(r.slug, 'gig')
		assert.equal(r.keptAs.length, 2)
		assert.ok(r.keptAs.every((n) => /\.json\.before-stick-/.test(n)))
		assert.equal(JSON.parse(fs.readFileSync(path.join(local, 'gig.json'), 'utf8')).name, 'Gig (stick)')
		assert.ok(!fs.existsSync(path.join(local, '_autosave', 'gig.json')), 'the box autosave must not win over the loaded file')
		assert.deepEqual(pvs.scanProjectsDir(local, 'local').map((p) => p.slug).sort(), ['gig', 'show_a'])
		assert.match((await withRoots(() => loadFromStick('../etc/passwd', { deps }))).error, /Invalid/)
		assert.match((await withRoots(() => loadFromStick('nope', { deps }))).error, /not on the stick/)
		assert.match(loadFromStick('gig', { deps: { mounts: () => '' } }).error || '', /No HighAsCG stick|not on the stick/)
		fs.rmSync(tmp, { recursive: true, force: true })
	})
})
