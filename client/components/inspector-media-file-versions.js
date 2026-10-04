/**
 * WO-592 B — media-file inspector "Versions": upload a new version (same path → every look plays
 * it), list every old version, go back to a chosen one, purge one by hand (final).
 */
import { api, getApiBase } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { postFormDataWithProgress } from '../lib/form-upload.js'

function fmtSize(n) {
	const b = Number(n) || 0
	if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
	if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`
	return `${Math.max(1, Math.round(b / 1e3))} kB`
}

function fmtDate(ms) {
	if (!ms) return ''
	const d = new Date(ms)
	const p = (n) => String(n).padStart(2, '0')
	return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Rescan; the Sources panel re-announces the selection, so the inspector reloads preview/waveform/info. */
function reselect() {
	window.dispatchEvent(new CustomEvent('media-library-changed', { detail: {} }))
}

/**
 * @param {HTMLElement} host
 * @param {{ id: string, isCurrent: () => boolean }} opts
 */
export function mountMediaFileVersions(host, { id, isCurrent }) {
	const ext = (id.match(/\.[^./]+$/) || [''])[0]
	host.innerHTML = `
		<div class="media-insp__versions-head">
			<span>Versions</span>
			<label class="media-insp__btn media-insp__btn--sm media-insp__upload" title="Replace this file with a new version — looks keep playing it under the same name">
				New version…<input type="file" accept="${escapeHtml(ext)}" hidden />
			</label>
		</div>
		<div class="media-insp__versions-list">…</div>
		<div class="media-insp__versions-progress" hidden><div></div></div>
		<div class="media-insp__msg"></div>`
	const list = host.querySelector('.media-insp__versions-list')
	const msg = host.querySelector('.media-insp__msg')
	const bar = host.querySelector('.media-insp__versions-progress')

	const render = (e) => {
		const cur = `<div class="media-insp__ver media-insp__ver--current"><b>v${e.currentV || 1}</b><span>current</span><span>${fmtSize(e.size)}</span></div>`
		const old = [...(e.versions || [])]
			.sort((a, b) => b.v - a.v)
			.map(
				(v) => `<div class="media-insp__ver"><b>v${v.v}</b><span>replaced ${escapeHtml(fmtDate(v.replacedAt))}</span><span>${fmtSize(v.size)}</span>
					<button type="button" class="media-insp__btn media-insp__btn--sm" data-restore="${v.v}" title="Make v${v.v} current again (the current file is kept as a version)">Go back</button>
					<button type="button" class="media-insp__btn media-insp__btn--sm media-insp__btn--danger" data-purge="${v.v}" title="Delete this old version permanently">✕</button></div>`,
			)
			.join('')
		list.innerHTML = cur + (old || '<div class="media-insp__ver media-insp__ver--none">No older versions</div>')
	}

	const load = () =>
		api
			.get(`/api/media/library/entry?path=${encodeURIComponent(id)}`)
			.then((r) => isCurrent() && r?.entry && render(r.entry))
			.catch(() => isCurrent() && (list.textContent = 'Versions unavailable'))

	const upload = async (file) => {
		if (!file) return
		if (!file.name.toLowerCase().endsWith(ext.toLowerCase())) {
			msg.textContent = `The new version must be a ${ext} file.`
			return
		}
		if (!confirm(`Replace "${id.split('/').pop()}" with "${file.name}"?\n\nEvery look plays the new version. The current one is kept in the version list.`)) return
		msg.textContent = ''
		bar.hidden = false
		const fd = new FormData()
		fd.append('file', file, file.name)
		try {
			await postFormDataWithProgress(`${getApiBase()}/api/media/version/upload?path=${encodeURIComponent(id)}`, fd, (l, t) => {
				if (t > 0) bar.firstElementChild.style.width = `${Math.round((l / t) * 100)}%`
			})
			reselect()
		} catch (err) {
			msg.textContent = err?.message || 'Upload failed — nothing changed'
		} finally {
			bar.hidden = true
		}
	}

	host.querySelector('input[type="file"]').addEventListener('change', (e) => void upload(e.target.files?.[0]))
	host.addEventListener('dragover', (e) => {
		if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
	})
	host.addEventListener('drop', (e) => {
		if (!e.dataTransfer?.files?.length) return
		e.preventDefault()
		e.stopPropagation()
		void upload(e.dataTransfer.files[0])
	})
	host.addEventListener('click', async (e) => {
		const r = e.target.closest('[data-restore]')?.getAttribute('data-restore')
		const p = e.target.closest('[data-purge]')?.getAttribute('data-purge')
		if (!r && !p) return
		msg.textContent = ''
		try {
			if (r) {
				await api.post('/api/media/version/restore', { path: id, v: Number(r) })
				reselect()
			} else if (confirm(`Delete version v${p} permanently? This cannot be undone.`)) {
				await api.post('/api/media/version/purge', { path: id, v: Number(p) })
				void load()
			}
		} catch (err) {
			msg.textContent = err?.message || 'Failed'
		}
	})
	void load()
}
