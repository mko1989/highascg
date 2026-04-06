#!/usr/bin/env node
/**
 * Compares HighAsCG tree to Work Order 02 target paths (files that should exist post-migration).
 * Run: node scripts/verify-w02-structure.js
 * Exit 0 always; prints missing paths to stdout for human review.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

/** Paths relative to HighAsCG root — from 02_WO_MIGRATE_TO_HIGHASCG.md target tree */
const EXPECTED = [
	'package.json',
	'README.md',
	'.gitignore',
	'index.js',
	'config/default.js',
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
	'web/index.html',
	'templates/multiview_overlay.html',
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
	console.log(`WO-02 structure check: ${present}/${EXPECTED.length} expected paths present`)
	if (missing.length) {
		console.log('\nMissing (migration incomplete):')
		for (const m of missing) console.log(`  - ${m}`)
	} else {
		console.log('All listed paths present.')
	}
}

main()
