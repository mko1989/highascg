#!/usr/bin/env node
/**
 * Write factory modular config + starter show into an exFAT layout directory
 * (configs/ + configs/.highascg-state.json with web_project).
 *
 * Usage:
 *   node tools/eggs/live-usb/write-exfat-starter-bundle.js [/path/to/exfat/root]
 */
'use strict'

const fs = require('fs')
const path = require('path')

const {
	REPO_ROOT,
	buildFactoryModularConfig,
	buildStarterProject,
	attachStarterHardwareConfig,
	buildStarterPersistenceState,
} = require('./starter-project')

const exfatRoot = path.resolve(process.argv[2] || '/tmp/highascg-exfat-starter')
const configsDir = path.join(exfatRoot, 'configs')

const { ConfigManager } = require(path.join(REPO_ROOT, 'src/config/config-manager'))
const defaults = require(path.join(REPO_ROOT, 'src/config/defaults'))
const {
	finalizeScreenDestinationsConfig,
	normalizeScreenDestinations,
} = require(path.join(REPO_ROOT, 'src/config/screen-destinations'))

function writeModularConfigs() {
	fs.mkdirSync(configsDir, { recursive: true })
	const factoryConfig = buildFactoryModularConfig(
		defaults,
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations,
	)
	const cm = new ConfigManager(configsDir, console)
	if (!cm.save(factoryConfig)) {
		throw new Error('Failed to write modular config into configs/')
	}
	return factoryConfig
}

function writeStarterState(factoryConfig) {
	const statePath = path.join(configsDir, '.highascg-state.json')
	const project = attachStarterHardwareConfig(buildStarterProject(), factoryConfig)
	fs.writeFileSync(statePath, JSON.stringify(buildStarterPersistenceState(project), null, 2), 'utf8')
}

function copyCasparTemplate() {
	const isoXml = path.join(REPO_ROOT, 'config', 'casparcg.config.iso')
	const dest = path.join(configsDir, 'casparcg.config')
	if (fs.existsSync(isoXml)) {
		fs.copyFileSync(isoXml, dest)
	}
}

function main() {
	if (!fs.existsSync(path.join(REPO_ROOT, 'package.json'))) {
		console.error(`Expected repo at ${REPO_ROOT}`)
		process.exit(1)
	}
	const factoryConfig = writeModularConfigs()
	writeStarterState(factoryConfig)
	copyCasparTemplate()
	console.log(`OK: starter configs + show → ${configsDir}`)
}

main()
