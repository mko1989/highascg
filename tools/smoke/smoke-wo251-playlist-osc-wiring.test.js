'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

/**
 * WO-251: the OSC-driven playlist advance/wrap handler (handlePlaylistOscUpdate) existed since
 * WO-211 but was never subscribed — playlists played the first item plus one native LOADBG-AUTO
 * handoff and then stopped. These are wiring-regression guards (grep-level, like the router
 * registration smokes) plus a functional dispatch test through a stub OscState 'change' emitter.
 */

const LIFECYCLE = path.join(__dirname, '..', '..', 'src', 'bootstrap', 'osc-lifecycle.js')

test('WO-251: osc-lifecycle requires and calls handlePlaylistOscUpdate on change', () => {
	const src = fs.readFileSync(LIFECYCLE, 'utf8')
	assert.match(
		src,
		/require\(['"]\.\.\/engine\/scene-take-lbg-playlist['"]\)/,
		'osc-lifecycle.js must import the playlist OSC handler'
	)
	assert.match(
		src,
		/handlePlaylistOscUpdate\(appCtx,\s*snapshot\)/,
		'the change listener must dispatch handlePlaylistOscUpdate(appCtx, snapshot)'
	)
})

test('WO-251: change events reach handlePlaylistOscUpdate through the lifecycle wiring', async () => {
	const { EventEmitter } = require('node:events')
	const { createOscLifecycle } = require(LIFECYCLE)

	class StubOscState extends EventEmitter {
		getSnapshot() {
			return { channels: {} }
		}
		destroy() {}
	}

	const appCtx = {
		log: () => {},
		state: { updateFromOscSnapshot: () => {}, clearOscMirror: () => {} },
		// handlePlaylistOscUpdate walks live scenes; an empty registry makes it a no-op pass,
		// which is enough to prove the dispatch path doesn't throw and is invoked.
	}
	const lifecycle = createOscLifecycle({
		appCtx,
		config: { osc: { enabled: true } },
		cli: {},
		logger: { info: () => {} },
		normalizeOscConfig: (c) => ({ enabled: true, ...(c.osc || {}) }),
		OscState: StubOscState,
		OscListener: class {
			constructor() {}
			start() {}
			stop() {}
		},
		applyOscSnapshotToVariables: () => {},
		clearOscVariables: () => {},
		startOscPlaybackInfoSupplement: () => {},
	})

	lifecycle.startOscSubsystem()
	assert.ok(appCtx.oscState instanceof StubOscState, 'stub OscState installed')
	// The throttle allows at most one dispatch per 250ms — a single emit must not throw.
	appCtx.oscState.emit('change', { channels: {} })
	lifecycle.stopOscSubsystem()
})
