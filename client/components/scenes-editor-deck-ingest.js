/**
 * Scenes editor — deck media drag-drop ingest (upload + poll media list for the placed items).
 * Extracted from scenes-editor.js (WO-221 Phase A mechanical split).
 */
import { api, getApiBase } from '../lib/api-client.js'
import { postFormDataWithProgress } from '../lib/form-upload.js'
import { getDefaultUploadSubdir } from '../lib/project-media-context.js'
import { showScenesToast } from './scenes-editor-support.js'

const DECK_DROP_EXT = /\.(mp4|mpe?g|m4v|mov|mxf|mkv|webm|avi|wmv|ts|mts|m2t|m2v|png|jpe?g|gif|webp|bmp|tiff?|dpx|exr|wav|mp3|aac|flac|ogg|m4a)$/i

export async function ingestDeckDroppedFiles(fileList) {
	const files = Array.from(fileList || []).filter((f) => DECK_DROP_EXT.test(f.name))
	if (!files.length) {
		showScenesToast('No supported media files in that drop.', 'error')
		return null
	}
	const fd = new FormData()
	for (const f of files) fd.append('file', f, f.name)
	const uploadSubdir = getDefaultUploadSubdir()
	if (uploadSubdir) fd.append('path', uploadSubdir)
	try {
		await postFormDataWithProgress(getApiBase() + '/api/ingest/upload', fd, () => {})
	} catch (err) {
		showScenesToast(String(err?.message || err), 'error')
		return null
	}
	await api.post('/api/media/refresh', { ensureHqThumbs: false }).catch(() => {})
	let list
	for (let attempt = 0; attempt < 10; attempt++) {
		await new Promise((r) => setTimeout(r, attempt === 0 ? 100 : 220))
		try {
			const data = await api.get('/api/media')
			list = data.media || data
		} catch {
			continue
		}
		if (!Array.isArray(list)) continue
		const payloads = []
		for (const f of files) {
			const base = f.name
			const hit = list.find((m) => {
				const id = String(m.id ?? m ?? '')
				return id === base || id.endsWith(`/${base}`) || String(m.label) === base
			})
			if (hit) {
				const idVal = hit.id ?? hit
				payloads.push({
					type: 'media',
					value: idVal,
					label: hit.label || String(idVal),
					resolution: hit.resolution,
				})
			}
		}
		if (payloads.length === files.length) return payloads
	}
	showScenesToast('Could not match uploaded file(s) in the media list. Try ↻ Refresh in Sources.', 'error')
	return null
}
