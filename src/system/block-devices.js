/**
 * Enumerate disk partitions for Settings → media/usb internal mount picker (WO-38).
 * Linux: lsblk JSON. Other platforms: empty list.
 */
'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

/**
 * @typedef {object} PartitionRow
 * @property {string} name
 * @property {string} path - kernel block path e.g. /dev/sda1
 * @property {string} type - lsblk TYPE (part, crypt, ...)
 * @property {string} size
 * @property {string} [fstype]
 * @property {string} [label]
 * @property {string} [uuid]
 * @property {string} [mountpoint]
 * @property {boolean} removable
 */

/** @param {Record<string, unknown>} b */
/** @param {string} key */
function pickStr(b, key) {
	const uc = key.toUpperCase()
	const v = b[key] ?? b[uc]
	if (v === null || v === undefined) return ''
	return String(v).trim()
}

/** @param {Record<string, unknown>} b */
/** @param {string} key */
function pickBoolFlag(b, key) {
	const uc = key.toUpperCase()
	const v = b[key] ?? b[uc]
	if (v === true || v === 1 || v === '1') return true
	if (v === false || v === 0 || v === '0' || v === '') return false
	const s = String(v ?? '').trim().toLowerCase()
	return s === '1' || s === 'true'
}

/**
 * Parses already-parsed `lsblk -J` root (fixtures / tests). Prefer lowercase keys (util-linux);
 * accepts uppercase for compatibility.
 *
 * @param {unknown} root
 * @returns {PartitionRow[]}
 */
function parseLsblkJsonForPartitionPicker(root) {
	const rows = []

	/** @param {Record<string, unknown>|undefined} b */
	function consider(b) {
		if (!b || typeof b !== 'object') return
		const typ = pickStr(b, 'type').toLowerCase()
		const devPath = pickStr(b, 'path')
		const uuid = pickStr(b, 'uuid').toLowerCase()
		const rm = pickBoolFlag(b, 'rm')
		const hot = pickBoolFlag(b, 'hotplug')
		// Dropdown is for mounts (need UUID for /dev/disk/by-uuid). Skip entries without UUID.
		if (!uuid || !devPath || !devPath.startsWith('/dev/')) return
		// Real partitions / crypto / typical LVM on /dev/mapper — skip whole disks.
		const allowType = typ === 'part' || typ === 'crypt'
		const allowMapper = devPath.includes('/dev/mapper/') && typ !== 'disk'
		if (!allowType && !allowMapper) return

		const nameRaw = pickStr(b, 'name')

		rows.push({
			name: nameRaw || devPath.split('/').pop() || '?',
			path: devPath,
			type: pickStr(b, 'type'),
			size: pickStr(b, 'size') || '?',
			fstype: pickStr(b, 'fstype') || undefined,
			label: pickStr(b, 'label') || undefined,
			uuid,
			mountpoint: pickStr(b, 'mountpoint') || undefined,
			removable: rm || hot,
		})
	}

	/** @param {unknown} tree */
	function walk(tree) {
		if (!tree) return
		const t = /** @type {{ blockdevices?: unknown[], children?: unknown[] }} */ (tree)
		if (typeof t.blockdevices === 'undefined' && typeof t.children === 'undefined') return
		const list =
			t.blockdevices && Array.isArray(t.blockdevices)
				? t.blockdevices
				: Array.isArray(t.children)
					? t.children
					: []
		for (const blk of list) {
			const b =
				Array.isArray(blk)
					?	null
				:	blk && typeof blk === 'object'
					?	/** @type {Record<string, unknown>} */
						(blk)
				:	null
			if (b) consider(b)
			if (blk && typeof blk === 'object' && blk.children && Array.isArray(blk.children))
				walk({ children: blk.children })
		}
	}

	walk(root)
	// Dedupe UUID (lsblk duplicates are rare); prefer first with a mountpoint (more context)
	const byUuid = new Map()
	for (const r of rows) {
		const prev = byUuid.get(r.uuid)
		if (!prev) byUuid.set(r.uuid, r)
		else if (!prev.mountpoint && r.mountpoint) byUuid.set(r.uuid, r)
	}
	return [...byUuid.values()].sort((a, b) => {
		const k = Number(a.removable) - Number(b.removable)
		if (k !== 0) return k
		return a.path.localeCompare(b.path)
	})
}

/**
 * @returns {Promise<PartitionRow[]>}
 */
async function listBlockPartitionsForPicker() {
	if (process.platform !== 'linux') return []

	let stdout
	try {
		const out = await execFileAsync(
			'lsblk',
			[
				'-J',
				'-o',
				'NAME,PATH,TYPE,SIZE,FSTYPE,LABEL,UUID,MOUNTPOINT,RM,HOTPLUG,PKNAME',
			],
			{ timeout: 12000, maxBuffer: 2e6 },
		)
		stdout = out.stdout || ''
	} catch {
		return []
	}

	let root
	try {
		root = JSON.parse(stdout)
	} catch {
		return []
	}
	return parseLsblkJsonForPartitionPicker(root)
}

module.exports = { listBlockPartitionsForPicker, parseLsblkJsonForPartitionPicker }
