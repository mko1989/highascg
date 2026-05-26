#!/usr/bin/env node
/**
 * Write factory modular config into HIGHASCG_ROOT/config before eggs --clone.
 * Replaces the eggs build host's saved settings (GPU map, screens, routing, …).
 */
'use strict'

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(process.env.HIGHASCG_ROOT || path.join(__dirname, '../../..'))
const configDir = path.join(REPO_ROOT, 'config')

const { ConfigManager } = require(path.join(REPO_ROOT, 'src/config/config-manager'))
const defaults = require(path.join(REPO_ROOT, 'src/config/defaults'))
const { finalizeScreenDestinationsConfig } = require(path.join(REPO_ROOT, 'src/config/screen-destinations'))

/** JSON files kept as repo templates (not operator settings). */
const PRESERVE_JSON = new Set([
	'casparcg.config.iso',
	'exfat-sync.json',
])

function unlinkIfExists(p) {
	try {
		if (fs.existsSync(p)) fs.unlinkSync(p)
	} catch (e) {
		console.error(`Failed to remove ${p}: ${e.message}`)
		process.exit(1)
	}
}

function main() {
	if (!fs.existsSync(configDir)) {
		console.error(`Missing config directory: ${configDir}`)
		process.exit(1)
	}

	for (const ent of fs.readdirSync(configDir)) {
		if (!ent.endsWith('.json')) continue
		if (PRESERVE_JSON.has(ent)) continue
		unlinkIfExists(path.join(configDir, ent))
	}

	for (const rel of ['highascg.config.json', '.highascg-state.json', '.module-state.json']) {
		unlinkIfExists(path.join(REPO_ROOT, rel))
	}

	const config = finalizeScreenDestinationsConfig(JSON.parse(JSON.stringify(defaults)))
	const cm = new ConfigManager(configDir, console)
	if (!cm.save(config)) {
		console.error('Failed to write factory modular config')
		process.exit(1)
	}

	console.log(`OK: factory modular config → ${configDir}`)
}

main()
