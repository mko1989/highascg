import { api, getApiBase } from '../lib/api-client.js'

/** @param {string | null} cd */
function parseContentDispositionFilename(cd) {
	if (!cd || typeof cd !== 'string') return null
	const mStar = /filename\*=(?:UTF-8''|)([^;\n]+)/i.exec(cd)
	if (mStar) {
		try {
			return decodeURIComponent(mStar[1].trim().replace(/^["']|["']$/g, ''))
		} catch {
			return mStar[1]
		}
	}
	const m = /filename="([^"]+)"/i.exec(cd)
	if (m) return m[1]
	const m2 = /filename=([^;\s]+)/i.exec(cd)
	if (m2) return m2[1].replace(/^["']|["']$/g, '')
	return null
}

/** Same-origin download without navigating the tab (avoids Chrome “insecure download” quirks on some HTTP setups). */
async function downloadLocalMediaFile(id, fallbackLabel) {
	const url = `${getApiBase()}/api/local-media/${encodeURIComponent(id)}/file`
	const res = await fetch(url)
	if (!res.ok) {
		let detail = res.statusText
		try {
			const j = await res.json()
			if (j?.error) detail = j.error
		} catch {}
		throw new Error(`HTTP ${res.status}: ${detail}`)
	}
	const lenStr = res.headers.get('content-length')
	const len = lenStr ? parseInt(lenStr, 10) : 0
	const maxBlob = 400 * 1024 * 1024
	if (len > maxBlob) {
		const a = document.createElement('a')
		a.href = url
		a.download = String(fallbackLabel || id).replace(/^.*[/\\]/, '') || 'download'
		a.rel = 'noopener'
		document.body.appendChild(a)
		a.click()
		a.remove()
		return
	}
	const cdName = parseContentDispositionFilename(res.headers.get('content-disposition'))
	let filename = cdName || String(fallbackLabel || id).replace(/^.*[/\\]/, '') || 'download'
	const blob = await res.blob()
	const blobUrl = URL.createObjectURL(blob)
	try {
		const a = document.createElement('a')
		a.href = blobUrl
		a.download = filename
		a.rel = 'noopener'
		document.body.appendChild(a)
		a.click()
		a.remove()
	} finally {
		setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000)
	}
}
import { classifyMediaItem } from '../lib/media-ext.js'
import { normalizeMediaIdForMatch } from '../lib/mixer-fill.js'
import { MIXER_EFFECTS, EFFECT_CATEGORIES } from '../lib/effect-registry.js'


/**
 * Ctrl+click / ⌘+click: download (GET /api/local-media/…/file).
 * Ctrl+Alt+click / ⌘+⌥+click: remove file on server (POST /api/media/delete).
 * @param {HTMLElement} el
 * @param {string} id - media id (Caspar path)
 * @param {string} label
 * @param {() => void} [onDeleted] - refresh list / feedback after successful delete
 */
function attachMediaModifierClick(el, id, label, onDeleted) {
	const hintDl = 'Ctrl+click or ⌘+click: download to this computer'
	const hintRm = 'Ctrl+Alt+click or ⌘+⌥+click: remove from server'
	el.title = `${label} — ${hintDl} · ${hintRm}`
	el.addEventListener('click', (e) => {
		if (!(e.ctrlKey || e.metaKey)) return
		e.preventDefault()
		e.stopPropagation()
		if (e.altKey) {
			const shortName = String(label || id).replace(/^.*[/\\]/, '') || id
			if (!confirm(`Remove "${shortName}" from the server?\n\nThis cannot be undone.`)) return
			void (async () => {
				try {
					await api.post('/api/media/delete', { id })
					onDeleted?.()
				} catch (err) {
					alert(err?.message || 'Delete failed')
				}
			})()
			return
		}
		void (async () => {
			try {
				await downloadLocalMediaFile(id, label)
			} catch (err) {
				alert(err?.message || 'Download failed')
			}
		})()
	})
}

export function makeDraggable(el, sourceType, sourceValue, label, extra = {}) {
	el.draggable = true
	el.dataset.sourceType = sourceType
	el.dataset.sourceValue = sourceValue
	el.dataset.sourceLabel = label || sourceValue
	el.classList.add('source-item', 'draggable')
	el.addEventListener('dragstart', (e) => {
		e.dataTransfer.effectAllowed = 'copy'
		
		// Multi-drag support
		const isSelected = el.classList.contains('source-item--selected')
		let payload
		if (isSelected) {
			const container = el.closest('.sources-list')
			const selectedEls = container ? Array.from(container.querySelectorAll('.source-item--selected')) : [el]
			payload = selectedEls.map(sel => ({
				type: sel.dataset.sourceType,
				value: sel.dataset.sourceValue,
				label: sel.dataset.sourceLabel,
				...JSON.parse(sel.dataset.extra || '{}')
			}))
			
			// If multiple, use a special type or just the array
			e.dataTransfer.setData('application/json', JSON.stringify({
				type: 'multi',
				items: payload
			}))
			e.dataTransfer.setData('text/plain', payload.map(p => p.value).join('\n'))
		} else {
			payload = { type: sourceType, value: sourceValue, label: label || sourceValue, ...extra }
			e.dataTransfer.setData('application/json', JSON.stringify(payload))
			e.dataTransfer.setData('text/plain', sourceValue)
		}
		
		el.target?.classList.add('dragging') || el.classList.add('dragging')
	})
	el.addEventListener('dragend', (e) => {
		el.target?.classList.remove('dragging') || el.classList.remove('dragging')
	})
	// Store extra for multi-drag reconstruction
	el.dataset.extra = JSON.stringify(extra)
}

export function renderSourceList(container, items, sourceType, filter, onPreview) {
	container.innerHTML = ''
	if (!items || items.length === 0) {
		container.innerHTML = '<p class="sources-empty">No items</p>'
		return
	}
	const filtered = filter ? items.filter((i) => (i.label || i.id || i).toLowerCase().includes(filter.toLowerCase())) : items
	filtered.forEach((item) => {
		const id = item.id ?? item
		const label = item.label ?? String(id)
		const el = document.createElement('div')
		el.className = 'source-item'
		el.dataset.sourceValue = id
		el.innerHTML = `
			<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 32))}</span>
		`
		makeDraggable(el, sourceType, id, label)
		container.appendChild(el)
	})
}

export function iconFor(type) {
	const icons = { media: '🎬', template: '📄', route: '📺', timeline: '⏱', effect: '✦' }
	return icons[type] || '•'
}

export function escapeHtml(s) {
	const div = document.createElement('div')
	div.textContent = s
	return div.innerHTML
}

function truncate(s, len) {
	if (!s || s.length <= len) return s
	return s.slice(0, len - 1) + '…'
}

function getExtension(filename) {
	if (!filename || typeof filename !== 'string') return ''
	const m = filename.match(/\.([a-zA-Z0-9]+)$/)
	return m ? m[1].toLowerCase() : ''
}

function formatDuration(ms) {
	if (ms == null || ms < 0) return '—'
	const s = Math.floor(ms / 1000)
	const m = Math.floor(s / 60)
	const h = Math.floor(m / 60)
	if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
	return `${m}:${String(s % 60).padStart(2, '0')}`
}

function formatFps(fps) {
	if (fps == null || fps <= 0 || isNaN(fps)) return ''
	const n = Math.round(fps * 100) / 100
	return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function formatFileSize(bytes) {
	if (bytes == null || bytes < 0 || !Number.isFinite(bytes)) return ''
	if (bytes < 1024) return bytes + ' B'
	if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
	return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

/**
 * Combine WebSocket `state.media` (CINF metadata after server flush) with last GET /api/media
 * (ffprobe + disk merge). Dedupe by basename without extension (same key as findMediaRow / scene fill).
 */
export function mergeMediaProbeOverlay(stateMedia, probeList) {
	const sm = stateMedia || []
	const pl = probeList || []
	if (!pl.length) return sm
	if (!sm.length) return pl
	const byKey = new Map()
	function addRow(item) {
		const key = normalizeMediaIdForMatch(item.id)
		const prev = byKey.get(key)
		if (!prev) {
			byKey.set(key, { ...item })
			return
		}
		byKey.set(key, { ...prev, ...item, id: prev.id })
	}
	for (const m of sm) addRow(m)
	for (const p of pl) addRow(p)
	return [...byKey.values()]
}

/**
 * Templates tab — Caspar `TLS` list entries, draggable as `template` sources for looks.
 * @param {HTMLElement} container
 * @param {Array<{ id?: string, label?: string }>} templates
 * @param {string} filter
 */
export function renderTemplatesBrowser(container, templates, filter) {
	container.innerHTML = ''
	const filtered = filter
		? (templates || []).filter((i) =>
				(i.label || i.id || '').toLowerCase().includes(filter.toLowerCase()),
			)
		: templates || []
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No templates (run Refresh — Caspar TLS)</p>'
		return
	}
	for (const item of filtered) {
		const id = item.id ?? item.label ?? ''
		if (!id) continue
		const label = item.label ?? String(id)
		const el = document.createElement('div')
		el.className = 'source-item source-item--template'
		el.dataset.sourceValue = id
		el.innerHTML = `
			<span class="source-item__kind-pill" title="HTML / Flash template">FT</span>
			<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 48))}</span>
		`
		makeDraggable(el, 'template', id, label)
		container.appendChild(el)
	}
}

/** Media browser: Detailed compact view with thumbnails and rich metadata. */
export function renderMediaBrowser(container, media, filter, onMediaDeleted, options = {}) {
	const collapsed = options.collapsedFolders || new Set()
	const onToggle = options.onToggleFolder
	const onMove = options.onMoveItem
	container.innerHTML = ''
	const filtered = filter
		? media.filter((i) => (i.label || i.id || i).toLowerCase().includes(filter.toLowerCase()))
		: media
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No media files</p>'
		return
	}

	// 1. Group into tree structure
	const root = { folders: {}, files: [] }
	filtered.forEach((item) => {
		const id = item.id ?? item
		const parts = String(id).split('/')
		if (item.isDir) {
			let curr = root
			for (let i = 0; i < parts.length; i++) {
				const p = parts[i]
				if (!curr.folders[p]) curr.folders[p] = { folders: {}, files: [], path: parts.slice(0, i + 1).join('/') }
				curr = curr.folders[p]
			}
		} else {
			let curr = root
			for (let i = 0; i < parts.length - 1; i++) {
				const p = parts[i]
				if (!curr.folders[p]) curr.folders[p] = { folders: {}, files: [], path: parts.slice(0, i + 1).join('/') }
				curr = curr.folders[p]
			}
			curr.files.push(item)
		}
	})

	// 2. Recursive render
	function walk(node, depth, isVisible) {
		const folderNames = Object.keys(node.folders).sort()
		folderNames.forEach((name) => {
			const folder = node.folders[name]
			const isCollapsed = collapsed.has(folder.path)
			const el = document.createElement('div')
			el.className = `source-item source-item--folder ${isCollapsed ? 'collapsed' : ''}`
			if (!isVisible) el.style.display = 'none'
			el.innerHTML = `
				${'<span class="source-item__nest-indent"></span>'.repeat(depth)}
				<span class="source-item__expand-arrow">${isCollapsed ? '▶' : '▼'}</span>
				<span class="source-item__icon">📁</span>
				<span class="source-item__label">${escapeHtml(name)}</span>
			`
			el.onclick = (e) => { e.stopPropagation(); onToggle?.(folder.path) }
			
			// Folder drop target for moving files
			el.addEventListener('dragover', (e) => {
				const raw = e.dataTransfer.getData('application/json')
				if (!raw) return
				try {
					const data = JSON.parse(raw)
					if (data.type === 'media' && data.value && !String(data.value).startsWith(folder.path + '/')) {
						e.preventDefault()
						el.classList.add('source-item--drop-target')
					}
				} catch {}
			})
			el.addEventListener('dragleave', () => el.classList.remove('source-item--drop-target'))
			el.addEventListener('drop', (e) => {
				el.classList.remove('source-item--drop-target')
				const raw = e.dataTransfer.getData('application/json')
				if (!raw) return
				try {
					const data = JSON.parse(raw)
					if (data.type === 'media' && data.value) {
						e.preventDefault()
						e.stopPropagation()
						onMove?.(data.value, folder.path)
					}
				} catch {}
			})

			container.appendChild(el)
			walk(folder, depth + 1, isVisible && !isCollapsed)
		})

		const files = node.files.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))
		files.forEach((item) => {
			const id = item.id ?? item
			const label = item.label ?? String(id)
			const shortLabel = label.split('/').pop()
			const ext = getExtension(shortLabel)
			const resolution = item.resolution || ''
			const duration = formatDuration(item.durationMs)
			const fpsStr = formatFps(item.fps)
			const kind = classifyMediaItem(item)
			
			const el = document.createElement('div')
			const isSelected = options.selected?.has(id)
			el.className = `source-item source-item--media source-item--media-detailed source-item--kind-${kind} ${isSelected ? 'source-item--selected' : ''}`
			if (!isVisible) el.style.display = 'none'
			el.dataset.sourceValue = id

			let thumbHtml = ''
			if (kind === 'video' || kind === 'still') {
				const thumbUrl = `${getApiBase()}/api/thumbnail/${encodeURIComponent(id)}?w=80&t=2`
				thumbHtml = `<div class="source-item__thumbnail"><img src="${thumbUrl}" loading="lazy" onerror="this.parentElement.innerHTML='<i>${kind === 'video' ? '🎬' : '🖼️'}</i>'"/></div>`
			} else if (kind === 'audio') {
				thumbHtml = `<div class="source-item__thumbnail"><i>🎵</i></div>`
			} else {
				thumbHtml = `<div class="source-item__thumbnail"><i>📄</i></div>`
			}

			const metaParts = []
			if (kind === 'video') {
				if (resolution) metaParts.push(`<span class="source-item__meta-tag">${resolution}</span>`)
				if (fpsStr) metaParts.push(`<span class="source-item__meta-tag">${fpsStr} fps</span>`)
				if (item.codec) metaParts.push(`<span class="source-item__meta-tag">${item.codec.toUpperCase()}</span>`)
				if (ext) metaParts.push(`<span class="source-item__meta-tag">${ext.toUpperCase()}</span>`)
			} else if (kind === 'still') {
				if (resolution) metaParts.push(`<span class="source-item__meta-tag">${resolution}</span>`)
				if (ext) metaParts.push(`<span class="source-item__meta-tag">${ext.toUpperCase()}</span>`)
			} else if (kind === 'audio') {
				if (item.codec) metaParts.push(`<span class="source-item__meta-tag">${item.codec.toUpperCase()}</span>`)
				if (ext) metaParts.push(`<span class="source-item__meta-tag">${ext.toUpperCase()}</span>`)
			}

			el.innerHTML = `
				${'<span class="source-item__nest-indent"></span>'.repeat(depth)}
				${thumbHtml}
				<div class="source-item__media-col">
					<div class="source-item__media-line1">
						<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(shortLabel)}</span>
						${duration !== '—' ? `<span class="source-item__duration">${escapeHtml(duration)}</span>` : ''}
					</div>
					<div class="source-item__meta-row">${metaParts.join('')}</div>
				</div>
			`
			
			// Click on thumbnail to select
			const thumbEl = el.querySelector('.source-item__thumbnail')
			if (thumbEl) {
				thumbEl.onclick = (e) => {
					e.stopPropagation()
					options.onToggleSelect?.(id, e.shiftKey)
				}
			}

			makeDraggable(el, 'media', id, label, {
				resolution: item.resolution || '',
				...(item.durationMs != null && item.durationMs > 0 ? { durationMs: item.durationMs } : {}),
			})
			attachMediaModifierClick(el, id, label, onMediaDeleted)
			container.appendChild(el)
		})
	}

	walk(root, 0, true)
}

/**
 * Render the Effects tab: CasparCG mixer effects grouped by category, each draggable.
 * @param {HTMLElement} container
 * @param {string} filter
 */
export function renderEffectsTab(container, filter) {
	container.innerHTML = ''
	const lowerFilter = (filter || '').toLowerCase()
	const filtered = lowerFilter
		? MIXER_EFFECTS.filter((e) => e.label.toLowerCase().includes(lowerFilter) || e.category.toLowerCase().includes(lowerFilter))
		: MIXER_EFFECTS

	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No matching effects</p>'
		return
	}

	// Group by category
	for (const cat of EFFECT_CATEGORIES) {
		const inCat = filtered.filter((e) => e.category === cat.id)
		if (inCat.length === 0) continue

		const heading = document.createElement('div')
		heading.className = 'sources-effects-category'
		heading.textContent = cat.label
		container.appendChild(heading)

		for (const fx of inCat) {
			const el = document.createElement('div')
			el.className = 'source-item source-item--effect'
			el.dataset.sourceValue = fx.type
			el.innerHTML = `
				<span class="source-item__label">${escapeHtml(fx.label)}</span>
			`
			makeDraggable(el, 'effect', fx.type, fx.label)
			container.appendChild(el)
		}
	}
}

export function buildLiveSources(channelMap, connectors = []) {
	const sources = []
	if (!channelMap) return sources
	const {
		programChannels = [],
		previewChannels = [],
		inputsCh,
		decklinkCount = 0,
		programResolutions = [],
		audioOnlyChannels = [],
		audioOnlyResolutions = [],
		previewEnabledByMain = [],
	} = channelMap
	programChannels.forEach((ch, i) => {
		const res = programResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		sources.push({ type: 'route', routeType: 'pgm', value: `route://${ch}`, label: `Program ${i + 1}`, resolution, fps })
	})
	previewChannels.forEach((ch, i) => {
		if ((previewEnabledByMain[i] === false) || ch == null) return
		const res = programResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		// Full channel composite (black L9 + content L10+). Do not use route://N-11 — layer numbers match PGM now.
		sources.push({ type: 'route', routeType: 'prv', value: `route://${ch}`, label: `Preview ${i + 1}`, resolution, fps })
	})
	if (inputsCh != null && decklinkCount > 0) {
		const inputsRes = channelMap.inputsResolution
		const resolution = inputsRes?.w && inputsRes?.h ? `${inputsRes.w}×${inputsRes.h}` : ''
		const fps = inputsRes?.fps != null ? formatFps(inputsRes.fps) : ''
		for (let i = 1; i <= decklinkCount; i++) {
			// Find connector that matches this decklink slot (0-indexed index in caspar config usually matches index in device-view)
			// But we look for ioDirection: 'in' and index: i-1
			const conn = connectors.find(c => c.caspar?.ioDirection === 'in' && c.index === (i - 1))
			sources.push({
				type: 'route',
				routeType: 'decklink',
				value: `route://${inputsCh}-${i}`,
				label: `decklink ${i}`,
				resolution,
				fps,
				decklinkSlot: i,
				inputsChannel: inputsCh,
				connectorId: conn?.id || null,
				decklinkDevice: conn?.externalRef != null ? parseInt(String(conn.externalRef), 10) : (i - 1)
			})
		}
	}
	audioOnlyChannels.forEach((ch, i) => {
		const res = audioOnlyResolutions[i]
		const resolution = res?.w && res?.h ? `${res.w}×${res.h}` : ''
		const fps = res?.fps != null ? formatFps(res.fps) : ''
		sources.push({
			type: 'route',
			routeType: 'audio_zone',
			value: `route://${ch}`,
			label: `Audio zone ${i + 1}`,
			resolution,
			fps,
		})
	})
	return sources
}

/**
 * @param {object | null | undefined} status - state.decklinkInputsStatus
 * @param {number} slot - 1-based decklink slot (layer on inputs channel)
 * @returns {string}
 */
export function decklinkSlotStatusMessage(status, slot) {
	if (status == null || typeof status !== 'object') return ''
	if (status.enabled === false && status.reason === 'amcp_disconnected') return 'AMCP offline — inputs not started'
	const failed = Array.isArray(status.failed) ? status.failed.find((x) => x && x.layer === slot) : null
	if (failed) return (failed.message && String(failed.message)) || 'PLAY failed on this layer'
	const sc = Array.isArray(status.skippedConflicts)
		? status.skippedConflicts.find((x) => x && x.input === slot)
		: null
	if (sc) return 'Skipped: device used as DeckLink output elsewhere'
	const sd = Array.isArray(status.skippedDuplicates)
		? status.skippedDuplicates.find((x) => x && x.input === slot)
		: null
	if (sd) return 'Skipped: duplicate device index (see Settings → Screens)'
	return ''
}
/**
 * Placeholders tab — virtual media assets for simulation mode.
 * @param {HTMLElement} container
 * @param {Array<object>} placeholders
 * @param {string} filter
 */
export function renderPlaceholdersBrowser(container, placeholders, filter) {
	container.innerHTML = ''
	const filtered = filter
		? (placeholders || []).filter((i) =>
				(i.label || i.id || '').toLowerCase().includes(filter.toLowerCase()),
			)
		: placeholders || []
	
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No placeholders. Click + to add one.</p>'
		return
	}

	for (const item of filtered) {
		const id = item.id
		const label = item.label || id
		const el = document.createElement('div')
		el.className = 'source-item source-item--placeholder'
		el.dataset.sourceValue = id
		
		const resolution = item.resolution || ''
		const duration = formatDuration(item.durationMs)
		const thumbStyle = item.template === 'solid' && item.value ? `background-color: ${item.value}` : ''
		
		el.innerHTML = `
			<div class="source-item__thumbnail source-item__thumbnail--placeholder" data-template="${item.template}" style="${thumbStyle}"></div>
			<div class="source-item__media-col">
				<div class="source-item__media-line1">
					<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(truncate(label, 32))}</span>
					<span class="source-item__duration">${escapeHtml(duration)}</span>
				</div>
				<div class="source-item__meta-row">
					<span class="source-item__meta-tag">${escapeHtml(item.template.toUpperCase())}</span>
					<span class="source-item__meta-tag">${escapeHtml(resolution)}</span>
				</div>
			</div>
			<button type="button" class="source-item__remove" title="Remove Placeholder">&times;</button>
		`
		
		makeDraggable(el, 'media', id, label, {
			isPlaceholder: true,
			template: item.template,
			resolution: item.resolution,
			durationMs: item.durationMs,
			value: item.value,
		})
		
		const removeBtn = el.querySelector('.source-item__remove')
		if (removeBtn) {
			removeBtn.addEventListener('click', (e) => {
				e.stopPropagation()
				if (confirm(`Remove placeholder "${label}"?`)) {
					window.placeholderState.remove(id)
					renderPlaceholdersBrowser(container, window.placeholderState.getAll(), filter)
				}
			})
		}

		container.appendChild(el)
	}
}
