'use strict'

/**
 * WO-1026 — the active half of the two-box run: the workflow is USED. Takes from the master onto the destination that
 * lives on the second server (its own DeckLink inputs as sources), a take on the LED wall that must stay on main, a
 * stream and a recording of the workflow PGM, then everything at once for a while (the soak), then the aftermath.
 * Ids: T5 takes, T6 stream, T7 record, T8 soak, T9 aftermath. These change what is on air on both servers.
 */

const V = require('./views')
const P = require('./probes')
const { LOOKS } = require('./scenario')
const { ok, fail, warn, skip, sleep, waitFor } = require('./lib')
const { snapshot } = require('./checks-static')

const LAYER = 10 // a look's first layer (scene layerNumber 10) — Caspar layer 10 or 110 (bank A / B, P.lookLayer)
const j = (v) => JSON.stringify(v)

async function looksByName(main) {
	const p = await main.get('/api/project')
	const out = {}
	for (const s of p?.scenes?.scenes || []) out[String(s.name || '')] = s
	return out
}

const take = (box, sceneId, extra = {}) => box.try('/api/scene/take-look', { sceneId, forceCut: true, ...extra })

/** What the second server's channel `ch` shows on the look layer (either bank). */
const peerLayer = async (ctx, ch) => P.lookLayer(await ctx.peer.amcp(`INFO ${ch}`), LAYER)
const mainLayer = async (ctx, ch) => (ch ? P.lookLayer(await ctx.main.amcp(`INFO ${ch}`), LAYER) : null)

async function takes(report, ctx) {
	const { main, peer, snap } = ctx
	const looks = await looksByName(main)
	const dest = V.destByLabel(snap.peer.dv, ctx.label)
	const ch = dest && V.channelsOf(snap.peer.dv, dest.id)
	const inputCh = (slot) => V.decklink(snap.peer.dv, slot).live?.hostChannel
	const inputLayer = (slot) => V.decklink(snap.peer.dv, slot).live?.hostLayer ?? slot
	const shows = (l, slot) => P.showsInput(l, slot, inputCh(slot), inputLayer(slot))
	const mainCh = dest && V.channelsOf(snap.main.dv, dest.id)
	const marks = { main: await P.logMark(main), peer: await P.logMark(peer) }

	await report.check('T5.0', 'the test looks exist in the show, scoped to their destinations', () => {
		const miss = Object.values(LOOKS).filter((l) => !looks[l.name]).map((l) => l.name)
		if (miss.length) return fail(`missing looks: ${miss.join(', ')}`)
		if (!dest || !ch?.pgm) return fail('no workflow destination / PGM channel on the second server')
		const scope = String(dest.mainScreenIndex)
		const bad = [LOOKS.mixer, LOOKS.ppt].filter((l) => String(looks[l.name].mainScope) !== scope).map((l) => l.name)
		return bad.length ? fail(`${bad.join(', ')} not scoped to screen ${scope}`) : ok(`workflow PGM ch ${ch.pgm} / PRV ch ${ch.prv} on the second server`)
	})

	for (const [id, key] of [['T5.1', 'mixer'], ['T5.2', 'ppt']]) {
		const L = LOOKS[key]
		await report.check(id, `take "${L.name}" on the master → the second server's PGM shows ITS DeckLink ${L.slot}`, async () => {
			if (!looks[L.name] || !ch?.pgm) return skip('no look / channel (T5.0)')
			const before = await peerLayer(ctx, ch.pgm)
			const r = await take(main, looks[L.name].id)
			if (r.status > 299) return fail(`take refused: ${r.status} ${j(r.data).slice(0, 240)}`)
			const shown = await waitFor(async () => {
				const l = await peerLayer(ctx, ch.pgm)
				return shows(l, L.slot) ? l : null
			}, 6000)
			const now = shown || (await peerLayer(ctx, ch.pgm))
			// the master plays the look on its own (uncabled) channel for the destination too: what did that do?
			const onMaster = await mainLayer(ctx, mainCh?.pgm)
			const ev = { before, now, onMaster, source: looks[L.name].layers?.[0]?.source?.value, expected: `DeckLink ${L.slot} = channel ${inputCh(L.slot)}-${inputLayer(L.slot)} on the second server` }
			const where = `${now.producer} bank ${now.bank}: ${now.text.replace(/\s+/g, ' ').slice(0, 120)}; master's own ch ${mainCh?.pgm}: ${onMaster?.empty ? 'empty' : onMaster?.producer}`
			return shown ? ok(where, ev) : fail(`second server PGM ch ${ch.pgm} layer ${LAYER}: ${now.empty ? 'empty' : now.producer + ' ' + now.text.slice(0, 160)}`, ev)
		})
	}

	await report.check('T5.3', 'stage a look on PRV from the master → the second server\'s PRV channel shows it, PGM keeps its look', async () => {
		if (!looks[LOOKS.mixer.name] || !ch?.prv) return skip('no look / PRV channel')
		const pgmBefore = await peerLayer(ctx, ch.pgm)
		const r = await take(main, looks[LOOKS.mixer.name].id, { target: 'preview' })
		if (r.status > 299) return fail(`refused: ${r.status} ${j(r.data).slice(0, 240)}`)
		const shown = await waitFor(async () => {
			const l = await peerLayer(ctx, ch.prv)
			return shows(l, LOOKS.mixer.slot) ? l : null
		}, 6000)
		const pgmAfter = await peerLayer(ctx, ch.pgm)
		if (!shown) return fail(`PRV ch ${ch.prv} layer ${LAYER}/${LAYER + 100} does not show DeckLink ${LOOKS.mixer.slot}`, { prv: await peerLayer(ctx, ch.prv), take: r.data })
		return pgmAfter.text === pgmBefore.text ? ok(`${shown.producer} bank ${shown.bank}; PGM unchanged`, shown) : fail('PGM changed with a PRV stage', { pgmBefore, pgmAfter })
	})

	await report.check('T5.4', 'take on the LED wall: on air on main, not sent to the second server', async () => {
		const L = looks[LOOKS.led.name]
		const led = V.channelsOf(snap.main.dv, ctx.led)
		const ledPeer = V.channelsOf(snap.peer.dv, ctx.led)
		if (!L || !led?.pgm) return skip('no LED look / channel')
		const sentBefore = Object.values((await main.get('/api/cluster')).fanout?.peers || {})[0]?.sent
		const r = await take(main, L.id)
		if (r.status > 299) return fail(`refused: ${r.status} ${j(r.data).slice(0, 240)}`)
		const onMain = await waitFor(async () => {
			const l = P.lookLayer(await main.amcp(`INFO ${led.pgm}`), LAYER)
			return l.empty ? null : l
		}, 6000)
		if (!onMain) return fail(`main LED PGM ch ${led.pgm} layer ${LAYER} empty`)
		const onPeer = ledPeer?.pgm ? await peerLayer(ctx, ledPeer.pgm) : { empty: true }
		const sentAfter = Object.values((await main.get('/api/cluster')).fanout?.peers || {})[0]?.sent
		return onPeer.empty ? ok(`main ch ${led.pgm}: ${onMain.producer}; fan-out sent ${sentBefore} → ${sentAfter}`) : fail(`the second server's uncabled LED channel ${ledPeer.pgm} got the look`, onPeer)
	})

	await report.check('T5.5', 'a take pressed on the second server goes on air through the master', async () => {
		const L = LOOKS.ppt
		if (!looks[L.name] || !ch?.pgm) return skip('no look / channel')
		await take(main, looks[LOOKS.mixer.name].id)
		const mixerOn = await waitFor(async () => shows(await peerLayer(ctx, ch.pgm), LOOKS.mixer.slot), 6000)
		if (!mixerOn) return fail('the master\'s Mixer take did not reach the second server first (T5.1)')
		await sleep(1000)
		const r = await take(peer, looks[L.name].id)
		if (r.status > 299) return fail(`refused: ${r.status} ${j(r.data).slice(0, 240)}`)
		const shown = await waitFor(async () => shows(await peerLayer(ctx, ch.pgm), L.slot), 6000)
		const air = (await main.get('/api/project'))?.scenes?.liveSceneIdByMain
		return shown ? ok(`master's live looks: ${j(air)}`, r.data) : fail('the second server\'s PGM did not change', { take: r.data, now: await peerLayer(ctx, ch.pgm) })
	})

	await report.check('T5.5b', 'the same press relayed as a cluster call (POST /api/cluster/send look.take → the master) goes on air', async () => {
		const L = LOOKS.ppt
		if (!looks[L.name] || !ch?.pgm) return skip('no look / channel')
		const master = (snap.peer.cluster.peers || []).find((p) => p.host === main.host)
		if (!master) return fail(`the second server does not list ${main.host}`)
		await take(main, looks[LOOKS.mixer.name].id)
		if (!(await waitFor(async () => shows(await peerLayer(ctx, ch.pgm), LOOKS.mixer.slot), 6000))) return fail('the master\'s Mixer take did not reach the second server first (T5.1)')
		const r = await peer.try('/api/cluster/send', { peer: master.id, action: 'look.take', args: { sceneId: looks[L.name].id, target: 'program' } })
		if (r.status > 299) return fail(`refused: ${r.status} ${j(r.data).slice(0, 240)}`)
		const shown = await waitFor(async () => shows(await peerLayer(ctx, ch.pgm), L.slot), 6000)
		return shown ? ok(`via ${master.id}: PGM shows DeckLink ${L.slot}`) : fail('the second server\'s PGM did not change', { now: await peerLayer(ctx, ch.pgm) })
	})

	await report.check('T5.6', 'no Caspar or server errors on either box during the takes', async () => {
		const logs = { main: await P.logsSince(main, marks.main), peer: await P.logsSince(peer, marks.peer) }
		const n = logs.main.caspar.length + logs.main.node.length + logs.peer.caspar.length + logs.peer.node.length
		return n ? fail(`${n} error / warning lines`, logs) : ok()
	})
}

/** A received stream (probeMedia) with fewer frames than its duration at 50 fps → why, else ''. */
function streamFramesShort(m) {
	const want = m.duration * 50
	if (!m.video || m.video.frames >= want - Math.max(10, want * 0.02)) return ''
	return `${m.video.frames} frames for ${m.duration.toFixed(1)} s (${want.toFixed(0)} at 50 fps, ${(m.video.frames / m.duration).toFixed(1)} fps delivered)`
}

/** The second server's first stream / record output ids. */
const outputIds = (stream) => ({ str: stream.outputs?.stream?.[0]?.id || '', rec: stream.outputs?.record?.[0]?.id || '' })

/** POST the throwaway stream target + key to `box` (/api/project/streaming-credentials: the active project) → { status, data }. */
async function setStreamTarget(ctx, box, id, clear = false) {
	const body = clear ? { outputId: id, rtmpServerUrl: '', clearKey: true } : { outputId: id, rtmpServerUrl: ctx.rtmp, streamKey: ctx.key, clearKey: false }
	return box.try('/api/project/streaming-credentials', body)
}

/** Receiver on main + start on the second server → { rx, r } (the receiver is stopped again when the start is refused). */
async function startStream(ctx, str, seconds) {
	const rx = await P.rtmpReceiver(ctx.main, `${ctx.rtmp}/${ctx.key}`, seconds, ctx.dir)
	const r = await ctx.peer.try('/api/streaming-channel/rtmp', { action: 'start', outputId: str })
	if (r.status > 299) await rx.stop()
	return { rx: r.status > 299 ? null : rx, r }
}

async function stream(report, ctx) {
	const { main, peer } = ctx
	const { str } = outputIds(ctx.snap.peer.stream)
	let rx = null
	// Stream targets and keys are per server by design (`streaming` is volatile in the shared show, show-merge.js): they
	// are set on the server that owns the output. Phase 1 (09.11) confirmed a target posted on the master does not travel.
	await report.check('T6.1', 'stream target + key set on the second server (the output\'s owner) → its stream starts', async () => {
		if (!str) return skip('no stream output on the second server')
		const set = (await setStreamTarget(ctx, peer, str)).status
		const s = await startStream(ctx, str, 12)
		rx = s.rx
		if (!rx) return fail(`credentials on the second server (→ ${set}); start refused: ${s.r.status} ${j(s.r.data).slice(0, 300)}`, s.r.data)
		return ok(`credentials on the second server → ${set}; started`, s.r.data)
	})
	await report.check('T6.2', 'while streaming: active, link healthy', async () => {
		if (!rx) return skip('stream not started')
		await sleep(6000)
		const s = (await peer.get('/api/streaming-channel')).rtmp || {}
		const link = typeof s.link === 'object' ? s.link?.state : s.link
		if (!s.active) return fail(`not active: ${s.lastError}`, s)
		// the API's word is not enough (a follower skipped the ADD and still said "started"): Caspar must run the consumer
		const ports = P.consumersOf(await peer.amcp(`INFO ${ctx.snap.peer.stream.channel}`))
		const on = ports.find((p) => p.port === Number(s.consumerIndex))
		if (!on) return fail(`API says active, link ${link || 'n/a'}, but Caspar ch${ctx.snap.peer.stream.channel} has no port ${s.consumerIndex} (ports ${j(ports)})`, s)
		return link && link !== 'connected' ? fail(`link ${link}`, s) : ok(`link ${link || 'n/a'}, Caspar port ${on.port} ${on.consumer}`)
	})
	await report.check('T6.3', 'the receiver on main got h264 1920x1080 50p with audio', async () => {
		if (!rx) return skip('stream not started')
		const file = await rx.done(20000)
		const m = await P.probeMedia(main, file)
		if (m.error) return fail(m.error, (await main.sh(`cat '${file}.log' | tail -5`)).out)
		const v = m.video
		const good = v.codec === 'h264' && v.width === 1920 && v.height === 1080 && Math.round(v.fps) === 50 && m.audio >= 1 && m.duration >= 6
		const line = `${v.codec} ${v.width}x${v.height} ${v.fps} fps, ${m.audio} audio, ${m.duration.toFixed(1)} s, ${v.frames} frames`
		if (!good) return fail(j(m))
		// a 50p timebase says nothing about delivery: the frames received must fill the duration (rerun 09.11: 470 of 600)
		const short = streamFramesShort(m)
		return short ? fail(`${short} (${line})`, m) : ok(line, m)
	})
	await report.check('T6.4', 'stop: the stream ends and is reported off', async () => {
		if (!str) return skip('no stream output')
		if (!rx) return skip('stream not started')
		const r = await peer.try('/api/streaming-channel/rtmp', { action: 'stop', outputId: str })
		await sleep(1500)
		const s = (await peer.get('/api/streaming-channel')).rtmp || {}
		return r.status < 300 && !s.active ? ok() : fail(`stop → ${r.status}, active ${s.active}`, s)
	})
}

/** Start, run `seconds`, stop a recording on the second server → { path, media } (the file is probed there). */
async function recordFor(ctx, rec, seconds) {
	const r = await ctx.peer.try('/api/streaming-channel/record', { action: 'start', outputId: rec })
	if (r.status > 299) return { error: `start refused: ${r.status} ${j(r.data).slice(0, 300)}` }
	const file = r.data?.path || r.data?.record?.path || ''
	await sleep(Math.min(3000, seconds * 1000))
	const ch = ctx.snap.peer.stream.channel
	const ports = ch ? P.consumersOf(await ctx.peer.amcp(`INFO ${ch}`)) : []
	await sleep(Math.max(0, seconds * 1000 - 3000))
	const stop = await ctx.peer.try('/api/streaming-channel/record', { action: 'stop', outputId: rec })
	await sleep(5000) // WO-947: the MP4 is final ~2 s after the stop answers
	const rel = file || stop.data?.path || ''
	if (!rel) return { error: 'no file path in the start / stop answers', start: r.data, stop: stop.data }
	// the API answers a path relative to the server's repo (media/Rec1_…); the ssh shell starts in $HOME
	const path = rel.startsWith('/') ? rel : `${ctx.peerRepo || '/home/casparcg/highascg'}/${rel}`
	return { path, ports, media: await P.probeMedia(ctx.peer, path), stop: stop.status }
}

/** A recording of `seconds` at 50 fps: the size, the rate and every frame. */
function judgeRecording(rec, seconds) {
	if (rec.error) return fail(rec.error, rec)
	const m = rec.media
	const cons = (rec.ports || []).map((p) => `${p.port} ${p.consumer}`).join(', ')
	if (m.error) return fail(`${rec.path}: ${m.error} (Caspar ports while recording: ${cons || 'none'})`, rec)
	const v = m.video
	const want = m.duration * 50
	const bad = []
	if (v.width !== 1920 || v.height !== 1080) bad.push(`${v.width}x${v.height}`)
	if (Math.round(v.fps) !== 50) bad.push(`${v.fps} fps`)
	if (Math.abs(m.duration - seconds) > 2) bad.push(`${m.duration.toFixed(1)} s for a ${seconds} s recording`)
	if (Math.abs(v.frames - want) > Math.max(5, want * 0.01)) bad.push(`${v.frames} frames, ${want.toFixed(0)} expected`)
	if (m.audio < 1) bad.push('no audio stream')
	const line = `${v.codec} ${v.width}x${v.height} ${v.fps} fps, ${m.duration.toFixed(1)} s, ${v.frames} frames, ${m.audio} audio — ${rec.path}`
	return bad.length ? fail(`${bad.join('; ')} (${line})`, rec) : ok(line, rec)
}

async function record(report, ctx) {
	const { rec } = outputIds(ctx.snap.peer.stream)
	await report.check('T7.1', 'record 10 s of the workflow PGM on the second server: 1080p50, every frame, audio', async () => {
		if (!rec) return skip('no record output on the second server')
		const r = await recordFor(ctx, rec, 10)
		if (r.path && !ctx.keep) await ctx.peer.sh(`rm -f '${r.path}'`)
		return judgeRecording(r, 10)
	})
}

async function soak(report, ctx) {
	const { main, peer, snap } = ctx
	const secs = ctx.soak
	const ids = outputIds(snap.peer.stream)
	await report.check('T8.1', `soak ${secs} s: stream + record + a take every 5 s on both destinations — recording complete, stream unbroken, no errors, servers responsive`, async () => {
		if (!secs) return skip('--soak=0')
		if (!ids.str || !ids.rec) return skip('no stream / record output')
		const looks = await looksByName(main)
		const seq = [LOOKS.mixer, LOOKS.ppt].map((l) => looks[l.name]).filter(Boolean)
		const led = looks[LOOKS.led.name]
		const idle = { main: await P.gpu(main), peer: await P.gpu(peer) } // before stream + record start
		const marks = { main: await P.logMark(main), peer: await P.logMark(peer) }
		// headroom: the receiver must outlive the sender, or its exit shows up as the sender's "Connection lost" errors
		// (phase 2, 09.11: a secs + 4 receiver quit while the stream still ran through the recording's stop + probe)
		const rx = await P.rtmpReceiver(main, `${ctx.rtmp}/${ctx.key}`, secs + 30, ctx.dir)
		const st = await peer.try('/api/streaming-channel/rtmp', { action: 'start', outputId: ids.str })
		if (st.status > 299) await rx.stop()
		const samples = { main: { gpu: [], api: [] }, peer: { gpu: [], api: [] } }
		let takesDone = 0
		const worker = (async () => {
			const end = Date.now() + secs * 1000
			while (Date.now() < end) {
				if (seq.length) takesDone += (await take(main, seq[takesDone % seq.length].id)).status < 300 ? 1 : 0
				if (led) await take(main, led.id)
				for (const b of [main, peer]) {
					samples[b.name].gpu.push(await P.gpu(b))
					samples[b.name].api.push(await P.apiMs(b).catch(() => 9999))
				}
				await sleep(Math.max(0, Math.min(5000, end - Date.now())))
			}
		})()
		const recP = recordFor(ctx, ids.rec, secs) // stops at `secs`, then waits for the MP4 and probes it
		await worker
		await peer.try('/api/streaming-channel/rtmp', { action: 'stop', outputId: ids.str }) // with the recording, not after its probe
		const rec = await recP
		const rxMedia = await P.probeMedia(main, await rx.done(15000))
		const logs = { main: await P.logsSince(main, marks.main), peer: await P.logsSince(peer, marks.peer) }
		if (rec.path && !ctx.keep) await peer.sh(`rm -f '${rec.path}'`)
		const load = {}
		for (const n of ['main', 'peer']) {
			const g = samples[n].gpu.filter(Boolean)
			load[n] = { gpuIdle: idle[n], gpuUtilAvg: Math.round(g.reduce((a, x) => a + x.util, 0) / (g.length || 1)), gpuUtilMax: Math.max(0, ...g.map((x) => x.util)), gpuMemMax: Math.max(0, ...g.map((x) => x.mem)), apiP50: Math.round(P.pct(samples[n].api, 50)), apiMax: Math.round(Math.max(0, ...samples[n].api)) }
		}
		const bad = []
		const recRes = judgeRecording(rec, secs)
		if (recRes.status !== 'pass') bad.push('recording: ' + recRes.detail)
		if (st.status > 299) bad.push(`stream start ${st.status}`)
		if (rxMedia.error || rxMedia.duration < secs * 0.9) bad.push(`stream received ${rxMedia.error || rxMedia.duration.toFixed(1) + ' s'}`)
		else if (streamFramesShort(rxMedia)) bad.push(`stream: ${streamFramesShort(rxMedia)}`)
		const errs = logs.main.caspar.length + logs.peer.caspar.length + logs.main.node.length + logs.peer.node.length
		if (errs) bad.push(`${errs} error / warning lines`)
		if (load.main.apiMax > 1000 || load.peer.apiMax > 1000) bad.push('an API call took > 1 s')
		const detail = `${takesDone} takes; recording ${recRes.detail}; stream ${rxMedia.duration?.toFixed?.(1)} s; load ${j(load)}`
		return bad.length ? fail(bad.join(' | ') + ' — ' + detail, { logs, load, rec, rxMedia }) : ok(detail, { load, rec, rxMedia })
	})
}

async function aftermath(report, ctx) {
	// T6.1 / the soak leave the throwaway target + key in the second server's project: take them out again
	await report.check('T9.0', 'the throwaway stream target + key are cleared on the second server', async () => {
		const { str } = outputIds(ctx.snap.peer.stream)
		if (!str) return skip('no stream output')
		if (ctx.keep) return skip('--keep')
		const r = await setStreamTarget(ctx, ctx.peer, str, true)
		const left = r.data?.rtmpServerUrl || r.data?.hasStreamKey
		return r.status < 300 && !left ? ok(`${str}: no target, no key`) : fail(`clear → ${r.status} ${j(r.data).slice(0, 200)}`)
	})
	await sleep(3000)
	const after = { main: await snapshot(ctx.main), peer: await snapshot(ctx.peer) }
	await report.check('T9.1', 'afterwards: nothing left running, layouts and the shared show as before', () => {
		const bad = []
		const s = after.peer.stream
		if (s.rtmp?.active) bad.push('stream still active')
		if (s.record?.active) bad.push('record still active')
		for (const n of ['main', 'peer']) if (!after[n].state.configComparison?.aligned) bad.push(`${n}: layout no longer aligned`)
		// the master holds no copy, so its own show.in_sync is always false: its followers' acks + the follower's own flag
		const acks = Object.values(after.main.cluster.show?.peers || {})
		if (!acks.length || !acks.every((p) => p.in_sync)) bad.push(`master: follower not acked ${j(after.main.cluster.show?.peers).slice(0, 160)}`)
		if (!after.peer.cluster.show?.in_sync) bad.push(`second server out of sync (held ${after.peer.cluster.show?.held})`)
		const f = Object.values(after.main.cluster.fanout?.peers || {})[0] || {}
		if (f.error || (f.held || []).length) bad.push(`fan-out: ${f.error} held ${j(f.held)}`)
		if (j(after.main.duties) !== j(ctx.snap.main.duties) || j(after.peer.duties) !== j(ctx.snap.peer.duties)) bad.push('duties changed during the run')
		return bad.length ? fail(bad.join('; ')) : ok(`fan-out sent ${f.sent}`)
	})
	await report.check('T9.2', 'the tracking server still detects on both cameras after the load', () => {
		const d = after[ctx.exp.tracking].det
		const stale = (d.cameras || []).filter((c) => c.stale).map((c) => c.id)
		if (!d.running) return fail(`detector not running: ${d.error}`)
		return stale.length ? warn(`stale: ${stale.join(', ')}`) : ok()
	})
}

async function activeChecks(report, ctx) {
	await takes(report, ctx)
	await stream(report, ctx)
	await record(report, ctx)
	await soak(report, ctx)
	await aftermath(report, ctx)
}

module.exports = { activeChecks }
