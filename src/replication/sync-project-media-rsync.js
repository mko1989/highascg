'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getReplicationConfig } = require('../config/replication-config')
const { collectProjectAssetRefs } = require('./project-media-refs')
const { resolveMediaFile } = require('./sync-project-media')
const { resolveTemplateFile } = require('./template-resolve')
const { getMediaIngestBasePath } = require('../media/local-media')
const {
	ensureProjectMediaDir,
	getActiveProjectSlug,
	getProjectMediaRoot,
	getProjectMediaRelId,
	buildProjectMediaManifest,
} = require('../media/project-media-root')
const projectStore = require('../engine/project-store')
const { runRsync } = require('./rsync-exec')
const { resolveReplicationSshIdentityPath } = require('./replication-ssh-setup')

function rsyncRemoteRoot() {
	return String(process.env.HIGHASCG_REPL_RSYNC_REMOTE_ROOT || REPO_ROOT).replace(/\/+$/, '')
}

function rsyncSshUser() {
	return String(process.env.HIGHASCG_REPL_RSYNC_USER || 'casparcg').trim() || 'casparcg'
}

function rsyncSshOpts() {
	const identity =
		String(process.env.HIGHASCG_REPL_RSYNC_IDENTITY_FILE || '').trim() || resolveReplicationSshIdentityPath()
	const identityOpt = identity ? `-i ${identity}` : ''
	const base =
		process.env.HIGHASCG_REPL_RSYNC_SSH_OPTS ||
		'-o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15'
	return [base, identityOpt].filter(Boolean).join(' ').trim()
}

/**
 * @param {string} err
 * @param {{ direction?: string, peerHost?: string }} ctx
 */
function rsyncAuthHint(err, ctx = {}) {
	const msg = String(err || '')
	if (!/permission denied|publickey|authentication failed|host key verification failed/i.test(msg)) {
		return null
	}
	const peer = ctx.peerHost || 'peer'
	const user = rsyncSshUser()
	const dir = ctx.direction === 'pull' ? 'pull from leader' : 'push to follower'
	return (
		`SSH auth failed for ${user}@${peer} (${dir}). ` +
		`Install passwordless keys on BOTH boxes: PEER=${peer} bash scripts/replication/setup-replication-ssh.sh ` +
		`(leader needs follower's pubkey in ~/.ssh/authorized_keys; follower needs leader's too).`
	)
}

/**
 * @param {object} ctx
 * @param {object} project
 */
function buildProjectMediaRsyncPlan(ctx, project) {
	const config = ctx?.config || {}
	const mediaBase = getMediaIngestBasePath(config)
	const slug =
		getActiveProjectSlug(ctx?.persistence, project) ||
		String(project?.slug || projectStore.projectSlugFromName(project?.name) || '').trim()

	ensureProjectMediaDir(config, slug, ctx?.persistence)

	/** @type {Set<string>} */
	const relPaths = new Set()
	const refs = collectProjectAssetRefs(project)

	if (slug) {
		const projectRel = path.posix.join('media', getProjectMediaRelId(slug, config))
		const projectAbs = getProjectMediaRoot(config, ctx?.persistence, slug)
		if (fs.existsSync(projectAbs)) {
			relPaths.add(`${projectRel}/`)
		}
	}

	for (const ref of refs.media) {
		const abs = resolveMediaFile(ref, mediaBase, slug, config)
		if (!abs || !abs.startsWith(mediaBase)) continue
		const relFromMedia = path.relative(mediaBase, abs).split(path.sep).join('/')
		relPaths.add(path.posix.join('media', relFromMedia))
	}

	for (const ref of refs.templates) {
		const src = resolveTemplateFile(ref)
		if (!src || !src.startsWith(REPO_ROOT)) continue
		const rel = path.relative(REPO_ROOT, src).split(path.sep).join('/')
		if (rel.startsWith('template/')) relPaths.add(rel)
	}

	const manifest = buildProjectMediaManifest(config, ctx?.persistence, project)
	for (const entry of manifest) {
		const rel = String(entry?.path || '').trim().replace(/^\/+/, '')
		if (!rel || rel.includes('..')) continue
		relPaths.add(path.posix.join('media', rel.split(path.sep).join('/')))
	}

	return {
		slug,
		relPaths: [...relPaths].sort(),
		refs: refs.media,
		templateRefs: refs.templates,
	}
}

/**
 * @param {'push'|'pull'} direction
 * @param {string} peerHost
 * @param {string[]} relPaths
 * @param {{ log?: Function }} [opts]
 */
async function runProjectMediaRsync(direction, peerHost, relPaths, opts = {}) {
	if (!peerHost) return { ok: false, error: 'peer host not configured' }
	if (!relPaths.length) {
		return { ok: true, skipped: true, reason: 'no media paths', files: 0, relPaths: [] }
	}

	const user = rsyncSshUser()
	const remoteRoot = rsyncRemoteRoot()
	const sshCommand = `ssh ${rsyncSshOpts()}`

	/** @type {string[]} */
	const errors = []
	let transferred = 0
	const total = relPaths.length
	const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null

	for (let i = 0; i < relPaths.length; i++) {
		const rel = relPaths[i]
		if (onProgress) {
			onProgress({
				percent: total ? Math.round((i / total) * 100) : 0,
				index: i,
				total,
				path: rel,
				phase: 'start',
			})
		}

		const isDir = rel.endsWith('/')
		const relNorm = rel.replace(/\\/g, '/')
		/** @type {string[]} */
		const args = ['-avz', '--mkpath', '-e', sshCommand]

		if (direction === 'push') {
			if (isDir) {
				// Trailing slash on source = contents only — target must be the full remote directory.
				const remoteDir = `${user}@${peerHost}:${path.posix.join(remoteRoot, relNorm)}`
				args.push(relNorm, remoteDir)
			} else {
				const parent = path.posix.dirname(relNorm)
				const remoteParent = `${user}@${peerHost}:${path.posix.join(remoteRoot, parent)}/`
				args.push(relNorm, remoteParent)
			}
		} else if (isDir) {
			const remoteDir = `${user}@${peerHost}:${path.posix.join(remoteRoot, relNorm)}`
			args.push(remoteDir, `./${relNorm}`)
		} else {
			const remoteFile = `${user}@${peerHost}:${path.posix.join(remoteRoot, relNorm)}`
			const parent = path.posix.dirname(relNorm)
			args.push(remoteFile, `./${parent}/`)
		}

		const out = await runRsync(REPO_ROOT, args, { log: opts.log })
		if (out.ok) {
			transferred += 1
			if (onProgress) {
				onProgress({
					percent: total ? Math.round(((i + 1) / total) * 100) : 100,
					index: i,
					total,
					path: rel,
					phase: 'done',
				})
			}
		} else {
			errors.push(`${rel}: ${out.stderr?.trim() || out.stdout?.trim() || `exit ${out.code}`}`)
		}
	}

	if (typeof opts.log === 'function') {
		opts.log(
			'info',
			`[replication] rsync ${direction} ${transferred}/${relPaths.length} path(s) ${direction === 'push' ? '→' : '←'} ${peerHost}`,
		)
	}

	if (errors.length) {
		const errorText = errors.join('; ')
		const hint = rsyncAuthHint(errorText, { direction, peerHost: peerHost })
		return {
			ok: false,
			error: errorText,
			hint,
			authFailed: !!hint,
			direction,
			relPaths,
			files: transferred,
		}
	}

	return {
		ok: true,
		direction,
		relPaths,
		files: transferred,
	}
}

/**
 * @param {object} ctx
 * @param {object} project
 * @param {{ direction?: 'push'|'pull'|'auto', log?: Function }} [opts]
 */
async function rsyncProjectMediaToPeer(ctx, project, opts = {}) {
	const repl = getReplicationConfig(ctx.config)
	const runtime = require('./replication-service').getReplicationRuntime(ctx)
	if (!repl.enabled || !repl.peer?.host) {
		return { ok: false, skipped: true, error: 'replication not paired' }
	}

	const { forcePeerPing } = require('./replication-refresh')
	if (runtime) {
		const ping = await forcePeerPing(ctx, runtime)
		if (!ping.ok) {
			return { ok: false, error: ping.error || 'peer unreachable — refresh hot backup connection' }
		}
	}

	const role = runtime?.roleState?.getRole() || repl.role
	let direction = opts.direction || 'auto'
	if (direction === 'auto') {
		direction = role === 'leader' ? 'push' : 'pull'
	}

	const plan = buildProjectMediaRsyncPlan(ctx, project)
	const peerHost = repl.peer.host
	let localSignature = ''
	try {
		const { getLocalProjectMediaManifest } = require('./project-media-parity')
		const localManifest = await getLocalProjectMediaManifest(ctx)
		localSignature = localManifest.signature || ''
	} catch {
		localSignature = ''
	}

	if (!plan.relPaths.length) {
		return {
			ok: false,
			error: 'no project media paths to sync — open a project with media or check media folder',
			transport: 'rsync',
			slug: plan.slug,
			relPaths: [],
		}
	}

	if (runtime) {
		runtime.lastMediaSync = {
			inProgress: true,
			transport: 'rsync',
			direction,
			slug: plan.slug,
			percent: 0,
			at: Date.now(),
		}
	}

	let out = await runProjectMediaRsync(direction, peerHost, plan.relPaths, {
		log: opts.log || ctx.log,
		onProgress: (progress) => {
			if (!runtime) return
			runtime.lastMediaSync = {
				...(runtime.lastMediaSync || {}),
				inProgress: true,
				transport: 'rsync',
				direction,
				slug: plan.slug,
				percent: progress.percent,
				currentPath: progress.path,
				pathIndex: progress.index,
				pathTotal: progress.total,
				at: Date.now(),
			}
		},
	})

	if (out.authFailed) {
		try {
			const { exchangeReplicationSshWithPeer } = require('./replication-ssh-setup')
			const exchanged = await exchangeReplicationSshWithPeer(ctx)
			if (exchanged.ok && typeof ctx.log === 'function') {
				ctx.log('info', '[replication] re-exchanged SSH keys with peer — retrying media rsync')
			}
			if (exchanged.ok) {
				out = await runProjectMediaRsync(direction, peerHost, plan.relPaths, {
					log: opts.log || ctx.log,
				})
			}
		} catch (e) {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', `[replication] SSH re-exchange failed: ${e?.message || e}`)
			}
		}
	}

	const result = {
		...out,
		transport: 'rsync',
		slug: plan.slug,
		linkedMedia: plan.refs.length,
		linkedTemplates: plan.templateRefs.length,
	}

	if (runtime) {
		runtime.lastMediaSync = {
			...result,
			inProgress: false,
			caughtUp: !!out.ok,
			percent: out.ok ? 100 : 0,
			localSignature: out.ok ? localSignature : runtime.lastMediaSync?.localSignature || '',
			at: Date.now(),
		}
	}

	if (out.ok && typeof ctx.log === 'function') {
		ctx.log(
			'info',
			`[replication] project media rsync ${direction} ok — ${plan.relPaths.length} path(s) slug=${plan.slug || '?'}`,
		)
	} else if (!out.ok && !out.skipped && typeof ctx.log === 'function') {
		const note = out.hint || out.error || 'unknown'
		ctx.log('warn', `[replication] project media rsync ${direction} failed: ${note}`)
	}

	const authFailed = !!out.authFailed
	return { ...result, authFailed, hint: out.hint || null }
}

module.exports = {
	buildProjectMediaRsyncPlan,
	rsyncProjectMediaToPeer,
	runProjectMediaRsync,
}
