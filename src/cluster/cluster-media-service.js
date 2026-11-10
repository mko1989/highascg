'use strict'

/**
 * WO-1029 plan 07 C10 — the shared media library on this server: the pieces of cluster-media-inventory / -needs /
 * -spread / -link / -transport put together with the server's context (kept out of routes-cluster.js, which is at its
 * line limit, like ownership-ctx.js). One instance per process (`ctx._clusterMediaService`).
 *
 * Servers are named by the ids of GET /api/cluster as THIS node sees them (self = `self.id`, else 'self', as
 * destination-ownership.js); between nodes a server is named by its device-key fingerprint.
 */

const crypto = require('crypto')
const { scanMediaInventory, createLocalInventory, createRemoteInventories } = require('./cluster-media-inventory')
const { computeNeeds, sharedLibrary, libraryIndex, mediaMissingForTake } = require('./cluster-media-needs')
const { planSpread, createSpreader } = require('./cluster-media-spread')
const { createPushJobs, remoteCopy } = require('./cluster-media-link')
const transport = require('./cluster-media-transport')

const KEY_FRESH_MS = 10 * 60 * 1000

function createMediaService(ctx) {
	const rc = () => require('../api/routes-cluster')
	const identity = () => require('../system/device-identity')
	const { fingerprint, postSshKey } = require('./cluster-media')
	const { postJson } = require('./cluster-peers')
	const mediaBase = () => require('../media/local-media').getMediaIngestBasePath(ctx.config)
	const log = (lvl, msg) => ctx.log?.(lvl, msg)
	let selfHead = {}

	async function headInfo() {
		const { freeBytes } = require('../media/media-safe-copy')
		let free = null
		try {
			free = await freeBytes(mediaBase())
		} catch {
			/* unknown */
		}
		let onAir = null
		try {
			onAir = require('./air-state').programLooks(ctx).length > 0
		} catch {
			/* unknown */
		}
		const loop = transport.loopbackMode()
		const wrapper = require('../replication/replication-ssh-setup').resolveReplicationSshWrapperPath()
		const canThrottle = loop || transport.wrapperAcceptsBwlimit(wrapper)
		const canResume = loop || transport.wrapperAcceptsPartialDir(wrapper)
		selfHead = { free_bytes: free, on_air: onAir, can_throttle: canThrottle, can_resume: canResume, ...(loop ? { media_root: mediaBase() } : {}) }
		return selfHead
	}

	const local = createLocalInventory({ scan: () => scanMediaInventory(mediaBase()), info: headInfo })

	// the signed media calls: cluster-call.js on their own path and replay-floor namespace (cluster-media-link.js)
	const { createClusterCall } = require('./cluster-call')
	const { sharedFloorStore } = require('./call-replay-guard')
	const floors = sharedFloorStore(ctx.log)
	const call = createClusterCall({
		cluster: rc().clusterOf(ctx),
		peerCaps: (id) => rc().clusterOf(ctx).peerCaps(id),
		selfKey: identity().getDevicePublicKeyPem(),
		sign: identity().signMessage,
		verify: identity().verifyMessage,
		post: (host, port, _path, body, timeout) => postJson(host, port, '/api/cluster/media-call', body, timeout),
		masterId: () => '',
		acceptsRemote: () => true, // information and file copies: not an operator press (accept_remote is for those)
		info: {
			'media.have': async (args) => ({ status: 200, body: await local.answer(args || {}) }),
			'media.push_status': async (args) => jobs.status(args?.job),
		},
		actions: {
			'media.push': async (args, peer) => pushRequest(args, peer),
			'media.push_cancel': async (args) => jobs.cancel(args?.job),
		},
		floorStore: { get: (k) => floors.get(`media-${k}`), set: (k, v) => floors.set(`media-${k}`, v) },
		log: ctx.log,
	})
	const remote = createRemoteInventories({ have: (id, args) => call.call(id, 'media.have', args, { quiet: true, timeoutMs: 20000 }) })

	const snapshot = () => rc().clusterOf(ctx).snapshot()
	const selfId = () => snapshot().self?.id || 'self'
	function servers() {
		const s = snapshot()
		return [
			{ id: s.self?.id || 'self', name: s.self?.hostname || 'this server', self: true, online: true, fp: fingerprint(identity().getDevicePublicKeyPem()) },
			...(s.peers || []).map((p) => ({ id: p.id, name: p.name || p.hostname || p.id, self: false, online: p.online === true, fp: p.fp || '' })),
		]
	}
	function inventory(id) {
		if (id === selfId()) {
			const cur = lastLocal
			return cur ? { known: true, files: cur.files, head: selfHead } : { known: false, reason: 'scanning' }
		}
		return remote.get(id)
	}
	let lastLocal = null

	const masterId = () => {
		const m = rc().masterOf(ctx).view()
		return m.is_master ? selfId() : m.master_id || ''
	}

	/** GET /api/cluster/media-needs body (also cached for the take answer). */
	async function needs({ refresh = false } = {}) {
		lastLocal = await local.get({ fresh: refresh })
		await headInfo()
		const list = servers()
		await remote.refreshAll(list.filter((s) => !s.self), { force: refresh })
		let destinations
		try {
			await rc().ownershipOf(ctx).refresh()
			destinations = rc().ownershipOf(ctx).destinations()
		} catch {
			destinations = []
		}
		const gather = require('../media/project-media-gather')
		let { slug, project } = gather.activeProject(ctx)
		if (!project) project = require('../engine/project-scenes').loadFullProject()
		const { expandMediaIdToMediaRoot } = require('../media/project-media-root')
		const out = computeNeeds({
			project,
			destinations,
			servers: list,
			inventory,
			masterId: masterId(),
			expand: (v) => (slug ? [expandMediaIdToMediaRoot(v, slug, ctx.config)] : []),
		})
		out.running = spreader.running()
		ctx._clusterMediaNeeds = out
		return out
	}

	async function library({ offset = 0, limit = 2000 } = {}) {
		lastLocal = await local.get()
		const list = servers()
		await remote.refreshAll(list.filter((s) => !s.self))
		const all = sharedLibrary(list, inventory)
		const o = Math.max(0, parseInt(offset, 10) || 0)
		const l = Math.max(1, Math.min(5000, parseInt(limit, 10) || 2000))
		const n = (await needs()).servers
		return { generatedAt: Date.now(), total: all.length, offset: o, servers: n, items: all.slice(o, o + l) }
	}

	// ---- pushing (this server is the source) ----
	const keyAt = new Map() // peer id → when its ssh key exchange last succeeded
	async function pushLocal(job, { signal, onProgress }) {
		const peer = (snapshot().peers || []).find((p) => p.fp === job.to)
		if (!peer) return { ok: false, error: 'the receiving server is not linked here' }
		if (!peer.online) return { ok: false, error: `${peer.name || peer.id} is offline` }
		const head = (await remote.refresh(peer.id)).head || {}
		if (transport.loopbackMode()) {
			if (!head.media_root) return { ok: false, error: `${peer.name || peer.id}: no loopback media folder` }
			return transport.loopbackCopyFile({ srcBase: mediaBase(), rel: job.path, destRoot: head.media_root, signal, onProgress })
		}
		if (require('../bootstrap/sandbox').isSandbox()) return { ok: false, error: 'a sandbox never pushes media over ssh' }
		if (!(Date.now() - (keyAt.get(peer.id) || 0) < KEY_FRESH_MS)) {
			const saved = rc().clusterOf(ctx).saved(peer.id)
			if (!saved?.device_key) return { ok: false, error: `${peer.name}: unlink and link it again (its identity was not recorded)` }
			const ssh = require('../replication/replication-ssh-setup')
			const r = await postSshKey(peer.id, saved, ssh.ensureReplicationSshKey(ctx.log).publicKeyLine, {
				selfKey: identity().getDevicePublicKeyPem(), sign: identity().signMessage, post: postJson, peerCaps: (id) => rc().clusterOf(ctx).peerCaps(id) })
			if (r.status === 403) return { ok: false, error: `${peer.name} has not linked this server back` }
			if (!r.ok) return { ok: false, error: `${peer.name}: ${r.json?.error || r.error || 'HTTP ' + r.status}` }
			keyAt.set(peer.id, Date.now())
		}
		const { rsyncSshOpts } = require('../replication/sync-project-media-rsync')
		const out = await transport.rsyncPushFile({
			mediaBase: mediaBase(), rel: job.path, host: saved(peer).host, user: String(process.env.HIGHASCG_REPL_RSYNC_USER || 'casparcg').trim() || 'casparcg',
			remoteRoot: String(process.env.HIGHASCG_REPL_RSYNC_REMOTE_ROOT || require('../repo-paths').REPO_ROOT).replace(/\/+$/, ''),
			sshOpts: rsyncSshOpts(), bwlimitKbps: head.can_throttle ? job.throttle_kbps : null, resume: head.can_resume === true, signal, onProgress,
		})
		if (!out.ok && /permission denied|publickey/i.test(out.error || '')) keyAt.delete(peer.id)
		return out
	}
	const saved = (peer) => rc().clusterOf(ctx).saved(peer.id) || peer
	const jobs = createPushJobs({ push: pushLocal })

	/** media.push from a linked server: the file must be ours (inside the media folder, the size it was told). */
	function pushRequest(args, peer) {
		const rel = transport.safeRel(args?.path)
		if (!rel || !/^[0-9a-f]{16}$/.test(String(args?.to || ''))) return { status: 400, body: { error: 'path and to required' } }
		const abs = require('../media/local-media').resolveSafe(mediaBase(), rel)
		let st
		try {
			st = abs && require('fs').statSync(abs)
		} catch {
			st = null
		}
		if (!st?.isFile()) return { status: 404, body: { error: `no file ${rel} here` } }
		log('info', `[cluster] media spread: ${peer?.name || 'a linked server'} asks this server to send ${rel}`)
		const kbps = Number(args.throttle_kbps)
		return jobs.start({ path: rel, to: String(args.to), bytes: st.size, throttle_kbps: Number.isFinite(kbps) && kbps > 0 ? kbps : null })
	}

	function serverInfo(id) {
		const s = servers().find((x) => x.id === id)
		const head = id === selfId() ? selfHead : remote.get(id).head || {}
		return { name: s?.name || id, free_bytes: head.free_bytes ?? null, on_air: head.on_air ?? null, can_throttle: head.can_throttle }
	}

	const spreader = createSpreader({
		server: serverInfo,
		copy: (t, o) => {
			const fpOf = (id) => servers().find((s) => s.id === id)?.fp || ''
			if (t.from === selfId()) {
				return jobs.run({ path: t.path, to: fpOf(t.to), bytes: t.bytes, throttle_kbps: o.throttleKbps }, o).then((v) => (v.state === 'done' ? { ok: true } : { ok: false, error: v.error }))
			}
			return remoteCopy(t, o, { call: (id, a, args, opts) => call.call(id, a, args, opts), fingerprintOf: fpOf, nameOf: (id) => serverInfo(id).name })
		},
		broadcast: (data) => typeof ctx._wsBroadcast === 'function' && ctx._wsBroadcast('cluster:media', data),
		onDone: () => {
			local.invalidate()
			needs({ refresh: true }).catch(() => {})
		},
		newId: () => `ms_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
		log: ctx.log,
	})

	/** POST /api/cluster/media-spread → { status, body }. */
	async function spread(body = {}) {
		if (spreader.running()) return spreader.start({ transfers: [{}], skipped: [] }) // → the 409 with the run
		const n = await needs({ refresh: true })
		// any library file by id (explicit `files`), needed or not; the default = what the destinations' owners lack
		const index = libraryIndex(servers(), inventory)
		const plan = planSpread(n, { files: body.files, to: body.to, overwrite: body.overwrite === true, selfId: selfId(), masterId: masterId(), index })
		return spreader.start(plan, { overwrite: body.overwrite === true })
	}

	return { needs, library, spread, cancel: () => spreader.cancel(), status: () => spreader.status(), handleCall: (b) => call.handle(b) }
}

/** The one instance of this process. */
function mediaServiceOf(ctx) {
	if (!ctx._clusterMediaService) ctx._clusterMediaService = createMediaService(ctx)
	return ctx._clusterMediaService
}

/**
 * Take answer (contract 5): `media_missing` on a successful take when the last media-needs knows something of this
 * look is missing on a box that outputs screen `mainIdx`. Never waits, never refuses.
 */
function withMediaMissing(ctx, res, sceneId, mainIdx) {
	const miss = mediaMissingForTake(ctx?._clusterMediaNeeds, sceneId, mainIdx)
	if (!miss.length || !res || res.status >= 400) return res
	try {
		const body = JSON.parse(String(res.body || '{}')) || {}
		return { ...res, body: JSON.stringify({ ...body, media_missing: miss }) }
	} catch {
		return res
	}
}

module.exports = { mediaServiceOf, withMediaMissing }
