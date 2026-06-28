'use strict'

/**
 * Smoke: Sources browser mixer effects catalog → client params → AMCP parity.
 *
 * Covers all 13 MIXER_EFFECTS from client/lib/effect-registry.js (Sources → Effects tab):
 * - catalog + schema completeness
 * - client effectToAmcpLines vs server look-take + timeline playback builders
 * - offline REST /api/mixer/* and /api/mixer/effect → captured AMCP strings
 *
 * Run:
 *   node --test tools/smoke/smoke-mixer-effects-catalog.test.js
 *   npm run smoke:mixer-effects
 *
 * @see 22_WO_MIXER_EFFECTS.md
 * @see 74_WO_MIXER_EFFECTS_INSPECTOR_PARAMS_AND_SMOKE.md
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { pathToFileURL } = require('url')

const defaults = require('../../src/config/defaults')
const { defaultLogger } = require('../../src/utils/logger')
const { StateManager } = require('../../src/state/state-manager')
const { AmcpClient } = require('../../src/caspar/amcp-client')
const { routeRequest } = require('../../src/api/router')
const { buildEffectAmcpLines } = require('../../src/engine/scene-take-lbg-helpers')
const { buildEffectAmcpLinesPlayback } = require('../../src/engine/timeline-playback-helpers')

const CL = '2-15'
const CHANNEL = 2
const LAYER = 15

/** Distinctive non-default params per effect type (Sources browser / inspector). */
const SAMPLE_PARAMS = {
	blend_mode: { mode: 'multiply' },
	brightness: { value: 0.75 },
	contrast: { value: 1.25 },
	saturation: { value: 0.5 },
	levels: { minIn: 0.1, maxIn: 0.9, gamma: 1.2, minOut: 0.05, maxOut: 0.95 },
	chroma_key: { key: 'Green', threshold: 0.4, softness: 0.3, spill: 0.8, blur: 0.1 },
	crop: { left: 0.1, top: 0.2, right: 0.8, bottom: 0.9 },
	clip_mask: { left: 0.05, width: 0.5, top: 0.1, height: 0.6 },
	perspective: {
		ulX: 0.1,
		ulY: 0.2,
		urX: 0.9,
		urY: 0.1,
		lrX: 1,
		lrY: 0.9,
		llX: 0,
		llY: 1,
	},
	grid: { resolution: 4 },
	keyer: { enabled: false },
	rotation: { degrees: 45 },
	anchor: { x: 0.5, y: 0.25 },
}

/** @param {AmcpClient} amcp @param {string[]} bucket */
function captureAmcp(amcp, bucket) {
	const sim = amcp._simulated
	const orig = sim.send.bind(sim)
	sim.send = function wrappedSend(cmd) {
		bucket.push(String(cmd).trim())
		return orig(cmd)
	}
}

function makeOfflineAmcp() {
	/** @type {import('../../src/caspar/amcp-protocol').AmcpConnectionContext} */
	const ctx = {
		socket: { isConnected: false },
		config: {
			offline_mode: true,
			amcp_batch: false,
			amcp_max_batch_commands: 64,
			amcp_mixer_commit_before_amcp_batch: true,
		},
		response_callback: {},
		_amcpSendQueue: Promise.resolve(),
		log: () => {},
	}
	return new AmcpClient(ctx)
}

function makeAppCtx(amcp) {
	const state = new StateManager({ logger: defaultLogger })
	const cfg = JSON.parse(JSON.stringify(defaults))
	return {
		state,
		variables: state.variables,
		config: cfg,
		gatheredInfo: {
			channelIds: [],
			channelStatusLines: {},
			channelXml: {},
			infoConfig: '',
			infoPaths: '',
			infoSystem: '',
		},
		CHOICES_MEDIAFILES: [],
		CHOICES_TEMPLATES: [],
		mediaDetails: {},
		programLayerBankByChannel: {},
		sceneDeck: { looks: [], previewSceneId: null, layerPresets: [], lookPresets: [] },
		persistence: { get: () => null, set: () => {}, remove: () => {} },
		amcp,
		_casparStatus: { connected: true, host: cfg.caspar?.host || '127.0.0.1', port: cfg.caspar?.port ?? 5250 },
		log: () => {},
		timelineEngine: null,
		getState: null,
	}
}

/** Strip optional instant duration suffix for REST vs line-builder comparison. */
function normalizeMixerLine(line) {
	return String(line)
		.trim()
		.replace(/\s+0$/, '')
		.replace(/\r/g, '')
}

/** @param {string} line */
function assertMixerTarget(line) {
	assert.match(line, /^MIXER\s+2-15\b/i, `expected channel-layer ${CL} in: ${line}`)
}

async function loadEffectRegistry() {
	const url = pathToFileURL(path.join(__dirname, '../../client/lib/effect-registry.js')).href
	return import(url)
}

test('MIXER_EFFECTS catalog: 13 types, schema keys, createEffectInstance defaults', async () => {
	const { MIXER_EFFECTS, EFFECT_MAP, createEffectInstance, effectPrimarySchema, effectAdvancedSchema } = await loadEffectRegistry()
	assert.equal(MIXER_EFFECTS.length, 13, 'Sources Effects tab must list 13 mixer effects')
	assert.equal(EFFECT_MAP.size, 13)

	for (const def of MIXER_EFFECTS) {
		assert.ok(def.type && def.label && def.amcpCommand, `${def.type}: missing metadata`)
		assert.ok(Array.isArray(def.schema) && def.schema.length > 0, `${def.type}: schema required`)
		for (const field of def.schema) {
			assert.ok(field.key && field.type, `${def.type}.${field.key}: schema field incomplete`)
		}
		const inst = createEffectInstance(def.type)
		assert.ok(inst, `${def.type}: createEffectInstance failed`)
		assert.equal(inst.type, def.type)
		for (const field of def.schema) {
			assert.ok(
				Object.prototype.hasOwnProperty.call(inst.params, field.key),
				`${def.type}: default missing param ${field.key}`,
			)
		}
		assert.ok(SAMPLE_PARAMS[def.type], `${def.type}: add SAMPLE_PARAMS entry for smoke`)
		const primary = effectPrimarySchema(def)
		const advanced = effectAdvancedSchema(def)
		assert.equal(primary.length + advanced.length, def.schema.length, `${def.type}: schema primary/advanced partition`)
	}
})

test('client effectToAmcpLines matches server look-take and timeline playback builders', async () => {
	const { MIXER_EFFECTS, effectToAmcpLines } = await loadEffectRegistry()

	for (const def of MIXER_EFFECTS) {
		const params = SAMPLE_PARAMS[def.type]
		const clientLines = effectToAmcpLines(def.type, params, CL)
		const takeLines = buildEffectAmcpLines(def.type, params, CL)
		const playbackLines = buildEffectAmcpLinesPlayback(def.type, params, CL)

		assert.ok(clientLines && clientLines.length === 1, `${def.type}: client lines`)
		assert.deepEqual(takeLines, clientLines, `${def.type}: look-take vs client`)
		assert.deepEqual(playbackLines, clientLines, `${def.type}: playback vs client`)
		assertMixerTarget(clientLines[0])
	}
})

test('REST /api/mixer/{command} dispatches AMCP for every effect command', async () => {
	const { MIXER_EFFECTS, effectToAmcpBody } = await loadEffectRegistry()

	for (const def of MIXER_EFFECTS) {
		const mapped = effectToAmcpBody(def.type, SAMPLE_PARAMS[def.type], CHANNEL, LAYER)
		assert.ok(mapped, `${def.type}: effectToAmcpBody mapping`)

		const amcp = makeOfflineAmcp()
		const captured = []
		captureAmcp(amcp, captured)
		const ctx = makeAppCtx(amcp)

		const res = await routeRequest(
			'POST',
			`/api/mixer/${mapped.command}`,
			JSON.stringify({ channel: CHANNEL, layer: LAYER, ...mapped.body }),
			ctx,
			null,
		)
		assert.equal(res.status, 200, `${def.type} POST /api/mixer/${mapped.command}`)

		const expected = normalizeMixerLine(
			(
				await loadEffectRegistry().then(({ effectToAmcpLines }) =>
					effectToAmcpLines(def.type, SAMPLE_PARAMS[def.type], CL),
				)
			)[0],
		)
		const sent = captured.map(normalizeMixerLine).find((c) => /^MIXER\s/i.test(c))
		assert.ok(sent, `${def.type}: no MIXER line captured`)
		assert.equal(sent, expected, `${def.type}: REST AMCP must match line builder`)
	}
})

test('REST POST /api/mixer/effect dispatches AMCP for every inspector effectType', async () => {
	const { MIXER_EFFECTS, effectToAmcpLines } = await loadEffectRegistry()

	for (const def of MIXER_EFFECTS) {
		const amcp = makeOfflineAmcp()
		const captured = []
		captureAmcp(amcp, captured)
		const ctx = makeAppCtx(amcp)

		const res = await routeRequest(
			'POST',
			'/api/mixer/effect',
			JSON.stringify({
				channel: CHANNEL,
				layer: LAYER,
				effectType: def.type,
				params: SAMPLE_PARAMS[def.type],
			}),
			ctx,
			null,
		)
		assert.equal(res.status, 200, `${def.type}: POST /api/mixer/effect`)

		const expected = normalizeMixerLine(effectToAmcpLines(def.type, SAMPLE_PARAMS[def.type], CL)[0])
		const sent = captured.map(normalizeMixerLine).find((c) => /^MIXER\s/i.test(c))
		assert.ok(sent, `${def.type}: no MIXER line captured via /effect`)
		assert.equal(sent, expected, `${def.type}: /effect AMCP must match line builder`)
	}
})
