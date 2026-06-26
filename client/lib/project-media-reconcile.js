/**
 * After project import: compare referenced clips/templates to server catalog.
 */
import { api } from './api-client.js'
import { collectProjectAssetRefs } from './project-media-refs.js'

const BANNER_ID = 'highascg-missing-media-banner'

/**
 * @param {unknown} list
 * @returns {Set<string>}
 */
function buildMediaIndex(list) {
	const out = new Set()
	if (!Array.isArray(list)) return out
	for (const item of list) {
		if (item == null) continue
		if (typeof item === 'string') {
			const s = item.trim()
			if (s) out.add(s)
			continue
		}
		if (typeof item === 'object') {
			for (const key of ['id', 'path', 'value', 'clip']) {
				const v = String(item[key] || '').trim()
				if (v) out.add(v)
			}
		}
	}
	return out
}

/**
 * @param {unknown} list
 * @returns {Set<string>}
 */
function buildTemplateIndex(list) {
	const out = new Set()
	if (!Array.isArray(list)) return out
	for (const item of list) {
		if (item == null) continue
		const raw =
			typeof item === 'string'
				? item
				: String(item.id ?? item.label ?? item.name ?? '').trim()
		if (!raw) continue
		out.add(raw.replace(/\.html$/i, ''))
	}
	return out
}

/**
 * @param {string} ref
 * @param {Set<string>} index
 */
function mediaExists(ref, index) {
	if (!ref || index.has(ref)) return true
	const base = ref.split(/[/\\]/).pop()
	if (base && index.has(base)) return true
	for (const id of index) {
		if (id.endsWith('/' + ref) || id.endsWith('\\' + ref)) return true
		if (ref.endsWith('/' + id) || ref.endsWith('\\' + id)) return true
	}
	return false
}

/**
 * @param {string} ref
 * @param {Set<string>} index
 */
function templateExists(ref, index) {
	const bare = ref.replace(/\.html$/i, '')
	if (index.has(bare) || index.has(ref)) return true
	for (const id of index) {
		if (id.endsWith('/' + bare) || id === bare) return true
	}
	return false
}

/**
 * @param {object} project
 * @param {{ offline?: boolean, stateStore?: { getState?: () => object } }} [opts]
 */
export async function reconcileProjectMedia(project, opts = {}) {
	const refs = collectProjectAssetRefs(project)
	if (refs.media.length === 0 && refs.templates.length === 0) {
		return {
			isClean: true,
			missingMedia: [],
			missingTemplates: [],
			usedMedia: [],
			usedTemplates: [],
		}
	}

	if (!opts.offline) {
		try {
			const res = await api.post('/api/project/reconcile', { project })
			if (res?.ok && res.reconciliation && typeof res.reconciliation === 'object') {
				const r = res.reconciliation
				return {
					isClean: !!r.isClean,
					missingMedia: Array.isArray(r.missingMedia) ? r.missingMedia : [],
					missingTemplates: Array.isArray(r.missingTemplates) ? r.missingTemplates : [],
					usedMedia: Array.isArray(r.usedMedia) ? r.usedMedia : refs.media,
					usedTemplates: Array.isArray(r.usedTemplates) ? r.usedTemplates : refs.templates,
				}
			}
		} catch {
			/* client fallback below */
		}
	}

	let mediaList = opts.stateStore?.getState?.()?.media
	let templates = opts.stateStore?.getState?.()?.templates

	if (!opts.offline) {
		try {
			if (!Array.isArray(mediaList) || mediaList.length === 0) {
				const data = await api.get('/api/media')
				mediaList = data?.media ?? data
			}
		} catch {
			/* use whatever is in stateStore */
		}
		try {
			if (!Array.isArray(templates) || templates.length === 0) {
				const state = await api.get('/api/state')
				templates = state?.templates
			}
		} catch {
			/* use whatever is in stateStore */
		}
	}

	const mediaIndex = buildMediaIndex(mediaList)
	const templateIndex = buildTemplateIndex(templates)

	const missingMedia = refs.media.filter((p) => !mediaExists(p, mediaIndex))
	const missingTemplates = refs.templates.filter((t) => !templateExists(t, templateIndex))

	return {
		isClean: missingMedia.length === 0 && missingTemplates.length === 0,
		missingMedia,
		missingTemplates,
		usedMedia: refs.media,
		usedTemplates: refs.templates,
	}
}

export function hideMissingMediaBanner() {
	document.getElementById(BANNER_ID)?.remove()
}

/**
 * @param {{ missingMedia: string[], missingTemplates: string[] }} report
 */
export function showMissingMediaBanner(report) {
	hideMissingMediaBanner()
	const missingMedia = report?.missingMedia || []
	const missingTemplates = report?.missingTemplates || []
	if (missingMedia.length === 0 && missingTemplates.length === 0) return

	const parts = []
	if (missingMedia.length) parts.push(`${missingMedia.length} media clip${missingMedia.length === 1 ? '' : 's'}`)
	if (missingTemplates.length) {
		parts.push(`${missingTemplates.length} template${missingTemplates.length === 1 ? '' : 's'}`)
	}

	const preview = [...missingMedia, ...missingTemplates.map((t) => `template:${t}`)].slice(0, 6)
	const more =
		missingMedia.length + missingTemplates.length > preview.length
			? ` (+${missingMedia.length + missingTemplates.length - preview.length} more)`
			: ''

	const el = document.createElement('div')
	el.id = BANNER_ID
	el.className = 'media-reconcile-banner'
	el.innerHTML =
		`<span class="media-reconcile-banner__text"><strong>Missing assets</strong> — ${parts.join(' and ')} not found on this server.` +
		` <span class="media-reconcile-banner__preview" title="${preview.map((p) => String(p).replace(/"/g, '&quot;')).join('\n')}">${preview.map((p) => String(p).replace(/</g, '&lt;')).join(' · ')}${more}</span></span>` +
		'<button type="button" class="media-reconcile-banner__link">Open Media</button>' +
		'<button type="button" class="media-reconcile-banner__dismiss" aria-label="Dismiss">×</button>'

	document.body.appendChild(el)
	el.querySelector('.media-reconcile-banner__link')?.addEventListener('click', () => {
		window.highascgActivateWorkspaceTab?.('sources')
		const tab = document.querySelector('.sources-tab[data-src-tab="media"]')
		tab?.click()
	})
	el.querySelector('.media-reconcile-banner__dismiss')?.addEventListener('click', () => {
		el.remove()
	})
}

/**
 * @param {object} project
 * @param {{
 *   offline?: boolean,
 *   stateStore?: { getState?: () => object },
 *   showToast?: (msg: string, type?: string) => void,
 *   source?: string,
 * }} [opts]
 */
export async function runPostImportMediaReconcile(project, opts = {}) {
	if (!project || typeof project !== 'object') return null
	if (opts.offline) return null

	let report
	try {
		report = await reconcileProjectMedia(project, opts)
	} catch (e) {
		console.warn('[HighAsCG] Media reconcile failed:', e?.message || e)
		return null
	}

	if (!report || report.isClean) {
		hideMissingMediaBanner()
		return report
	}

	showMissingMediaBanner(report)
	const n = (report.missingMedia?.length || 0) + (report.missingTemplates?.length || 0)
	opts.showToast?.(
		`Project loaded — ${n} referenced asset${n === 1 ? '' : 's'} missing on server`,
		'warn',
	)
	return report
}
