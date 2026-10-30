#!/usr/bin/env node
'use strict'

/**
 * WO-836 — `npm run test:live`: the LIVE-BOX category. Runs the tests that act on the real box (AMCP to the real
 * CasparCG, requests to the running HighAsCG API, a spawned second node, real LAN sockets). Typing this command is the
 * opt-in: it sets HIGHASCG_LIVE_TESTS=1 for the children (see live-guard.js; a bare `node --test` of one of these
 * files is skipped without it). NEVER part of `test:ci`.
 *
 *   npm run test:live                      # preflight, then every live test + probe
 *   HIGHASCG_LIVE_TAKE=1 npm run test:live # + smoke-scene-take.js (POSTs a forceCut TAKE on channel 1 — takes program live)
 *
 * Layout: tools/test-live/*.test.js  node:test files        (run together under `node --test`)
 *         tools/test-live/<name>.js|mjs  HTTP/AMCP probes   (exit code = result, run one by one)
 *         tools/test-live/manual/        hand-run spikes and raw-socket helpers (guarded, never run here)
 * The GUI release suite (WO-836 part 3) slots in as a third group of the same kind; `npm run test:release` chains
 * offline + live + GUI (tools/ci/run-release-tests.js).
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')

const HERE = __dirname
const REPO_ROOT = path.resolve(HERE, '../..')
const env = { ...process.env, HIGHASCG_LIVE_TESTS: '1' }

const CASPAR_HOST = env.HIGHASCG_CASPAR_HOST || env.CASPAR_HOST || '127.0.0.1'
const CASPAR_PORT = parseInt(env.HIGHASCG_CASPAR_PORT || env.CASPAR_PORT || '5250', 10)
const API_PORT = parseInt(env.HIGHASCG_HTTP_PORT || env.HIGHASCG_SMOKE_PORT || '4200', 10)

/** Probes: exit code is the verdict. The take probe changes what is on air, so it is opt-in. */
const PROBES = [
	'http-smoke.js',
	'smoke-caspar.js',
	'verify-streaming-channel.mjs',
	...(env.HIGHASCG_LIVE_TAKE === '1' ? ['smoke-scene-take.js'] : []),
]

function reachable(host, port, timeoutMs = 1500) {
	return new Promise((resolve) => {
		const s = net.connect({ host, port })
		const done = (ok) => {
			s.destroy()
			resolve(ok)
		}
		s.setTimeout(timeoutMs, () => done(false))
		s.on('connect', () => done(true))
		s.on('error', () => done(false))
	})
}

async function main() {
	const testFiles = fs
		.readdirSync(HERE)
		.filter((f) => /\.test\.(js|mjs)$/.test(f))
		.sort()
		.map((f) => path.join('tools/test-live', f))

	const [caspar, api] = await Promise.all([reachable(CASPAR_HOST, CASPAR_PORT), reachable('127.0.0.1', API_PORT)])
	console.log(`[test:live] preflight: Caspar ${CASPAR_HOST}:${CASPAR_PORT} ${caspar ? 'up' : 'DOWN'}, HighAsCG API :${API_PORT} ${api ? 'up' : 'DOWN'}`)
	if (!caspar || !api) {
		console.error('[test:live] the box is not up — these tests need the live Caspar and API. Start them, or run the offline suite (npm run test:ci).')
		process.exit(1)
	}

	const results = []
	console.log(`[test:live] ${testFiles.length} node:test file(s), ${PROBES.length} probe(s)`)
	const t = spawnSync(process.execPath, ['--test', `--test-timeout=${env.NODE_TEST_TIMEOUT || '120000'}`, ...testFiles], { cwd: REPO_ROOT, stdio: 'inherit', env })
	results.push({ name: `node:test x${testFiles.length}`, status: t.status === null ? 1 : t.status })
	for (const p of PROBES) {
		console.log(`\n[test:live] probe ${p}`)
		const r = spawnSync(process.execPath, [path.join('tools/test-live', p)], { cwd: REPO_ROOT, stdio: 'inherit', env })
		results.push({ name: p, status: r.status === null ? 1 : r.status })
	}

	console.log('\n[test:live] summary')
	for (const r of results) console.log(`  ${r.status === 0 ? 'PASS' : 'FAIL'}  ${r.name}`)
	process.exit(results.some((r) => r.status !== 0) ? 1 : 0)
}

main()
