'use strict'

/**
 * WO-1013 — put back what was on the screens after Caspar (re)connects.
 *
 * Owner, 09.11: "when a test card is on and i hit apply and restart in devices, the test card should turn it self on
 * as soon as caspar is ready. kind of goes for anything that was already on screens."
 *
 * Devices ▸ Apply & restart restarts Caspar only; node keeps its in-memory and persisted state, so it knows what was
 * on air. Run once per Caspar connect from `src/bootstrap/caspar-info-ready.js`:
 *  1. {@link restoreProgramLooks} — a program channel whose look bands Caspar shows EMPTY while scene.live holds a
 *     look: on a RECONNECT the look is re-taken (cut, no PGM/PRV exchange); on the FIRST connect of this node process
 *     (box boot) the persisted look is cleared, as the reconcile did before WO-1013. Different content is left to
 *     the live-scene reconcile (it still clears on a real mismatch).
 *  2. {@link restoreLedTestCard} — the card is re-painted on layer 999 when `ctx._ledTestPatternActive` is still on:
 *     the boot splash on its own channels, the operator's card through `applyCard` (stored settings and picks).
 * Every Caspar-facing call is injectable (`deps`) for the offline smoke.
 */

const log = (ctx, level, msg) => {
	if (typeof ctx?.log === 'function') ctx.log(level, msg)
}

function defaultDeps() {
	return {
		getChannelMap: (cfg) => require('../config/routing').getChannelMap(cfg),
		liveSceneState: require('../state/live-scene-state'),
		take: (body, ctx) => require('../api/routes-scene-take').handleSceneTake(body, ctx),
		applyCard: (ctx, on) => require('./led-test-card-control').applyCard(ctx, on),
		postCard: (path, body, ctx) => require('../api/routes-led-test-card').handlePost(path, body, ctx),
		clearBorderType: (ch) => require('./global-border-live').clearCasparBorderType(ch),
		cardControl: require('./led-test-card-control'),
	}
}

function programChannelsOf(ctx, deps) {
	const map = deps.getChannelMap(ctx?.config || {}) || {}
	const list = Array.isArray(map.programChannels) && map.programChannels.length ? map.programChannels : []
	return [...new Set(list.map((c) => parseInt(String(c), 10)).filter((n) => Number.isFinite(n) && n > 0))]
}

/** Pure: why a persisted live look is NOT re-taken ('' = re-take it). */
function retakeSkipReason(scene) {
	const layers = Array.isArray(scene?.layers) ? scene.layers : []
	const withContent = layers.filter((l) => l?.source?.value)
	if (!withContent.length) return 'no content'
	/* A timeline look plays through the timeline engine (210+), whose own play state survives in node — a re-take
	 * would restart it from the top. Left open in WO-1013. */
	if (withContent.some((l) => String(l.source?.type || '') === 'timeline')) return 'timeline look'
	return ''
}

/**
 * Look bands of one program channel on Caspar right now: 'empty' | 'occupied' | null (could not tell).
 * @param {object} amcp
 * @param {number} ch
 */
async function lookBandState(amcp, ch) {
	if (!amcp || typeof amcp.info !== 'function') return null
	const { infoResponseToXml } = require('../caspar/channel-info-xml')
	const { parseLayerFgProducerTypesFromChannelXml, lookBandsEmpty } = require('../state/live-scene-reconcile')
	try {
		const xml = infoResponseToXml(await amcp.info(ch))
		if (!xml || !xml.includes('<channel')) return null
		return lookBandsEmpty(await parseLayerFgProducerTypesFromChannelXml(xml)) ? 'empty' : 'occupied'
	} catch {
		return null
	}
}

/**
 * @param {object} ctx app ctx
 * @param {{ reconnect: boolean, deps?: object }} opts
 * @returns {Promise<Array<{ channel: number, action: string, detail?: string }>>}
 */
async function restoreProgramLooks(ctx, { reconnect, deps: injected } = {}) {
	const deps = { ...defaultDeps(), ...(injected || {}) }
	const out = []
	if (!ctx?.amcp || ctx.amcp.isConnected === false) return out
	const { shouldSkipSceneReconcile } = require('../state/live-scene-reconcile')
	const live = deps.liveSceneState.getAll() || {}
	let cleared = false
	for (const ch of programChannelsOf(ctx, deps)) {
		/* WO-1013: Caspar's border template cache (global-border-live.js) describes the OLD Caspar — after a restart
		 * a border "update" would send nothing (type unchanged) and the border never came back. */
		try {
			deps.clearBorderType(ch)
		} catch {
			/* advisory */
		}
		const entry = live[String(ch)]
		const scene = entry?.scene
		if (!scene || !Array.isArray(scene.layers) || !scene.layers.some((l) => l?.source?.value)) continue
		const state = await lookBandState(ctx.amcp, ch)
		if (state !== 'empty') {
			out.push({ channel: ch, action: state === 'occupied' ? 'kept' : 'unknown' })
			continue
		}
		const name = String(scene.name || entry.sceneId || '')
		if (!reconnect) {
			/* First connect of this node process (box boot / node started with Caspar down): nothing of ours was on
			 * screen in this Caspar. Same result as the pre-WO-1013 reconcile: clear what it would have cleared. */
			if (shouldSkipSceneReconcile(scene)) {
				out.push({ channel: ch, action: 'kept', detail: 'first connect, non-file look' })
				continue
			}
			await deps.liveSceneState.clearChannel(ch)
			cleared = true
			log(ctx, 'info', `[restore-on-screens] ch${ch}: first connect, Caspar empty — cleared persisted live look ${name}`)
			out.push({ channel: ch, action: 'cleared' })
			continue
		}
		const skip = retakeSkipReason(scene)
		if (skip) {
			log(ctx, 'info', `[restore-on-screens] ch${ch}: look ${name} not re-taken (${skip})`)
			out.push({ channel: ch, action: 'skipped', detail: skip })
			continue
		}
		const sceneId = String(scene.id ?? entry.sceneId ?? '')
		let res
		try {
			res = await deps.take(
				{
					channel: ch,
					incomingScene: { ...scene, id: sceneId },
					/* The persisted look is what Caspar should show; "current" is a stub with the same id and no layers so
					 * every layer plays (nothing "unchanged" is kept) and the fixture recall skips (same look). */
					useServerLive: false,
					currentScene: { id: sceneId, layers: [] },
					forceCut: true,
					previewExchange: false,
				},
				ctx,
			)
		} catch (e) {
			res = { status: 500, body: JSON.stringify({ error: e?.message || String(e) }) }
		}
		if (res?.status === 200) {
			log(ctx, 'info', `[restore-on-screens] ch${ch}: Caspar was empty — re-took live look ${name} (cut)`)
			out.push({ channel: ch, action: 'retaken' })
		} else {
			let msg = `status ${res?.status}`
			try {
				msg = JSON.parse(res?.body || '{}').error || msg
			} catch {
				/* keep the status */
			}
			log(ctx, 'warn', `[restore-on-screens] ch${ch}: re-take of ${name} failed: ${msg}`)
			out.push({ channel: ch, action: 'failed', detail: msg })
		}
	}
	if (cleared) deps.liveSceneState.broadcastSceneLive(ctx)
	return out
}

/** Pure: the per-channel POST /api/led-test-card body that repaints the boot splash (startup-led-test-pattern.js). */
function splashCardBody(channel) {
	return {
		enabled: true,
		channel,
		showLedGrid: false,
		showCircle: true,
		showCross: true,
		centerLabel: 'HighAsCG',
		showCenterCharacter: true,
		cols: 4,
		rows: 3,
		panelWidth: 192,
		panelHeight: 108,
	}
}

/** Flag + source, stored (persistOnState) and broadcast — through the route's own setter, the one WS `change` sender. */
function setCardActive(ctx, on, source) {
	ctx._ledTestCardSource = on ? source : null
	require('../api/routes-led-test-card').broadcastLedTestPatternActive(ctx, on)
}

/**
 * WO-1013 follow-up — a NODE restart used to forget that the operator's card was on, while Caspar kept painting it
 * (GUI "off", card on air; the next Caspar restart then did not repaint it). Called once at boot, before Caspar is
 * connected: the stored on-state (led-test-card-control `ledTestCardOn`) is taken provisionally, so nothing that runs
 * on connect (multiview apply clears layer 999 while the card is "off") wipes a card that is still up.
 * {@link verifyPrimedLedTestCard} then checks it against Caspar on the first connect.
 * @param {object} ctx
 * @param {{ deps?: object }} [opts]
 * @returns {boolean} primed
 */
function primeLedTestCardFromPersisted(ctx, { deps: injected } = {}) {
	const deps = { ...defaultDeps(), ...(injected || {}) }
	if (!ctx || ctx._ledTestPatternActive === true) return false
	const st = deps.cardControl.readOnState()
	if (!st.on) return false
	ctx._ledTestPatternActive = true
	ctx._ledTestCardSource = 'control'
	ctx._ledTestCardPrimed = true
	return true
}

/**
 * First Caspar connect of this node process: is the primed operator card really on air?
 *  - the boot splash painted this boot (`_startupLedTestChannelIndices`) → it is a fresh Caspar, the splash owns the
 *    flag; the stored operator state is stale → stored off, source cleared (splash and operator card never mix);
 *  - layer 999 has a producer on any planned target → on (node restart, Caspar kept the card), broadcast;
 *  - none (box boot / Caspar restarted while node was down) → off, stored off, broadcast — as the looks are cleared;
 *  - no channel readable → left as primed (uncertain: keep what the operator last chose).
 * @param {object} ctx
 * @param {{ deps?: object }} [opts]
 * @returns {Promise<{ state: string, channels?: number[] }>}
 */
async function verifyPrimedLedTestCard(ctx, { deps: injected } = {}) {
	const deps = { ...defaultDeps(), ...(injected || {}) }
	if (!ctx?._ledTestCardPrimed) return { state: 'not primed' }
	ctx._ledTestCardPrimed = false
	const ctl = deps.cardControl
	if (Array.isArray(ctx._startupLedTestChannelIndices) && ctx._startupLedTestChannelIndices.length) {
		ctx._ledTestCardSource = null
		ctl.persistOnState(ctx)
		log(ctx, 'info', '[restore-on-screens] test card: boot splash is up — stored operator card state dropped')
		return { state: 'splash' }
	}
	const map = deps.getChannelMap(ctx.config || {}) || {}
	const targets = ctl.planTargets(ctl.getSettings(), map, true)
	const { infoResponseToXml } = require('../caspar/channel-info-xml')
	const { parseLayerFgProducerTypesFromChannelXml } = require('../state/live-scene-reconcile')
	const onAir = []
	let readable = 0
	for (const ch of targets) {
		try {
			const xml = infoResponseToXml(await ctx.amcp.info(ch))
			if (!xml || !xml.includes('<channel')) continue
			const types = await parseLayerFgProducerTypesFromChannelXml(xml)
			readable++
			const t = types['999']
			if (t && t !== 'empty') onAir.push(ch)
		} catch {
			/* unreadable channel: no evidence either way */
		}
	}
	if (onAir.length) {
		setCardActive(ctx, true, 'control')
		log(ctx, 'info', `[restore-on-screens] test card: still on air after node restart (ch ${onAir.join(', ')}) — on`)
		return { state: 'on', channels: onAir }
	}
	if (!readable) {
		log(ctx, 'warn', '[restore-on-screens] test card: no target channel readable — keeping the stored on-state')
		return { state: 'unknown' }
	}
	setCardActive(ctx, false, null)
	log(ctx, 'info', '[restore-on-screens] test card: stored on, but no layer 999 on Caspar (fresh start) — off')
	return { state: 'off' }
}

/**
 * Re-paint the test card on a fresh Caspar when node still has it on.
 * The boot splash counts when it is the card that is up: painted at boot and no operator switch since
 * (`_ledTestCardSource` is set by led-test-card-control.js).
 * @param {object} ctx
 * @param {{ deps?: object }} [opts]
 * @returns {Promise<{ restored: boolean, mode?: 'splash'|'card', targets?: number[], failures?: object[], reason?: string }>}
 */
async function restoreLedTestCard(ctx, { deps: injected } = {}) {
	const deps = { ...defaultDeps(), ...(injected || {}) }
	const { markLedTestLayerPainted } = require('../bootstrap/led-test-layer-999')
	/* WO-492's "layer 999 is provably empty" cache was measured on the OLD Caspar — drop it on every connect so a later
	 * switch-off probes again instead of skipping a channel. */
	markLedTestLayerPainted(ctx)
	if (ctx?._ledTestPatternActive !== true) return { restored: false, reason: 'inactive' }
	if (!ctx.amcp || ctx.amcp.isConnected === false) return { restored: false, reason: 'not connected' }
	const splash = Array.isArray(ctx._startupLedTestChannelIndices) ? ctx._startupLedTestChannelIndices : []
	let r
	if (ctx._ledTestCardSource !== 'control' && splash.length) {
		const failures = []
		for (const ch of splash) {
			let res
			try {
				res = await deps.postCard('/api/led-test-card', JSON.stringify(splashCardBody(ch)), ctx)
			} catch (e) {
				res = { status: 500, body: JSON.stringify({ error: e?.message || String(e) }) }
			}
			if (res?.status !== 200) failures.push({ channel: ch, error: `HTTP ${res?.status ?? '?'}` })
		}
		r = { mode: 'splash', targets: [...splash], failures }
	} else {
		const a = await deps.applyCard(ctx, true)
		r = { mode: 'card', targets: a?.targets || [], failures: a?.failures || [] }
	}
	markLedTestLayerPainted(ctx)
	const ok = r.targets.length > r.failures.length
	log(
		ctx,
		ok ? 'info' : 'warn',
		`[restore-on-screens] test card (${r.mode}) re-applied on ch ${r.targets.join(', ') || '—'}` +
			(r.failures.length ? ` — failed: ${r.failures.map((f) => `ch${f.channel} ${f.error}`).join(', ')}` : ''),
	)
	return { restored: ok, ...r }
}

module.exports = {
	retakeSkipReason,
	splashCardBody,
	restoreProgramLooks,
	restoreLedTestCard,
	primeLedTestCardFromPersisted,
	verifyPrimedLedTestCard,
}
