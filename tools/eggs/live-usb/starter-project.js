'use strict'

/**
 * Factory starter show + hardware snapshot for ISO / exFAT eggs bundles.
 * Shared by write-iso-default-config.js and write-exfat-starter-bundle.js.
 */

const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../../..')

const STARTER_PROJECT_NAME = 'New project 1'
const STARTER_PROJECT_SLUG = 'new_project_1'

/**
 * Modular config with one PGM-only screen destination (Device View default).
 * @param {object} defaults
 * @param {typeof import('../../src/config/screen-destinations').finalizeScreenDestinationsConfig} finalizeScreenDestinationsConfig
 * @param {typeof import('../../src/config/screen-destinations').normalizeScreenDestinations} normalizeScreenDestinations
 */
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
	if (config.casparServer && typeof config.casparServer === 'object') {
		config.casparServer.screen_count = 1
	}
	config.screen_count = 1
	return config
}

/**
 * Minimal operator project — no looks, no timeline clips.
 * @returns {object}
 */
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
			mainEditorVisible: [true, false, false, false],
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
		},
		programOutput: null,
		placeholders: [],
	}
}

/**
 * Embed server hardware slices so project load restores PGM destination + graph defaults.
 * @param {object} project
 * @param {object} factoryConfig — output of buildFactoryModularConfig
 */
function attachStarterHardwareConfig(project, factoryConfig) {
	const { buildHardwareConfigFromConfig } = require(path.join(
		REPO_ROOT,
		'src/engine/project-hardware-config',
	))
	project.hardwareConfig = buildHardwareConfigFromConfig(factoryConfig, {
		get: () => null,
	})
	return project
}

/**
 * @param {object} project
 */
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
	REPO_ROOT,
	STARTER_PROJECT_NAME,
	STARTER_PROJECT_SLUG,
	buildFactoryModularConfig,
	buildStarterProject,
	attachStarterHardwareConfig,
	buildStarterPersistenceState,
}
