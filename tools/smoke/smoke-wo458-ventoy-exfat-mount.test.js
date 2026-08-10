'use strict'

/**
 * WO-458 — Ventoy stick: ~/exfat never mounts.
 *
 * On a Ventoy stick the data partition IS the boot medium. Ventoy maps the booted ISO's
 * extents out of it with device-mapper, and dm holds the raw partition O_EXCL, so
 * `mount /dev/sdb1` returns EBUSY (status 32) no matter what the label says. Ventoy also
 * publishes a 1:1 linear map of the whole partition under /dev/mapper/<part>, which mounts
 * fine. resolve_usb_dev() picks that map, and must NOT pick the smaller ISO-extent map.
 *
 * Second leg: `systemctl start --no-block` always exits 0, so the old
 * `if ! systemctl start --no-block …; then <fallback>; fi` made every fallback unreachable —
 * the boot log showed "Device present" then straight to the 45s timeout with no fallback line.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const CANON = 'scripts/exfat/highascg-exfat-boot.sh'
const RUNTIME = 'tools/runtime/wo47-highascg-exfat-boot.sh'
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/** Extract the `SYSFS_BLOCK=…` preamble + resolve_usb_dev() so it can run without the boot chain. */
function resolverSource() {
	const src = read(CANON)
	const start = src.indexOf('SYSFS_BLOCK=')
	const end = src.indexOf('\n}\n', src.indexOf('resolve_usb_dev() {'))
	assert.ok(start > 0 && end > start, 'resolve_usb_dev() not found in ' + CANON)
	return src.slice(start, end + 3)
}

/**
 * Build a fake sysfs + /dev/mapper mirroring the topology captured on the box:
 *   sdb1 (8:17) held by dm-0 "ventoy" (3.5G ISO extents) and dm-1 "sdb1" (29.3G, the exFAT fs).
 * @param {{ holders?: Array<{ dm: string, name: string, sectors: number }>, exfatOn?: string[] }} opts
 */
function fakeTree(opts = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo458-'))
	const sysfs = path.join(dir, 'sys')
	const mapper = path.join(dir, 'mapper')
	const partSectors = 61437952
	fs.mkdirSync(path.join(sysfs, 'sdb1'), { recursive: true })
	fs.writeFileSync(path.join(sysfs, 'sdb1', 'size'), `${partSectors}\n`)
	fs.mkdirSync(mapper, { recursive: true })
	const holders = opts.holders || [
		{ dm: 'dm-0', name: 'ventoy', sectors: 7340032 },
		{ dm: 'dm-1', name: 'sdb1', sectors: partSectors },
	]
	if (holders.length) fs.mkdirSync(path.join(sysfs, 'sdb1', 'holders'), { recursive: true })
	for (const h of holders) {
		const hd = path.join(sysfs, 'sdb1', 'holders', h.dm)
		fs.mkdirSync(path.join(hd, 'dm'), { recursive: true })
		fs.writeFileSync(path.join(hd, 'dm', 'name'), `${h.name}\n`)
		fs.writeFileSync(path.join(hd, 'size'), `${h.sectors}\n`)
		fs.writeFileSync(path.join(mapper, h.name), '')
	}
	// Stub blkid: only the named devices probe as exfat.
	const bin = path.join(dir, 'bin')
	fs.mkdirSync(bin, { recursive: true })
	const exfat = opts.exfatOn || ['sdb1']
	fs.writeFileSync(
		path.join(bin, 'blkid'),
		`#!/bin/sh\ncase "\${*}" in\n${exfat.map((n) => `*/${n}) echo exfat ;;`).join('\n')}\n*) exit 2 ;;\nesac\n`
	)
	fs.chmodSync(path.join(bin, 'blkid'), 0o755)
	return { dir, sysfs, mapper, bin }
}

function resolve(tree) {
	const script = `${resolverSource()}\nresolve_usb_dev\n`
	return execFileSync('bash', ['-c', script], {
		env: {
			...process.env,
			PATH: `${tree.bin}:${process.env.PATH}`,
			USB_DEV: '/dev/sdb1',
			HIGHASCG_SYSFS_BLOCK: tree.sysfs,
			HIGHASCG_DEV_MAPPER: tree.mapper,
		},
		encoding: 'utf8',
	})
}

describe('WO-458 Ventoy exFAT mount', () => {
	it('picks the full-partition dm map, not the smaller ISO-extent map', () => {
		const tree = fakeTree()
		assert.equal(resolve(tree), `${tree.mapper}/sdb1`)
	})

	it('ignores a same-name map that does not probe as exfat', () => {
		const tree = fakeTree({ exfatOn: [] })
		assert.equal(resolve(tree), '/dev/sdb1', 'must fall back to the raw partition')
	})

	it('returns the raw partition on a plain stick (no device-mapper holders)', () => {
		const tree = fakeTree({ holders: [] })
		assert.equal(resolve(tree), '/dev/sdb1')
	})

	it('never sizes-matches the ISO map even when it probes as exfat', () => {
		const tree = fakeTree({
			holders: [{ dm: 'dm-0', name: 'ventoy', sectors: 7340032 }],
			exfatOn: ['ventoy'],
		})
		assert.equal(resolve(tree), '/dev/sdb1', 'a partial-size map is never the filesystem')
	})

	for (const file of [CANON, RUNTIME]) {
		it(`${file}: mount fallback is reachable and dm-aware`, () => {
			const src = read(file)
			// The start stays --no-block (blocking here delays highascg.service, which is why the
			// original code used it). What must never come back is gating the fallback on the
			// systemctl exit code: --no-block always exits 0, so that made the fallback dead code.
			assert.match(src, /systemctl start --no-block home-casparcg-exfat\.mount/, 'start must stay asynchronous')
			assert.ok(
				!/if ! systemctl start[^\n]*home-casparcg-exfat\.mount[^\n]*; then/.test(src),
				'the fallback must not hang off the systemctl exit code'
			)
			assert.match(src, /if ! mountpoint -q "\$MP"; then/, 'the fallback must be gated on the actual mount state')
			assert.match(src, /resolve_usb_dev\(\) \{/, 'must carry the Ventoy device resolver')
			assert.match(src, /MOUNT_DEV="\$\(resolve_usb_dev\)"/)
			assert.match(src, /mount -t exfat -o "defaults,uid=\$\{uid\},gid=\$\{gid\},umask=002" "\$MOUNT_DEV"/)
		})
	}
})
