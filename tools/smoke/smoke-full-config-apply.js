'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

const steps = []

function mockOsConfig() {
	return {
		applyX11Layout(config, opts = {}) {
			steps.push(`xrandr live=${opts.live !== false} persist=${opts.persist !== false}`)
			return {
				applied: opts.live !== false,
				persisted: opts.persist !== false,
				xrandrCommand: opts.persist !== false || opts.live !== false ? 'DISPLAY=:0 xrandr --mock' : null,
			}
		},
		restartDisplayManager() {
			steps.push('nodm restart')
			return true
		},
	}
}

function mockDisplayWait() {
	return {
		async waitForDisplayStable() {
			steps.push('wait display stable')
			return { ok: true, displays: 3 }
		},
	}
}

function mockCasparRestart() {
	return {
		killStuckCasparMainProcess() {
			steps.push('kill caspar')
			return true
		},
		isAmcpTcpConnected() {
			return false
		},
		async waitForAmcpDisconnect() {
			return true
		},
		async finishCasparAfterApply() {
			steps.push('caspar restart')
			return { attempted: true, restartSent: true, disconnected: true, reconnected: true }
		},
		async reloadCasparAfterConfigWrite() {
			steps.push('caspar restart')
			return { attempted: true, restartSent: true, disconnected: true, reconnected: true }
		},
		async sendRestartAndWaitForCaspar() {
			steps.push('caspar restart')
			return { restartSent: true, disconnected: true, reconnected: true }
		},
		resolveReconnectWaitMs() {
			return 1000
		},
	}
}

function mockCanvasCheck(needed) {
	return {
		needsNodmRestartForLayout() {
			return {
				needed,
				plannedCanvas: needed ? { width: 12000, height: 1080 } : { width: 8960, height: 1080 },
				currentCanvas: { width: 8960, height: 1080, source: 'screen' },
				reason: needed ? 'canvas_expansion' : 'canvas_fits',
			}
		},
	}
}

async function runApply(canvasNeeded) {
	steps.length = 0
	const origLoad = Module._load
	Module._load = function (request, parent, isMain) {
		if (request.endsWith('/os-config')) return mockOsConfig()
		if (request.endsWith('/display-stable-wait')) return mockDisplayWait()
		if (request.endsWith('/caspar-restart')) return mockCasparRestart()
		if (request.endsWith('/xrandr-layout-verify')) return mockCanvasCheck(canvasNeeded)
		if (request.endsWith('/x-display-session')) {
			return {
				async applyOperatorDisplaySession() {
					steps.push('operator display session')
				},
				displaySessionEnv() {
					return {}
				},
			}
		}
		if (request.endsWith('/nvidia-display-policy')) {
			return {
				async applyNvidiaDisplayPolicy() {
					steps.push('nvidia display policy')
					return { ok: true }
				},
			}
		}
		return origLoad.apply(this, arguments)
	}
	try {
		delete require.cache[require.resolve('../../src/utils/full-config-apply')]
		const { applyFullServerConfig } = require('../../src/utils/full-config-apply')
		const ctx = { config: { screen_count: 2 }, amcp: {} }
		const res = await applyFullServerConfig(ctx, {
			writeCasparConfig: async () => {
				steps.push('write caspar')
				return { ok: true, path: '/tmp/casparcg.config' }
			},
		})
		return res
	} finally {
		Module._load = origLoad
		delete require.cache[require.resolve('../../src/utils/full-config-apply')]
	}
}

test('full apply: canvas fits — write, persist layout, live xrandr, AMCP restart', async () => {
	const res = await runApply(false)
	assert.equal(res.ok, true)
	assert.deepEqual(steps, [
		'write caspar',
		'xrandr live=false persist=true',
		'xrandr live=true persist=false',
		'operator display session',
		'caspar restart',
		'nvidia display policy',
	])
})

test('full apply: canvas expansion — nodm, live xrandr, kill autostart, AMCP restart', async () => {
	const res = await runApply(true)
	assert.equal(res.ok, true)
	assert.deepEqual(steps, [
		'write caspar',
		'xrandr live=false persist=true',
		'nodm restart',
		'wait display stable',
		'xrandr live=true persist=false',
		'operator display session',
		'kill caspar',
		'caspar restart',
		'nvidia display policy',
	])
})
