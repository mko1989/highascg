'use strict'

/**
 * Reproduces observed data loss. A project saved with 14 connectors / 6 edges / 3 destinations was
 * factory-reset, and ~23s later a background autosave from the still-open browser rewrote it
 * carrying the now-empty live config (7 connectors, 0 edges, 0 destinations). Loading it restored
 * nothing — which presents as "loading a project does not load the device settings" but is really
 * the file having been destroyed before the load.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
	injectHardwareConfigToProject,
	hardwareConfigHasOperatorIntent,
} = require('../../src/engine/project-hardware-config')

/** A ctx whose live config is post-factory-reset: connectors present, nothing wired. */
function emptyLiveCtx() {
	const cfg = {
		deviceGraph: { version: 1, devices: [], connectors: [{ id: 'gpu_p0', kind: 'gpu_out' }], edges: [] },
		screenDestinations: { version: 1, destinations: [], edidNotes: '' },
		casparServer: {},
	}
	return { config: cfg, configManager: { get: () => cfg, save: () => {} }, persistence: { get: () => null, set: () => {} } }
}

const RICH_HW = {
	version: 2,
	deviceGraph: {
		version: 1,
		devices: [],
		connectors: [
			{ id: 'dst_in_a', kind: 'destination_in', externalRef: 'a' },
			{ id: 'gpu_p0', kind: 'gpu_out' },
		],
		edges: [{ id: 'e1', sourceId: 'dst_in_a', sinkId: 'gpu_p0' }],
	},
	screenDestinations: {
		version: 1,
		destinations: [{ id: 'a', label: 'PGM 1', mode: 'pgm_only', mainScreenIndex: 0 }],
		edidNotes: '',
	},
}

test('the emptiness predicate agrees this live config has nothing to say', () => {
	const ctx = emptyLiveCtx()
	const probe = {}
	injectHardwareConfigToProject(ctx, probe)
	assert.equal(
		hardwareConfigHasOperatorIntent(probe.hardwareConfig),
		false,
		'a post-reset live config must count as empty, or the guard below never engages',
	)
	assert.equal(hardwareConfigHasOperatorIntent(RICH_HW), true, 'the rich fixture must count as non-empty')

	/* The pre-existing predicate is NOT usable here: a factory-reset box still enumerates its GPU
	 * ports, and that function counts connectors as data. This is why the guard needed its own. */
	const { hardwareConfigHasOperatorData } = require('../../src/engine/project-hardware-config')
	assert.equal(
		hardwareConfigHasOperatorData(probe.hardwareConfig),
		true,
		'documents the trap: connectors alone make a wiped config look non-empty',
	)
})

test('autosave does NOT overwrite a good hardware slice with an empty live config', () => {
	const project = { name: 'tra', hardwareConfig: RICH_HW }
	injectHardwareConfigToProject(emptyLiveCtx(), project, { preserveWhenEmpty: true })

	assert.equal(project.hardwareConfig.deviceGraph.edges.length, 1, 'cabling must survive the autosave')
	assert.equal(project.hardwareConfig.screenDestinations.destinations.length, 1, 'destinations must survive')
})

test('autosave falls back to the STORED project when the payload carries no hardware', () => {
	/* The browser never builds hardwareConfig, so a real autosave payload has none at all — the
	 * only surviving copy is the file on disk. */
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hascg-projects-'))
	const prev = process.env.HIGHASCG_PROJECTS_DIR
	process.env.HIGHASCG_PROJECTS_DIR = dir
	try {
		const projectStore = require('../../src/engine/project-store')
		const slug = projectStore.projectSlugFromName('tra')
		projectStore.writeProjectFile(slug, { name: 'tra', slug, hardwareConfig: RICH_HW })

		const project = { name: 'tra' } // no hardwareConfig, exactly like a browser autosave
		injectHardwareConfigToProject(emptyLiveCtx(), project, { preserveWhenEmpty: true })

		assert.equal(
			project.hardwareConfig?.deviceGraph?.edges?.length,
			1,
			'must recover the stored cabling rather than stamp the empty live config over it',
		)
	} finally {
		if (prev === undefined) delete process.env.HIGHASCG_PROJECTS_DIR
		else process.env.HIGHASCG_PROJECTS_DIR = prev
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('an EXPLICIT save may still record an empty rig', () => {
	/* Deliberate asymmetry: "capture what is on screen now" must be able to record an empty rig,
	 * otherwise clearing your Device View could never be saved. */
	const project = { name: 'tra', hardwareConfig: RICH_HW }
	injectHardwareConfigToProject(emptyLiveCtx(), project) // no preserveWhenEmpty
	assert.equal(project.hardwareConfig.deviceGraph.edges.length, 0, 'explicit save records live truth')
})
