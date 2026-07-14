'use strict'

/**
 * Factory starter show + modular config (PGM-only default).
 * Lives under src/ so playout runtime works without tools/eggs/ on ISO or drop-update.
 * Eggs build scripts re-export via tools/eggs/live-usb/starter-project.js.
 */

const { normalizeDeviceGraph } = require('./device-graph-core')
const { buildHardwareConfigFromConfig } = require('../engine/project-hardware-config')

const STARTER_PROJECT_NAME = 'New project 1'
const STARTER_PROJECT_SLUG = 'new_project_1'

function buildFactoryModularConfig(defaults, finalizeScreenDestinationsConfig, normalizeScreenDestinations) {
	const config = finalizeScreenDestinationsConfig(JSON.parse(JSON.stringify(defaults)))
	config.screenDestinations = normalizeScreenDestinations({
		version: 1,
		destinations: [
			{
				id: 'dst_pgm_1',
				label: 'PGM 1',
				mainScreenIndex: 0,
				mode: 'pgm_only',
				videoMode: '1080p5000',
				width: 1920,
				height: 1080,
				fps: 50,
				caspar: { bus: 'pgm' },
				edidLabel: '',
			},
		],
		edidNotes: '',
	})
	config.screen_count = 1
	config.deviceGraph = normalizeDeviceGraph({
		version: 1,
		devices: [{ id: 'caspar_host', role: 'caspar_host', label: 'Caspar / HighAsCG host' }],
		connectors: [],
		edges: [],
		layout: {},
	})
	if (config.casparServer && typeof config.casparServer === 'object') {
		config.casparServer.screen_count = 1
		config.casparServer.multiview_enabled = false
		config.casparServer.multiview_screen_consumer = false
		config.casparServer.multiview_decklink_device = 0
	}
	const eggEnforce = process.env.HIGHASCG_EGG_ENFORCE_AUTH === '1'
	config.security = {
		enforceAuth: eggEnforce,
		exposeToNetwork: true,
		apiToken: '',
	}
	return config
}

function buildStarterProject() {
	const savedAt = new Date().toISOString()
	return {
		version: 2,
		name: STARTER_PROJECT_NAME,
		slug: STARTER_PROJECT_SLUG,
		savedAt,
		scenes: {
			scenes: [],
			liveSceneIdByMain: [null, null, null, null],
			previewSceneIdByMain: [null, null, null, null],
			liveSceneId: null,
			previewSceneId: null,
			activeScreenIndex: 0,
			globalDefaultTransition: { type: 'MIX', duration: 12, tween: 'linear' },
			mainEditorVisible: [true, true, true, true],
			layerPresets: [],
			lookPresets: [],
			globalBorders: [null, null, null, null],
		},
		timelines: {
			timelines: [],
			activeId: null,
		},
		multiview: {
			cells: [],
			canvasWidth: 1920,
			canvasHeight: 1080,
			showOverlay: true,
			bgColor: '#000000',
			showTimersUnderLabels: false,
			timerScale: 100,
			highlightTopTimer: true,
		},
		programOutput: null,
		placeholders: [],
	}
}

function attachStarterHardwareConfig(project, factoryConfig) {
	project.hardwareConfig = buildHardwareConfigFromConfig(factoryConfig, {
		get: () => null,
	})
	return project
}

function buildStarterPersistenceState(project) {
	return {
		web_project: project,
		web_project_active_slug: STARTER_PROJECT_SLUG,
		scene_deck: {
			looks: [],
			previewSceneId: null,
			layerPresets: [],
			lookPresets: [],
		},
	}
}

module.exports = {
	STARTER_PROJECT_NAME,
	STARTER_PROJECT_SLUG,
	buildFactoryModularConfig,
	buildStarterProject,
	attachStarterHardwareConfig,
	buildStarterPersistenceState,
}
