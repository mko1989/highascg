'use strict'

/**
 * WO-979 — the role split, end to end: one server plays out (MEDIA), the other does camera tracking, previs and the
 * lighting / PSN output (TRACKING). `nodes` = [media, tracking]. Proves, in order:
 *   alone        each server does everything (WO-723: a single box ticks it all) — both send PSN (the WO-712 hazard)
 *   link         the two link (WO-732/739) and the media server is master; the tracking server follows it
 *   duties       GET /api/server/duties: tracking does tracking / zones / auto / presenters / lighting / ptz, media
 *                defers each of them (its Auto answers off_by_duties, its follow output is blocked, intake 409)
 *   psn          only the lighting sender's PSN reaches the wire; a picked sender moves it, Auto puts it back
 *   exchange     tracking → media: the tracking server's people on the media server (API + WS, tagged, moving)
 *   overlay      media → tracking: pin / unpin / home over the signed call land on the tracking director (R2/R3a)
 *   air          media → tracking: a take on the media server is in the tracking server's air state (R3b)
 *   rules        R4 on the tracking server: Opener → auto:home; Closer → look:Credits, which the master takes
 *   impose       tracking → media: a signed look.take from the tracking server goes on air on the media server
 *   refusal      accept_remote off refuses presses both ways, while the information exchange keeps flowing
 *   relay        rule 3: the media node relays the tracking node's API (a client never crosses machines)
 *   unlink       rule 4: both back to local-only — peers, master, duties, PSN, the other's data; a restart keeps it
 *
 * Sandbox servers (duties-fixture.js: projects, fake camera, PSN ears) run every step; `--live` servers run the steps
 * that change nothing but the link, the sender choice, accept_remote (all put back) and — only with `--look=<id>` —
 * one take on the media server.
 */

const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { waitFor } = require('./cluster-nodes')
const { steps: clusterSteps } = require('./cluster-scenario')
const P = require('./duties-probes')
const { LOOKS } = require('./duties-fixture')

const TRACKING_DUTIES = ['zones', 'auto', 'presenters', 'lighting', 'ptz']
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const clusterStep = (prefix) => clusterSteps.find((s) => s.name.startsWith(prefix))
const fpOf = async (n) => (await P.get(n, '/api/cluster/identity')).fingerprint

/** Both PSN ears over `ms` → { media, tracking } packet counts. */
async function listen(env, ms = 1500) {
	env.ears.media.reset()
	env.ears.tracking.reset()
	await sleep(ms)
	return { media: env.ears.media.count(), tracking: env.ears.tracking.count() }
}

/** Wait until only `who` ('media' | 'tracking' | 'both') is heard on PSN. */
async function psnFrom(env, who, what) {
	return waitFor(
		what,
		async () => {
			const c = await listen(env, 700)
			const ok =
				who === 'both' ? c.media > 0 && c.tracking > 0 : c[who] > 0 && c[who === 'media' ? 'tracking' : 'media'] === 0
			return ok && c
		},
		10000,
		0
	)
}

const steps = [
	{
		name: 'alone: each server does everything (single-box duties), both send PSN',
		async run({ media, tracking, ...env }) {
			const [dm, dt] = await Promise.all([P.duties(media), P.duties(tracking)])
			for (const k of TRACKING_DUTIES) {
				assert.equal(dm[k], true, `media alone: ${k}`)
				assert.equal(dt[k], true, `tracking alone: ${k}`)
			}
			assert.equal(dt.tracking, true, "the tracking server's project tracks (detection on + a camera)")
			if (media.kind !== 'sandbox') return { media: dm, tracking: dt }
			assert.equal(dm.tracking, false, "the media server's project does not track")
			const psn = await psnFrom(env, 'both', 'both servers send PSN while alone')
			return { psn: psn.value, ms: psn.ms }
		},
	},
	{ ...clusterStep('clocks'), name: 'clocks: the two servers within 5 s' },
	{ ...clusterStep('link every pair'), name: 'link media ↔ tracking (the other server accepts the invite)' },
	{
		name: 'master: the media server is master, the tracking server follows it',
		async run({ media, tracking }) {
			const r = await media.post('/api/cluster/master/set', { master: 'self', auto: true })
			assert.equal(r.status, 200, JSON.stringify(r.data))
			const f = await waitFor(
				'tracking follows media',
				async () => {
					const v = await P.cluster(tracking)
					return v.follows_master && v.master.master_id === media.id && v
				},
				8000
			)
			return { epoch: r.data.epoch, followMs: f.ms }
		},
	},
	{
		name: 'duties: the tracking server tracks, the media server defers (GET duties on both)',
		async run({ media, tracking }) {
			const got = await waitFor(
				'duties resolve across the link',
				async () => {
					const [dm, dt] = await Promise.all([P.duties(media), P.duties(tracking)])
					const ok = TRACKING_DUTIES.every((k) => dt[k] === true && dm[k] === false) && dt.tracking && !dm.tracking
					return ok && { media: dm, tracking: dt }
				},
				12000
			)
			assert.equal(got.value.media.artnet_in, true, 'Auto artnet_in = every server')
			assert.equal(got.value.tracking.artnet_in, true)
			const peerSeen = (await P.cluster(media)).peers.find((p) => p.id === tracking.id)?.duties
			assert.equal(
				peerSeen?.tracking,
				true,
				`the media server's card shows the tracking server tracking: ${JSON.stringify(peerSeen)}`
			)
			// a live media box may run without the Tracking plugin (features.tracking false): then there is nothing to defer
			const plugin = (await media.get('/api/tracking/auto')).status !== 404
			if (plugin || media.kind === 'sandbox') {
				const auto = await P.get(media, '/api/tracking/auto')
				assert.equal(auto.off_by_duties, true, `media Auto: ${JSON.stringify(auto).slice(0, 120)}`)
				const follow = await P.get(media, '/api/tracking/follow')
				assert.equal(follow.output_blocked, 'server-duties', 'media follow output blocked by the duty')
				assert.equal(follow.psn?.enabled, false, 'media PSN socket closed')
				const intake = await media.post('/api/tracking/presenters', { name: 'wo979' })
				assert.equal(intake.status, 409, `media presenter intake: ${intake.status} ${JSON.stringify(intake.data)}`)
			}
			const ls = await Promise.all([P.senders(media), P.senders(tracking)])
			assert.ok(
				ls.every((s) => s.lighting.by === '' && s.lighting.auto),
				'lighting on Auto'
			)
			assert.equal(ls[0].lighting.here, false)
			assert.equal(ls[1].lighting.here, true)
			return { resolveMs: got.ms, media: got.value.media, tracking: got.value.tracking }
		},
	},
	{
		name: 'psn: only the sender is on the wire; a picked sender moves it, Auto puts it back',
		sandbox: true,
		async run({ media, tracking, ...env }) {
			const auto = await psnFrom(env, 'tracking', 'Auto → only the tracking server sends PSN')
			const fp = await fpOf(media)
			const r = await tracking.post('/api/server/senders', { kind: 'lighting', by: fp }) // picked on the tracking box
			assert.equal(r.status, 200, JSON.stringify(r.data))
			const picked = await psnFrom(env, 'media', 'picked media → only the media server sends PSN')
			const back = await tracking.post('/api/server/senders', { kind: 'lighting', by: '' })
			assert.equal(back.status, 200)
			const again = await psnFrom(env, 'tracking', 'Auto again → the tracking server')
			return { auto: auto.value, picked: { ...picked.value, ms: picked.ms }, back: { ...again.value, ms: again.ms } }
		},
	},
	{
		name: "exchange tracking → media: the tracking server's people on the media server (API + WS)",
		async run({ media, tracking, tapMedia }) {
			const x = await waitFor(
				'tracking.auto from the tracking server on the media server',
				async () => {
					const v = (await P.exchange(media))['tracking.auto']
					return v?.source?.id === tracking.id && (media.kind !== 'sandbox' || v.persons?.length > 0) && v
				},
				12000
			)
			const ws = await waitFor(
				'WS tracking:auto tagged with the tracking server',
				async () => tapMedia.seen('tracking:auto', (d) => d?.source?.id === tracking.id && !d.gone),
				8000
			)
			if (media.kind !== 'sandbox') return { persons: x.value.persons?.length ?? 0, ms: x.ms, wsMs: ws.ms }
			const p0 = x.value.persons[0]
			const moved = await waitFor(
				'the person moves on the media server',
				async () => {
					const p = (await P.exchange(media))['tracking.auto']?.persons?.find((q) => q.key === p0.key)
					return p && (p.x !== p0.x || p.y !== p0.y) && p
				},
				6000
			)
			const own = (await P.get(tracking, '/api/tracking/auto')).persons.find((q) => q.key === p0.key)
			assert.ok(own, `the tracking director has ${p0.key}`)
			return {
				key: p0.key,
				from: [p0.x, p0.y],
				to: [moved.value.x, moved.value.y],
				firstMs: x.ms,
				moveMs: moved.ms,
				wsMsgs: tapMedia.count('tracking:auto'),
			}
		},
	},
	{
		name: 'overlay media → tracking: pin, unpin and home land on the tracking director (signed calls)',
		async run({ media, tracking }) {
			const persons = (await P.exchange(media))['tracking.auto']?.persons || []
			const out = {}
			if (persons.length) {
				const key = persons[0].key
				const pin = await P.send(media, tracking, 'tracking.auto.pin', { key, slot: 1 })
				assert.equal(pin.status, 200, `pin: ${pin.status} ${JSON.stringify(pin.data)?.slice(0, 200)}`)
				const there = await P.get(tracking, '/api/tracking/auto')
				assert.equal(there.slots[0].key, key, 'slot 1 holds the person on the tracking server')
				const back = await waitFor(
					'the pin shows on the media server',
					async () => {
						const p = (await P.exchange(media))['tracking.auto']?.persons?.find((q) => q.key === key)
						return p?.slot === 1 && p
					},
					8000
				)
				const un = await P.send(media, tracking, 'tracking.auto.pin', { key, slot: 0 })
				assert.equal(un.status, 200)
				assert.equal((await P.get(tracking, '/api/tracking/auto')).slots[0].key, null, 'unpinned')
				Object.assign(out, { key, pinRoundTripMs: back.ms })
			} else out.pin = 'skipped: nobody detected on the tracking server'
			const home = await P.send(media, tracking, 'tracking.auto.home', { now: true })
			assert.equal(home.status, 200, `home: ${home.status} ${JSON.stringify(home.data)?.slice(0, 200)}`)
			return { ...out, home: home.data?.home }
		},
	},
	{
		name: "air media → tracking: a take on the media server is in the tracking server's air state",
		needsLook: true,
		async run({ media, tracking, look }) {
			const src = `peer:${media.id}`
			// R4: a source's first air update only seeds (a new link fires nothing) — wait for that heartbeat (≤ 5 s poll)
			await waitFor(
				"the tracking server has heard the media server's air once (the seed)",
				async () => (await P.exchange(tracking)).air?.source?.id === media.id,
				12000
			)
			const log = media.kind === 'sandbox' ? path.join(media.sb.root, 'server.log') : ''
			const from = log ? fs.statSync(log).size : 0
			const r = await P.take(media, look)
			assert.equal(r.status, 200, `take ${look}: ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`)
			const here = await waitFor(
				"on the media server's own air",
				async () => (await P.airOf(media, 'self'))?.includes(look),
				5000
			)
			const there = await waitFor(
				"in the tracking server's air state",
				async () => (await P.airOf(tracking, src))?.includes(look),
				8000
			)
			const out = { look, mediaMs: here.ms, trackingMs: there.ms }
			if (media.kind === 'sandbox') {
				// what the media node sent its Caspar for this take: the simulated Caspar logs every command it runs
				const amcp = await waitFor(
					'the media node sent LOADBG + PLAY of the Opener clip',
					async () => {
						const fd = fs.openSync(log, 'r')
						const buf = Buffer.alloc(Math.max(0, fs.fstatSync(fd).size - from))
						fs.readSync(fd, buf, 0, buf.length, from)
						fs.closeSync(fd)
						const text = buf.toString('utf8')
						const lb = /\[AMCP SIM\] Executing: (LOADBG (\d+-\d+) E2E_RED\b.*)/.exec(text)
						return (
							lb && new RegExp(`\\[AMCP SIM\\] Executing: PLAY ${lb[2]}\\b`).test(text) && [lb[1].trim(), `PLAY ${lb[2]}`]
						)
					},
					4000,
					200
				)
				out.amcp = amcp.value
				const ear = (await P.get(tracking, '/api/tracking/follow')).output_blocked
				assert.equal(ear, null, 'the tracking server keeps its own output')
			}
			return out
		},
	},
	{
		name: 'rules (R4) on the tracking server: Opener → auto:home ran, Closer → look:Credits taken by the master',
		sandbox: true,
		async run({ media, tracking }) {
			const fired = (await P.onAir(tracking)).recent || []
			const home = fired.find((e) => /Opener/i.test(JSON.stringify(e)) && /auto home/.test(JSON.stringify(e)))
			assert.ok(home, `Opener fired auto:home: ${JSON.stringify(fired).slice(0, 300)}`)
			const r = await P.take(media, LOOKS.closer)
			assert.equal(r.status, 200, JSON.stringify(r.data)?.slice(0, 200))
			const credits = await waitFor(
				"the rule's look:Credits went to the master and is on air there",
				async () => (await P.airOf(media, 'self'))?.includes(LOOKS.credits),
				10000
			)
			const rec = (await P.onAir(tracking)).recent.find((e) => JSON.stringify(e).includes(`${LOOKS.credits} → master`))
			assert.ok(rec, `the rule detail names the master: ${JSON.stringify((await P.onAir(tracking)).recent).slice(0, 300)}`)
			const back = await waitFor(
				"Credits in the tracking server's air state",
				async () => (await P.airOf(tracking, `peer:${media.id}`))?.includes(LOOKS.credits),
				8000
			)
			return { home: home.detail || home, creditsMs: credits.ms, backMs: back.ms, rule: rec.detail || rec }
		},
	},
	{
		name: 'impose tracking → media: a signed look.take from the tracking server goes on air on the media server',
		needsLook: true,
		async run({ media, tracking, look }) {
			const r = await P.send(tracking, media, 'look.take', { sceneId: look })
			assert.equal(r.status, 200, `look.take: ${r.status} ${JSON.stringify(r.data)?.slice(0, 200)}`)
			const on = await waitFor(
				'on air on the media server',
				async () => (await P.airOf(media, 'self'))?.includes(look),
				6000
			)
			const nobody = await P.send(tracking, media, 'look.take', { sceneId: 'wo979_no_such_look' })
			assert.equal(nobody.status, 404, `unknown look: ${nobody.status}`)
			const bad = await P.send(tracking, media, 'system.shutdown', {})
			assert.equal(bad.status, 400, 'not on the allow-list')
			return { onAirMs: on.ms }
		},
	},
	{
		name: 'refusal: accept_remote off refuses presses both ways; the exchange keeps flowing',
		async run({ media, tracking, ...env }) {
			const out = {}
			for (const [rx, tx, action, args] of [
				[tracking, media, 'tracking.auto.home', { now: true }],
				[media, tracking, 'look.take', { sceneId: env.look || 'wo979_no_such_look', target: 'preview' }],
			]) {
				const off = await rx.post('/api/server/duties', { patch: { accept_remote: false } })
				assert.equal(off.status, 200, JSON.stringify(off.data))
				env.restore.add(rx)
				try {
					const r = await P.send(tx, rx, action, args)
					assert.equal(r.status, 403, `${tx.id} → ${rx.id} ${action}: ${r.status} ${JSON.stringify(r.data)}`)
					assert.match(String(r.data?.error), /refuses remote/)
					out[`${tx.id}→${rx.id}`] = r.data.error
				} finally {
					await rx.post('/api/server/duties', { patch: { accept_remote: true } })
					env.restore.delete(rx)
				}
			}
			const fresh = (await P.exchange(media)).sources.find(
				(s) => s.topic === 'tracking.auto' && s.source.id === tracking.id
			)
			assert.ok(fresh && fresh.age_ms < 6000, `tracking.auto still arrives: ${JSON.stringify(fresh)}`)
			const air = (await P.exchange(tracking)).sources.find((x) => x.topic === 'air' && x.source.id === media.id)
			assert.ok(air && air.age_ms < 6000, `air still arrives: ${JSON.stringify(air)}`)
			return out
		},
	},
	{
		name: 'relay (rule 3): the media node answers for the tracking node; nothing links a client',
		async run({ media, tracking }) {
			const r = await media.get(`/api/cluster/peers/${encodeURIComponent(tracking.id)}/relay/api/server/duties`)
			assert.equal(r.status, 200, `relay: ${r.status} ${JSON.stringify(r.data)}`)
			assert.equal(r.data.tracking, true, "the relayed answer is the tracking node's own")
			for (const [a, b] of [
				[media, tracking],
				[tracking, media],
			]) {
				const peers = (await P.cluster(a)).peers
				assert.equal(peers.length, 1, `${a.id} links exactly one server`)
				assert.equal(`${peers[0].host}:${peers[0].port}`, b.address, `${a.id}'s link is ${b.id}'s node address`)
			}
			return { relayed: Object.keys(r.data).length }
		},
	},
	{
		name: "unlink (rule 4): both back to local-only — peers, master, duties, the other's data, PSN",
		async run({ media, tracking, ...env }) {
			const t0 = Date.now()
			const r = await media.del(`/api/cluster/peers/${encodeURIComponent(tracking.id)}`)
			assert.equal(r.status, 200, `unlink: ${r.status}`)
			assert.equal(
				r.data.link_back?.ok,
				true,
				`the tracking server dropped the media server too: ${JSON.stringify(r.data.link_back)}`
			)
			for (const n of [media, tracking]) {
				const v = await P.cluster(n)
				assert.deepEqual(v.peers, [], `${n.id} peers`)
				assert.equal(v.master.epoch, 0, `${n.id} forgot the master`)
				assert.equal(v.follows_master, false, `${n.id} follows no one`)
			}
			const solo = await waitFor(
				'duties back to single-box',
				async () => {
					const [dm, dt] = await Promise.all([P.duties(media), P.duties(tracking)])
					return TRACKING_DUTIES.every((k) => dm[k] && dt[k]) && { media: dm, tracking: dt }
				},
				6000
			)
			const gone = await waitFor(
				'no data from the other server left on either',
				async () => {
					const x = await P.exchange(media)
					const air = await P.airOf(tracking, `peer:${media.id}`)
					return x['tracking.auto'] === null && !x.sources.length && !(air && air.length) && true
				},
				25000,
				250
			)
			const out = { dutiesMs: solo.ms, dataGoneMs: Date.now() - t0, goneWaitMs: gone.ms }
			if (media.kind === 'sandbox') out.psn = (await psnFrom(env, 'both', 'both send PSN again')).value
			return out
		},
	},
	{
		name: 'unlink survives a restart: no stored remote origin to go back to',
		sandbox: true,
		async run({ media, tracking }) {
			await media.restart()
			const v = await P.cluster(media)
			assert.deepEqual(v.peers, [])
			assert.equal(v.master.epoch, 0)
			assert.equal((await P.duties(media)).zones, true)
			assert.deepEqual((await P.cluster(tracking)).peers, [])
			return { pid: media.pid }
		},
	},
]

/**
 * @param {object[]} nodes  [media, tracking] (cluster-nodes.js shape; sandbox nodes carry `sb`)
 * @param {{ ears?: object, look?: string, onStep?: Function }} opts
 */
async function runDutiesScenario(nodes, opts = {}) {
	const [media, tracking] = nodes
	const tapMedia = P.wsTap(media)
	await tapMedia.opened
	const env = {
		nodes,
		media,
		tracking,
		tapMedia,
		ears: opts.ears,
		look: opts.look || (media.kind === 'sandbox' ? LOOKS.opener : ''),
		restore: new Set(),
	}
	const results = []
	try {
		for (const s of steps) {
			let skip = ''
			if (s.sandbox && media.kind !== 'sandbox') skip = 'sandbox only'
			else if (s.needsLook && !env.look) skip = 'needs --look=<a look id on the media server> (it goes on air)'
			if (skip) {
				results.push({ step: s.name, status: 'skip', reason: skip })
				opts.onStep?.(results[results.length - 1])
				continue
			}
			const t0 = Date.now()
			try {
				results.push({
					step: s.name,
					status: 'pass',
					ms: Date.now() - t0,
					metrics: await s.run({ ...env, nodes, benchN: 20 }),
				})
				results[results.length - 1].ms = Date.now() - t0
			} catch (e) {
				results.push({
					step: s.name,
					status: 'fail',
					ms: Date.now() - t0,
					error: e instanceof Error ? e.message : String(e),
				})
			}
			opts.onStep?.(results[results.length - 1])
		}
	} finally {
		tapMedia.close()
		for (const n of env.restore) await n.post('/api/server/duties', { patch: { accept_remote: true } })
	}
	return results
}

module.exports = { steps, runDutiesScenario, TRACKING_DUTIES }
