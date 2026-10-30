#!/usr/bin/env node
'use strict'

/**
 * WO-825 — build the box-local GDTF Share library from the box's own account (~/.highascg/gdtf-share.json; override the
 * home with HIGHASCG_GDTF_SHARE_DIR). Not shipped in git / the ISO: GDTF Share's terms forbid redistributing the content.
 *
 *   node tools/gdtf/build-library.js [--limit N] [--delay MS]      description XML + 128 px WebP thumbnails (~110 MB)
 *   node tools/gdtf/build-library.js --full [--delay MS]           also/only: every full .gdtf (~12 GB) into <library>/full/
 *   node tools/gdtf/build-library.js --status                      what is there / what a full download would take
 *
 * Resumable: run it again and it continues; Ctrl-C stops after the current file. --limit N takes a stable spread
 * sample of N fixtures (a proof run: `--limit 20`). The password is never printed.
 */

const lib = require('../../src/fixtures/gdtf-library')
const build = require('../../src/fixtures/gdtf-library-build')
const full = require('../../src/fixtures/gdtf-share-full')
const share = require('../../src/fixtures/gdtf-share')
const { Job } = require('../../src/fixtures/gdtf-share-job')

const arg = (n) => {
	const i = process.argv.indexOf(n)
	return i >= 0 ? process.argv[i + 1] : undefined
}
const has = (n) => process.argv.includes(n)
const mb = (b) => `${(b / 2 ** 20).toFixed(1)} MB`

async function main() {
	if (has('--status')) {
		const u = lib.usage()
		console.log(`library: ${lib.index().entries.length} fixtures, ${u.files} files, ${mb(u.bytes)} in ${lib.dir()}`)
		const e = await full.estimate(fetch)
		console.log(`full download: ${e.files} files, ${mb(e.bytes)} (${e.doneFiles} files / ${mb(e.doneBytes)} already cached)`)
		return
	}
	if (!share.account()) throw new Error('no GDTF Share account set (POST /api/fixtures/share/account)')
	const job = new Job(has('--full') ? 'full' : 'library')
	process.on('SIGINT', () => {
		console.log('\nstopping after the current file …')
		job.cancel()
	})
	const t = setInterval(() => process.stdout.write(`\r${job.kind} ${job.done + job.skipped}/${job.total} (new ${job.done}, skipped ${job.skipped}, failed ${job.failed}) ${mb(job.bytes)} ${job.current.slice(0, 40).padEnd(40)}`), 1000)
	const deps = { delayMs: arg('--delay') !== undefined ? Number(arg('--delay')) : 300, limit: Number(arg('--limit')) || 0 }
	await (has('--full') ? full.runFull : build.build)(job, deps)
	clearInterval(t)
	console.log(`\n${job.state}: new ${job.done}, skipped ${job.skipped}, failed ${job.failed}${job.error ? `, last error: ${job.error}` : ''}`)
	const u = lib.usage()
	console.log(`library now: ${lib.index().entries.length} fixtures, ${mb(u.bytes)}`)
	process.exitCode = job.state === 'error' || job.failed ? 1 : 0
}

main().catch((e) => {
	console.error(e.message)
	process.exit(1)
})
