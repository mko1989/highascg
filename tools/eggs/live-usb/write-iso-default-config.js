#!/usr/bin/env node
/**
 * Write factory modular config into HIGHASCG_ROOT/config before eggs --clone.
 * Replaces the eggs build host's saved settings (GPU map, screens, routing, …)
 * and resets projects/ to a single starter show.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const {
	REPO_ROOT,
	STARTER_PROJECT_SLUG,
	buildFactoryModularConfig,
	buildStarterProject,
	attachStarterHardwareConfig,
	buildStarterPersistenceState,
} = require('./starter-project')

const highascgRoot = path.resolve(process.env.HIGHASCG_ROOT || path.join(__dirname, '../../..'))
const configDir = path.join(highascgRoot, 'config')
const projectsDir = path.join(highascgRoot, 'projects')

const { ConfigManager } = require(path.join(REPO_ROOT, 'src/config/config-manager'))
const defaults = require(path.join(REPO_ROOT, 'src/config/defaults'))
const {
	finalizeScreenDestinationsConfig,
	normalizeScreenDestinations,
} = require(path.join(REPO_ROOT, 'src/config/screen-destinations'))

/** JSON files kept as repo templates (not operator settings). */
const PRESERVE_JSON = new Set(['casparcg.config.iso', 'exfat-sync.json'])

function unlinkIfExists(p) {
	try {
		if (fs.existsSync(p)) fs.unlinkSync(p)
	} catch (e) {
		console.error(`Failed to remove ${p}: ${e.message}`)
		process.exit(1)
	}
}

function resetProjectsDir(starterProject) {
	if (!fs.existsSync(projectsDir)) {
		fs.mkdirSync(projectsDir, { recursive: true })
	}
	for (const ent of fs.readdirSync(projectsDir)) {
		const full = path.join(projectsDir, ent)
		if (ent === '_autosave') {
			for (const sub of fs.readdirSync(full)) {
				unlinkIfExists(path.join(full, sub))
			}
			continue
		}
		if (ent.endsWith('.json')) unlinkIfExists(full)
	}
	const autosaveDir = path.join(projectsDir, '_autosave')
	if (!fs.existsSync(autosaveDir)) fs.mkdirSync(autosaveDir, { recursive: true })
	const starterPath = path.join(projectsDir, `${STARTER_PROJECT_SLUG}.json`)
	fs.writeFileSync(starterPath, JSON.stringify(starterProject, null, 2), 'utf8')
	fs.writeFileSync(
		path.join(autosaveDir, `${STARTER_PROJECT_SLUG}.json`),
		JSON.stringify(starterProject, null, 2),
		'utf8',
	)
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

	for (const rel of ['highascg.config.json', '.highascg-state.json', '.module-state.json', 'autosave.json']) {
		unlinkIfExists(path.join(highascgRoot, rel))
	}

	const factoryConfig = buildFactoryModularConfig(
		defaults,
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations,
	)
	const cm = new ConfigManager(configDir, console)
	if (!cm.save(factoryConfig)) {
		console.error('Failed to write factory modular config')
		process.exit(1)
	}

	const starterProject = attachStarterHardwareConfig(buildStarterProject(), factoryConfig)
	resetProjectsDir(starterProject)
	fs.writeFileSync(
		path.join(highascgRoot, '.highascg-state.json'),
		JSON.stringify(buildStarterPersistenceState(starterProject), null, 2),
		'utf8',
	)

	console.log(`OK: factory modular config → ${configDir}`)
	console.log(`OK: starter project → ${path.join(projectsDir, `${STARTER_PROJECT_SLUG}.json`)}`)
}

main()
