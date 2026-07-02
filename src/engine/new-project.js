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
const { buildFactoryModularConfig } = require('../../tools/eggs/live-usb/starter-project')

const DEFAULT_PROJECT_NAME = 'Untitled'
const PROJECT_VERSION = 2

/**
 * @param {object} hardwareConfig
 * @returns {object}
 */
function buildNewUntitledProject(hardwareConfig) {
	return {
		version: PROJECT_VERSION,
		name: DEFAULT_PROJECT_NAME,
		savedAt: new Date().toISOString(),
		hardwareConfig,
		scenes: {
			scenes: [],
			liveSceneIdByMain: [null, null, null, null],
			previewSceneIdByMain: [null, null, null, null],
			liveSceneId: null,
			previewSceneId: null,
			activeScreenIndex: 0,
			globalDefaultTransition: { type: 'MIX', duration: 12, tween: 'linear' },
			mainEditorVisible: [true, false, false, false],
			layerPresets: [],
			lookPresets: [],
			globalBorders: [null, null, null, null],
		},
		timelines: { timelines: [], activeId: null },
		multiview: {
			cells: [],
			canvasWidth: 1920,
			canvasHeight: 1080,
			showOverlay: true,
			bgColor: '#000000',
			showTimersUnderLabels: false,
		},
		programOutput: null,
		placeholders: [],
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
	try {
		persistence.set('scene_deck', ctx.sceneDeck)
	} catch {
		/* optional */
	}
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
