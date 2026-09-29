'use strict'

/**
 * Atomic "new project" — empty Untitled show + eggs starter routing (1× PGM).
 */
const defaults = require('../config/defaults')
const { finalizeScreenDestinationsConfig, normalizeScreenDestinations } = require('../config/screen-destinations')
const {
	buildHardwareConfigFromConfig,
	applyHardwareConfigToCtx,
} = require('./project-hardware-config')
const { persistProject } = require('./project-scenes')
const { ensureProjectMediaDir } = require('../media/project-media-root')
const projectStore = require('./project-store')
const { persistSceneDeckForCtx } = require('../state/live-deck-state')
const { buildFactoryModularConfig } = require('../config/factory-starter')

const EMPTY_PROJECT_TEMPLATE = require('../config/default-empty-project.json')

const DEFAULT_PROJECT_NAME = 'Untitled'
const PROJECT_VERSION = 2

/**
 * @param {object} hardwareConfig
 * @returns {object}
 */
function buildNewUntitledProject(hardwareConfig) {
	return {
		...JSON.parse(JSON.stringify(EMPTY_PROJECT_TEMPLATE)),
		version: PROJECT_VERSION,
		name: DEFAULT_PROJECT_NAME,
		savedAt: new Date().toISOString(),
		hardwareConfig,
	}
}

/**
 * @param {object} persistence
 * @returns {{ factoryConfig: object, hardwareConfig: object }}
 */
function buildStarterHardwareConfig(persistence) {
	const factoryConfig = buildFactoryModularConfig(
		defaults,
		finalizeScreenDestinationsConfig,
		normalizeScreenDestinations,
	)
	return {
		factoryConfig,
		hardwareConfig: buildHardwareConfigFromConfig(factoryConfig, persistence),
	}
}

/**
 * @param {object} cfg
 * @returns {object[] | null} deep copy of the live GPU physical port map, or null when unset
 */
function copyLiveGpuTopology(cfg) {
	const rows = cfg?.gpuPhysicalTopology
	return Array.isArray(rows) && rows.length ? JSON.parse(JSON.stringify(rows)) : null
}

/**
 * Apply starter routing and persist empty Untitled project.
 * @param {object} ctx
 * @returns {{ project: object, slug: string }}
 */
function createNewProject(ctx) {
	if (!ctx?.configManager) {
		throw new Error('Server context missing configManager')
	}
	/* WO-569: stop the operator-GUI compose routes/shape holes on the CURRENT (about-to-be-stale)
	 * channel before the destinations reset below can renumber which Caspar channel "operator_gui"
	 * is (routing-map.js allocates it dynamically after programChannels/multiview — resetting to
	 * "one PGM" shifts that count). resolveOperatorGuiChannel() resolves synchronously against
	 * ctx.config at call time, so calling this BEFORE applyHardwareConfigToCtx mutates ctx.config
	 * in place captures the OLD channel number; the actual STOP/MIXER CLEAR happen async after,
	 * unaffected by the later mutation. Without this, a New Project taken from the operator GUI's
	 * Looks tab left the previous setup's video holes open with no channel left that will ever
	 * clear them again (a later withdrawal resolves the NEW channel instead). */
	const persistence = ctx.persistence || require('../utils/persistence')
	try {
		const { clearOperatorGuiLayout, noteClientLayoutReport } = require('../system/operator-gui-channel')
		// Mirrors the DELETE /api/operator-gui/layout handler's own pair (routes-operator-gui.js):
		// noteClientLayoutReport([]) vetoes a stale reconnect re-apply of the old project's persisted
		// cells onto whatever channel resolves next, same as an operator's own explicit withdrawal.
		noteClientLayoutReport(ctx, [])
		void clearOperatorGuiLayout(ctx).catch((e) => {
			if (typeof ctx.log === 'function') ctx.log('warn', `[project] operator-gui layout clear: ${e?.message || e}`)
		})
		// clearOperatorGuiLayout() deliberately never persists an EMPTY cell set (a live reconnect
		// blip must not wipe the saved arrangement) — but a New Project IS the case that should wipe
		// it, same as clearPersistedMultiviewLayout below, so a later Caspar reconnect can't reapply
		// the old project's compose layout onto whatever channel "operator_gui" resolves to next.
		persistence.remove('operatorGuiLayout')
	} catch {
		/* optional */
	}

	const { hardwareConfig } = buildStarterHardwareConfig(persistence)

	/* The GPU bracket map (gpuPhysicalTopology) is a property of THIS machine's card, not of a show:
	 * the factory config carries the generic `__generic__` rows (defaults-core.js resolves them with
	 * no GPU model — HDMI-0/1 on a DP-only card), and applying them here replaced the operator's
	 * Device View port layout with ports the card does not have. Keep the live map (and its
	 * operator-saved flag, which the snapshot apply never touches) so a New project resets the
	 * show, never the rig's port layout. */
	const liveTopology = copyLiveGpuTopology(ctx.configManager.get())
	if (liveTopology) hardwareConfig.gpuPhysicalTopology = liveTopology
	else delete hardwareConfig.gpuPhysicalTopology

	if (!applyHardwareConfigToCtx(ctx, hardwareConfig)) {
		throw new Error('Failed to apply starter hardware configuration')
	}

	const cm = ctx.configManager
	if (cm) {
		/* WO-474: a New project opens a CLEAN device view — no audio, stream, record or virtual-cam
		 * output. The factory hardwareConfig above carries empty arrays, but applyHardwareConfigToCtx
		 * deliberately re-adds the box's monitor-role audio outputs (WO-443, which protects a box
		 * from a project SAVED ELSEWHERE) and never touches virtualCamera, which is not project
		 * state. A New project is the explicit reset to factory, so it clears all four here. */
		const next = {
			...cm.get(),
			extraLiveSources: [],
			audioOutputs: [],
			streamOutputs: [],
			recordOutputs: [],
		}
		delete next.virtualCamera
		cm.save(next)
		if (ctx.config) {
			Object.assign(ctx.config, cm.get())
			delete ctx.config.virtualCamera
		}
	}

	const project = buildNewUntitledProject(hardwareConfig)
	const slug = projectStore.projectSlugFromName(project.name)

	ctx.sceneDeck = {
		looks: [],
		previewSceneId: null,
		layerPresets: [],
		lookPresets: [],
	}
	persistSceneDeckForCtx(ctx)
	try {
		const { clearPersistedMultiviewLayout } = require('../state/clear-multiview-layout')
		clearPersistedMultiviewLayout(ctx)
	} catch {
		/* optional */
	}

	persistProject(ctx, project, { writeAutosave: true })
	ensureProjectMediaDir(ctx.config, slug, persistence)

	try {
		const { ensureLiveAudioRouting } = require('../config/routing-setup')
		void ensureLiveAudioRouting(ctx).catch((e) => {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[project] Live audio routing: ${e?.message || e}`)
			}
		})
	} catch {
		/* optional */
	}

	return { project, slug }
}

module.exports = {
	DEFAULT_PROJECT_NAME,
	buildNewUntitledProject,
	buildStarterHardwareConfig,
	createNewProject,
}
