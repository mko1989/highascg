/**
 * Playlist control panel — collapsible inspector-footer section (owner request 2026-07-26,
 * "similar to timers and audio mixer compact"). A dropdown of every playlist currently LIVE on
 * any channel (GET /api/playlist/state, polled while open), a dropdown of that playlist's items
 * (selecting one = goto), and Prev / Play / Next transport via POST /api/playlist/control —
 * mode-agnostic (drives auto playlists too; the engine re-arms timers/preloads after a jump).
 */

import { api } from '../lib/api-client.js'
import { escapeHtml } from '../lib/dom-escape.js'

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
				<div class="playlist-control-panel__row playlist-control-panel__transport">
					<button type="button" class="btn btn--secondary" id="plp-prev" title="Previous item">⏮</button>
					<button type="button" class="btn" id="plp-play" title="Restage the selected item">▶</button>
					<button type="button" class="btn btn--secondary" id="plp-next" title="Next item">⏭</button>
				</div>
			</div>
		</div>`

	const el = (id) => mountEl.querySelector(`#${id}`)
	const toggle = el('plp-toggle')
	const content = el('plp-content')
	const chevron = toggle.querySelector('.timer-control-panel__chevron')
	const listSel = el('plp-list')
	const itemSel = el('plp-item')

	/** @type {Array<object>} */
	let playlists = []
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
				const dur = it.duration != null ? ` (${it.duration}s)` : ''
				return `<option value="${i}"${i === cur ? ' selected' : ''}>${escapeHtml(`${active}${i + 1}. ${it.label}${dur}`)}</option>`
			})
			.join('')
		for (const id of ['plp-prev', 'plp-play', 'plp-next']) {
			const b = el(id)
			if (b) b.disabled = !p?.live
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
