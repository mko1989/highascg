/**
 * Compose frame: per-layer thumbnail/placeholder content builder.
 * Extracted from scenes-compose.js (WO-221 Phase A mechanical split).
 */

import { api } from '../lib/api-client.js'
import { getThumbnailUrl, getLiveThumbnailUrl, getLiveThumbnailChannelForSource } from '../lib/thumbnail-url.js'
import { isMediaOrFileSource } from './scenes-shared.js'
import { invalidateThumbnailCache } from './preview-canvas-draw-base.js'
import { showScenesToast } from './scenes-editor-support.js'
import { getTemplateThumbUrl, isTemplateSourceType } from '../lib/template-thumb.js'

/** @param {object | null | undefined} source @param {string} [text] */
export function makeLayerSourcePlaceholder(source, text) {
	const ph = document.createElement('div')
	ph.className = 'scenes-layer__placeholder scenes-layer__placeholder--empty'
	const t = String(source?.type || '').toLowerCase()
	if (t === 'timeline') ph.textContent = text || 'Timeline'
	else if (t === 'route' || t === 'live' || /^route:\/\//i.test(String(source?.value || ''))) ph.textContent = text || 'Live'
	else ph.textContent = text || (source?.label || source?.value || 'Source').slice(0, 24)
	return ph
}

/**
 * Build the `.scenes-layer__content` element for a compose layer (thumbnail, template
 * poster, live-thumb-with-refresh, or a placeholder), based on the layer's source type.
 * @param {object} layer
 * @param {{ SCENE_THUMB_MAX_W: number, getThumbUrlForLayerSource?: Function, getPreviewChannelForLiveThumb?: Function }} opts
 * @returns {HTMLElement}
 */
export function buildComposeLayerContent(layer, opts) {
	const { SCENE_THUMB_MAX_W, getThumbUrlForLayerSource, getPreviewChannelForLiveThumb } = opts

	/* WO-158 T158.2: source content lives in its own clip wrapper so the crop rect can be
	 * clipped without also clipping the handle buttons (which are positioned outside the
	 * box via negative offsets and must stay visible). */
	const content = document.createElement('div')
	content.className = 'scenes-layer__content'

	if (layer.source?.isPlaceholder) {
		const ph = document.createElement('div')
		ph.className = 'scenes-layer__placeholder scenes-layer__placeholder--pattern'
		const t = layer.source.template || 'color_grid'
		ph.dataset.template = t
		if (t === 'solid' && layer.source.value) {
			ph.style.backgroundColor = layer.source.value
		}
		ph.textContent = layer.source.label || layer.source.value
		content.appendChild(ph)
	} else if (isMediaOrFileSource(layer.source)) {
		const img = document.createElement('img')
		img.className = 'scenes-layer__thumb'
		img.alt = ''
		img.src = getThumbnailUrl(layer.source.value, SCENE_THUMB_MAX_W, 0)
		img.draggable = false
		img.addEventListener('error', () => {
			img.replaceWith(makeLayerSourcePlaceholder(layer.source, 'No preview'))
		})
		content.appendChild(img)
	} else if (isTemplateSourceType(layer.source)) {
		/* WO-187: Template/CG/HTML thumbnails — render via server Puppeteer or fall back to static posters.
		 * Show placeholder initially, swap img src when async resolution completes. */
		const placeholder = makeLayerSourcePlaceholder(layer.source, 'Template...')
		content.appendChild(placeholder)

		const cachedUrl = getTemplateThumbUrl(layer, {
			onResolved: (url) => {
				// Guard: element may have been detached before callback fires
				if (!placeholder.isConnected) return
				if (!url) return

				const img = document.createElement('img')
				img.className = 'scenes-layer__thumb'
				img.alt = ''
				img.src = url
				img.draggable = false
				img.addEventListener('error', () => {
					img.replaceWith(makeLayerSourcePlaceholder(layer.source, 'No preview'))
				})
				placeholder.replaceWith(img)
			},
		})

		// If already cached synchronously, use it immediately
		if (cachedUrl) {
			placeholder.remove()
			const img = document.createElement('img')
			img.className = 'scenes-layer__thumb'
			img.alt = ''
			img.src = cachedUrl
			img.draggable = false
			img.addEventListener('error', () => {
				img.replaceWith(makeLayerSourcePlaceholder(layer.source, 'No preview'))
			})
			content.appendChild(img)
		}
	} else if (typeof getThumbUrlForLayerSource === 'function') {
		const liveUrl = getThumbUrlForLayerSource(layer.source)
		if (liveUrl) {
			const wrap = document.createElement('div')
			wrap.className = 'scenes-layer__live-thumb-wrap'
			const img = document.createElement('img')
			img.className = 'scenes-layer__thumb'
			img.alt = ''
			img.src = liveUrl
			img.draggable = false
			img.addEventListener('error', () => {
				img.replaceWith(makeLayerSourcePlaceholder(layer.source, 'No preview'))
			})
			wrap.appendChild(img)
			const btn = document.createElement('button')
			btn.type = 'button'
			btn.className = 'scenes-layer__live-refresh'
			btn.title = 'Refresh live still (Caspar PRINT → cached)'
			btn.setAttribute('aria-label', 'Refresh live thumbnail')
			btn.textContent = '↻'
			btn.addEventListener('click', async (e) => {
				e.stopPropagation()
				e.preventDefault()
				const fb = typeof getPreviewChannelForLiveThumb === 'function' ? getPreviewChannelForLiveThumb() : null
				const n = getLiveThumbnailChannelForSource(layer.source, fb)
				if (!Number.isFinite(n) || n <= 0) {
					const directNdi =
						layer.source?.useDirect === true &&
						String(layer.source?.value || '').trim().toLowerCase().startsWith('ndi://')
					showScenesToast(
						directNdi
							? 'Direct NDI has no Caspar-channel still — use Routed mode with a keyed channel or route:// preview.'
							: 'Cannot resolve Caspar channel for this source — set preview routing or use route:// / NDI channel hint.',
						'error',
					)
					return
				}
				btn.disabled = true
				try {
					await api.post('/api/thumbnail/live/capture', { channel: n, force: true })
					invalidateThumbnailCache(`/api/thumbnail/live/${n}`)
					img.src = getLiveThumbnailUrl(n, Date.now())
				} catch (err) {
					showScenesToast(err?.message || 'Live thumbnail capture failed', 'error')
				} finally {
					btn.disabled = false
				}
			})
			wrap.appendChild(btn)
			content.appendChild(wrap)
		} else {
			content.appendChild(makeLayerSourcePlaceholder(layer.source))
		}
	} else {
		const ph = makeLayerSourcePlaceholder(layer.source, 'Drop source')
		content.appendChild(ph)
	}

	return content
}
