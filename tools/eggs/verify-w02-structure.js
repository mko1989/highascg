#!/usr/bin/env node
/**
 * Expected layout: server at repo root (`src/`), UI in `client/`.
 * Run: node tools/eggs/verify-w02-structure.js
 */

'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../..')

const EXPECTED = [
	'package.json',
	'README.md',
	'.gitignore',
	'index.js',
	'src/server/http-server.js',
	'src/server/ws-server.js',
	'src/server/cors.js',
	'src/caspar/tcp-client.js',
	'src/caspar/amcp-protocol.js',
	'src/caspar/amcp-client.js',
	'src/caspar/amcp-batch.js',
	'src/caspar/connection-manager.js',
	'src/osc/osc-config.js',
	'src/osc/osc-listener.js',
	'src/osc/osc-state.js',
	'src/osc/osc-variables.js',
	'src/state/state-manager.js',
	'src/state/playback-tracker.js',
	'src/state/live-scene-state.js',
	'src/utils/logger.js',
	'src/utils/query-cycle.js',
	'src/utils/periodic-sync.js',
	'src/media/cinf-parse.js',
	'src/media/local-media.js',
	'src/repo-paths.js',
	'client/index.html',
	'vite.config.js',
	'template/multiview_overlay.html',
]

function exists(rel) {
	try {
		fs.accessSync(path.join(ROOT, rel), fs.constants.F_OK)
		return true
	} catch {
		return false
	}
}

function main() {
	const missing = EXPECTED.filter((rel) => !exists(rel))
	const present = EXPECTED.length - missing.length
	console.log(`Structure check (src/ at root + client/): ${present}/${EXPECTED.length} expected paths present`)
	if (exists('backend')) {
		console.log('\nWARN: backend/ still exists — server should be at repo root (src/, index.js)')
	}
	if (missing.length) {
		console.log('\nMissing:')
		for (const m of missing) console.log(`  - ${m}`)
	} else {
		console.log('All listed paths present.')
	}
	const distWeb = exists('dist-web/index.html')
	console.log(`dist-web/: ${distWeb ? 'present (runtime prefers over client/)' : 'absent (optional: npm run build:client)'}`)
}

main()
