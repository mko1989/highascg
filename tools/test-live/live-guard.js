'use strict'

/**
 * WO-836: the LIVE-BOX test category.
 *
 * Files under tools/test-live/ talk to the real box: AMCP to the real CasparCG (:5250), requests to the running
 * HighAsCG API (:4200), a second node on the live config, real LAN sockets. They are NEVER part of `npm run test:ci`
 * (the offline gate) and refuse to do anything unless the operator opts in:
 *
 *   HIGHASCG_LIVE_TESTS=1 npm run test:live          # the whole category (tools/test-live/run-live-tests.js)
 *   HIGHASCG_LIVE_TESTS=1 node --test tools/test-live/<file>
 *
 * `npm run test:live` sets the variable itself (typing the command is the opt-in); a bare `node --test <file>` does
 * not. Usage at the top of a CommonJS live file (a top-level `return` is legal in CJS):
 *
 *   const { liveGuard } = require('./live-guard')
 *   if (!liveGuard(__filename)) return
 *
 * ES modules cannot `return`; they call `requireLiveOrExit(import.meta.url)` instead.
 *
 * Why a skipped *test* and not a silent exit: `node --test` then reports "skipped" for the file, so a release run
 * that forgot the opt-in is visible instead of looking green.
 */
const path = require('path')

const ENV = 'HIGHASCG_LIVE_TESTS'

function isLiveEnabled(env = process.env) {
	return env[ENV] === '1'
}

function skipMessage(file) {
	const name = path.basename(String(file || '').replace(/^file:\/\//, ''))
	return `live-box test ${name} skipped — it acts on the real box (AMCP / API / LAN). Set ${ENV}=1 (or run \`npm run test:live\`) to run it.`
}

/**
 * @param {string} file  __filename of the live test
 * @returns {boolean} true when the live category is enabled; false after registering a skipped placeholder test
 */
function liveGuard(file) {
	if (isLiveEnabled()) return true
	const msg = skipMessage(file)
	if (process.env.NODE_TEST_CONTEXT) {
		// under `node --test`: a skipped test shows up in the summary
		require('node:test').test(msg, { skip: msg }, () => {})
	} else {
		console.log(`[live-guard] ${msg}`)
	}
	return false
}

/** ESM / script variant: print the skip and exit 0 (nothing below the call may run). */
function requireLiveOrExit(file) {
	if (isLiveEnabled()) return
	console.log(`[live-guard] ${skipMessage(file)}`)
	process.exit(0)
}

module.exports = { liveGuard, requireLiveOrExit, isLiveEnabled, skipMessage, ENV }
