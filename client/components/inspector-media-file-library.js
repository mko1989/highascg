/**
 * WO-592 — media-file inspector, library half: per-file trim/mute defaults (copied onto a look
 * layer when the clip is added — client/lib/media-file-defaults.js), "used in", rename, and a
 * FINAL delete (owner: "delete should be final for the file").
 */
import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { setLocalMediaFileDefaults } from '../lib/media-file-defaults.js'
import { formatMediaTimecode } from './inspector-media-file-wave.js'

/** "1:02.5" / "62.5" / "1:02:03" → seconds; '' → null; garbage → NaN */
export function parseTimeInput(text) {
	const t = String(text ?? '').trim()
	if (!t) return null
	const parts = t.split(':').map((x) => Number(x))
	if (parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN
	return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/**
 * @param {HTMLElement} host - empty container appended by the inspector
 * @param {{ id: string, fps: number, durationSec: number, getPos: (() => number) | null,
 *   onTrim: (trim: { inSec: number|null, outSec: number|null }) => void, isCurrent: () => boolean,
 *   timed: boolean }} opts - timed=false (stills): no trim/mute
 */
export function mountMediaFileLibrarySection(host, opts) {
	const { id, fps, getPos, onTrim, isCurrent, timed } = opts
	const tc = (sec) => (sec == null ? '' : formatMediaTimecode(sec, fps))
	host.innerHTML = `${
		timed
			? `<div class="media-insp__trim">
			<label>In <input type="text" class="inspector-field__input" data-k="in" placeholder="start" /></label>
			${getPos ? '<button type="button" class="media-insp__btn media-insp__btn--sm" data-act="set-in" title="Set from the preview position">⇤</button>' : ''}
			<label>Out <input type="text" class="inspector-field__input" data-k="out" placeholder="end" /></label>
			${getPos ? '<button type="button" class="media-insp__btn media-insp__btn--sm" data-act="set-out" title="Set from the preview position">⇥</button>' : ''}
			<button type="button" class="media-insp__btn media-insp__btn--sm" data-act="clear-trim" title="Clear trim">✕</button>
		</div>
		<label class="media-insp__mute"><input type="checkbox" data-k="muted" /> Mute audio</label>
		<p class="media-insp__hint">Trim and mute are this file's defaults — a look layer copies them when the clip is added.</p>`
			: ''
	}
		<div class="media-insp__usage">Checking where this file is used…</div>
		<div class="media-insp__actions">
			<button type="button" class="media-insp__btn" data-act="rename">Rename…</button>
			<button type="button" class="media-insp__btn media-insp__btn--danger" data-act="delete">Delete</button>
		</div>
		<div class="media-insp__msg"></div>`
	const q = (k) => host.querySelector(`[data-k="${k}"]`)
	const msg = host.querySelector('.media-insp__msg')
	const usageEl = host.querySelector('.media-insp__usage')
	let defaults = {}
	let usage = []

	const trimSec = () => ({
		inSec: defaults.trimInMs != null ? defaults.trimInMs / 1000 : null,
		outSec: defaults.trimOutMs != null ? defaults.trimOutMs / 1000 : null,
	})
	const show = () => {
		const t = trimSec()
		if (!timed) return
		q('in').value = tc(t.inSec)
		q('out').value = tc(t.outSec)
		q('muted').checked = !!defaults.muted
		onTrim(t)
	}
	const save = async (patch) => {
		msg.textContent = ''
		try {
			const r = await api.post('/api/media/library/defaults', { path: id, ...patch })
			defaults = r.defaults || {}
			setLocalMediaFileDefaults(id, defaults)
		} catch (e) {
			msg.textContent = e?.message || 'Could not save'
		}
		if (isCurrent()) show()
	}
	const commitTime = (k) => {
		const sec = parseTimeInput(q(k).value)
		if (Number.isNaN(sec)) {
			msg.textContent = 'Use seconds or m:ss.ff'
			return show()
		}
		void save({ [k === 'in' ? 'trimInMs' : 'trimOutMs']: sec == null ? null : Math.round(sec * 1000) })
	}
	if (timed) {
		q('in').addEventListener('change', () => commitTime('in'))
		q('out').addEventListener('change', () => commitTime('out'))
		q('muted').addEventListener('change', () => void save({ muted: q('muted').checked }))
	}

	host.addEventListener('click', async (e) => {
		const act = e.target.closest('[data-act]')?.getAttribute('data-act')
		if (!act) return
		if (act === 'set-in' || act === 'set-out') {
			const ms = Math.round(getPos() * 1000)
			return void save(act === 'set-in' ? { trimInMs: ms } : { trimOutMs: ms })
		}
		if (act === 'clear-trim') return void save({ trimInMs: null, trimOutMs: null })
		if (act === 'rename') return void rename()
		if (act === 'delete') return void del()
	})

	async function rename() {
		const slash = id.lastIndexOf('/')
		const folder = slash >= 0 ? id.slice(0, slash + 1) : ''
		const base = id.slice(slash + 1)
		const dot = base.lastIndexOf('.')
		const ext = dot > 0 ? base.slice(dot) : ''
		const next = prompt(`Rename (the extension ${ext} stays):`, dot > 0 ? base.slice(0, dot) : base)
		if (next == null || !next.trim() || `${next.trim()}${ext}` === base) return
		const to = `${folder}${next.trim()}${ext}`
		try {
			await api.post('/api/media/rename', { renames: [{ from: id, to }] })
			window.dispatchEvent(new CustomEvent('media-library-changed', { detail: { renamed: [{ from: id, to }] } }))
		} catch (err) {
			msg.textContent = err?.message || 'Rename failed — nothing changed'
		}
	}

	async function del() {
		const n = usage.reduce((a, r) => a + r.count, 0)
		const where = usage.length ? `\n\nIt is used ${n} time(s) in ${usage.length} look(s)/timeline(s) — those will show it as missing.` : ''
		if (!confirm(`Delete "${id.slice(id.lastIndexOf('/') + 1)}" permanently?${where}\n\nThis is final — the file cannot be recovered.`)) return
		try {
			await api.post('/api/media/delete', { id })
			window.dispatchEvent(new CustomEvent('media-library-changed', { detail: { deleted: [id] } }))
			window.dispatchEvent(new CustomEvent('media-file-select', { detail: null }))
		} catch (err) {
			msg.textContent = err?.message || 'Delete failed'
		}
	}

	api.get(`/api/media/library/entry?path=${encodeURIComponent(id)}`)
		.then((r) => {
			if (!isCurrent()) return
			defaults = r?.entry?.defaults || {}
			usage = Array.isArray(r?.usage) ? r.usage : []
			show()
			usageEl.innerHTML = usage.length
				? `<span>Used in</span><ul>${usage
						.map((u) => `<li>${u.kind === 'timeline' ? 'Timeline' : 'Look'} <b>${escapeHtml(u.name)}</b> <i>${escapeHtml(u.project)}${u.count > 1 ? ` ×${u.count}` : ''}</i></li>`)
						.join('')}</ul>`
				: 'Not used in any look or timeline'
		})
		.catch(() => {
			if (isCurrent()) usageEl.textContent = 'Library info unavailable'
		})
}
