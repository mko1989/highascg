#!/usr/bin/env node
'use strict'
/**
 * WO-926 — after install-iso-defaults.sh prunes node_modules to what the ISO ships (--omit=dev --omit=optional),
 * start the server from this tree in the hermetic e2e sandbox (scratch HOME, --no-caspar, no X, sandbox guards) and
 * fail the build when it does not answer. The 01.11 ISO shipped a server that exited at boot with
 * `Cannot find module 'jszip'` (a package that only came in under an optional dependency); this would have caught it.
 *
 *   node tools/eggs/live-usb/verify-production-boot.js
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { startSandbox } = require('../../e2e/sandbox-server')

async function main() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-prod-boot-'))
	try {
		const sb = await startSandbox({ root })
		await sb.stop()
		console.log(`verify-production-boot: OK — the pruned server answered on ${sb.url}`)
		return 0
	} catch (e) {
		console.error(`verify-production-boot: FAILED — the ISO's server would not start:\n${e?.message || e}`)
		return 1
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
}

main().then((code) => process.exit(code))
