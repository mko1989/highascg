'use strict'

/**
 * WO-1029 part 2 — put an air snapshot (air-snapshot.js) back on the restarted Caspar. Called only from
 * restore-on-screens.js `restoreOnConnect` (one owner of the restore per Caspar connect), in this order:
 *   rekeyLiveLooks (before WO-1013's look re-take: live looks follow their destination to its new channel number)
 *   → [WO-1013 looks, preview re-stage]
 *   → restoreChannels (program channels first, preview after, then the rest; air-snapshot-plan.js per channel)
 *   → resumeTimeline → [WO-1013 test card] → restoreConsumers.
 * A failed step is reported and the next one runs. A channel the cluster master holds here (a backup screen it
 * forwards) is not touched: the master's catch-up owns it. Every outside call is injectable (`deps`).
 */

const { rolesOf } = require('./air-snapshot-roles')
const { parseChannelInfo } = require('./air-snapshot-parse')
const { planChannelRestore } = require('./air-snapshot-plan')

const KIND_ORDER = { program: 0, preview: 1, other: 2 }

function defaultDeps(ctx) {
	return {
		now: () => Date.now(),
		getChannelMap: (cfg) => require('../config/routing').getChannelMap(cfg),
		liveSceneState: require('../state/live-scene-state'),
		info: async (ch) => require('../caspar/channel-info-xml').infoResponseToXml(await ctx.amcp.info(ch)),
		send: (line) => ctx.amcp.raw(line),
		airHeld: (ch) => {
			try {
				return require('../replication/amcp-fanout').airHeldBy(ctx, ch)
			} catch {
				return null
			}
		},
		timelineEngine: () => ctx.timelineEngine || null,
		persistBanks: () => require('./scene-transition').persistProgramLayerBanks(ctx),
		startStream: (outputId) =>
			require('../api/routes-streaming-channel-rtmp').handlePostRtmp(JSON.stringify({ action: 'start', ...(outputId ? { outputId } : {}) }), ctx),
	}
}

/** old channel → new channel by role, or null when that role has no channel any more. */
function channelMapper(snap, newRoles) {
	return (old) => {
		const role = snap.roles?.[String(old)]
		if (!role) return null
		return newRoles.byRole.get(role) ?? null
	}
}

/**
 * Live looks are stored per program channel NUMBER; after a renumbering apply they would be re-taken on the wrong
 * screen. Move each to its destination's new channel (all at once: 1→2 and 2→1 in one pass); a destination that is
 * gone drops its look (reported).
 */
async function rekeyLiveLooks(ctx, snap, { deps: injected, newRoles } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	const roles = newRoles || rolesOf(ctx.config || {}, deps.getChannelMap)
	const map = channelMapper(snap, roles)
	const live = deps.liveSceneState.getAll() || {}
	const moves = []
	const dropped = []
	for (const look of snap.looks || []) {
		const entry = live[String(look.channel)]
		if (!entry) continue
		const to = map(look.channel)
		if (to === look.channel) continue
		if (to == null) dropped.push({ what: `look ${look.name || look.scene_id} (ch ${look.channel})`, why: goneWhy(snap, roles, look.channel, 'its destination no longer exists') })
		moves.push({ from: look.channel, to, entry })
	}
	for (const m of moves) await deps.liveSceneState.clearChannel(m.from)
	for (const m of moves) if (m.to != null) await deps.liveSceneState.setChannel(m.to, m.entry)
	return { moved: moves.filter((m) => m.to != null).map((m) => ({ from: m.from, to: m.to })), dropped }
}

/** WO-1029 C1b: a role with no channel here because its screen is on another server says so (NOT_HERE), not "gone". */
function goneWhy(snap, roles, oldCh, gone) {
	const role = snap.roles?.[String(oldCh)]
	return role && roles.notHere?.has(role) ? 'its screen is not on this server (NOT_HERE) — content dropped here' : gone
}

const otherBank = (b) => (b === 'b' ? 'a' : 'b')

function bankTable(ctx) {
	if (!ctx.programLayerBankByChannel) ctx.programLayerBankByChannel = {} // the real ctx has it (live-deck getter)
	return ctx.programLayerBankByChannel
}

/**
 * WO-1029 — a program look sits on bank A or B and every take lands on the OTHER bank (scene-take-lbg.js). The
 * WO-1013 re-take after a restart would therefore put the look on the other bank than the snapshot saw it on. Before
 * the re-take the pointer of each mapped program channel is set to the opposite of the snapshot's bank, so the cut
 * lands on the SAME bank and flips the pointer back to it; a channel without a live look keeps its old bank.
 * @returns {Array<{ channel: number, bank: 'a'|'b', retake: boolean }>}
 */
function alignBanksForRetake(ctx, snap, { deps: injected, newRoles } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	const roles = newRoles || rolesOf(ctx.config || {}, deps.getChannelMap)
	const map = channelMapper(snap, roles)
	const live = deps.liveSceneState.getAll() || {}
	const banks = bankTable(ctx)
	const out = []
	for (const sc of snap.channels || []) {
		if (sc.kind !== 'program' || !sc.bank) continue
		const ch = map(sc.channel)
		if (ch == null) continue
		const retake = !!live[String(ch)]?.scene?.layers?.some((l) => l?.source?.value)
		banks[String(ch)] = retake ? otherBank(sc.bank) : sc.bank
		out.push({ channel: ch, bank: sc.bank, retake })
	}
	return out
}

/**
 * After the looks: a channel whose look was not re-taken (kept, skipped, failed) goes back to the snapshot's bank;
 * a re-taken one keeps what the take set (it flipped onto the snapshot's bank). Persisted, so the next take's
 * outgoing / incoming banks match what is on Caspar.
 */
function settleBanks(ctx, aligned, looks, { deps: injected } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	const banks = bankTable(ctx)
	for (const a of aligned || []) {
		const retaken = (looks || []).some((l) => l.channel === a.channel && l.action === 'retaken')
		if (!retaken) banks[String(a.channel)] = a.bank
	}
	try {
		deps.persistBanks()
	} catch {
		/* advisory */
	}
}

/**
 * The INFO pass: every snapshot channel, mapped by role, planned against what Caspar shows there now.
 * @returns {Promise<{ clips: object[], layers: object[], skipped: object[] }>}
 */
async function restoreChannels(ctx, snap, { deps: injected, newRoles } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	const roles = newRoles || rolesOf(ctx.config || {}, deps.getChannelMap)
	const mapChannel = channelMapper(snap, roles)
	const out = { clips: [], layers: [], skipped: [] }
	const timelineOwned = !!snap.timeline
	const cardActive = !!snap.card?.active
	const list = [...(snap.channels || [])].sort((a, b) => (KIND_ORDER[a.kind] ?? 2) - (KIND_ORDER[b.kind] ?? 2) || a.channel - b.channel)
	for (const sc of list) {
		// WO-1029: the operator GUI channel and the multiview channels are laid out by their own modules on every
		// connect (operator-gui-channel.js, multiview apply: route layers WITH their MIXER FILL, from the CURRENT
		// channel map). Replaying the snapshot's routes there put plain full-frame routes — and routes to the OLD
		// channel numbers — over that layout: the Live tiles went black after an Apply (5867, 10.11).
		if (/^(opgui|mv):/.test(String(sc.role || ''))) continue
		if (!sc.layers?.length) continue
		const ch = mapChannel(sc.channel)
		const name = `${sc.label || sc.role} (was ch ${sc.channel})`
		if (ch == null) {
			out.skipped.push({ what: name, why: goneWhy(snap, roles, sc.channel, 'destination no longer exists — its content dropped') })
			continue
		}
		const held = deps.airHeld(ch)
		if (held) {
			out.skipped.push({ what: name, why: `driven by ${held.drivenBy} (the master's catch-up restores it)` })
			continue
		}
		let current
		try {
			current = await parseChannelInfo(await deps.info(ch))
		} catch {
			current = null
		}
		if (!current) {
			out.skipped.push({ what: name, why: `INFO ${ch} not readable after the restart` })
			continue
		}
		const elapsedS = Math.max(0, deps.now() - snap.taken_at) / 1000
		/* A program channel: its old bank's layers go to the bank the node's pointer holds now (the re-take's), the other
		 * bank's are leftovers of the previous look (air-snapshot-plan.js bandOf). */
		const bands =
			sc.kind === 'program' && sc.bank
				? { oldBank: sc.bank, newBank: bankTable(ctx)[String(ch)] === 'b' ? 'b' : 'a', lookLayers: sc.look_layers || [] }
				: null
		const plan = planChannelRestore(sc, current, { channel: ch, elapsedS, mapChannel, cardActive, timelineOwned, bands })
		const failed = new Set()
		for (const line of plan.lines) {
			try {
				await deps.send(line)
			} catch (e) {
				const m = /^\S+\s+(\d+-\d+)/.exec(line)
				if (m) failed.add(m[1])
				out.skipped.push({ what: line, why: e?.message || String(e) })
			}
		}
		const ok = (r) => !failed.has(`${r.channel}-${r.layer}`)
		out.clips.push(...plan.clips.filter(ok))
		out.layers.push(...plan.layers.filter(ok))
		out.skipped.push(...plan.skipped)
	}
	return out
}

/**
 * The timeline engine kept its clock while Caspar restarted: a playing timeline is re-sent from where the engine is
 * now (= snapshot position + elapsed, its own loop / end rules applied); a paused one is parked at its position.
 */
async function resumeTimeline(ctx, snap, { deps: injected } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	const tl = snap.timeline
	if (!tl) return null
	const eng = deps.timelineEngine()
	if (!eng || typeof eng.getPlayback !== 'function') return { id: tl.id, playing: tl.playing, at_ms: tl.position_ms, resumed_ms: null, error: 'no timeline engine' }
	const pb = eng.getPlayback(tl.id)
	if (tl.playing && !pb?.playing) return { id: tl.id, playing: false, at_ms: tl.position_ms, resumed_ms: null, skipped: 'ended or stopped meanwhile' }
	const pos = tl.playing ? Math.max(0, Number(pb?.position) || 0) : tl.position_ms
	eng._prevKey = new Map() // its "already on that layer" cache describes the OLD Caspar
	eng.play(tl.id, pos, { restart: true })
	if (!tl.playing) eng.pause(tl.id)
	return { id: tl.id, playing: tl.playing, at_ms: Math.round(tl.position_ms), resumed_ms: Math.round(pos) }
}

/**
 * A running stream is started again (same output) and reported; a recording is NOT restarted into a new file without
 * the operator saying so (owner decision pending) — it is marked stopped here and reported.
 */
async function restoreConsumers(ctx, snap, { deps: injected } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	const out = { stream: null, records: [], skipped: [] }
	const s = snap.consumers?.stream
	if (s?.active) {
		if (ctx.streamingChannelRtmp) ctx.streamingChannelRtmp.active = false // the consumer died with Caspar
		try {
			const r = await deps.startStream(s.outputId)
			out.stream = r?.status === 200 ? { restarted: true } : { restarted: false, error: errorOf(r) }
		} catch (e) {
			out.stream = { restarted: false, error: e?.message || String(e) }
		}
		if (!out.stream.restarted) out.skipped.push({ what: 'stream', why: out.stream.error })
	}
	for (const r of snap.consumers?.records || []) {
		const sess = ctx.streamingChannelRecords?.[r.key]
		if (sess?.active) sess.active = false
		out.records.push({ key: r.key, path: r.path, restarted: false })
		out.skipped.push({ what: `recording ${r.key}${r.path ? ` (${r.path})` : ''}`, why: 'stopped by the Caspar restart — not restarted into a new file (start it again)' })
	}
	return out
}

function errorOf(r) {
	try {
		return JSON.parse(String(r?.body || '{}')).error || `HTTP ${r?.status}`
	} catch {
		return `HTTP ${r?.status}`
	}
}

module.exports = { rekeyLiveLooks, alignBanksForRetake, settleBanks, restoreChannels, resumeTimeline, restoreConsumers }
