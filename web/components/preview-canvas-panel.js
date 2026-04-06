import { initLiveView, initDualComposeLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'

/**
 * @param {HTMLElement} host
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.storageKeyPrefix
 * @param {() => { w: number, h: number }} options.getOutputResolution
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number, isLive: boolean, meta?: { composePrvPgmLayout?: 'lr'|'tb' }) => void} options.draw
 * @param {boolean} [options.composePrvPgmLayoutToggle] — show control for PRV/PGM band layout (compose previews)
 * @param {boolean} [options.fillParentHeight] — body fills host height (use with a sized parent, e.g. scenes split)
 * @param {boolean} [options.hideInnerResize] — hide drag handle on panel body (parent controls height)
 * @param {(collapsed: boolean) => void} [options.onCollapsedChange] — e.g. shrink parent flex host when collapsed (compose split)
 * @param {import('../lib/state-store.js').StateStore} [options.stateStore]
 * @param {string} [options.streamName]
 */
export function initPreviewPanel(host, options) {
	const {
		title = 'Output preview',
		storageKeyPrefix = 'casparcg_preview',
		getOutputResolution,
		draw,
		stateStore,
		streamName,
		composePrvPgmLayoutToggle = false,
		fillParentHeight = false,
		hideInnerResize = false,
		onCollapsedChange = null,
	} = options

	const kCollapsed = `${storageKeyPrefix}_collapsed`
	const kHeight = `${storageKeyPrefix}_height`
	const kComposeLayout = `${storageKeyPrefix}_compose_prv_pgm_layout`

	let composePrvPgmLayout = 'lr'
	try {
		const v = localStorage.getItem(kComposeLayout)
		if (v === 'tb' || v === 'lr') composePrvPgmLayout = v
	} catch {}

	let collapsed = false
	try {
		collapsed = localStorage.getItem(kCollapsed) === '1'
	} catch {}

	let bodyHeight = 200
	try {
		const h = parseInt(localStorage.getItem(kHeight) || '', 10)
		if (!isNaN(h) && h >= 80 && h <= 560) bodyHeight = h
	} catch {}

	const root = document.createElement('div')
	root.className = 'preview-panel' + (collapsed ? ' preview-panel--collapsed' : '')
	const composePairClass =
		composePrvPgmLayout === 'tb' ? 'preview-panel__compose-pair--tb' : 'preview-panel__compose-pair--lr'
	const composeInner = composePrvPgmLayoutToggle
		? `
			<div class="preview-panel__canvas-wrap">
				<div class="preview-panel__compose-pair ${composePairClass}">
					<div class="preview-panel__compose-cell preview-panel__compose-cell--prv">
						<div class="preview-panel__video-container" data-preview-webrtc="prv"></div>
					</div>
					<div class="preview-panel__compose-cell preview-panel__compose-cell--pgm">
						<div class="preview-panel__video-container" data-preview-webrtc="pgm"></div>
					</div>
				</div>
				<canvas class="preview-panel__canvas preview-panel__canvas--compose-overlay" aria-hidden="true"></canvas>
			</div>
		`
		: `
			<div class="preview-panel__canvas-wrap">
				<div class="preview-panel__video-container"></div>
				<canvas class="preview-panel__canvas"></canvas>
			</div>
		`
	root.innerHTML = `
		<div class="preview-panel__header">
			<button type="button" class="preview-panel__toggle" aria-expanded="${!collapsed}" title="Show or hide preview"></button>
			<span class="preview-panel__title">${title}</span>
			<button type="button" class="preview-panel__compose-layout" hidden
				title="PRV/PGM bands: sides (left/right) or stacked (PGM top, PRV bottom)"></button>
			<span class="preview-panel__res"></span>
		</div>
		<div class="preview-panel__body"${fillParentHeight ? '' : ` style="height:${bodyHeight}px"`}>
			<div class="preview-panel__resize" title="Drag to resize"></div>
			<div class="preview-panel__canvas-outer">
				${composeInner}
			</div>
		</div>
	`
	host.appendChild(root)

	if (fillParentHeight) {
		root.classList.add('preview-panel--fill')
	}
	if (composePrvPgmLayoutToggle) {
		root.classList.add('preview-panel--compose-dual')
	}

	const btn = root.querySelector('.preview-panel__toggle')
	const composeLayoutBtn = root.querySelector('.preview-panel__compose-layout')
	const resEl = root.querySelector('.preview-panel__res')

	function syncComposeLayoutButton() {
		if (!composeLayoutBtn) return
		const isTb = composePrvPgmLayout === 'tb'
		composeLayoutBtn.textContent = isTb ? 'Stack' : 'Side'
		composeLayoutBtn.setAttribute('aria-pressed', isTb ? 'true' : 'false')
		composeLayoutBtn.title = isTb
			? 'PRV/PGM bands: PGM on top, PRV on bottom — click for left/right bands'
			: 'PRV/PGM bands: PRV left, PGM right — click for top/bottom bands'
	}

	function syncComposeLayoutPair() {
		if (!composePairEl) return
		composePairEl.classList.remove('preview-panel__compose-pair--lr', 'preview-panel__compose-pair--tb')
		composePairEl.classList.add(composePrvPgmLayout === 'tb' ? 'preview-panel__compose-pair--tb' : 'preview-panel__compose-pair--lr')
	}

	if (composePrvPgmLayoutToggle && composeLayoutBtn) {
		composeLayoutBtn.hidden = false
		syncComposeLayoutButton()
		composeLayoutBtn.addEventListener('click', () => {
			composePrvPgmLayout = composePrvPgmLayout === 'tb' ? 'lr' : 'tb'
			try {
				localStorage.setItem(kComposeLayout, composePrvPgmLayout)
			} catch {}
			syncComposeLayoutButton()
			syncComposeLayoutPair()
			scheduleDraw()
		})
	}
	const body = root.querySelector('.preview-panel__body')
	if (fillParentHeight) {
		body.classList.add('preview-panel__body--fill')
	}
	const resizeHandle = root.querySelector('.preview-panel__resize')
	if (hideInnerResize) {
		resizeHandle.style.display = 'none'
	}
	const wrap = root.querySelector('.preview-panel__canvas-wrap')
	const composePairEl = composePrvPgmLayoutToggle ? root.querySelector('.preview-panel__compose-pair') : null
	const prvVideoContainer = composePrvPgmLayoutToggle
		? root.querySelector('.preview-panel__video-container[data-preview-webrtc="prv"]')
		: null
	const pgmVideoContainer = composePrvPgmLayoutToggle
		? root.querySelector('.preview-panel__video-container[data-preview-webrtc="pgm"]')
		: null
	const videoContainer = composePrvPgmLayoutToggle ? null : root.querySelector('.preview-panel__video-container')
	const canvas = root.querySelector('.preview-panel__canvas')
	const ctx = canvas.getContext('2d', { alpha: true })

	if (composePrvPgmLayoutToggle) {
		syncComposeLayoutPair()
	}

	btn.textContent = collapsed ? '▸' : '▾'

	let rafDraw = null
	let ro = null

	function scheduleDraw() {
		if (rafDraw != null) return
		rafDraw = requestAnimationFrame(() => {
			rafDraw = null
			paint()
		})
	}

	function paint() {
		if (collapsed) return
		const { w: W, h: H } = getOutputResolution()
		const ww = Math.max(1, W)
		const hh = Math.max(1, H)
		if (resEl) resEl.textContent = `${ww}×${hh}`

		const dpr = Math.min(window.devicePixelRatio || 1, 2)
		/* Full wrap size: overlay canvas is a sibling of compose-pair, not a third flex child */
		const sizeHost = wrap
		const cw = sizeHost.clientWidth || 320
		const ch = sizeHost.clientHeight || 160
		const scale = Math.min(cw / ww, ch / hh, 1) || 1
		const dispW = Math.floor(ww * scale)
		const dispH = Math.floor(hh * scale)
		canvas.style.width = `${dispW}px`
		canvas.style.height = `${dispH}px`
		canvas.width = Math.round(ww * dpr)
		canvas.height = Math.round(hh * dpr)
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
		
		const isLive = !!(streamName && shouldShowLiveVideo())
		const meta = composePrvPgmLayoutToggle
			? { composePrvPgmLayout, composeDualStreamPreview: true }
			: {}
		draw(ctx, ww, hh, isLive, meta)
	}

	let liveView = null
	let pollTimer = null

	function updateLiveView() {
		const isStreaming = shouldShowLiveVideo()
		const shouldBeLive = !!(streamName && isStreaming && !collapsed)

		if (shouldBeLive) {
			if (composePrvPgmLayoutToggle && prvVideoContainer && pgmVideoContainer) {
				if (!liveView || liveView.kind !== 'dual') {
					if (liveView) liveView.destroy()
					liveView = initDualComposeLiveView(prvVideoContainer, pgmVideoContainer)
				}
			} else {
				if (liveView?.kind === 'dual') {
					liveView.destroy()
					liveView = null
				}
				if (!liveView) {
					liveView = initLiveView(videoContainer, streamName)
				} else {
					liveView.updateStream(streamName)
				}
			}
			if (pollTimer) {
				clearInterval(pollTimer)
				pollTimer = null
			}
		} else {
			if (liveView) {
				liveView.destroy()
				liveView = null
			}
			// T7.1: Start polling thumbnails if streaming is off and panel is visible
			if (!collapsed && !pollTimer) {
				pollTimer = setInterval(() => scheduleDraw(), 2000)
			}
		}
		scheduleDraw()
	}

	const unsubStream = streamState.subscribe(() => {
		updateLiveView()
	})
	const unsubSettings = settingsState.subscribe(() => {
		updateLiveView()
	})

	function setCollapsed(c) {
		collapsed = c
		root.classList.toggle('preview-panel--collapsed', collapsed)
		body.hidden = collapsed
		btn.setAttribute('aria-expanded', String(!collapsed))
		btn.textContent = collapsed ? '▸' : '▾'
		try {
			localStorage.setItem(kCollapsed, collapsed ? '1' : '0')
		} catch {}
		try {
			onCollapsedChange?.(collapsed)
		} catch {
			/* ignore */
		}
		updateLiveView()
		if (!collapsed) scheduleDraw()
	}

	btn.addEventListener('click', () => setCollapsed(!collapsed))

	let dragStartY = 0
	let dragStartH = 0
	const maxPanelBodyPx = () => Math.min(1200, Math.floor(window.innerHeight * 0.92))
	if (!hideInnerResize) {
		resizeHandle.addEventListener('mousedown', (e) => {
			if (e.button !== 0 || collapsed) return
			e.preventDefault()
			dragStartY = e.clientY
			dragStartH = body.offsetHeight
			const onMove = (ev) => {
				const dy = ev.clientY - dragStartY
				const nh = Math.max(80, Math.min(maxPanelBodyPx(), dragStartH + dy))
				body.style.height = `${nh}px`
				scheduleDraw()
			}
			const onUp = () => {
				document.removeEventListener('mousemove', onMove)
				document.removeEventListener('mouseup', onUp)
				document.body.style.cursor = ''
				document.body.style.userSelect = ''
				try {
					localStorage.setItem(kHeight, String(body.offsetHeight))
				} catch {}
			}
			document.body.style.cursor = 'row-resize'
			document.body.style.userSelect = 'none'
			document.addEventListener('mousemove', onMove)
			document.addEventListener('mouseup', onUp)
		})
	}

	if (typeof ResizeObserver !== 'undefined') {
		ro = new ResizeObserver(() => scheduleDraw())
		ro.observe(wrap)
	}
	window.addEventListener('resize', scheduleDraw)

	let unsubState = null
	if (stateStore?.on) {
		let rafState = null
		unsubState = stateStore.on('*', () => {
			if (rafState != null) return
			rafState = requestAnimationFrame(() => {
				rafState = null
				scheduleDraw()
			})
		})
	}

	body.hidden = collapsed
	try {
		onCollapsedChange?.(collapsed)
	} catch {
		/* ignore */
	}
	updateLiveView()
	scheduleDraw()

	return {
		scheduleDraw,
		destroy() {
			if (rafDraw != null) cancelAnimationFrame(rafDraw)
			if (ro) ro.disconnect()
			window.removeEventListener('resize', scheduleDraw)
			if (unsubState) unsubState()
			unsubStream()
			unsubSettings()
			if (pollTimer) clearInterval(pollTimer)
			if (liveView) liveView.destroy()
			root.remove()
		},
	}
}
