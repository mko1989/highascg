'use strict'

/**
 * WO-857 — starts the console-selection feed with the fixture service (follow-service.js): the common feed follows
 * project changes (FixtureID map) and the grandMA3 plugin's UDP listener binds. `ctx.consoleSelection` is the feed,
 * `ctx.gma3SelectionListener` the listener (GET /api/fixtures/console-selection reports both).
 * @returns {{ listener: object, stop: () => void }}
 */

const { getService } = require('./console-selection')
const { Gma3SelectionListener, listenConfig } = require('./gma3-selection-listener')

function startConsoleSelection(ctx, log = () => {}) {
	const service = getService(ctx).start()
	const listener = new Gma3SelectionListener({ service, log })
	if (ctx) ctx.gma3SelectionListener = listener
	listener.start(listenConfig(ctx)).catch((e) => log('warn', '[console-selection] ' + (e?.message || e)))
	return {
		listener,
		stop() {
			listener.stop()
			service.stop()
			if (ctx?.gma3SelectionListener === listener) delete ctx.gma3SelectionListener
		},
	}
}

module.exports = { startConsoleSelection }
