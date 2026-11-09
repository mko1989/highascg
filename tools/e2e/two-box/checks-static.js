'use strict'

/**
 * WO-1026 — the read-only half of the two-box run: is each server set up as the phase says (scenario.js), and do the
 * two agree (link, master, shared show, channel layouts, cables, DeckLink directions, the tracking duty)?
 * Nothing here changes a server. Ids: T0 link + show, T1 layouts, T2 outputs, T3 DeckLink inputs, T4 tracking.
 */

const V = require('./views')
const { ok, fail, warn, skip } = require('./lib')

const BOXES = ['main', 'peer']
const j = (v) => JSON.stringify(v)

/** Everything the static checks read, once per box: { dv, cluster, duties, state, det, stream, info }. */
async function snapshot(box) {
	const [dv, cluster, duties, state, det, stream, info] = await Promise.all([
		box.get('/api/device-view'),
		box.get('/api/cluster'),
		box.get('/api/server/duties'),
		box.get('/api/state'),
		box.get('/api/tracking/detections'),
		box.get('/api/streaming-channel'),
		box.amcp('INFO').catch((e) => 'ERR ' + e.message),
	])
	return { dv, cluster, duties, state, det, stream, info }
}

async function link(report, ctx) {
	const { main, peer, snap } = ctx
	await report.check('T0.1', 'second server runs the latest release', async () => {
		const u = await peer.get('/api/system/update/check?force=1', 30000)
		if (u.error) return fail(`update check: ${u.error}`)
		return u.updateAvailable ? fail(`runs ${u.current}, latest is ${u.latest}`) : ok(`${u.current}`)
	})
	await report.check('T0.2', 'Caspar connected on both, same build', async () => {
		const v = {}
		for (const b of [main, peer]) {
			if (snap[b.name].dv?.live?.caspar?.connected !== true) return fail(`${b.name}: Caspar not connected`)
			v[b.name] = (await b.amcp('VERSION')).trim()
		}
		return v.main === v.peer ? ok(v.main) : warn(`main ${v.main} / peer ${v.peer}`)
	})
	await report.check('T0.3', 'the two servers are linked both ways', () => {
		const a = (snap.main.cluster.peers || []).find((p) => p.host === peer.host)
		const b = (snap.peer.cluster.peers || []).find((p) => p.host === main.host || p.fp === snap.main.cluster.master?.key_id)
		if (!a) return fail('main does not list the second server')
		if (!b) return fail(`second server does not list main (invites: ${j((snap.peer.cluster.invites || []).map((i) => i.id))})`)
		if (!a.online || !b.online) return fail(`online: main sees ${a.online}, second sees ${b.online}`)
		return a.linked_back === false ? fail(`main: ${a.link_back_error || 'not linked back'}`) : ok()
	})
	await report.check('T0.4', 'main is the master, the second server follows it', () => {
		const m = snap.main.cluster.master || {}
		const p = snap.peer.cluster.master || {}
		if (!m.is_master) return fail(`main is not master (${j(m).slice(0, 160)})`)
		if (p.is_master || p.master !== m.key_id) return fail(`second server's master = ${p.master || 'none'}, expected ${m.key_id}`)
		return m.epoch === p.epoch ? ok(`epoch ${m.epoch}`) : fail(`epoch main ${m.epoch} / second ${p.epoch}`)
	})
	await report.check('T0.5', 'the show is shared and in sync', () => {
		const a = snap.main.cluster.show || {}
		const b = snap.peer.cluster.show || {}
		if (!a.on || !b.on) return fail(`sharing: main ${a.on}, second ${b.on}`)
		if (a.hash !== b.hash) return fail(`hash main ${a.hash} / second ${b.hash}`, { main: a, peer: b })
		if (!a.in_sync) return fail(`main in_sync false: ${j(a.peers).slice(0, 200)}`)
		return ok(`${a.slug} rev ${a.rev} ${a.hash}`)
	})
	await report.check('T0.6', 'both servers hold the same destination list', () => {
		const sig = (dv) => V.destinations(dv).map((d) => `${d.id}:${d.mode}:${V.modeName(d)}@${d.fps}:${d.mainScreenIndex}`).sort()
		const a = sig(snap.main.dv)
		const b = sig(snap.peer.dv)
		return j(a) === j(b) ? ok(`${a.length} destinations`) : fail('lists differ', { main: a, peer: b })
	})
	await report.check('T0.7', `the workflow destination "${ctx.label}" is 1080p50 PGM/PRV, the LED wall is in the show`, () => {
		const d = V.destByLabel(snap.main.dv, ctx.label)
		if (!d) return fail(`no destination labelled "${ctx.label}"`)
		if (!V.destById(snap.main.dv, ctx.led)) return fail(`LED wall destination ${ctx.led} missing`)
		const good = d.mode === 'pgm_prv' && V.modeName(d) === '1080p5000' && Number(d.fps) === 50
		return good ? ok(d.id) : fail(`${d.mode} ${V.modeName(d)} @${d.fps}`)
	})
}

async function layouts(report, ctx) {
	const { snap } = ctx
	for (const n of BOXES) {
		await report.check(`T1.1.${n}`, `${n}: the running Caspar has the generated channel layout`, () => {
			const cc = snap[n].state.configComparison
			if (!cc) return fail('no configComparison yet')
			return cc.aligned ? ok(`${cc.serverChannelCount} channels`) : fail(`running ${cc.serverChannelCount} / generated ${cc.moduleChannelCount}`, cc.serverChannels)
		})
		await report.check(`T1.2.${n}`, `${n}: every shared destination's channels run at its size`, () => {
			const modes = V.channelModes(snap[n].info)
			const bad = []
			const rows = []
			for (const d of V.destinations(snap[n].dv)) {
				if (['operator_gui', 'multiview', 'stream'].includes(d.mode)) continue
				const ch = V.channelsOf(snap[n].dv, d.id)
				rows.push(`${d.label}: pgm ${ch?.pgm}=${modes[ch?.pgm]} prv ${ch?.prv}=${modes[ch?.prv]}`)
				if (!ch?.pgm || modes[ch.pgm] !== V.modeName(d)) bad.push(`${d.label} PGM ch ${ch?.pgm}: ${modes[ch?.pgm]} ≠ ${V.modeName(d)}`)
				if (d.mode === 'pgm_prv' && (!ch?.prv || modes[ch.prv] !== V.modeName(d))) bad.push(`${d.label} PRV ch ${ch?.prv}: ${modes[ch?.prv]}`)
			}
			return bad.length ? fail(bad.join('; '), rows) : ok(rows.join(' | '))
		})
	}
	await report.check('T1.3', 'fan-out: connected to the second Caspar, nothing held, forwards exactly what is cabled there', () => {
		const f = Object.values(snap.main.cluster.fanout?.peers || {})[0]
		if (!snap.main.cluster.fanout?.active || !f) return fail('fan-out not active on main')
		if (!f.connected) return fail(`not connected: ${f.error}`)
		if ((f.held || []).length) return fail(`held: ${j(f.held)}`)
		const want = V.destinations(snap.peer.dv).filter((d) => !['operator_gui', 'multiview', 'stream'].includes(d.mode) && V.sinksOf(snap.peer.dv, d.id).length).map((d) => d.id).sort()
		const got = (f.destinations || []).map((d) => (typeof d === 'string' ? d : d.id)).sort()
		return j(want) === j(got) ? ok(j(got)) : fail(`forwards ${j(got)}, cabled on the second server: ${j(want)}`, f)
	})
	await report.check('T1.4', 'placement: LED wall cabled on main only, the workflow destination on the second server only', () => {
		const s = V.destByLabel(snap.main.dv, ctx.label)
		const at = (id) => BOXES.filter((n) => V.sinksOf(snap[n].dv, id).length).join('+') || 'nowhere'
		const led = at(ctx.led)
		const str = s ? at(s.id) : 'no such destination'
		return led === 'main' && str === 'peer' ? ok() : fail(`LED wall on ${led}, "${ctx.label}" on ${str}`)
	})
}

async function outputs(report, ctx) {
	const { snap, exp } = ctx
	const screenOn = (n, ch) => (snap[n].state.configComparison?.serverChannels || []).find((c) => c.index === ch) || {}
	const gpuCheck = (n, d, w, h) => {
		const ch = V.channelsOf(snap[n].dv, d.id)
		const gpu = V.sinksOf(snap[n].dv, d.id).filter((s) => s.kind === 'gpu_out')
		if (!gpu.length) return { bad: 'not cabled to a GPU output' }
		const shown = gpu.map((g) => ({ port: g.id, note: g.note, ...V.gpuDisplay(snap[n].dv, g) }))
		const pgm = shown.find((s) => s.connected && !/outputLayer"?:\s*2/.test(s.note)) || shown.find((s) => s.connected)
		if (!pgm) return { bad: `cabled to ${shown.map((s) => s.name).join(', ')}: no monitor connected there`, shown }
		if (pgm.resolution !== `${w}x${h}` || Math.round(pgm.hz) !== 50) return { bad: `${pgm.name} runs ${pgm.resolution}@${pgm.hz}, expected ${w}x${h}@50`, shown }
		if (!screenOn(n, ch?.pgm).hasScreen) return { bad: `PGM channel ${ch?.pgm} has no screen consumer in the running Caspar`, shown }
		return { detail: `${pgm.name} ${pgm.resolution}@${pgm.hz}, PGM ch ${ch.pgm}`, shown }
	}
	await report.check('T2.1', 'main: the LED wall destination is on its DisplayPort at the wall size, 50 Hz', () => {
		const d = V.destById(snap.main.dv, ctx.led)
		if (!d) return fail('no LED wall destination')
		const r = gpuCheck('main', d, d.width, d.height)
		return r.bad ? fail(r.bad, r.shown) : ok(r.detail, r.shown)
	})
	await report.check('T2.2', 'second server: the workflow destination is on its own monitor output at 1920x1080@50', () => {
		const d = V.destByLabel(snap.peer.dv, ctx.label)
		if (!d) return fail('no workflow destination')
		const r = gpuCheck('peer', d, 1920, 1080)
		if (r.bad && exp.peer.gpuOut === 'optional') return skip(`not required in this phase (${r.bad})`)
		return r.bad ? fail(r.bad, r.shown) : ok(r.detail, r.shown)
	})
	await report.check('T2.3', 'second server: the PRV of the workflow destination exists (and where it is shown)', () => {
		const d = V.destByLabel(snap.peer.dv, ctx.label)
		const ch = d && V.channelsOf(snap.peer.dv, d.id)
		if (!ch?.prv) return fail('no PRV channel')
		const prvOut = V.sinksOf(snap.peer.dv, d.id).filter((s) => /outputLayer"?:\s*2/.test(s.note))
		return ok(`PRV ch ${ch.prv}; ${prvOut.length ? 'shown on ' + prvOut.map((s) => s.externalRef || s.id).join(', ') : 'no output of its own (operator GUI only)'}`)
	})
	await report.check('T2.4', 'second server: PGM of the workflow destination leaves on DeckLink 2 (phase 2)', () => {
		const slot = exp.peer.decklinkOut
		if (!slot) return skip('phase 1: no DeckLink output')
		const d = V.destByLabel(snap.peer.dv, ctx.label)
		const ch = d && V.channelsOf(snap.peer.dv, d.id)
		const cabled = d && V.sinksOf(snap.peer.dv, d.id).some((s) => s.id === `dlsdi_${slot}`)
		if (!cabled) return fail(`not cabled to dlsdi_${slot}`)
		const out = (snap.peer.dv.live?.decklink?.outputs || []).find((o) => Number(o.deviceIndex) === slot)
		if (!out?.ok) return fail(`DeckLink ${slot} output row: ${j(out).slice(0, 200)}`)
		if (out.decklinkVideoMode !== '1080p5000') return fail(`DeckLink ${slot} sends ${out.decklinkVideoMode}`)
		return screenOn('peer', ch?.pgm).hasDecklinkOutput ? ok(`PGM ch ${ch.pgm} → DeckLink ${slot} 1080p5000`) : fail(`PGM ch ${ch?.pgm} has no DeckLink consumer in the running Caspar`)
	})
	await report.check('T2.5', 'stream + record outputs of the second server take the workflow destination PGM', () => {
		const s = snap.peer.stream
		const d = V.destByLabel(snap.peer.dv, ctx.label)
		const sinks = d ? V.sinksOf(snap.peer.dv, d.id).map((x) => x.kind) : []
		const n = { stream: (s.outputs?.stream || []).length, record: (s.outputs?.record || []).length }
		if (!s.enabled || !s.channel) return fail('streaming channel off', s)
		if (!n.stream || !n.record) return fail(`outputs: ${n.stream} stream, ${n.record} record`)
		if (!sinks.includes('stream_out') || !sinks.includes('record_out')) return fail(`destination is cabled to ${j(sinks)} — no stream_out / record_out cable`)
		const idx = d.mainScreenIndex + 1
		const src = { stream: s.videoSource, record: (s.outputs.record[0] || {}).source }
		const good = src.stream === `program_${idx}` && src.record === `program_${idx}`
		return good ? ok(`program_${idx}, streaming ch ${s.channel}`) : fail(`sources ${j(src)}, expected program_${idx}`)
	})
}

async function decklinkInputs(report, ctx) {
	const { snap, exp } = ctx
	for (const n of BOXES) {
		await report.check(`T3.1.${n}`, `${n}: DeckLink port directions are the phase's`, () => {
			const got = {}
			for (const slot of [1, 2, 3, 4]) got[slot] = V.decklink(snap[n].dv, slot).dir
			return j(got) === j(exp[n].decklink) ? ok(j(got)) : fail(`is ${j(got)}, expected ${j(exp[n].decklink)}`)
		})
		await report.check(`T3.2.${n}`, `${n}: every DeckLink input is open on its own channel and is a Live source`, () => {
			const slots = Object.keys(exp[n].decklink).map(Number).filter((s) => exp[n].decklink[s] === 'in')
			if (!slots.length) return skip('no inputs in this phase')
			const rt = snap[n].dv.live?.decklink?.runtime || {}
			if (rt.enabled === false) return fail(`inputs off: ${rt.reason}`)
			const bad = []
			const noSignal = []
			const rows = []
			for (const slot of slots) {
				const d = V.decklink(snap[n].dv, slot)
				const src = V.liveSource(snap[n].dv, slot)
				rows.push(`DL${slot}: ${d.live?.state} ch ${d.live?.hostChannel}, signal ${d.signal}, source ${src?.value || 'none'}`)
				if (d.live?.state !== 'ready' || !d.live?.hostChannel) bad.push(`DL${slot} ${d.live?.state} ${d.live?.message || ''}`)
				else if (!src) bad.push(`DL${slot} is not in the Live sources`)
				else if (d.signal === false) noSignal.push(slot)
			}
			if ((rt.failed || []).length || (rt.skippedConflicts || []).length) bad.push(`failed ${j(rt.failed)} conflicts ${j(rt.skippedConflicts)}`)
			if (bad.length) return fail(bad.join('; '), rows)
			return noSignal.length ? warn(`no SDI signal on DeckLink ${noSignal.join(', ')} (cable / source, not the software)`, rows) : ok(rows.join(' | '))
		})
	}
}

async function tracking(report, ctx) {
	const { snap, exp } = ctx
	const here = exp.tracking
	const other = here === 'main' ? 'peer' : 'main'
	await report.check('T4.1', 'the show has tracking cameras on DeckLink inputs 1 and 2, detection on', async () => {
		const p = await ctx.main.get('/api/project')
		const t = p?.previs?.tracking || {}
		const roles = (t.cameras || []).map((c) => c.role).sort()
		if (!roles.includes('in1') || !roles.includes('in2')) return fail(`camera roles ${j(roles)}`)
		return t.detection?.enabled ? ok(j(roles)) : fail('detection is off in the show')
	})
	await report.check('T4.2', `only the ${here} server holds the tracking duty; the other defers zones / auto / presenters`, () => {
		const a = snap[here].duties
		const b = snap[other].duties
		const bad = []
		if (!a.tracking) bad.push(`${here}.tracking false`)
		if (b.tracking) bad.push(`${other}.tracking true (both would detect)`)
		for (const k of ['zones', 'auto', 'presenters']) {
			if (!a[k]) bad.push(`${here}.${k} false`)
			if (b[k]) bad.push(`${other}.${k} true`)
		}
		return bad.length ? fail(bad.join('; '), { [here]: a, [other]: b }) : ok()
	})
	await report.check('T4.3', `${here}: the detector runs and reads both cameras`, () => {
		const d = snap[here].det
		if (!d.enabled || !d.running) return fail(`enabled ${d.enabled}, running ${d.running}, error "${d.error}"`)
		const cams = (d.cameras || []).map((c) => ({ id: c.id, role: c.role, stale: c.stale, frame: c.frame, sidecar: d.sidecar?.[c.id] || null }))
		const bad = cams.filter((c) => c.stale || c.frame == null)
		if (cams.length < 2) return fail(`${cams.length} camera(s)`, cams)
		return bad.length ? fail(`no fresh frame from ${bad.map((c) => `${c.id} (${c.role}: ${j(c.sidecar)})`).join(', ')}`, cams) : ok(j(cams.map((c) => `${c.id}/${c.role}`)), cams)
	})
	await report.check('T4.4', `${other}: no detector process, and it does not hold the camera surfaces`, async () => {
		const d = snap[other].det
		const shm = await ctx[other].sh('ls /dev/shm | grep -E "^highascg-in[0-9]+$" || true')
		const bad = []
		if (d.running || d.pid) bad.push(`detector running (pid ${d.pid})`)
		if (shm.out.trim()) bad.push(`camera surfaces present: ${shm.out.trim().split('\n').join(', ')}`)
		return bad.length ? fail(bad.join('; ')) : ok()
	})
	await report.check('T4.5', `${here}: camera surfaces exist for in1 and in2`, async () => {
		const shm = await ctx[here].sh('ls -la /dev/shm | grep -E "highascg-in[12]$" || true')
		const n = shm.out.trim().split('\n').filter(Boolean).length
		return n === 2 ? ok() : fail(`${n} of 2 surfaces`, shm.out)
	})
	await report.check('T4.6', `${other} is told who tracks (the exchange names the ${here} server)`, async () => {
		const x = await ctx[other].get('/api/cluster/exchange')
		const peerRow = (snap[other].cluster.peers || [])[0] || {}
		if (peerRow.duties?.tracking !== true) return fail(`${other} sees the other server's tracking duty as ${peerRow.duties?.tracking}`)
		return ok(`sources ${j(x.sources || [])}`)
	})
}

async function staticChecks(report, ctx) {
	ctx.snap = { main: await snapshot(ctx.main), peer: await snapshot(ctx.peer) }
	await link(report, ctx)
	await layouts(report, ctx)
	await outputs(report, ctx)
	await decklinkInputs(report, ctx)
	await tracking(report, ctx)
}

module.exports = { staticChecks, snapshot }
