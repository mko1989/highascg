'use strict'

/**
 * WO-868 — the "Operator GUI first" switch: one backend operation so nobody edits stores by hand.
 *
 *   1. plan (operator-first-plan.js) — refuse on any refusal (`force` overrides only `on_air`); a no-op returns at once
 *   2. backup into ~/.highascg/backup/wo868-<UTC>/ (projects/, persistence state, the config) — kept after success
 *   3. renumber, in one simultaneous pass per store: config slices (live sources, graph host channels, stream /
 *      record sources, virtual camera), persistence (channel-keyed live/bank maps re-keyed, multiview layouts, deck,
 *      web_project), every project + autosave file (each with its OWN rig's remap, stamped, rev bumped)
 *   4. set / clear `casparServer.operator_gui_first`, adopt the converted active project (deck mirror, clients
 *      reload through the usual project_sync broadcast)
 *   5. the standard full apply (config → layout → NVIDIA → Caspar restart; a sandbox writes the config only; skipped in
 *      offline preparation mode, which never writes casparcg.config)
 *
 * Disable runs the same steps toward the legacy scheme (the remap is role-identity based, so on → off is identity).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { withOperatorGuiFirst, CHANNEL_SCHEME_FIRST, CHANNEL_SCHEME_LEGACY } = require('../config/operator-gui-first')
const { remapDeep, remapChannelKeyedObject } = require('../config/channel-remap')
const { planOperatorFirst, publicPlan, listProjectFiles, CHANNEL_KEYED_STATE, ROUTE_STATE_RE } = require('./operator-first-plan')

function backupRoot() {
	return path.join(process.env.HOME || os.homedir(), '.highascg', 'backup')
}

/** @param {object} ctx @param {object} persistence */
function writeBackup(ctx, persistence) {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const dir = path.join(backupRoot(), `wo868-${stamp}`)
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
	const projectsDir = require('../engine/project-store').projectsDir()
	if (fs.existsSync(projectsDir)) fs.cpSync(projectsDir, path.join(dir, 'projects'), { recursive: true })
	try {
		persistence.flushSync?.()
	} catch {
		/* best effort */
	}
	fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(persistence.getAll ? persistence.getAll() : {}, null, 1), { mode: 0o600 })
	const cm = ctx.configManager
	fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cm ? cm.get() : ctx.config, null, 1), { mode: 0o600 })
	const cfgPath = cm?.configPath
	if (cfgPath && fs.existsSync(cfgPath) && fs.statSync(cfgPath).isDirectory()) {
		fs.mkdirSync(path.join(dir, 'config'), { mode: 0o700 })
		for (const n of fs.readdirSync(cfgPath)) {
			if (n.endsWith('.json')) fs.copyFileSync(path.join(cfgPath, n), path.join(dir, 'config', n))
		}
	}
	return dir
}

/** @param {string} file @param {object} value */
function writeJsonAtomic(file, value) {
	const tmp = `${file}.wo868.tmp`
	fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
	fs.renameSync(tmp, file)
}

/** Every project + autosave file into `toScheme`; returns the per-file counts. */
function convertProjectFiles(config, toScheme) {
	const { convertProjectChannelScheme } = require('../engine/project-channel-scheme')
	const dir = require('../engine/project-store').projectsDir()
	const done = []
	for (const f of listProjectFiles(dir)) {
		let project
		try {
			project = JSON.parse(fs.readFileSync(f, 'utf8'))
		} catch {
			continue
		}
		const r = convertProjectChannelScheme(project, config, { toScheme, absent: CHANNEL_SCHEME_LEGACY })
		if (!r.converted && r.project === project) continue
		const next = r.project
		// a client still holding the old numbers gets a stale-rev 409 instead of writing them back
		if (r.converted) next.rev = (Number.isFinite(Number(project.rev)) ? Number(project.rev) : 0) + 1
		writeJsonAtomic(f, next)
		done.push({ file: path.relative(dir, f), references: r.count })
	}
	return done
}

/** Persistence + its in-memory mirrors. */
function remapPersistence(ctx, persistence, remap, toScheme) {
	const all = persistence.getAll ? persistence.getAll() : {}
	const keys = []
	for (const [key, value] of Object.entries(all)) {
		const stats = { count: 0 }
		let next
		if (CHANNEL_KEYED_STATE.includes(key)) next = remapChannelKeyedObject(value, remap, stats)
		else if (ROUTE_STATE_RE.test(key)) next = remapDeep(value, remap, stats)
		else if (key === 'web_project' && value && typeof value === 'object') {
			const r = require('../engine/project-channel-scheme').convertProjectChannelScheme(value, ctx.config, { toScheme })
			next = r.project
			stats.count = r.converted ? r.count : 0
		} else continue
		if (!stats.count) continue
		persistence.set(key, next)
		keys.push(key)
		if (key === 'programLayerBankByChannel' && ctx.liveDeck?.replaceProgramLayerBanks) {
			ctx.liveDeck.replaceProgramLayerBanks(next)
			ctx.liveDeck.persistProgramLayerBanks?.()
		}
		if (key === 'multiviewLayout') ctx._multiviewLayout = next
	}
	if (ctx._multiviewLayouts && typeof ctx._multiviewLayouts === 'object') {
		for (const n of Object.keys(ctx._multiviewLayouts)) ctx._multiviewLayouts[n] = remapDeep(ctx._multiviewLayouts[n], remap)
	}
	return keys
}

/** Re-read the (converted) active project and hand it to the deck mirror + clients. */
function adoptActiveProject(ctx, persistence) {
	const projectStore = require('../engine/project-store')
	const slug = projectStore.getActiveSlug(persistence)
	const project = slug ? projectStore.readProjectFile(slug) : null
	if (!project) return null
	const { adoptSceneDeckFromProject } = require('../engine/project-activate')
	adoptSceneDeckFromProject(ctx, project)
	persistence.set('web_project', projectStore.withProjectSlug(project, slug))
	try {
		require('../api/routes-data-project-sync').scheduleProjectSyncBroadcast(ctx, project)
	} catch {
		/* no clients */
	}
	return slug
}

/**
 * @param {object} ctx
 * @param {{ enable: boolean, force?: boolean, apply?: boolean, log?: (level: string, msg: string) => void }} opts
 * @returns {Promise<{ ok: boolean, status: number, plan: object, backupDir?: string, projects?: object[],
 *   persistenceKeys?: string[], configSlices?: string[], activeProject?: string|null, apply?: object|null, error?: string }>}
 */
async function runOperatorFirstSwitch(ctx, opts) {
	const log = typeof opts.log === 'function' ? opts.log : () => {}
	const enable = opts.enable === true
	const plan = planOperatorFirst(ctx, { enable, includeProjects: true })
	const blocking = plan.refusals.filter((r) => !(r.forceable && opts.force === true))
	if (blocking.length) {
		return { ok: false, status: 409, error: blocking.map((r) => r.message).join(' '), plan: publicPlan(plan) }
	}
	if (plan.noop) return { ok: true, status: 200, noop: true, plan: publicPlan(plan) }
	const persistence = ctx.persistence || require('../utils/persistence')
	const toScheme = enable ? CHANNEL_SCHEME_FIRST : CHANNEL_SCHEME_LEGACY
	const backupDir = writeBackup(ctx, persistence)
	log('info', `[WO-868] Operator GUI first → ${enable ? 'ON' : 'OFF'}: backup ${backupDir}; remap ${JSON.stringify(plan.remap)}`)

	// projects first, while the live config still describes the scheme they are in
	const projects = convertProjectFiles(ctx.config, toScheme)
	const persistenceKeys = remapPersistence(ctx, persistence, plan._remap, toScheme)

	const cm = ctx.configManager
	const base = cm ? cm.get() : ctx.config
	const next = withOperatorGuiFirst({ ...base, ...plan._configPatch }, enable)
	if (cm) {
		cm.save(next)
		Object.assign(ctx.config, cm.get())
	} else Object.assign(ctx.config, next)
	if (!enable && ctx.config.casparServer) delete ctx.config.casparServer.operator_gui_first
	try {
		persistence.flushSync?.()
	} catch {
		/* best effort */
	}
	const activeProject = adoptActiveProject(ctx, persistence)
	const renumbered = projects.filter((p) => p.references > 0)
	log('info', `[WO-868] ${projects.length} project file(s) stamped, ${renumbered.length} renumbered (${renumbered.reduce((n, p) => n + p.references, 0)} reference(s)); state keys [${persistenceKeys.join(', ')}]; config [${Object.keys(plan._configPatch).join(', ')}]`)

	let apply = null
	// offline preparation mode never writes casparcg.config (routes-caspar-config.js): the stores are switched, the
	// config follows on the first apply after offline mode is turned off
	const applySkipped = opts.apply === false ? 'requested' : ctx.config?.offline_mode ? 'offline_mode' : null
	if (!applySkipped) {
		const { applyCasparConfigToDiskAndRestart } = require('../api/routes-caspar-config')
		const res = await applyCasparConfigToDiskAndRestart(ctx, { force: true })
		try {
			apply = { status: res.status, ...JSON.parse(res.body) }
		} catch {
			apply = { status: res.status }
		}
		delete apply.fullApply
	}
	if (typeof ctx._wsBroadcast === 'function') {
		try {
			ctx._wsBroadcast('change', { path: 'system.operatorFirst', value: { enabled: enable, backupDir } })
		} catch {
			/* optional */
		}
	}
	const ok = !apply || apply.status === 200
	return {
		ok,
		status: ok ? 200 : 502,
		...(ok ? {} : { error: apply?.error || 'Full apply failed' }),
		plan: publicPlan(plan),
		backupDir,
		projects,
		persistenceKeys,
		configSlices: Object.keys(plan._configPatch),
		activeProject,
		apply,
		...(applySkipped ? { applySkipped } : {}),
	}
}

module.exports = { runOperatorFirstSwitch }
