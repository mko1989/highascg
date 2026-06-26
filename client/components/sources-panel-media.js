import { api } from '../lib/api-client.js'
import { getThumbnailUrl } from '../lib/thumbnail-url.js'
import { classifyMediaItem } from '../lib/media-ext.js'
import { escapeHtml, truncate, getExtension, formatDuration, formatFps, makeDraggable, attachMediaModifierClick } from './sources-panel-helpers.js'

function folderSegmentKey(segment) {
	return String(segment || '').toLowerCase()
}

/** Case-insensitive folder bucket; keeps first segment spelling (isDir rows are sorted first). */
function getOrCreateFolder(parent, segment, fullPath) {
	const fk = folderSegmentKey(segment)
	let name = Object.keys(parent.folders).find((k) => folderSegmentKey(k) === fk)
	if (!name) {
		name = segment
		parent.folders[name] = { folders: {}, files: [], path: fullPath }
	}
	return parent.folders[name]
}

function folderPathCollapsed(collapsed, path) {
	const key = folderSegmentKey(path)
	for (const c of collapsed) {
		if (folderSegmentKey(c) === key) return true
	}
	return false
}

/** @returns {string[]} media ids being dragged onto a folder */
function mediaIdsFromDragPayload(data) {
	if (!data) return []
	if (data.type === 'multi' && Array.isArray(data.items)) {
		return data.items.filter((it) => it?.type === 'media' && it.value).map((it) => String(it.value))
	}
	if (data.type === 'media' && data.value) return [String(data.value)]
	return []
}

function readMediaDragPayload(fallbackRaw) {
	const g = globalThis.__highascgMediaDragPayload
	if (g) return g
	if (!fallbackRaw) return null
	try {
		return JSON.parse(fallbackRaw)
	} catch {
		return null
	}
}

/** Media browser: Detailed compact view with thumbnails and rich metadata. */
export function renderMediaBrowser(container, media, filter, onMediaDeleted, options = {}) {
	const collapsed = options.collapsedFolders || new Set()
	const onToggle = options.onToggleFolder
	const onMove = options.onMoveItem
	
	const filtered = filter
		? media.filter((i) => (i.label || i.id || i).toLowerCase().includes(filter.toLowerCase()))
		: media

	const renderKey = JSON.stringify({
		media: filtered.map(m => ({ id: m.id, res: m.resolution, dur: m.durationMs })),
		filter,
		collapsed: Array.from(collapsed),
		selected: Array.from(options.selected || [])
	})
	if (container._lastRenderKey === renderKey) return
	container._lastRenderKey = renderKey

	container.innerHTML = ''
	if (filtered.length === 0) {
		container.innerHTML = '<p class="sources-empty">No media files</p>'
		return
	}

	// 1. Group into tree structure (dirs first so folder labels match server isDir casing)
	const root = { folders: {}, files: [] }
	const sorted = [...filtered].sort((a, b) => Number(!!b.isDir) - Number(!!a.isDir))
	sorted.forEach((item) => {
		const id = item.id ?? item
		const parts = String(id).split('/').filter(Boolean)
		if (item.isDir) {
			let curr = root
			for (let i = 0; i < parts.length; i++) {
				const path = parts.slice(0, i + 1).join('/')
				curr = getOrCreateFolder(curr, parts[i], path)
			}
		} else {
			let curr = root
			for (let i = 0; i < parts.length - 1; i++) {
				const path = parts.slice(0, i + 1).join('/')
				curr = getOrCreateFolder(curr, parts[i], path)
			}
			curr.files.push(item)
		}
	})

	// 2. Recursive render
	/** @type {string[]} */
	const visibleFileIds = []
	function walk(node, depth, isVisible) {
		const folderNames = Object.keys(node.folders).sort()
		folderNames.forEach((name) => {
			const folder = node.folders[name]
			const isCollapsed = folderPathCollapsed(collapsed, folder.path)
			const el = document.createElement('div')
			el.className = `source-item source-item--folder ${isCollapsed ? 'collapsed' : ''}`
			if (!isVisible) el.style.display = 'none'
			el.innerHTML = `
				${'<span class="source-item__nest-indent"></span>'.repeat(depth)}
				<span class="source-item__expand-arrow">${isCollapsed ? '▶' : '▼'}</span>
				<span class="source-item__icon">📁</span>
				<span class="source-item__label">${escapeHtml(name)}</span>
				<span class="source-item__delete-folder" title="Delete folder">🗑</span>
			`
			el.onclick = (e) => { e.stopPropagation(); onToggle?.(folder.path) }
			
			const delBtn = el.querySelector('.source-item__delete-folder')
			if (delBtn) {
				delBtn.onclick = (e) => {
					e.stopPropagation()
					if (confirm(`Delete folder "${name}" and all its contents?\n\nThis cannot be undone.`)) {
						void (async () => {
							try {
								await api.post('/api/media/delete', { id: folder.path })
								onMediaDeleted?.()
							} catch (err) {
								alert(err?.message || 'Delete failed')
							}
						})()
					}
				}
			}
			
			// Folder drop target for moving files
			el.addEventListener('dragover', (e) => {
				const data = readMediaDragPayload(e.dataTransfer.getData('application/json'))
				const values = mediaIdsFromDragPayload(data)
				const canDrop = values.some(
					(v) => v && !String(v).startsWith(folder.path + '/') && String(v) !== folder.path,
				)
				if (canDrop) {
					e.preventDefault()
					el.classList.add('source-item--drop-target')
					e.dataTransfer.dropEffect = e.altKey ? 'copy' : 'move'
				}
			})
			el.addEventListener('dragleave', () => el.classList.remove('source-item--drop-target'))
			el.addEventListener('drop', (e) => {
				el.classList.remove('source-item--drop-target')
				const data = readMediaDragPayload(e.dataTransfer.getData('application/json'))
				if (!data) return
				const copy = !!e.altKey
				const ids = mediaIdsFromDragPayload(data)
				if (ids.length) {
					e.preventDefault()
					e.stopPropagation()
					if (copy) options.onCopyItems?.(ids, folder.path)
					else options.onMoveItems?.(ids, folder.path)
					return
				}
				if (data.type === 'media' && data.value) {
					e.preventDefault()
					e.stopPropagation()
					if (copy) options.onCopyItem?.(data.value, folder.path)
					else onMove?.(data.value, folder.path)
				}
			})

			container.appendChild(el)
			walk(folder, depth + 1, isVisible && !isCollapsed)
		})

		const files = node.files.sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id))
		files.forEach((item) => {
			const id = item.id ?? item
			visibleFileIds.push(String(id))
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
				const thumbUrl = getThumbnailUrl(id, 80, 2)
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
				<span class="source-item__select-mark" title="Click to select · Shift+click range · ⌘/Ctrl+click multi">${isSelected ? '☑' : '☐'}</span>
				${thumbHtml}
				<div class="source-item__media-col">
					<div class="source-item__media-line1">
						<span class="source-item__label" title="${escapeHtml(label)}">${escapeHtml(shortLabel)}</span>
						${duration !== '—' ? `<span class="source-item__duration">${escapeHtml(duration)}</span>` : ''}
					</div>
					<div class="source-item__meta-row">${metaParts.join('')}</div>
				</div>
			`
			
			// Row click toggles selection (modifiers handled in panel)
			el.addEventListener('click', (e) => {
				if (e.target.closest('.source-item__delete-folder')) return
				// Ctrl+Alt / ⌘+⌥ delete — handled by attachMediaModifierClick
				if (e.altKey && (e.ctrlKey || e.metaKey)) return
				// Alt alone — download
				if (e.altKey) return
				e.preventDefault()
				e.stopPropagation()
				options.onToggleSelect?.(id, {
					shiftKey: e.shiftKey,
					ctrlKey: e.ctrlKey,
					metaKey: e.metaKey,
				})
			})

			const markEl = el.querySelector('.source-item__select-mark')
			if (markEl) {
				markEl.onclick = (e) => {
					e.stopPropagation()
					options.onToggleSelect?.(id, {
						shiftKey: e.shiftKey,
						ctrlKey: e.ctrlKey || e.metaKey,
						metaKey: e.metaKey,
					})
				}
			}

			const thumbEl = el.querySelector('.source-item__thumbnail')
			if (thumbEl) {
				thumbEl.onclick = (e) => {
					if (e.ctrlKey || e.metaKey) return
					e.stopPropagation()
					options.onToggleSelect?.(id, {
						shiftKey: e.shiftKey,
						ctrlKey: e.ctrlKey,
						metaKey: e.metaKey,
					})
				}
			}

			makeDraggable(el, 'media', id, label, {
				resolution: item.resolution || '',
				kind: kind,
				...(item.durationMs != null && item.durationMs > 0 ? { durationMs: item.durationMs } : {}),
			})
			attachMediaModifierClick(el, id, label, onMediaDeleted)
			container.appendChild(el)
		})
	}

	walk(root, 0, true)
	options.onVisibleFileOrder?.(visibleFileIds)
}
