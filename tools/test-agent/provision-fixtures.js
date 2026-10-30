#!/usr/bin/env node
'use strict'

/**
 * WO-836 Part 3c — put the test cards' fixture media (e2e_bars.mp4, e2e_still.png, e2e_tone.wav: the same three files
 * the sandbox generates) into the media root of the box that will be tested. Never overwrites a file that exists.
 *
 *   node tools/test-agent/provision-fixtures.js [--media DIR] [--remove]
 *
 * Default DIR: the live node's local_media_path (GET /api/settings), else /home/casparcg/highascg/media. Afterwards the
 * Sources list needs its ↻ (the driver's `ui click "Reload the list"`), the release-test skill does that.
 * --remove deletes exactly these three files (end of a release run).
 */

const fs = require('fs')
const path = require('path')
const { writeFixtureMedia } = require('../e2e/sandbox-server')
const { request } = require('./lib/target')

const FILES = ['e2e_bars.mp4', 'e2e_still.png', 'e2e_tone.wav']

async function main() {
	const argv = process.argv.slice(2)
	const mi = argv.indexOf('--media')
	let dir = mi >= 0 ? argv[mi + 1] : ''
	if (!dir) {
		try {
			const s = await request({ mode: 'live', api: 'http://127.0.0.1:4200' }, 'GET', '/api/settings')
			dir = s.local_media_path || ''
		} catch {
			/* node down: default below */
		}
	}
	dir = path.resolve(dir || '/home/casparcg/highascg/media')
	if (argv.includes('--remove')) {
		for (const f of FILES) fs.rmSync(path.join(dir, f), { force: true })
		console.log(JSON.stringify({ ok: true, removed: FILES, dir }))
		return
	}
	const before = FILES.filter((f) => fs.existsSync(path.join(dir, f)))
	writeFixtureMedia(dir)
	console.log(JSON.stringify({ ok: true, dir, already_there: before, now_there: FILES.filter((f) => fs.existsSync(path.join(dir, f))) }))
}

main().catch((e) => {
	console.log(JSON.stringify({ ok: false, error: e.message }))
	process.exit(1)
})
