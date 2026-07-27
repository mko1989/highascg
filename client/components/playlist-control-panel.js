/**
 * Playlist control panel — collapsible inspector-footer section (owner request 2026-07-26,
 * "similar to timers and audio mixer compact"). A dropdown of every playlist currently LIVE on
 * any channel (GET /api/playlist/state, polled while open), a dropdown of that playlist's items
 * (selecting one = goto), and Prev / Play / Next transport via POST /api/playlist/control —
 * mode-agnostic (drives auto playlists too; the engine re-arms timers/preloads after a jump).
 */

import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'
import { sceneState } from '../lib/scene-state.js'
import { isTimelessItem, timelessSecsOf } from '../lib/playlist-timeless.js'

const LS_COLLAPSED = 'highascg_playlist_panel_collapsed'
const POLL_MS = 2000

export function initPlaylistControlPanel(mountEl) {
	if (!mountEl) return
	mountEl.innerHTML = `
		<div class="timer-control-panel playlist-control-panel">
			<button type="button" class="timer-control-panel__toggle" id="plp-toggle" aria-expanded="false">
				<span class="timer-control-panel__chevron">▶</span>
				<span class="timer-control-panel__label">Playlists</span>
				<span class="playlist-control-panel__count" id="plp-count"></span>
			</button>
			<div class="timer-control-panel__content" id="plp-content" hidden>
				<div class="playlist-control-panel__row">
					<select id="plp-list" class="inspector-field__select" title="Live playlists (look · layer · channel)"></select>
				</div>
				<div class="playlist-control-panel__row">
					<select id="plp-item" class="inspector-field__select" title="Items — selecting one jumps to it"></select>
				</div>
				<div class="playlist-control-panel__row playlist-control-panel__timeless">
					<label for="plp-timeless" title="Graphics, templates and shaders have no intrinsic length — they advance after this many seconds">Timeless (s)</label>
					<input type="number" id="plp-timeless" min="1" max="86400" step="1" />
					<button type="button" class="btn btn--secondary" id="plp-timeless-apply" title="Set the duration of every image/template/shader item in this playlist">Set all</button>
				</div>
				<div class="playlist-control-panel__row playlist-control-panel__transport">
					<button type="button" class="btn btn--secondary" id="plp-prev" title="Previous item"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="3" width="2" height="10"/><path d="M14 3v10L6 8z"/></svg></button>
					<button type="button" class="btn btn--secondary" id="plp-play" title="Restage the selected item"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2v12l10-6z"/></svg></button>
					<button type="button" class="btn btn--secondary" id="plp-next" title="Next item"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3v10l8-5z"/><rect x="12" y="3" width="2" height="10"/></svg></button>
				</div>
			</div>
		</div>`

	const el = (id) => mountEl.querySelector(`#${id}`)
	const toggle = el('plp-toggle')
	const content = el('plp-content')
	const chevron = toggle.querySelector('.timer-control-panel__chevron')
	const listSel = el('plp-list')
	const itemSel = el('plp-item')
	const timelessInp = el('plp-timeless')

	/** @type {Array<object>} */
	let playlists = []
	/** @type {Map<string, number>} */
	const appliedSecs = new Map()
	let selectedKey = null
	let pollTimer = null

	const keyOf = (p) => `${p.sceneId}:${p.layerNumber}`
	const selected = () => playlists.find((p) => keyOf(p) === selectedKey) || null

	function renderLists() {
		el('plp-count').textContent = playlists.length ? String(playlists.length) : ''
		if (!playlists.length) {
			listSel.innerHTML = '<option value="">— no live playlists —</option>'
			itemSel.innerHTML = ''
			return
		}
		if (!playlists.some((p) => keyOf(p) === selectedKey)) selectedKey = keyOf(playlists[0])
		listSel.innerHTML = playlists
			.map((p) => {
				const k = keyOf(p)
				/* WO-347: every playlist defined in the looks; live ones carry the channel. */
				const label = `${p.live ? '🔴 ' : ''}${p.sceneName} · L${p.layerNumber}${p.live ? ` · ch${p.channel}` : ' · not live'}`
				return `<option value="${escapeHtml(k)}"${k === selectedKey ? ' selected' : ''}>${escapeHtml(label)}</option>`
			})
			.join('')
		const p = selected()
		const cur = p?.live ? p.activeIndex : (p?.startIndex ?? 0)
		itemSel.innerHTML = (p?.items || [])
			.map((it, i) => {
				const active = i === cur ? (p.live ? '● ' : '▸ ') : ''
				/* Owner 27.07: timed media carries its own length — the (Ns) tag is only true
				 * for timeless items; labels show the file name, not the path. */
				const dur = isTimelessItem(it) && it.duration != null ? ` (${it.duration}s)` : ''
				const base = String(it.label || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || it.label
				return `<option value="${i}"${i === cur ? ' selected' : ''}>${escapeHtml(`${active}${i + 1}. ${base}${dur}`)}</option>`
			})
			.join('')
		for (const id of ['plp-prev', 'plp-play', 'plp-next']) {
			const b = el(id)
			if (b) b.disabled = !p?.live
		}
		/* todos27: show the duration ALREADY set on the playlist's timeless items, not a
		 * hard default — and never clobber the field while the operator is typing in it.
		 * appliedSecs bridges the poll gap for LIVE playlists (the engine keeps playing the
		 * old durations until the next take, so the server still reports the old value). */
		if (timelessInp && document.activeElement !== timelessInp) {
			const applied = p ? appliedSecs.get(keyOf(p)) : null
			const serverSecs = p ? timelessSecsOf(p.items) : 20
			if (applied != null && applied === serverSecs) appliedSecs.delete(keyOf(p))
			timelessInp.value = String(applied ?? serverSecs)
		}
	}

	async function refresh() {
		try {
			const r = await api.get('/api/playlist/state')
			playlists = Array.isArray(r?.playlists) ? r.playlists : []
		} catch {
			playlists = []
		}
		renderLists()
	}

	async function control(action, index) {
		const p = selected()
		if (!p) return
		try {
			await api.post('/api/playlist/control', {
				channel: p.channel,
				layerNumber: p.layerNumber,
				action,
				...(index != null ? { index } : {}),
			})
		} catch (e) {
			console.warn('[playlist panel]', action, 'failed:', e?.message || e)
		}
		void refresh()
	}

	listSel.addEventListener('change', () => {
		selectedKey = listSel.value
		renderLists()
	})
	itemSel.addEventListener('change', () => {
		const p = selected()
		const idx = parseInt(itemSel.value, 10)
		if (!p || !Number.isFinite(idx)) return
		if (p.live) {
			void control('goto', idx)
		} else {
			/* WO-347: pre-playout start item — playout of this look starts here. */
			void api
				.post('/api/playlist/control', { action: 'set_start', sceneId: p.sceneId, layerNumber: p.layerNumber, index: idx })
				.then(() => refresh())
				.catch((e) => console.warn('[playlist panel] set_start failed:', e?.message || e))
		}
	})
	el('plp-timeless-apply').addEventListener('click', () => {
		const p = selected()
		const secs = Math.max(1, Math.min(86400, parseFloat(timelessInp?.value) || 0))
		if (!p || !secs) return
		const scene = sceneState.scenes.find((sc) => sc && sc.id === p.sceneId)
		const layerIndex = scene?.layers?.findIndex((l) => Number(l.layerNumber) === Number(p.layerNumber)) ?? -1
		const layer = layerIndex >= 0 ? scene.layers[layerIndex] : null
		if (!layer || !Array.isArray(layer.playlist)) {
			console.warn('[playlist panel] set-all: playlist layer not found in project state')
			return
		}
		let touched = 0
		const nextList = layer.playlist.map((it) => {
			if (!isTimelessItem(it)) return it
			touched++
			return { ...it, duration: secs }
		})
		if (!touched) return
		sceneState.patchLayer(p.sceneId, layerIndex, { playlist: nextList })
		document.dispatchEvent(new CustomEvent('scenes-refresh-preview'))
		appliedSecs.set(keyOf(p), secs)
		void refresh()
	})
	el('plp-prev').addEventListener('click', () => void control('prev'))
	el('plp-next').addEventListener('click', () => void control('next'))
	el('plp-play').addEventListener('click', () => {
		const idx = parseInt(itemSel.value, 10)
		void control('goto', Number.isFinite(idx) ? idx : selected()?.activeIndex ?? 0)
	})

	function setOpen(open) {
		content.hidden = !open
		toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
		chevron.textContent = open ? '▼' : '▶'
		try {
			localStorage.setItem(LS_COLLAPSED, open ? '0' : '1')
		} catch { /* best-effort */ }
		if (pollTimer) {
			clearInterval(pollTimer)
			pollTimer = null
		}
		if (open) {
			void refresh()
			pollTimer = setInterval(() => void refresh(), POLL_MS)
		}
	}

	toggle.addEventListener('click', () => setOpen(content.hidden))
	let startOpen = false
	try {
		startOpen = localStorage.getItem(LS_COLLAPSED) === '0'
	} catch { /* default collapsed */ }
	setOpen(startOpen)
}
