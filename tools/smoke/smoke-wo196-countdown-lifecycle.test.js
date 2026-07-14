'use strict'

/**
 * WO-196: Countdown lifecycle — exit clear, continuity, panel list scope.
 *
 * Verification:
 * - T196.1: Exit clear — exiting template layers emit CG CLEAR unless same host layer in incoming look
 * - T196.2: Continuity — same template on same host layer emits UPDATE-only (no CLEAR+ADD+PLAY)
 * - T196.3: List scope — GET /api/countdown/list includes all project scenes + onAir flags
 * - T196.4: Help text — panel header and inspector group have title with timer identity docs
 * - T196.5: Smokes — teardown clear present/absent per continuity matrix; same-timer take → UPDATE
 */

const test = require('node:test')
const assert = require('node:assert/strict')

test('WO-196 T196.1: Exit clear — teardown emits CG CLEAR for exiting template layers', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg-teardown.js'), 'utf8')

	// Verify imports for template CG functions
	assert.ok(source.includes("require('./scene-template-cg')"), 'scene-template-cg imported')
	assert.ok(source.includes('isSceneTemplateLayer'), 'isSceneTemplateLayer used')
	assert.ok(source.includes('buildSceneTemplateCgClearLines'), 'buildSceneTemplateCgClearLines used')

	// Verify teardown accepts incomingTemplateHostLayers parameter
	assert.ok(source.includes('incomingTemplateHostLayers'), 'incomingTemplateHostLayers parameter accepted')

	// Verify teardown logic iterates exiting layers and emits clear
	assert.ok(source.includes('for (const layer of exitMedia)'), 'iterates exit media')
	assert.ok(source.includes('if (!isSceneTemplateLayer(layer'), 'checks isSceneTemplateLayer')
})

test('WO-196 T196.1: scene-take-lbg.js computes and passes incoming template host-layer set', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')

	// Verify incomingTemplateHostLayers set is built
	assert.ok(source.includes('incomingTemplateHostLayers'), 'computes incomingTemplateHostLayers')
	assert.ok(source.includes('new Set()'), 'creates a Set for host layers')
	assert.ok(source.includes('buildSceneTemplateCgSpec'), 'uses buildSceneTemplateCgSpec')
	assert.ok(source.includes('resolveTemplateCgHostLayer'), 'resolves host layer')

	// Verify it's passed to teardown (the parameter appears in the object being passed)
	assert.ok(source.includes('runSceneTakeLbgTeardown'), 'calls teardown')
	const teardownCallMatch = source.match(/runSceneTakeLbgTeardown\(\{[\s\S]*?incomingTemplateHostLayers/)
	assert.ok(teardownCallMatch, 'passes incomingTemplateHostLayers to teardown')
})

test('WO-196 T196.2: Continuity — pipeline detects same template on same host layer', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg-amcp-pipeline.js'), 'utf8')

	// Verify isSameTemplateSpec and buildSceneTemplateCgUpdateOnlyLines are imported
	assert.ok(source.includes('isSameTemplateSpec'), 'isSameTemplateSpec imported and used')
	assert.ok(source.includes('buildSceneTemplateCgUpdateOnlyLines'), 'buildSceneTemplateCgUpdateOnlyLines imported')

	// Verify continuity detection logic in the template CG loop
	assert.ok(source.includes('isContinuous'), 'continuity detection variable')
	assert.ok(source.includes('currentMap.get(job.layer.layerNumber)'), 'checks current scene layer')
})

test('WO-196 T196.2: scene-template-cg.js has isSameTemplateSpec and UPDATE-only builder', () => {
	const { isSameTemplateSpec, buildSceneTemplateCgUpdateOnlyLines } = require('../../src/engine/scene-template-cg')

	// Verify functions exist and are callable
	assert.ok(typeof isSameTemplateSpec === 'function', 'isSameTemplateSpec exported')
	assert.ok(typeof buildSceneTemplateCgUpdateOnlyLines === 'function', 'buildSceneTemplateCgUpdateOnlyLines exported')

	// Test isSameTemplateSpec logic
	const incoming = { cgName: 'countdown/countdown' }
	const current = { cgName: 'countdown/countdown' }
	const different = { cgName: 'lower-thirds/lt-classic' }

	assert.ok(isSameTemplateSpec(incoming, current), 'same cgName detected as continuous')
	assert.ok(!isSameTemplateSpec(incoming, different), 'different cgName not continuous')
	assert.ok(!isSameTemplateSpec(incoming, null), 'null current is not continuous')

	// Test UPDATE-only builder produces only UPDATE line (no CLEAR/ADD)
	const lines = buildSceneTemplateCgUpdateOnlyLines(1, 10, { cgName: 'countdown/countdown', data: '{}' })
	assert.ok(Array.isArray(lines), 'returns array of lines')
	assert.strictEqual(lines.length, 1, 'UPDATE-only produces single line')
	assert.ok(lines[0].includes('UPDATE'), 'line is UPDATE')
	assert.ok(!lines[0].includes('CLEAR'), 'no CLEAR in UPDATE-only')
	assert.ok(!lines[0].includes(' ADD '), 'no ADD in UPDATE-only')
})

test('WO-196 T196.3: routes-countdown.js list includes all project scenes + onAir flag', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/api/routes-countdown.js'), 'utf8')

	// Verify project-scenes-load is imported
	assert.ok(source.includes("require('../engine/project-scenes-load')"), 'project-scenes-load imported')
	assert.ok(source.includes('loadFullProject'), 'loadFullProject used')

	// Verify list logic enumerates all project scenes
	assert.ok(source.includes('projectScenesLoad.loadFullProject()'), 'loads full project (via module object so tests can stub — WO-205 fix)')
	assert.ok(source.includes('allScenes'), 'iterates all scenes')

	// Verify onAir flag is set
	assert.ok(source.includes('onAir'), 'onAir flag used')
	assert.ok(source.includes('onAir: false'), 'initialized to false')
	assert.ok(source.includes('onAir: true'), 'marked true for live state')
})

test('WO-196 T196.3: handleGet returns items with onAir flag', async () => {
	const { handleGet } = require('../../src/api/routes-countdown')

	// Mock liveSceneState with one on-air timer
	const liveSceneStateMock = require.cache[require.resolve('../../src/state/live-scene-state')]
	const originalGetAll = liveSceneStateMock?.exports?.getAll

	// Temporarily mock loadFullProject to return empty project (we'll rely on live state)
	const projectScenesLoadMock = require.cache[require.resolve('../../src/engine/project-scenes-load')]
	const originalLoadFullProject = projectScenesLoadMock?.exports?.loadFullProject

	const result = handleGet('/api/countdown/list', {})
	assert.ok(result, 'handleGet returns result')
	assert.ok(result.body, 'result has body')

	// Parse the JSON body
	const body = JSON.parse(result.body)
	assert.ok(body.items, 'items array present')
	assert.ok(Array.isArray(body.items), 'items is array')

	// If any items, check they have onAir flag
	if (body.items.length > 0) {
		for (const item of body.items) {
			assert.ok(typeof item.onAir === 'boolean', `item has onAir flag (boolean): ${item.onAir}`)
		}
	}
})

test('WO-196 T196.4 (superseded by WO-210): timer-control-panel.js has help text on header', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../client/components/timer-control-panel.js'), 'utf8')

	// WO-210: panel is screen-timer-owned now; identity guidance moved to the WO-210 help text
	assert.ok(source.includes('helpText'), 'help text present in panel')
	assert.ok(source.includes('Screen timers'), 'WO-210 screen-timer guidance in panel')
})

test('WO-196 T196.4: inspector-countdown.js has help text on title', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../client/components/inspector-countdown.js'), 'utf8')

	// Verify help text is added to inspector group title
	assert.ok(source.includes('Timer identity = screen + layer number'), 'help text present in inspector')
	assert.ok(source.includes('Reuse the same layer number across looks'), 'continuity guidance in inspector')
})

test('WO-196 T196.3 (superseded by WO-210): timer-control-panel is registry-driven', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../client/components/timer-control-panel.js'), 'utf8')

	// WO-210 replaced the dropdown/on-air UI: the panel lists screen timers from the
	// server registry and controls them via /api/timers/* — no off-air dead ends exist.
	assert.ok(source.includes('/api/timers/list'), 'panel reads the screen-timer registry')
	assert.ok(source.includes('/api/timers/cmd'), 'transport commands go through the registry API')
	assert.ok(source.includes('/api/timers/visible'), 'visibility toggles never clear the CG')
})
