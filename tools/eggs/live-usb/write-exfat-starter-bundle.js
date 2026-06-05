#!/usr/bin/env node
/**
 * Write factory modular config + starter show into an exFAT layout directory
 * (configs/ + configs/.highascg-state.json with web_project).
 *
 * Usage:
 *   node tools/eggs/live-usb/write-exfat-starter-bundle.js [/path/to/exfat/root]
 */
'use strict'

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../../..')
const exfatRoot = path.resolve(process.argv[2] || '/tmp/highascg-exfat-starter')
const configsDir = path.join(exfatRoot, 'configs')

const { ConfigManager } = require(path.join(REPO_ROOT, 'src/config/config-manager'))
const defaults = require(path.join(REPO_ROOT, 'src/config/defaults'))
const { finalizeScreenDestinationsConfig } = require(path.join(REPO_ROOT, 'src/config/screen-destinations'))

function defaultTransition() {
	return { type: 'MIX', duration: 12, tween: 'linear' }
}

function buildStarterProject() {
	const savedAt = new Date().toISOString()
	const globalDefaultTransition = defaultTransition()
	return {
		version: 2,
		name: 'Starter show',
		savedAt,
		scenes: {
			scenes: [
				{
					id: 'look-intro',
					name: 'Intro',
					mainScope: '0',
					layers: [],
					defaultTransition: { ...globalDefaultTransition },
				},
				{
					id: 'look-main',
					name: 'Main',
					mainScope: '0',
					layers: [],
					defaultTransition: { ...globalDefaultTransition },
				},
			],
			liveSceneIdByMain: [null, null, null, null],
			previewSceneIdByMain: [null, null, null, null],
			liveSceneId: null,
			previewSceneId: null,
			activeScreenIndex: 0,
			globalDefaultTransition,
			mainEditorVisible: [true, true, true, true],
			layerPresets: [],
			lookPresets: [],
			globalBorders: [null, null, null, null],
		},
		timelines: {
			timelines: [
				{
					id: 'timeline-main',
					name: 'Main',
					duration: 120000,
					layers: [{ id: 'tl-layer-1', name: 'Layer 1', clips: [] }],
					flags: [],
					layerHeights: [48],
				},
			],
			activeId: 'timeline-main',
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
		placeholders: null,
	}
}

function writeModularConfigs() {
	fs.mkdirSync(configsDir, { recursive: true })
	const config = finalizeScreenDestinationsConfig(JSON.parse(JSON.stringify(defaults)))
	const cm = new ConfigManager(configsDir, console)
	if (!cm.save(config)) {
		throw new Error('Failed to write modular config into configs/')
	}
}

function writeStarterState() {
	const statePath = path.join(configsDir, '.highascg-state.json')
	const project = buildStarterProject()
	const payload = {
		web_project: project,
		scene_deck: {
			looks: project.scenes.scenes.map((s) => ({ id: s.id, name: s.name, mainScope: s.mainScope })),
			previewSceneId: null,
			layerPresets: [],
			lookPresets: [],
		},
	}
	fs.writeFileSync(statePath, JSON.stringify(payload, null, 2), 'utf8')
}

function copyCasparTemplate() {
	const isoXml = path.join(REPO_ROOT, 'config', 'casparcg.config.iso')
	const dest = path.join(configsDir, 'casparcg.config')
	if (fs.existsSync(isoXml)) {
		fs.copyFileSync(isoXml, dest)
	}
}

function main() {
	if (!fs.existsSync(path.join(REPO_ROOT, 'package.json'))) {
		console.error(`Expected repo at ${REPO_ROOT}`)
		process.exit(1)
	}
	writeModularConfigs()
	writeStarterState()
	copyCasparTemplate()
	console.log(`OK: starter configs + show → ${configsDir}`)
}

main()
