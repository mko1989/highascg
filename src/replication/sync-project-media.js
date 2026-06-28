'use strict'

const fs = require('fs')
const path = require('path')
const { collectProjectAssetRefs } = require('./project-media-refs')
const { resolveTemplateFile } = require('./template-resolve')
const { getMediaIngestBasePath } = require('../media/local-media')
const { expandMediaIdToMediaRoot } = require('../media/project-media-root')
const projectStore = require('../engine/project-store')
const { ensureRemoteDevice, ensureSharedFolder, scanFolder } = require('./syncthing-client')
const { REPO_ROOT } = require('../repo-paths')

const ACTIVE_MEDIA_FOLDER_ID = 'highascg-project-media'

function resolveMediaFile(ref, mediaBase, slug) {
	const raw = String(ref || '').trim()
	if (!raw) return null
	const candidates = []
	if (slug) candidates.push(expandMediaIdToMediaRoot(raw, slug))
	candidates.push(raw, path.basename(raw))
	const seen = new Set()
	for (const cand of candidates) {
		const key = String(cand || '')
		if (!key || seen.has(key)) continue
		seen.add(key)
		const p = path.join(mediaBase, key)
		try {
			if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
		} catch {
			/* ignore */
		}
	}
	return null
}

function emptyDir(dir) {
	if (!fs.existsSync(dir)) return
	for (const name of fs.readdirSync(dir)) {
		if (name === '.stfolder') continue
		const p = path.join(dir, name)
		try {
			const st = fs.statSync(p)
			if (st.isDirectory()) emptyDir(p)
			fs.rmSync(p, { recursive: true, force: true })
		} catch {
			/* ignore */
		}
	}
}

function linkOrCopyFile(src, dest) {
	fs.mkdirSync(path.dirname(dest), { recursive: true })
	try {
		if (fs.existsSync(dest)) fs.unlinkSync(dest)
		fs.linkSync(src, dest)
		return true
	} catch {
		try {
			fs.copyFileSync(src, dest)
			return true
		} catch {
			return false
		}
	}
}

/**
 * @param {object} project
 * @param {string} [mediaBase]
 */
function rebuildProjectMediaStaging(project, mediaBase) {
	const base = mediaBase || getMediaIngestBasePath()
	const staging = path.join(base, '.replication-active')
	const mediaDir = path.join(staging, 'media')
	const templatesDir = path.join(staging, 'templates')
	fs.mkdirSync(staging, { recursive: true })
	emptyDir(staging)

	const refs = collectProjectAssetRefs(project)
	const slug = String(project.slug || projectStore.projectSlugFromName(project.name) || '').trim()
	let linkedMedia = 0
	let linkedTemplates = 0

	for (const ref of refs.media) {
		const src = resolveMediaFile(ref, base, slug)
		if (!src) continue
		const dest = path.join(mediaDir, path.basename(src))
		if (linkOrCopyFile(src, dest)) linkedMedia += 1
	}

	for (const ref of refs.templates) {
		const src = resolveTemplateFile(ref)
		if (!src) continue
		const rel = path.relative(path.join(REPO_ROOT, 'template'), src)
		const dest = path.join(templatesDir, rel)
		if (linkOrCopyFile(src, dest)) linkedTemplates += 1
	}

	return {
		staging,
		linkedMedia,
		linkedTemplates,
		refs: refs.media,
		templateRefs: refs.templates,
	}
}

/**
 * Copy synced templates from staging into repo template/ (follower after Syncthing).
 * @param {string} [stagingRoot]
 */
function installTemplatesFromStaging(stagingRoot) {
	const base = stagingRoot || path.join(getMediaIngestBasePath(), '.replication-active')
	const srcRoot = path.join(base, 'templates')
	if (!fs.existsSync(srcRoot)) return { installed: 0 }

	let installed = 0
	const walk = (dir, rel = '') => {
		for (const name of fs.readdirSync(dir)) {
			const full = path.join(dir, name)
			const relPath = rel ? `${rel}/${name}` : name
			const st = fs.statSync(full)
			if (st.isDirectory()) {
				walk(full, relPath)
				continue
			}
			if (!name.endsWith('.html')) continue
			const dest = path.join(REPO_ROOT, 'template', relPath)
			if (linkOrCopyFile(full, dest)) installed += 1
		}
	}
	walk(srcRoot)
	return { installed }
}

async function syncProjectMediaViaSyncthing(project, remoteDeviceId, opts = {}) {
	const base = getMediaIngestBasePath()
	const { staging, linkedMedia, linkedTemplates, refs, templateRefs } = rebuildProjectMediaStaging(project, base)
	if (!remoteDeviceId) return { ok: false, error: 'remote syncthing device id required' }

	await ensureRemoteDevice(remoteDeviceId, 'highascg-peer')
	const folderType = opts.asLeader ? 'sendonly' : 'receiveonly'
	const out = await ensureSharedFolder(ACTIVE_MEDIA_FOLDER_ID, staging, [remoteDeviceId], folderType)
	await scanFolder(ACTIVE_MEDIA_FOLDER_ID)

	if (!opts.asLeader) {
		try {
			installTemplatesFromStaging(staging)
		} catch {
			/* optional */
		}
	}

	return {
		ok: out.ok,
		folderId: ACTIVE_MEDIA_FOLDER_ID,
		staging,
		linkedMedia,
		linkedTemplates,
		refs,
		templateRefs,
		error: out.error,
	}
}

module.exports = {
	ACTIVE_MEDIA_FOLDER_ID,
	rebuildProjectMediaStaging,
	installTemplatesFromStaging,
	syncProjectMediaViaSyncthing,
	resolveMediaFile,
}
