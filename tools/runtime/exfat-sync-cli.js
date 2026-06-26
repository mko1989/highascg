#!/usr/bin/env node
/**
 * WO-47: run exFAT ↔ project mtime sync from the shell (boot hook / manual).
 * Usage: node tools/runtime/exfat-sync-cli.js [--boot] [--push] [--dry-run]
 */
'use strict'

const { runExfatSync, pushProjectConfigToExfat } = require('../../src/system/exfat-sync')
const { runPrivateVolumeSync } = require('../../src/system/private-volume-sync')

const dryRun = process.argv.includes('--dry-run')
const boot = process.argv.includes('--boot')
const pushOnly = process.argv.includes('--push')
const privateOnly = process.argv.includes('--private')

const logFn = (lvl, m) => {
	if (lvl === 'warn' || lvl === 'error') console.error(m)
	else console.log(m)
}

const run = privateOnly
	? runPrivateVolumeSync({ dryRun, boot, pushOnly, log: logFn })
	: pushOnly
		? pushProjectConfigToExfat({ dryRun, log: logFn })
		: runExfatSync({
				dryRun,
				boot,
				log: logFn,
			}).then(async (r) => {
				if (boot && !dryRun) {
					const pr = await runPrivateVolumeSync({ dryRun: false, boot: true, log: logFn })
					r.privateSync = pr
				}
				return r
			})

run
	.then((r) => {
		console.log(JSON.stringify(r, null, 2))
		const benign =
			!r.errors?.length ||
			(r.errors.length === 1 &&
				/not a mount point|no valid exfat-sync map|no exfat sync map|no bridge or USB data volume mounted/i.test(
					String(r.errors[0]),
				))
		process.exit(benign ? 0 : 1)
	})
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
