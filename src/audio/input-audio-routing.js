'use strict'

/**
 * WO-604 slice 3 — live-input audio routing composed on the server (owner: "anything that happens in casparcg is
 * composed in the node server … each function or set of actions is an api endpoint").
 *
 * The web mixer did this in the client: a Ch button PLAYed / STOPped the input's audio-only route on a program
 * channel, kept the targets in localStorage, mirrored them into `<kind>_input_<slot>_audio_targets`, then pushed the
 * embedded-copy volume; the audio-send select and AUTO MIX wrote settings and pushed the volume the same way; START
 * re-played the routes from localStorage. Here each is one call, for the config-persisted kinds (DeckLink, v4l2 —
 * the WO-312 replayable set). ALSA `live_audio` slots keep their client flow (targets still in localStorage).
 *
 * Every change broadcasts `change` path `audioInputRouting` with the snapshot below.
 */

const { getChannelMap } = require('../config/routing-map')
const { parseRouteClip } = require('../caspar/channel-info-xml')
const mixerState = require('./mixer-state')
const {
	VALID_POLICIES,
	liveInputAudioTargets,
	liveInputAudioSendPolicy,
	isAutoMixEnabled,
} = require('../engine/live-input-audio-policy')
const { REPLAYABLE_KINDS, pgmDestLayerForInput, isPgmAudioOnly, amcpForPlannedRoute } = require('../engine/live-input-route-reassert')

const cs = (config) => (config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : {})

/**
 * Pure: what the console shows for the routable inputs.
 * @param {object} config
 */
function routingSnapshot(config) {
	let map
	try {
		map = getChannelMap(config || {})
	} catch {
		map = {}
	}
	const programChannels = (Array.isArray(map.programChannels) ? map.programChannels : []).map(Number).filter((n) => n >= 1)
	const inputs = []
	for (const e of Array.isArray(map.inputChannels) ? map.inputChannels : []) {
		const kind = String(e?.kind || '')
		const slot = parseInt(String(e?.slot), 10)
		if (!REPLAYABLE_KINDS.has(kind) || !Number.isFinite(slot) || slot < 1) continue
		const route = parseRouteClip(String(e.route || '')) ? String(e.route) : null
		inputs.push({
			kind,
			slot,
			key: `input:${e.channel}`,
			label: String(e.label || `${kind} ${slot}`),
			channel: Number(e.channel),
			layer: Number(e.layer),
			route,
			destLayer: pgmDestLayerForInput(kind, slot),
			send: liveInputAudioSendPolicy(config, kind, slot),
			targets: liveInputAudioTargets(config, kind, slot),
		})
	}
	return { autoMix: isAutoMixEnabled(config), programChannels, inputs }
}

/**
 * Pure: the MIXER VOLUME of the input's own (embedded) copy — the gain only under AFV with auto mix on and no routed
 * target; any lit Ch button means the matrix rules and the embedded copy is silent (live-input-audio-policy.js).
 * @param {object} config @param {{ kind: string, slot: number }} input @param {number} gain @param {boolean} muted
 */
function embeddedGain(config, input, gain, muted) {
	if (muted) return 0
	if (liveInputAudioSendPolicy(config, input.kind, input.slot) !== 'afv' || !isAutoMixEnabled(config)) return 0
	return liveInputAudioTargets(config, input.kind, input.slot).length === 0 ? gain : 0
}

/** @returns {{ input: object } | { status: number, error: string }} */
function findInput(config, kind, slot) {
	const k = String(kind || '')
	const n = parseInt(String(slot), 10)
	if (!REPLAYABLE_KINDS.has(k)) return { status: 400, error: `kind must be one of ${[...REPLAYABLE_KINDS].join(', ')}` }
	const input = routingSnapshot(config).inputs.find((i) => i.kind === k && i.slot === n)
	return input ? { input } : { status: 404, error: `No ${k} input ${slot} in the channel map.` }
}

/** Persist a casparServer patch (null deletes the key — defaults stay implicit, the config file stays clean). */
function patchCasparServer(ctx, patch) {
	const next = { ...cs(ctx.config) }
	for (const [k, v] of Object.entries(patch)) {
		if (v === null) delete next[k]
		else next[k] = v
	}
	ctx.config.casparServer = next
	if (ctx.configManager) ctx.configManager.save({ ...ctx.configManager.get(), casparServer: next })
}

function broadcast(ctx) {
	if (typeof ctx?._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'audioInputRouting', value: routingSnapshot(ctx.config) })
}

/** The routable input whose console strip is `key` (`input:<host channel>`), or null. */
function inputForKey(config, key) {
	return routingSnapshot(config).inputs.find((i) => i.key === key) || null
}

/**
 * One strip gain, three paths: the input's own layer gets the gain; the looks consuming its route get the embedded
 * gain (policy-silenced while the matrix rules — a fader move must not re-open a copy the routes already carry); the
 * audio-only routes on its target channels get the gain (they tap the source before the host mixer, f343e5e, so they
 * never followed the fader before). Muted = 0 everywhere.
 * @param {object} ctx @param {object} input - routingSnapshot().inputs[i]
 * @param {{ gain: number, muted: boolean, duration?: unknown, tween?: unknown, defer?: unknown }} o
 */
async function applyInputStrip(ctx, input, o) {
	const { fanOutVolumeToRouteConsumers } = require('../api/routes-audio')
	const gain = o.muted ? 0 : Math.max(0, Number(o.gain) || 0)
	const embedded = embeddedGain(ctx.config, input, gain, o.muted)
	const t = { duration: o.duration, tween: o.tween, defer: o.defer }
	const r = await ctx.amcp.mixer.mixerVolume(input.channel, input.layer, gain, t.duration, t.tween, t.defer)
	const fanout = await fanOutVolumeToRouteConsumers(ctx.amcp, input.channel, input.layer, { volume: embedded, ...t })
	const routes = []
	if (input.send !== 'never') {
		for (const ch of input.targets) {
			await ctx.amcp.mixer.mixerVolume(ch, input.destLayer, gain, t.duration, t.tween, t.defer)
			routes.push({ channel: ch, layer: input.destLayer })
		}
	}
	return { ...(r && typeof r === 'object' ? r : { data: r }), gain, embedded, ...(fanout.length ? { fanout } : {}), ...(routes.length ? { routes } : {}) }
}

/** Re-apply the strip's stored gain / mute after a routing or policy change (re-reads the input from config). */
async function reapplyStored(ctx, key) {
	const input = inputForKey(ctx.config, key)
	if (!input) return null
	const snap = mixerState.snapshot()
	const stored = snap.gains[key]
	return applyInputStrip(ctx, input, { gain: typeof stored === 'number' && stored >= 0 ? stored : 1, muted: snap.muted[key] === true })
}

/**
 * POST /api/audio/inputs/route { kind, slot, channel, on } — the Ch button. Apply first, persist only on success: a
 * failed route must not leave a target recorded that nothing on air matches.
 */
async function setRoute(ctx, body) {
	const found = findInput(ctx.config, body?.kind, body?.slot)
	if (!found.input) return found
	const { input } = found
	const ch = parseInt(String(body?.channel), 10)
	const snap = routingSnapshot(ctx.config)
	if (!snap.programChannels.includes(ch)) return { status: 400, error: `Channel ${body?.channel} is not a program channel.` }
	if (typeof body?.on !== 'boolean') return { status: 400, error: 'on must be true or false' }
	if (!input.route) return { status: 409, error: `Input "${input.label}" has no dedicated channel route yet.` }
	if (parseRouteClip(input.route).channel === ch) return { status: 400, error: 'A route must never feed the channel it is sourced from.' }
	if (!ctx.amcp) return { status: 503, error: 'Caspar not connected' }
	const cl = `${ch}-${input.destLayer}`
	const cmds = body.on
		? amcpForPlannedRoute({ channel: ch, layer: input.destLayer, route: input.route, audioOnly: isPgmAudioOnly(ctx.config) })
		: [`STOP ${cl}`, `MIXER ${cl} CLEAR`]
	for (const c of cmds) await ctx.amcp.raw(c)
	const targets = input.targets.filter((t) => t !== ch)
	if (body.on) targets.push(ch)
	targets.sort((a, b) => a - b)
	patchCasparServer(ctx, { [`${input.kind}_input_${input.slot}_audio_targets`]: targets.length ? targets : null })
	const applied = await reapplyStored(ctx, input.key)
	broadcast(ctx)
	return { ok: true, targets, embedded: applied?.embedded }
}

/** POST /api/audio/inputs/send { kind, slot, send: 'afv'|'always'|'never' } — bites now, not only on the next take. */
async function setSendPolicy(ctx, body) {
	const found = findInput(ctx.config, body?.kind, body?.slot)
	if (!found.input) return found
	const send = String(body?.send || '').toLowerCase()
	if (!VALID_POLICIES.has(send)) return { status: 400, error: 'send must be afv, always or never' }
	if (!ctx.amcp) return { status: 503, error: 'Caspar not connected' }
	patchCasparServer(ctx, { [`${found.input.kind}_input_${found.input.slot}_audio_send`]: send === 'afv' ? null : send })
	const applied = await reapplyStored(ctx, found.input.key)
	broadcast(ctx)
	return { ok: true, send, embedded: applied?.embedded }
}

/** POST /api/audio/auto-mix { on } — deliberately not retroactive: the next take applies it. */
function setAutoMix(ctx, body) {
	if (typeof body?.on !== 'boolean') return { status: 400, error: 'on must be true or false' }
	patchCasparServer(ctx, { audio_auto_mix: body.on ? null : false })
	broadcast(ctx)
	return { ok: true, autoMix: body.on }
}

/**
 * After an input's capture (re)start: put its persisted program routes back on air (STOP / CLEAR / PLAY, so a route
 * built against the dead producer is rebuilt). `never` inputs have none by policy.
 * @returns {Promise<number>} routes restored
 */
async function restoreInputRoutes(ctx, kind, slot) {
	const found = findInput(ctx.config, kind, slot)
	if (!found.input || !found.input.route || !ctx.amcp || found.input.send === 'never') return 0
	const { input } = found
	const src = parseRouteClip(input.route).channel
	let n = 0
	for (const ch of input.targets) {
		if (ch === src) continue
		for (const c of amcpForPlannedRoute({ channel: ch, layer: input.destLayer, route: input.route, audioOnly: isPgmAudioOnly(ctx.config) })) {
			await ctx.amcp.raw(c)
		}
		n++
	}
	if (n) await reapplyStored(ctx, input.key)
	return n
}

module.exports = {
	routingSnapshot,
	embeddedGain,
	inputForKey,
	applyInputStrip,
	setRoute,
	setSendPolicy,
	setAutoMix,
	restoreInputRoutes,
}
