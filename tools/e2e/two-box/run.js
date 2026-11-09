#!/usr/bin/env node
'use strict'

/**
 * WO-1026 — the owner's two-box workflow, checked on the REAL servers.
 *
 *   node tools/e2e/two-box/run.js --phase=1|2 [--peer=192.168.0.10] [--main=127.0.0.1] [--main-lan=192.168.0.17]
 *        [--static] [--only=T3,T5.1] [--soak=60] [--keep] [--json=<file>] [--label="Stream PGM"] [--led=<destination id>]
 *
 * Run it ON the main server (the master). It reads both servers over their APIs and the second one's shell over ssh.
 * It does not set the workflow up (WO-1026 has the runbook) — it says whether the servers are in it and whether it
 * works: T0–T4 only read (--static stops there); T5–T9 take looks, stream to a receiver on main and record on the
 * second server, so they change what is on air on BOTH boxes. Exit code 1 when a check failed.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { makeBox, createReport } = require('./lib')
const { PHASES, STREAM_LABEL, LED_ID } = require('./scenario')
const { staticChecks } = require('./checks-static')
const { activeChecks } = require('./checks-active')

function args(argv) {
	const out = {}
	for (const a of argv) {
		const m = /^--([\w-]+)(?:=(.*))?$/.exec(a)
		if (m) out[m[1]] = m[2] === undefined ? true : m[2]
	}
	return out
}

async function main() {
	const a = args(process.argv.slice(2))
	const phase = Number(a.phase)
	if (!PHASES[phase]) {
		console.error('usage: run.js --phase=1|2 [--static] [--only=T0,T5.1] [--soak=60] [--json=file]  (see the header)')
		process.exit(2)
	}
	const mainLan = String(a['main-lan'] || '192.168.0.17')
	const ctx = {
		phase,
		exp: PHASES[phase],
		main: makeBox('main', String(a.main || '127.0.0.1'), true),
		peer: makeBox('peer', String(a.peer || '192.168.0.10'), false),
		label: String(a.label || STREAM_LABEL),
		led: String(a.led || LED_ID),
		rtmp: `rtmp://${mainLan}:1935/live`,
		key: 'twobox',
		soak: a.soak === undefined ? 60 : Number(a.soak) || 0,
		keep: !!a.keep,
		dir: path.join(os.tmpdir(), 'highascg-two-box'),
	}
	// the peer lists main by its LAN address; `main.host` is what link checks compare against
	ctx.main.host = mainLan
	const report = createReport({ only: a.only ? String(a.only).split(',') : [] })
	console.log(`two-box workflow, phase ${phase}: main ${ctx.main.base} (${mainLan}), second server ${ctx.peer.base}`)
	await staticChecks(report, ctx)
	if (!a.static) await activeChecks(report, ctx)
	const sum = report.summary()
	console.log(`\n${sum.pass} passed, ${sum.fail} failed, ${sum.warn} warnings, ${sum.skip} skipped (of ${sum.total})`)
	if (a.json) fs.writeFileSync(String(a.json), JSON.stringify({ phase, at: new Date().toISOString(), summary: sum, rows: report.rows }, null, '\t'))
	process.exit(sum.fail ? 1 : 0)
}

main().catch((e) => {
	console.error(e)
	process.exit(1)
})
