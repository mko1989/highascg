#!/usr/bin/env node
/**
 * Clean-slate reset — internal projects/config/media wipe; preserve bridge + exFAT.
 * WO-69 operator CLI (backup-box QA entry point).
 *
 * Usage:
 *   node tools/runtime/clean-slate-reset.js --dry-run
 *   node tools/runtime/clean-slate-reset.js --backup-box --yes
 *   sudo systemctl restart highascg   # after reset
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO_ROOT = path.resolve(__dirname, '../..')
const HIGHASCG_ROOT = path.resolve(process.env.HIGHASCG_ROOT || REPO_ROOT)

const PRESERVE_CONFIG_JSON = new Set(['casparcg.config.iso', 'exfat-sync.json'])

/** Config keys stashed during --backup-box (local machine profile for hot backup). */
const BACKUP_BOX_PRESERVE = ['device_graph.json', 'replication-local-machine.json']

function parseArgs(argv) {
	const out = { dryRun: false, yes: false, backupBox: false }
	for (const a of argv.slice(2)) {
		if (a === '--dry-run') out.dryRun = true
		else if (a === '--yes' || a === '-y') out.yes = true
		else if (a === '--backup-box') out.backupBox = true
		else if (a === '-h' || a === '--help') {
			console.log(`Usage: node tools/runtime/clean-slate-reset.js [--dry-run] [--yes] [--backup-box]

  --backup-box   Preserve device_graph + replication-local-machine (hot backup follower QA)
  --dry-run      Print actions only
  --yes          Required to apply changes (except with --dry-run)

After reset on backup: restart highascg, leader → Become leader, backup → Follower → Connect.
Config show slice + project media rsync from leader on connect (replication.mediaTransport: rsync).`)
			process.exit(0)
		} else {
			console.error(`Unknown arg: ${a}`)
			process.exit(2)
		}
	}
	return out
}

function unlinkIfExists(p, dryRun) {
	if (!fs.existsSync(p)) return false
	if (dryRun) {
		console.log(`[dry-run] unlink ${p}`)
		return true
	}
	fs.unlinkSync(p)
	return true
}

function rmRf(p, dryRun) {
	if (!fs.existsSync(p)) return
	if (dryRun) {
		console.log(`[dry-run] rm -rf ${p}`)
		return
	}
	fs.rmSync(p, { recursive: true, force: true })
}

function stashConfigFiles(configDir, names, dryRun) {
	/** @type {Record<string, string>} */
	const stash = {}
	for (const name of names) {
		const full = path.join(configDir, name)
		if (!fs.existsSync(full)) continue
		if (dryRun) {
			console.log(`[dry-run] stash ${full}`)
			stash[name] = '(dry-run)'
			continue
		}
		stash[name] = fs.readFileSync(full, 'utf8')
	}
	return stash
}

function restoreConfigFiles(configDir, stash, dryRun) {
	for (const [name, body] of Object.entries(stash)) {
		if (body === '(dry-run)') continue
		const full = path.join(configDir, name)
		if (dryRun) {
			console.log(`[dry-run] restore ${full}`)
			continue
		}
		fs.writeFileSync(full, body, 'utf8')
	}
}

function resetProjects(projectsDir, dryRun) {
	const {
		STARTER_PROJECT_SLUG,
		buildStarterProject,
		attachStarterHardwareConfig,
		buildStarterPersistenceState,
		buildFactoryModularConfig,
	} = require('../eggs/live-usb/starter-project')
	const defaults = require('../../src/config/defaults')

	const {
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations,
	} = require('../../src/config/screen-destinations')

	if (dryRun) {
		console.log(`[dry-run] reset projects under ${projectsDir}`)
		return { starterSlug: STARTER_PROJECT_SLUG }
	}

	if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true })
	for (const ent of fs.readdirSync(projectsDir)) {
		const full = path.join(projectsDir, ent)
		if (ent === '_autosave') {
			for (const sub of fs.readdirSync(full)) {
				unlinkIfExists(path.join(full, sub), false)
			}
			continue
		}
		if (ent.endsWith('.json')) unlinkIfExists(full, false)
	}

	const factoryConfig = buildFactoryModularConfig(
		defaults,
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations,
	)
	const starterProject = attachStarterHardwareConfig(buildStarterProject(), factoryConfig)
	const starterPath = path.join(projectsDir, `${STARTER_PROJECT_SLUG}.json`)
	fs.writeFileSync(starterPath, JSON.stringify(starterProject, null, 2), 'utf8')
	const autosaveDir = path.join(projectsDir, '_autosave')
	if (!fs.existsSync(autosaveDir)) fs.mkdirSync(autosaveDir, { recursive: true })
	fs.writeFileSync(
		path.join(autosaveDir, `${STARTER_PROJECT_SLUG}.json`),
		JSON.stringify(starterProject, null, 2),
		'utf8',
	)
	fs.writeFileSync(
		path.join(HIGHASCG_ROOT, '.highascg-state.json'),
		JSON.stringify(buildStarterPersistenceState(starterProject), null, 2),
		'utf8',
	)
	return { starterSlug: STARTER_PROJECT_SLUG }
}

function resetConfig(configDir, stash, dryRun) {
	if (dryRun) {
		console.log(`[dry-run] factory config reset in ${configDir}`)
		restoreConfigFiles(configDir, stash, true)
		return
	}

	for (const ent of fs.readdirSync(configDir)) {
		if (!ent.endsWith('.json')) continue
		if (PRESERVE_CONFIG_JSON.has(ent)) continue
		if (stash[ent]) continue
		unlinkIfExists(path.join(configDir, ent), false)
	}

	const defaults = require('../../src/config/defaults')
	const { ConfigManager } = require('../../src/config/config-manager')
	const {
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations,
	} = require('../../src/config/screen-destinations')
	const { buildFactoryModularConfig } = require('../eggs/live-usb/starter-project')

	const factoryConfig = buildFactoryModularConfig(
		defaults,
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations,
	)
	const cm = new ConfigManager(configDir, console)
	if (!cm.save(factoryConfig)) {
		throw new Error('Failed to write factory modular config')
	}
	restoreConfigFiles(configDir, stash, false)
}

function runMediaScript(dryRun, assumeYes) {
	const script = path.join(REPO_ROOT, 'scripts/runtime/highascg-clean-slate-reset.sh')
	const args = [script]
	if (dryRun) args.push('--dry-run')
	if (assumeYes || dryRun) args.push('--yes')
	const out = execFileSync('bash', args, {
		cwd: REPO_ROOT,
		env: { ...process.env, HIGHASCG_ROOT },
		encoding: 'utf8',
	})
	return JSON.parse(out.trim().split('\n').pop() || '{}')
}

function resetCasparConfig(dryRun) {
	const iso = path.join(HIGHASCG_ROOT, 'config', 'casparcg.config.iso')
	const live = path.join(HIGHASCG_ROOT, 'config', 'casparcg.config')
	if (!fs.existsSync(iso)) return
	if (dryRun) {
		console.log(`[dry-run] copy ${iso} → ${live}`)
		return
	}
	fs.copyFileSync(iso, live)
}

async function pushCleanStateToVolumes(dryRun) {
	if (dryRun) {
		console.log('[dry-run] purge stale bridge/USB project mirrors')
		console.log('[dry-run] push clean state/projects/config to bridge (+ USB if mounted)')
		return { copied: 0, skipped: 0, errors: [] }
	}
	purgeStaleVolumeProjectMirrors(dryRun)
	try {
		const { pushProjectConfigToExfat } = require('../../src/system/exfat-sync')
		return await pushProjectConfigToExfat({
			log: (level, msg) => console.log(`[${level}] ${msg}`),
			pairIds: [
				'bridge-modular-config',
				'bridge-state-highascg',
				'bridge-state-module',
				'bridge-projects',
				'usb-state-highascg',
				'usb-state-module',
				'usb-projects',
				'usb-modular-config',
			],
		})
	} catch (e) {
		console.warn(`[clean-slate] volume push skipped: ${e.message}`)
		return { copied: 0, skipped: 0, errors: [e.message] }
	}
}

/** Remove old show JSON on bridge/USB so boot sync cannot resurrect the previous project. */
function purgeStaleVolumeProjectMirrors(dryRun) {
	const roots = ['/home/casparcg/bridge/projects', '/home/casparcg/exfat/projects']
	for (const root of roots) {
		if (!fs.existsSync(root)) continue
		for (const ent of fs.readdirSync(root)) {
			const full = path.join(root, ent)
			if (ent === '_autosave') {
				for (const sub of fs.readdirSync(full)) {
					const p = path.join(full, sub)
					if (dryRun) console.log(`[dry-run] unlink ${p}`)
					else unlinkIfExists(p, false)
				}
				continue
			}
			if (!ent.endsWith('.json')) continue
			if (dryRun) console.log(`[dry-run] unlink ${full}`)
			else unlinkIfExists(full, false)
		}
	}
}

function clearStateFiles(dryRun) {
	for (const rel of [
		'.highascg-state.json',
		'.module-state.json',
		'autosave.json',
		'highascg.config.json',
		'config/.highascg-state.json',
	]) {
		unlinkIfExists(path.join(HIGHASCG_ROOT, rel), dryRun)
	}
	try {
		const { clearPersistedOsLayout } = require('../../src/utils/os-config')
		if (!dryRun) clearPersistedOsLayout({ reason: 'clean slate reset' })
		else console.log('[dry-run] clearPersistedOsLayout')
	} catch (e) {
		console.warn(`[clean-slate] os layout clear skipped: ${e.message}`)
	}
}

function main() {
	const opts = parseArgs(process.argv)
	if (!opts.dryRun && !opts.yes) {
		console.error('Refusing without --yes (use --dry-run to preview)')
		process.exit(1)
	}

	void run(opts).catch((e) => {
		console.error(e)
		process.exit(1)
	})
}

async function run(opts) {
	const configDir = path.join(HIGHASCG_ROOT, 'config')
	const projectsDir = path.join(HIGHASCG_ROOT, 'projects')

	const stashNames = opts.backupBox ? BACKUP_BOX_PRESERVE : []
	const stash = stashConfigFiles(configDir, stashNames, opts.dryRun)

	console.log(`==> Clean slate (${opts.backupBox ? 'backup-box' : 'full'}) dryRun=${opts.dryRun}`)
	if (opts.backupBox) {
		console.log('    Preserving:', BACKUP_BOX_PRESERVE.join(', ') || '(none)')
	}

	clearStateFiles(opts.dryRun)
	resetConfig(configDir, stash, opts.dryRun)
	const { starterSlug } = resetProjects(projectsDir, opts.dryRun)
	resetCasparConfig(opts.dryRun)

	let mediaSummary = { ok: true, mediaDeleted: 0, mediaSkipped: 0 }
	try {
		mediaSummary = runMediaScript(opts.dryRun, opts.yes)
	} catch (e) {
		console.error(`[clean-slate] media phase failed: ${e.message}`)
		mediaSummary = { ok: false, error: e.message }
	}

	let volumePush = { copied: 0, skipped: 0, errors: [] }
	if (!opts.dryRun) {
		volumePush = await pushCleanStateToVolumes(false)
	} else {
		await pushCleanStateToVolumes(true)
	}

	const summary = {
		ok: mediaSummary.ok !== false,
		mode: opts.backupBox ? 'backup-box' : 'full',
		dryRun: opts.dryRun,
		starterProject: starterSlug,
		replication: 'defaults (unpaired standalone)',
		media: mediaSummary,
		volumePush,
		note:
			'Stop highascg before reset when possible. Bridge/USB copies are pushed after wipe so boot sync does not restore the old show.',
		next: [
			'sudo systemctl restart highascg',
			'Leader: Device View → Hot backup → Become leader',
			'Backup: Follower → Scan → Connect to leader',
			'Leader pushes project + show config; media rsync runs on connect',
		],
	}
	console.log(JSON.stringify(summary, null, 2))
}

main()
