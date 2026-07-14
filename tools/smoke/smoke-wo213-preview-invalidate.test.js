'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

describe('WO-213 preview invalidate on live change', () => {
	const repoRoot = path.resolve(__dirname, '../..')

	it('source-grep: app-ws-handlers contains maybeInvalidatePreviewOnLiveChange export', () => {
		const appWsHandlers = fs.readFileSync(
			path.join(repoRoot, 'client/lib/app-ws-handlers.js'),
			'utf8'
		)
		assert.match(
			appWsHandlers,
			/export function maybeInvalidatePreviewOnLiveChange/,
			'app-ws-handlers.js must export maybeInvalidatePreviewOnLiveChange'
		)
	})

	it('source-grep: app-ws-handlers calls maybeInvalidatePreviewOnLiveChange at both apply sites', () => {
		const appWsHandlers = fs.readFileSync(
			path.join(repoRoot, 'client/lib/app-ws-handlers.js'),
			'utf8'
		)
		const matches = (appWsHandlers.match(/maybeInvalidatePreviewOnLiveChange/g) || []).length
		assert.ok(
			matches >= 3,
			`app-ws-handlers.js must call maybeInvalidatePreviewOnLiveChange at both apply sites (export + 2 calls; found ${matches} matches)`
		)
	})

	it('source-grep: app-ws-handlers dispatches scenes-preview-invalidate event', () => {
		const appWsHandlers = fs.readFileSync(
			path.join(repoRoot, 'client/lib/app-ws-handlers.js'),
			'utf8'
		)
		assert.match(
			appWsHandlers,
			/scenes-preview-invalidate/,
			"app-ws-handlers.js must dispatch 'scenes-preview-invalidate' event"
		)
	})

	it('source-grep: scenes-preview-runtime contains listener for scenes-preview-invalidate', () => {
		const previewRuntime = fs.readFileSync(
			path.join(repoRoot, 'client/components/scenes-preview-runtime.js'),
			'utf8'
		)
		assert.match(
			previewRuntime,
			/scenes-preview-invalidate/,
			"scenes-preview-runtime.js must listen for 'scenes-preview-invalidate' event"
		)
	})

	it('source-grep: scenes-preview-runtime listener calls clearLastPreviewLayers', () => {
		const previewRuntime = fs.readFileSync(
			path.join(repoRoot, 'client/components/scenes-preview-runtime.js'),
			'utf8'
		)
		assert.match(
			previewRuntime,
			/addEventListener.*scenes-preview-invalidate.*clearLastPreviewLayers/s,
			'scenes-preview-runtime.js listener must call clearLastPreviewLayers()'
		)
	})

	it('source-grep: pip-overlay-amcp UPDATE condition has WO-213 comment', () => {
		const pipOverlay = fs.readFileSync(
			path.join(repoRoot, 'client/lib/pip-overlay-amcp.js'),
			'utf8'
		)
		assert.match(
			pipOverlay,
			/WO-213.*UPDATE.*config freshness/i,
			'pip-overlay-amcp.js must have WO-213 comment on UPDATE condition noting config freshness'
		)
	})

	it('unit: maybeInvalidatePreviewOnLiveChange with dynamic ESM import', async () => {
		// Stub globalThis.window with event tracking before importing the ESM module
		const eventDispatcher = {
			dispatchedEvents: [],
			addEventListener(name, handler) {
				this.handlers ??= {}
				this.handlers[name] = handler
			},
			dispatchEvent(ev) {
				this.dispatchedEvents.push(ev.type)
			},
		}

		// Mock window in globalThis before import
		const originalWindow = globalThis.window
		try {
			globalThis.window = eventDispatcher

			// Dynamic import of the ESM module
			const { maybeInvalidatePreviewOnLiveChange } = await import(
				`file://${path.join(repoRoot, 'client/lib/app-ws-handlers.js')}`
			)

			// Test case 1: Fresh channel state with sceneId A on PRV channel
			const channelMap1 = { previewChannels: [2] } // PRV channel is 2
			const liveMap1 = { '2': { sceneId: 'scene-A' } }
			maybeInvalidatePreviewOnLiveChange(liveMap1, channelMap1)
			// First call may or may not dispatch (depends on initial state being undefined)
			const firstDispatchCount = eventDispatcher.dispatchedEvents.length

			// Test case 2: Changed sceneId B on PRV channel (must dispatch)
			const liveMap2 = { '2': { sceneId: 'scene-B' } }
			maybeInvalidatePreviewOnLiveChange(liveMap2, channelMap1)
			assert.equal(
				eventDispatcher.dispatchedEvents[eventDispatcher.dispatchedEvents.length - 1],
				'scenes-preview-invalidate',
				'Must dispatch scenes-preview-invalidate when PRV channel sceneId changes'
			)

			// Test case 3: Change on NON-preview channel must NOT dispatch
			eventDispatcher.dispatchedEvents = []
			const channelMap2 = { previewChannels: [2] } // PRV channel is 2, not 3
			const liveMap3 = { '3': { sceneId: 'new-scene' } } // Channel 3 is not a preview channel
			maybeInvalidatePreviewOnLiveChange(liveMap3, channelMap2)
			assert.equal(
				eventDispatcher.dispatchedEvents.length,
				0,
				'Must NOT dispatch for non-preview channel changes'
			)
		} finally {
			globalThis.window = originalWindow
		}
	})
})
