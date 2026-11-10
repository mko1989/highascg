#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const { ensureHardwareHostname, HARDWARE_IDENTITY_PATH } = require('../../src/system/hardware-identity')
const { loadNetworkConfig } = require('../../src/system/hardware-identity-select')
const { REPO_ROOT } = require('../../src/repo-paths')

/**
 * Boot / manual apply: migrate clone ISO hostnames (highascg-nvidia-*) → highascg####.
 * Intended to run as root via highascg-hardware-hostname.service.
 */
function log(level, msg) {
	const line = `[hardware-identity] ${level}: ${msg}`
	if (level === 'warn' || level === 'error') console.error(line)
	else console.log(line)
}

// WO-1029 P1d: read the same config.network the node reads (it used to pass none -> eno1 -> 7580 vs node 7579).
const hw = ensureHardwareHostname({ log, config: { network: loadNetworkConfig(path.join(REPO_ROOT, 'config')) } })

if (typeof process.getuid === 'function' && process.getuid() === 0) {
	try {
		if (fs.existsSync(HARDWARE_IDENTITY_PATH)) {
			execFileSync('chown', ['casparcg:casparcg', HARDWARE_IDENTITY_PATH], { stdio: 'ignore' })
		}
	} catch {
		/* ignore — identity file optional until first derive */
	}
}

if (hw.hostnameApplied) {
	log('info', `applied hostname ${hw.identity.hostname}`)
	process.exit(0)
}
if (hw.hostnameError) {
	log('warn', `hostname not applied: ${hw.hostnameError}`)
}
process.exit(0)
