#!/usr/bin/env node
/**
 * Write factory modular config into config/ for git (clean clone + CI).
 * Writes atomically without ConfigManager.save() so exFAT post-save sync cannot
 * pull machine-specific configs back from a mounted stick.
 *
 * Usage:
 *   node tools/ci/write-repo-default-config.js
 *   npm run config:write-defaults
 */
'use strict'

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const CONFIG_DIR = path.join(REPO_ROOT, 'config')

/** JSON in config/ that must stay machine-local (never overwrite or commit). */
const MACHINE_LOCAL_JSON = new Set([
	'exfat-sync.json',
	'hardware-identity.json',
	'replication-local-identity.json',
	'tailscale.json',
	'.highascg-state.json',
])

/** Factory defaults written here — keep in sync with .gitignore exceptions. */
const REPO_DEFAULT_CONFIG_FILES = [
	'general.json',
	'caspar.json',
	'server.json',
	'osc.json',
	'ui.json',
	'editor_defaults.json',
	'audio_routing.json',
	'dmx.json',
	'rtmp.json',
	'usb_ingest.json',
	'project_scoped_media.json',
	'streaming_channel.json',
	'record_outputs.json',
	'audio_outputs.json',
	'stream_outputs.json',
	'caspar_server.json',
	'screen_destinations.json',
	'device_graph.json',
	'companion.json',
	'plugins.json',
	'replication.json',
	'security.json',
]

const MODULAR_KEYS = [
	'caspar',
	'server',
	'osc',
	'ui',
	'editorDefaults',
	'audioRouting',
	'dmx',
	'rtmp',
	'usbIngest',
	'projectScopedMedia',
	'streamingChannel',
	'recordOutputs',
	'audioOutputs',
	'streamOutputs',
	'casparServer',
	'screenDestinations',
	'deviceGraph',
	'companion',
	'plugins',
	'replication',
	'security',
]

const defaults = require(path.join(REPO_ROOT, 'src/config/defaults'))
const { finalizeScreenDestinationsConfig, normalizeScreenDestinations } = require(
	path.join(REPO_ROOT, 'src/config/screen-destinations')
)
const { buildFactoryModularConfig } = require(path.join(REPO_ROOT, 'src/config/factory-starter'))

function camelToSnake(str) {
	return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

function atomicWrite(filePath, data) {
	const tmp = `${filePath}.tmp`
	fs.writeFileSync(tmp, data, 'utf8')
	fs.renameSync(tmp, filePath)
}

function writeModularConfig(dir, config) {
	const general = { ...config }
	for (const key of MODULAR_KEYS) {
		if (config[key] === undefined) continue
		const filename = `${camelToSnake(key)}.json`
		atomicWrite(path.join(dir, filename), JSON.stringify(config[key], null, 2))
		delete general[key]
	}
	if (Object.keys(general).length > 0) {
		atomicWrite(path.join(dir, 'general.json'), JSON.stringify(general, null, 2))
	}
}

function main() {
	if (!fs.existsSync(CONFIG_DIR)) {
		fs.mkdirSync(CONFIG_DIR, { recursive: true })
	}

	const factoryConfig = buildFactoryModularConfig(
		defaults,
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations
	)
	factoryConfig.audioOutputs = []
	factoryConfig.streamOutputs = []

	writeModularConfig(CONFIG_DIR, factoryConfig)

	const written = []
	for (const name of REPO_DEFAULT_CONFIG_FILES) {
		if (MACHINE_LOCAL_JSON.has(name)) continue
		const full = path.join(CONFIG_DIR, name)
		if (fs.existsSync(full)) written.push(name)
	}

	console.log(`[write-repo-default-config] OK — ${written.length} file(s) in config/`)
	for (const name of written) console.log(`  - ${name}`)
}

module.exports = { REPO_DEFAULT_CONFIG_FILES, MACHINE_LOCAL_JSON, writeModularConfig }

if (require.main === module) main()
