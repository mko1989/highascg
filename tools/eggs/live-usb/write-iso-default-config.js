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

/** WO-168 T168.5: shared reset/verify/runtime manifest — see src/config/factory-defaults-manifest.js. */
const {
	PRESERVE_JSON,
	ROOT_STATE_FILES,
	STALE_ROOT_STAMP_FILES,
	PROJECTS_AUTOSAVE_DIR,
	isConfigBackupEntry,
} = require(path.join(REPO_ROOT, 'src/config/factory-defaults-manifest'))

/** Factory media-scanner config (WO-162). The scanner binary opens
 *  ./casparcg.config relative to its WorkingDirectory (the repo root) — NOT
 *  scanner.config, and NOT the server's config/casparcg.config. Single source
 *  of truth is the git-tracked template; the inline copy is a fallback so
 *  ISOs never ship without it even if the template moves. */
const SCANNER_CONFIG_TEMPLATE = path.join(REPO_ROOT, 'scripts/setup/templates/scanner.config')
const SCANNER_CONFIG_FALLBACK = `<?xml version="1.0" encoding="utf-8"?>
<!--
  CasparCG MEDIA-SCANNER config (read from cwd by casparcg-scanner.service:
  /usr/bin/casparcg-scanner opens ./casparcg.config relative to
  WorkingDirectory=/home/casparcg/highascg).
  The playout SERVER's config is config/casparcg.config. Do not confuse.
-->
<configuration>
  <paths>
    <media-path>media/</media-path>
  </paths>

  <amcp>
    <media-server>
      <host>127.0.0.1</host>
      <port>8000</port>
    </media-server>
  </amcp>
</configuration>
`

function writeScannerConfig() {
	const dest = path.join(highascgRoot, 'casparcg.config')
	let content = SCANNER_CONFIG_FALLBACK
	try {
		if (fs.existsSync(SCANNER_CONFIG_TEMPLATE)) {
			content = fs.readFileSync(SCANNER_CONFIG_TEMPLATE, 'utf8')
		}
	} catch (e) {
		console.error(`Failed to read ${SCANNER_CONFIG_TEMPLATE}: ${e.message} — using inline fallback`)
	}
	try {
		fs.writeFileSync(dest, content, 'utf8')
	} catch (e) {
		console.error(`Failed to write ${dest}: ${e.message}`)
		process.exit(1)
	}
	return dest
}

function unlinkIfExists(p) {
	try {
		if (fs.existsSync(p)) fs.unlinkSync(p)
	} catch (e) {
		console.error(`Failed to remove ${p}: ${e.message}`)
		process.exit(1)
	}
}

/** WO-168 T168.3: recursive purge for projects/_trash/ tombstones and other non-JSON clutter. */
function rmrfIfExists(p) {
	try {
		if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
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
		if (ent === PROJECTS_AUTOSAVE_DIR) {
			for (const sub of fs.readdirSync(full)) {
				unlinkIfExists(path.join(full, sub))
			}
			continue
		}
		if (ent.endsWith('.json')) {
			unlinkIfExists(full)
			continue
		}
		// WO-168 T168.3: projects/_trash/ tombstones, sync-conflict files, and any
		// other build-host clutter — factory reset ships exactly the starter
		// project + its autosave, nothing else.
		rmrfIfExists(full)
	}
	const autosaveDir = path.join(projectsDir, PROJECTS_AUTOSAVE_DIR)
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
		if (ent.endsWith('.json')) {
			if (PRESERVE_JSON.has(ent)) continue
			unlinkIfExists(path.join(configDir, ent))
			continue
		}
		// WO-168 T168.3: config/*.bak* + "casparcg copy.config"-style duplicates
		// are build-host backups, not operator settings — belt-and-suspenders
		// vs. the exclude list (which also omits these from the ISO squashfs).
		if (isConfigBackupEntry(ent)) {
			unlinkIfExists(path.join(configDir, ent))
		}
	}

	for (const rel of ROOT_STATE_FILES) {
		unlinkIfExists(path.join(highascgRoot, rel))
	}

	// WO-168 T168.4: stray drop-update stamps at HIGHASCG_ROOT (no runtime
	// consumer there — see factory-defaults-manifest.js). Does NOT touch
	// BUILD_STAMP / .highascg-build-stamp (runtime version reporting).
	for (const rel of STALE_ROOT_STAMP_FILES) {
		unlinkIfExists(path.join(highascgRoot, rel))
	}

	// WO-162: the root-level scanner config (casparcg.config, read by the
	// scanner binary from cwd) is NOT operator data — always (re)write the
	// factory template so produced ISOs ship a valid media-scanner config.
	const scannerConfigPath = writeScannerConfig()

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
	console.log(`OK: factory scanner config → ${scannerConfigPath}`)
}

// WO-168 T168.7: guard so smokes can `require()` this module (e.g. to reuse
// resetProjectsDir against a fixture tree) without triggering a real run —
// production invocation is unchanged (`node write-iso-default-config.js`,
// optionally with HIGHASCG_ROOT set, same as before).
if (require.main === module) {
	main()
}

module.exports = { main, resetProjectsDir, writeScannerConfig, highascgRoot, configDir, projectsDir }
