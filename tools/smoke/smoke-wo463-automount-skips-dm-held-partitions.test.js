'use strict'

/**
 * WO-463 — USB auto-mount looped on the Ventoy boot partition.
 *
 * Observed on the operator box booted from a Ventoy stick:
 *
 *   USB auto-mount failed for /dev/sdb1: Error mounting /dev/sdb1 at /media/casparcg/Ventoy:
 *   /dev/sdb1 already mounted or mount point busy
 *
 * The poller treated every unmounted removable partition as a mount candidate. On a Ventoy stick
 * the boot partition is exactly that — unmounted from the OS's point of view — but Ventoy holds
 * it O_EXCL through the dm map it built for the booted ISO, so udisks can never mount it and the
 * poller retried forever. lsblk already reports the claim as child nodes on the partition, which
 * is the same signal WO-458 reads out of /sys/class/block/<part>/holders.
 *
 * A claimed partition is never the mountable object anyway — for Ventoy, LVM or LUKS the thing
 * you mount is the mapper device.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { parseRemovableCandidates } = require('../../src/media/usb-drives-discovery.js')

/** The exact topology captured on the box: p1 Ventoy (dm-held), p2 VTOYEFI, p3 operator data. */
const VENTOY_STICK = {
	blockdevices: [
		{
			name: 'sdb',
			type: 'disk',
			rm: true,
			children: [
				{
					name: 'sdb1',
					type: 'part',
					fstype: 'exfat',
					label: 'Ventoy',
					mountpoint: null,
					children: [
						{ name: 'ventoy', type: 'dm', mountpoint: '/run/live/medium' },
						{ name: 'sdb1', type: 'dm', mountpoint: null },
					],
				},
				{ name: 'sdb2', type: 'part', fstype: 'vfat', label: 'VTOYEFI', mountpoint: null },
				{ name: 'sdb3', type: 'part', fstype: 'exfat', label: 'HIGHASCGEXF', mountpoint: null },
			],
		},
	],
}

const devices = (tree) => parseRemovableCandidates(JSON.stringify(tree)).map((c) => c.blockDevice)

describe('WO-463 auto-mount skips dm-held partitions', () => {
	it('never offers the Ventoy boot partition — udisks can only ever answer EBUSY', () => {
		assert.ok(!devices(VENTOY_STICK).includes('/dev/sdb1'), 'dm holds it; mounting it cannot succeed')
	})

	it('still offers the ordinary partitions on the same stick', () => {
		const got = devices(VENTOY_STICK)
		assert.deepEqual(got, ['/dev/sdb2', '/dev/sdb3'], 'the fix must not blind the poller to real volumes')
	})

	it('a plain unclaimed removable partition is still a candidate', () => {
		const plain = {
			blockdevices: [
				{ name: 'sdc', type: 'disk', rm: true, children: [{ name: 'sdc1', type: 'part', fstype: 'vfat', mountpoint: null }] },
			],
		}
		assert.deepEqual(devices(plain), ['/dev/sdc1'])
	})

	it('an already-mounted partition is still skipped', () => {
		const mounted = {
			blockdevices: [
				{ name: 'sdc', type: 'disk', rm: true, children: [{ name: 'sdc1', type: 'part', fstype: 'vfat', mountpoint: '/media/x' }] },
			],
		}
		assert.deepEqual(devices(mounted), [])
	})

	it('a bare removable disk with a filesystem and no partitions still mounts', () => {
		const bare = { blockdevices: [{ name: 'sdd', type: 'disk', rm: true, fstype: 'exfat', mountpoint: null }] }
		assert.deepEqual(devices(bare), ['/dev/sdd'])
	})
})
