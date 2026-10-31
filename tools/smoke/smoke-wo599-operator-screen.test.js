'use strict'

/**
 * WO-599 T4 — server half of the native Godot operator-screen picker (src/api/routes-operator-screen.js):
 * lists the connected outputs with their flag port, and a pick writes the WO-290 choice (flag + cable).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { handleGet, handlePost } = require('../../src/api/routes-operator-screen')
const { routes } = require('../../src/api/router')

const OUTPUTS = [
	{ name: 'DP-6', port: 4, x: 0, y: 0, width: 1920, height: 1080 },
	{ name: 'DP-2', port: 2, x: 1920, y: 0, width: 1920, height: 1080 },
	{ name: 'HDMI-0', port: null, x: 3840, y: 0, width: 1920, height: 1080 },
]
const listOutputs = () => OUTPUTS

function makeCtx(config) {
	const saved = []
	const ctx = {
		config,
		configManager: { get: () => JSON.parse(JSON.stringify(ctx.config)), save: (c) => saved.push(c) },
	}
	return { ctx, saved }
}

const body = (r) => JSON.parse(r.body)

describe('WO-599 T4 operator-screen picker routes', () => {
	it('GET marks the output whose port holds the flag', () => {
		const { ctx } = makeCtx({ casparServer: { screen_2_operator_monitor: true } })
		const r = body(handleGet(ctx, { listOutputs, resolveFlagPort: () => 2 }))
		assert.equal(r.port, 2)
		assert.deepEqual(
			r.outputs.map((o) => [o.name, o.current]),
			[
				['DP-6', false],
				['DP-2', true],
				['HDMI-0', false],
			]
		)
	})

	it('POST moves the flag, clears the others and wires the operator_gui cable', () => {
		const config = {
			screen_1_operator_monitor: true,
			casparServer: { screen_2_operator_monitor: true, screen_count: 2 },
			screenDestinations: { destinations: [{ id: 'op', mode: 'operator_gui' }] },
			deviceGraph: {
				connectors: [{ id: 'dst_in_op' }, { id: 'gpu_p1' }, { id: 'gpu_p3' }],
				edges: [{ id: 'old', sourceId: 'dst_in_op', sinkId: 'gpu_p1' }],
			},
		}
		const { ctx, saved } = makeCtx(config)
		const r = handlePost({ name: 'DP-6' }, ctx, { listOutputs })
		assert.equal(r.status, 200)
		assert.deepEqual(body(r), { ok: true, name: 'DP-6', port: 4 })
		assert.equal(saved.length, 1)
		const next = saved[0]
		assert.equal(next.casparServer.screen_4_operator_monitor, true)
		assert.equal(next.casparServer.screen_2_operator_monitor, undefined)
		assert.equal(next.screen_1_operator_monitor, undefined)
		assert.equal(next.casparServer.screen_count, 2)
		assert.deepEqual(next.deviceGraph.edges, [{ id: 'e_dst_in_op_gpu_p3', sourceId: 'dst_in_op', sinkId: 'gpu_p3' }])
		assert.equal(ctx.config.casparServer.screen_4_operator_monitor, true)
		assert.equal(ctx.config.screen_1_operator_monitor, undefined)
	})

	it('POST refuses a missing name, an unknown output and an unmapped port without saving', () => {
		const { ctx, saved } = makeCtx({ casparServer: {} })
		assert.equal(handlePost({}, ctx, { listOutputs }).status, 400)
		assert.equal(handlePost({ name: 'DP-9' }, ctx, { listOutputs }).status, 404)
		assert.equal(handlePost({ name: 'HDMI-0' }, ctx, { listOutputs }).status, 422)
		assert.equal(handlePost('{"name":"HDMI-0"}', ctx, { listOutputs }).status, 422, 'a raw JSON body is parsed')
		assert.equal(saved.length, 0)
	})

	it('releases the pointer confine while the prompt is up and re-confines on cancel, pick or timeout', async () => {
		const calls = []
		let active = true
		const confine = {
			isActive: () => active,
			stop: () => {
				calls.push('stop')
				active = false
			},
			sync: (cfg) => {
				calls.push(`sync:${cfg.casparServer?.screen_4_operator_monitor === true ? 4 : '-'}`)
				active = true
			},
		}
		const { ctx } = makeCtx({ casparServer: {} })
		const deps = { listOutputs, confine }
		assert.equal(body(handlePost({ prompt: true }, ctx, deps)).confineReleased, true)
		assert.equal(body(handlePost({ prompt: true }, ctx, deps)).confineReleased, true, 'a second open keeps it released')
		handlePost({ prompt: false }, ctx, deps)
		assert.deepEqual(calls, ['stop', 'sync:-'])
		handlePost({ prompt: false }, ctx, deps)
		assert.deepEqual(calls, ['stop', 'sync:-'], 'never confines what it did not release')

		handlePost({ prompt: true }, ctx, deps)
		handlePost({ name: 'DP-6' }, ctx, deps)
		assert.deepEqual(calls.slice(2), ['stop', 'sync:4'], 'after a pick: confined to the new monitor')

		handlePost({ prompt: true }, ctx, { ...deps, promptMaxMs: 5 })
		await new Promise((r) => setTimeout(r, 30))
		assert.deepEqual(calls.slice(4), ['stop', 'sync:4'], 'the client vanished: the backstop re-confines')

		active = false
		assert.equal(body(handlePost({ prompt: true }, ctx, deps)).confineReleased, false, 'nothing to release')
		handlePost({ prompt: false }, ctx, deps)
		assert.equal(calls.length, 6)
	})

	it('WO-891: GET marks the outputs a Caspar screen consumer is planned on (the layout plan, by sysId)', () => {
		const get = (config) => body(handleGet({ config }, { listOutputs, resolveFlagPort: () => 4, bootStatus: () => ({}) }))
		const marked = (r) => r.outputs.filter((o) => o.caspar).map((o) => o.name)
		assert.deepEqual(marked(get({ casparServer: { screen_count: 1 }, screen_1_system_id: 'DP-2' })), ['DP-2'])
		assert.deepEqual(marked(get({})), [], 'no planned screen: nothing marked')
		assert.equal(get({}).outputs[0].caspar, false, 'the field is always present')
	})

	it('is registered on the router for GET and POST without Caspar', () => {
		const hits = routes.routes.filter((r) => r.path === '/api/system/operator-screen')
		assert.deepEqual(hits.map((r) => r.method).sort(), ['GET', 'POST'])
		for (const r of hits) assert.equal(r.options?.requireCaspar, false)
	})
})
