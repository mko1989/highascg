#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const SCAN_DIRS = ['tools/smoke', 'test']

/** Basename patterns excluded from CI (live server, hardware, spikes). */
const EXCLUDE_NAME = [
	/\.live\.test\./i,
	/^highascg-live-/i,
	/^spike-/i,
	/^raw-tcp/i,
	/^query-test/i,
	/^batch-test/i,
	/^http-smoke/i,
	/^smoke-caspar/i,
	/^run-live-test/i,
	/^verify-streaming-channel/i,
	/^smoke-companion-press/i,
	/^smoke-api-origin/i,
	/^smoke-wo47-manifest/i,
	/^smoke-logs-modal-toggles/i,
	/^smoke-settings-nuclear-password-dom/i,
	/^smoke-full-config-apply/i,
	/^test-artnet-input/i,
	/^smoke-project-fps-network/i,
	/^smoke-preview-amcp-channel/i,
	/^smoke-xrandr-canvas-check/i,
	// WO-235 incident (2026-07-15): these connect a real ConnectionManager to
	// `HIGHASCG_CASPAR_PORT || CASPAR_PORT || 5250` with no self-hosted mock AMCP server and no
	// `.live.` naming safeguard. Running the "full" gate on a box with a real CasparCG on :5250
	// sent live BEGIN/CLEAR/PLAY/COMMIT traffic to the production channel and wiped on-air layers
	// (channel 1 layers 10-15 CLEARed). Excluded until they gate on an explicit opt-in env var
	// (matching the `.live.test.js` convention) instead of silently succeeding against whatever
	// is listening on the default port.
	/^smoke-amcp-batch-library\.test\./i,
	/^smoke-amcp-legacy-transport\.test\./i,
	/^smoke-amcp-migration-air-paths\.test\./i,
	/^smoke-amcp-send-after\.test\./i,
]

function isOfflineTestFile(name) {
	if (!/\.test\.(js|mjs)$/i.test(name)) return false
	return !EXCLUDE_NAME.some((re) => re.test(name))
}

function walk(dir, out) {
	if (!fs.existsSync(dir)) return
	for (const name of fs.readdirSync(dir)) {
		if (name.includes('.sync-conflict-')) continue
		const fp = path.join(dir, name)
		const st = fs.lstatSync(fp)
		if (st.isDirectory()) {
			walk(fp, out)
			continue
		}
		if (isOfflineTestFile(name)) out.push(fp)
	}
}

function collectOfflineTestFiles() {
	/** @type {string[]} */
	const files = []
	for (const rel of SCAN_DIRS) walk(path.join(REPO_ROOT, rel), files)
	return files.sort()
}

module.exports = { collectOfflineTestFiles, EXCLUDE_NAME }

if (require.main === module) {
	for (const f of collectOfflineTestFiles()) console.log(path.relative(REPO_ROOT, f))
}
