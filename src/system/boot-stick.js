'use strict'

/**
 * WO-697 — is the USB data volume (HIGHASCGEXF at ~/exfat) on the stick this box booted from?
 *
 * Only then does the box sync with it automatically (config pairs, project push / pull, the project catalog, the
 * private folder). A HighAsCG stick plugged into a box that booted from its own disk — e.g. to copy a new ISO onto
 * Ventoy — is just a drive: nothing is written to it or adopted from it unless the operator asks
 * (src/system/stick-transfer.js). On 23.10 a stick plugged in here left with this box's projects and config, and
 * the next machine booted from it loaded them (WO-696 finding 2).
 *
 * "Booted from" = the live medium (/run/live/medium, live-boot) and the volume sit on the same disk. Ventoy maps the
 * ISO out of its partition with device-mapper (/dev/mapper/ventoy → slaves/sda1), so dm devices are followed to
 * their slaves, then a partition to its disk. An installed box has no /run/live/medium: never a boot stick.
 * scripts/exfat/highascg-boot-stick.sh is the shell twin (network apply, server drop update).
 */

const fs = require('fs')
const path = require('path')

const LIVE_MEDIUM = '/run/live/medium'
const SYS_BLOCK = '/sys/class/block'

const realFs = {
	mounts: () => fs.readFileSync('/proc/self/mounts', 'utf8'),
	realpath: (p) => fs.realpathSync(p),
	readdir: (p) => fs.readdirSync(p),
	exists: (p) => fs.existsSync(p),
	read: (p) => fs.readFileSync(p, 'utf8'),
}

/** The device mounted at `target` (the last of stacked mounts), or null. /proc/mounts escapes spaces as \040. */
function mountSource(target, mountsText) {
	const want = path.resolve(target)
	let src = null
	for (const line of String(mountsText || '').split('\n')) {
		const [dev, mp] = line.split(' ')
		if (mp && mp.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))) === want) src = dev
	}
	return src
}

/** /dev/mapper/ventoy → dm-0 → sda1 → "sda"; /dev/nvme0n1p3 → "nvme0n1". Null when sysfs does not know it. */
function diskOf(dev, fsx) {
	let name
	try {
		name = path.basename(fsx.realpath(dev))
	} catch {
		name = path.basename(String(dev))
	}
	// Ventoy's /dev/mapper/ventoy has no node after switch_root (only /dev/mapper/control): find it by its dm name
	if (!fsx.exists(`${SYS_BLOCK}/${name}`)) {
		let dms = []
		try {
			dms = fsx.readdir(SYS_BLOCK).filter((n) => n.startsWith('dm-'))
		} catch {}
		const dm = dms.find((n) => {
			try {
				return fsx.read(`${SYS_BLOCK}/${n}/dm/name`).trim() === name
			} catch {
				return false
			}
		})
		if (dm) name = dm
	}
	for (let i = 0; i < 4; i++) {
		let slaves = []
		try {
			slaves = fsx.readdir(`${SYS_BLOCK}/${name}/slaves`)
		} catch {}
		if (!slaves.length) break
		name = [...slaves].sort()[0]
	}
	if (!fsx.exists(`${SYS_BLOCK}/${name}`)) return null
	if (!fsx.exists(`${SYS_BLOCK}/${name}/partition`)) return name
	try {
		return path.basename(path.dirname(fsx.realpath(`${SYS_BLOCK}/${name}`)))
	} catch {
		return null
	}
}

/**
 * @param {string | null | undefined} mountPath the USB volume's mount (exfat-sync map `volumes.usb.mount`)
 * @param {Partial<typeof realFs>} [deps]
 * @returns {{ mounted: boolean, bootStick: boolean, disk: string | null, bootDisk: string | null }}
 */
function stickState(mountPath, deps = {}) {
	const fsx = { ...realFs, ...deps }
	let text = ''
	try {
		text = fsx.mounts()
	} catch {}
	const src = mountPath ? mountSource(mountPath, text) : null
	const medium = mountSource(LIVE_MEDIUM, text)
	const disk = src ? diskOf(src, fsx) : null
	const bootDisk = medium ? diskOf(medium, fsx) : null
	return { mounted: !!src, bootStick: !!disk && disk === bootDisk, disk, bootDisk }
}

/** True only when the volume at `mountPath` is mounted and on the disk this live system booted from. */
function isBootStick(mountPath, deps) {
	return stickState(mountPath, deps).bootStick
}

module.exports = { stickState, isBootStick, mountSource, diskOf }
