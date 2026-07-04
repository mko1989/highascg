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

const EMPTY_PROJECT_TEMPLATE = require('../../data/default-empty-project.json')

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
 * Apply starter routing and persist empty Untitled project.
 * @param {object} ctx
 * @returns {{ project: object, slug: string }}
 */
function createNewProject(ctx) {
	if (!ctx?.configManager) {
		throw new Error('Server context missing configManager')
	}
	const persistence = ctx.persistence || require('../utils/persistence')
	const { hardwareConfig } = buildStarterHardwareConfig(persistence)

	if (!applyHardwareConfigToCtx(ctx, hardwareConfig)) {
		throw new Error('Failed to apply starter hardware configuration')
	}

	const cm = ctx.configManager
	if (cm) {
		const next = { ...cm.get(), extraLiveSources: [] }
		cm.save(next)
		if (ctx.config) Object.assign(ctx.config, cm.get())
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
		persistence.set('multiviewLayout', null)
		ctx._multiviewLayout = null
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
