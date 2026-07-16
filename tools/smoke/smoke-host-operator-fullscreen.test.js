'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { ConfigManager } = require('../../src/config/config-manager')
const { REPO_ROOT } = require('../../src/repo-paths')
const {
	buildOperatorFullscreenState,
	findWebpageHostSource,
	handleHostOperatorFullscreen,
	resolveOperatorRouteTarget,
	applyHostOperatorFullscreen,
} = require('../../src/api/host-operator-fullscreen')

function loadProjectConfig(extraLiveSources) {
	const configDir = process.env.HIGHASCG_CONFIG_PATH || path.join(REPO_ROOT, 'config')
	const cm = new ConfigManager(configDir, { info() {}, warn() {}, error() {} })
	cm.load()
	const base = cm.get()
	return {
		...base,
		extraLiveSources: extraLiveSources || base.extraLiveSources || [],
	}
}

describe('host-operator-fullscreen', () => {
	const extraLiveSources = [
		{
			type: 'browser',
			routeType: 'webpage_host',
			value: 'route://20-1',
			hostChannel: 20,
			hostLayer: 1,
			sourceId: 'webpage_test',
			cefNeedle: 'interactive_click_test',
			label: 'Click test',
			interactiveCapable: true,
		},
	]

	it('findWebpageHostSource resolves by sourceId', () => {
		const config = { extraLiveSources }
		const row = findWebpageHostSource(config, { sourceId: 'webpage_test' })
		assert.equal(row?.hostChannel, 20)
	})

	it('resolveOperatorRouteTarget uses the interactive-enabled multiview/screen zone when configured', (t) => {
		const config = loadProjectConfig(extraLiveSources)
		const target = resolveOperatorRouteTarget(config)
		if (!target) {
			t.skip('no interactive-enabled zones in project config')
			return
		}
		assert.ok(target.channel >= 1)
		assert.equal(target.layer, 999)
	})

	// WO-257: CEF interactive-bridge focus (cefFocusTarget) is gone — buildOperatorFullscreenState
	// only carries routing/display metadata now.
	it('buildOperatorFullscreenState carries routing metadata (no cefFocusTarget)', () => {
		const source = findWebpageHostSource({ extraLiveSources }, { sourceId: 'webpage_test' })
		const state = buildOperatorFullscreenState(source, { channel: 4, layer: 999, zoneId: 'multiview' })
		assert.equal(state.sourceId, 'webpage_test')
		assert.equal(state.hostChannel, 20)
		assert.equal(state.zoneId, 'multiview')
		assert.equal('cefFocusTarget' in state, false)
	})

	it('toggle off returns host-still-running message', async () => {
		const cmds = []
		const ctx = {
			config: { extraLiveSources },
			amcp: { raw: async (cmd) => cmds.push(cmd) },
			_hostOperatorFullscreen: buildOperatorFullscreenState(
				findWebpageHostSource({ extraLiveSources }, { sourceId: 'webpage_test' }),
				{ channel: 4, layer: 999, zoneId: 'multiview' },
			),
		}
		const res = await handleHostOperatorFullscreen(ctx, { sourceId: 'webpage_test', action: 'toggle' })
		assert.equal(res.active, false)
		assert.match(res.message, /still running on ch 20/)
		assert.ok(cmds.some((c) => /^CLEAR 4-999/.test(c)))
		assert.equal(ctx._hostOperatorFullscreen, null)
	})

	it('apply sends PLAY route on operator layer', async (t) => {
		const config = loadProjectConfig(extraLiveSources)
		const target = resolveOperatorRouteTarget(config)
		if (!target) {
			t.skip('no interactive-enabled zones in project config')
			return
		}
		const cmds = []
		const ctx = {
			config,
			amcp: { raw: async (cmd) => cmds.push(cmd) },
			_hostOperatorFullscreen: null,
		}
		const res = await applyHostOperatorFullscreen(ctx, { sourceId: 'webpage_test' })
		assert.equal(res.active, true)
		assert.ok(cmds.some((c) => c === `PLAY ${target.channel}-${target.layer} route://20-1`))
		assert.ok(cmds.some((c) => c.includes('FILL 0 0 1 1')))
		assert.equal(ctx._hostOperatorFullscreen?.hostChannel, 20)
	})
})
