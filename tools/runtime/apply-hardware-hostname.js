#!/usr/bin/env node
'use strict'

const fs = require('fs')
const { execFileSync } = require('child_process')
const { ensureHardwareHostname, HARDWARE_IDENTITY_PATH } = require('../../src/system/hardware-identity')

/**
 * Boot / manual apply: migrate clone ISO hostnames (highascg-nvidia-*) → highascg####.
 * Intended to run as root via highascg-hardware-hostname.service.
 */
function log(level, msg) {
	const line = `[hardware-identity] ${level}: ${msg}`
	if (level === 'warn' || level === 'error') console.error(line)
	else console.log(line)
}

const hw = ensureHardwareHostname({ log })

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
