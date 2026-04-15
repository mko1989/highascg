import { initLiveView, initDualComposeLiveView } from './live-view.js'
import { streamState, shouldShowLiveVideo } from '../lib/stream-state.js'
import { settingsState } from '../lib/settings-state.js'

/** Space between PRV and PGM (px); drag handle sits here. */
const COMPOSE_GUTTER_PX = 6
/** Live→offline: border fades out before the pair is hidden. */
const COMPOSE_BORDER_FADE_MS = 400

/**
 * Size the PRV+PGM pair so each cell can match program output aspect (two W×H cells side-by-side or stacked).
 * @param {number} w
 * @param {number} h
 * @param {'lr'|'tb'} layout
 * @param {number} cw
 * @param {number} ch
 */
function fitComposePairRect(w, h, layout, cw, ch) {
	const w2 = Math.max(1, w)
	const h2 = Math.max(1, h)
	const cw2 = Math.max(1, cw)
	const ch2 = Math.max(1, ch)
	if (layout === 'lr') {
		const ar = (2 * w2) / h2
		let fitW = cw2
		let fitH = fitW / ar
		if (fitH > ch2) {
			fitH = ch2
			fitW = fitH * ar
		}
		return { fitW: Math.round(fitW), fitH: Math.round(Math.max(64, fitH)) }
	}
	const ar = w2 / (2 * h2)
	let fitW = cw2
	let fitH = fitW / ar
	if (fitH > ch2) {
		fitH = ch2
		fitW = fitH * ar
	}
	return { fitW: Math.round(Math.max(64, fitW)), fitH: Math.round(fitH) }
}

/**
 * Logical size of each PRV/PGM cell in the same units as program ww×hh so canvas bitmap aspect
 * matches the on-screen cell when the gutter split is not 50/50.
 */
function composeCellLogicalDimensions(layout, ww, hh, fitW, fitH, prvSize, pgmSize) {
	const ps = Math.max(1, prvSize)
	const pgs = Math.max(1, pgmSize)
	if (layout === 'lr') {
		return {
			prv: { w: ww, h: ww * (fitH / ps) },
			pgm: { w: ww, h: ww * (fitH / pgs) },
		}
	}
	return {
		prv: { w: hh * (fitW / ps), h: hh },
		pgm: { w: hh * (fitW / pgs), h: hh },
	}
}

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
	const kPrvPgmSplit = `${storageKeyPrefix}_compose_prv_pgm_split`

	let composePrvPgmLayout = 'lr'
	try {
		const v = localStorage.getItem(kComposeLayout)
		if (v === 'tb' || v === 'lr') composePrvPgmLayout = v
	} catch {}

	/** Fraction of PRV+PGM inner span (excluding gutter) for PRV: ~0.15–0.85 */
	let prvPct = 0.5
	try {
		const p = parseFloat(localStorage.getItem(kPrvPgmSplit) || '')
		if (!Number.isNaN(p) && p >= 0.15 && p <= 0.85) prvPct = p
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
						<canvas class="preview-panel__canvas preview-panel__canvas--compose-cell" data-compose-canvas="prv" aria-hidden="true"></canvas>
					</div>
					<div class="preview-panel__compose-gutter" title="Drag to resize PRV vs PGM" aria-hidden="true"></div>
					<div class="preview-panel__compose-cell preview-panel__compose-cell--pgm">
						<div class="preview-panel__video-container" data-preview-webrtc="pgm"></div>
						<canvas class="preview-panel__canvas preview-panel__canvas--compose-cell" data-compose-canvas="pgm" aria-hidden="true"></canvas>
					</div>
				</div>
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
	const canvasOuter = root.querySelector('.preview-panel__canvas-outer')
	const composePairEl = composePrvPgmLayoutToggle ? root.querySelector('.preview-panel__compose-pair') : null
	const composeGutter = composePrvPgmLayoutToggle ? root.querySelector('.preview-panel__compose-gutter') : null
	const prvVideoContainer = composePrvPgmLayoutToggle
		? root.querySelector('.preview-panel__video-container[data-preview-webrtc="prv"]')
		: null
	const pgmVideoContainer = composePrvPgmLayoutToggle
		? root.querySelector('.preview-panel__video-container[data-preview-webrtc="pgm"]')
		: null
	const videoContainer = composePrvPgmLayoutToggle ? null : root.querySelector('.preview-panel__video-container')
	const canvasPrv = composePrvPgmLayoutToggle ? root.querySelector('[data-compose-canvas="prv"]') : null
	const canvasPgm = composePrvPgmLayoutToggle ? root.querySelector('[data-compose-canvas="pgm"]') : null
	const canvas = composePrvPgmLayoutToggle ? null : root.querySelector('.preview-panel__canvas')
	const ctxPrv = canvasPrv ? canvasPrv.getContext('2d', { alpha: true }) : null
	const ctxPgm = canvasPgm ? canvasPgm.getContext('2d', { alpha: true }) : null
	const ctx = canvas ? canvas.getContext('2d', { alpha: true }) : null

	if (composePrvPgmLayoutToggle) {
		syncComposeLayoutPair()
	}

	btn.textContent = collapsed ? '▸' : '▾'

	let rafDraw = null
	let ro = null
	let prevComposeStreamLive = false
	let composeOfflineDelayTimer = null

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
		const sizeHost = wrap
		let cw = sizeHost.clientWidth
		let ch = sizeHost.clientHeight
		if (canvasOuter && (cw < 16 || ch < 16)) {
			cw = Math.max(cw, canvasOuter.clientWidth)
			ch = Math.max(ch, canvasOuter.clientHeight)
		}
		if (composePrvPgmLayoutToggle && fillParentHeight && (ch < 8 || cw < 8)) {
			requestAnimationFrame(() => scheduleDraw())
			return
		}
		if (!cw) cw = 320
		if (!ch) ch = 160
		const scale = Math.min(cw / ww, ch / hh) || 1
		const dispW = Math.floor(ww * scale)
		const dispH = Math.floor(hh * scale)

		const isLive = !!(streamName && shouldShowLiveVideo())

		if (!composePrvPgmLayoutToggle) {
			canvas.width = Math.round(ww * dpr)
			canvas.height = Math.round(hh * dpr)
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
			canvas.style.width = `${dispW}px`
			canvas.style.height = `${dispH}px`
			draw(ctx, ww, hh, isLive, {})
			return
		}

		/* Dual PRV/PGM: one canvas per cell; stream on/off timing (offline class + border fade). */
		if (isLive) {
			if (composeOfflineDelayTimer != null) {
				clearTimeout(composeOfflineDelayTimer)
				composeOfflineDelayTimer = null
			}
			root.classList.remove('preview-panel--compose-offline')
			root.classList.remove('preview-panel--compose-border-fade-out')
			prevComposeStreamLive = true
		} else {
			if (prevComposeStreamLive) {
				root.classList.remove('preview-panel--compose-offline')
				root.classList.add('preview-panel--compose-border-fade-out')
				composeOfflineDelayTimer = setTimeout(() => {
					root.classList.add('preview-panel--compose-offline')
					root.classList.remove('preview-panel--compose-border-fade-out')
					composeOfflineDelayTimer = null
					scheduleDraw()
				}, COMPOSE_BORDER_FADE_MS)
			} else if (composeOfflineDelayTimer == null) {
				root.classList.add('preview-panel--compose-offline')
			}
			prevComposeStreamLive = false
		}

		const prvCell = root.querySelector('.preview-panel__compose-cell--prv')
		const pgmCell = root.querySelector('.preview-panel__compose-cell--pgm')
		const g = COMPOSE_GUTTER_PX
		let fitW = 0
		let fitH = 0
		let prvSize = 0
		let pgmSize = 0
		if (prvCell && pgmCell && composePairEl) {
			const fit = fitComposePairRect(ww, hh, composePrvPgmLayout, cw, ch)
			fitW = fit.fitW
			fitH = fit.fitH
			composePairEl.style.width = `${fitW}px`
			composePairEl.style.height = `${fitH}px`
			composePairEl.style.flexShrink = '0'
			composePairEl.style.alignSelf = 'center'
			composePairEl.style.maxWidth = '100%'
			composePairEl.style.maxHeight = '100%'

			const inner = Math.max(0, (composePrvPgmLayout === 'lr' ? fitW : fitH) - g)
			prvSize = inner > 0 ? Math.floor(inner * prvPct) : 0
			if (inner >= 64) {
				prvSize = Math.max(32, Math.min(inner - 32, prvSize))
			} else if (inner > 0) {
				prvSize = Math.max(1, Math.min(inner - 1, prvSize))
			}
			pgmSize = inner - prvSize

			if (composePrvPgmLayout === 'tb') {
				prvCell.style.cssText = `flex:0 0 ${prvSize}px;height:${prvSize}px;min-height:0;width:100%;max-width:100%`
				pgmCell.style.cssText = `flex:0 0 ${pgmSize}px;height:${pgmSize}px;min-height:0;width:100%;max-width:100%`
			} else {
				prvCell.style.cssText = `flex:0 0 ${prvSize}px;width:${prvSize}px;min-width:0;max-width:${prvSize}px;height:100%;align-self:stretch`
				pgmCell.style.cssText = `flex:0 0 ${pgmSize}px;width:${pgmSize}px;min-width:0;max-width:${pgmSize}px;height:100%;align-self:stretch`
			}
		}

		const layout = composePrvPgmLayout === 'tb' ? 'tb' : 'lr'
		let prvVp = { w: layout === 'lr' ? ww / 2 : ww, h: layout === 'tb' ? hh / 2 : hh }
		let pgmVp = { w: layout === 'lr' ? ww / 2 : ww, h: layout === 'tb' ? hh / 2 : hh }
		if (fitW > 0 && fitH > 0 && prvSize > 0 && pgmSize > 0) {
			const dim = composeCellLogicalDimensions(layout, ww, hh, fitW, fitH, prvSize, pgmSize)
			prvVp = dim.prv
			pgmVp = dim.pgm
		}

		canvasPrv.width = Math.max(1, Math.round(prvVp.w * dpr))
		canvasPrv.height = Math.max(1, Math.round(prvVp.h * dpr))
		ctxPrv.setTransform(dpr, 0, 0, dpr, 0, 0)
		canvasPgm.width = Math.max(1, Math.round(pgmVp.w * dpr))
		canvasPgm.height = Math.max(1, Math.round(pgmVp.h * dpr))
		ctxPgm.setTransform(dpr, 0, 0, dpr, 0, 0)

		canvasPrv.style.width = '100%'
		canvasPrv.style.height = '100%'
		canvasPgm.style.width = '100%'
		canvasPgm.style.height = '100%'

		const meta = {
			composePrvPgmLayout,
			composeDualStreamPreview: isLive,
			composePrvPgmLayoutToggle: true,
		}
		draw(ctxPrv, ww, hh, isLive, { ...meta, composeCell: 'prv', composeCellViewport: prvVp })
		draw(ctxPgm, ww, hh, isLive, { ...meta, composeCell: 'pgm', composeCellViewport: pgmVp })
	}

	if (composePrvPgmLayoutToggle && composeGutter) {
		composeGutter.addEventListener('mousedown', (e) => {
			if (e.button !== 0 || collapsed) return
			e.preventDefault()
			const onMove = (ev) => {
				if (!composePairEl) return
				const r = composePairEl.getBoundingClientRect()
				let next
				if (composePrvPgmLayout === 'lr') {
					next = (ev.clientX - r.left) / r.width
				} else {
					next = (r.bottom - ev.clientY) / r.height
				}
				next = Math.max(0.15, Math.min(0.85, next))
				if (Math.abs(next - prvPct) > 1e-6) {
					prvPct = next
					try {
						localStorage.setItem(kPrvPgmSplit, String(prvPct))
					} catch {
						/* ignore */
					}
					scheduleDraw()
				}
			}
			const onUp = () => {
				document.removeEventListener('mousemove', onMove)
				document.removeEventListener('mouseup', onUp)
				document.body.style.cursor = ''
				document.body.style.userSelect = ''
			}
			document.body.style.cursor = composePrvPgmLayout === 'lr' ? 'col-resize' : 'row-resize'
			document.body.style.userSelect = 'none'
			document.addEventListener('mousemove', onMove)
			document.addEventListener('mouseup', onUp)
		})
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
		if (canvasOuter) ro.observe(canvasOuter)
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
			if (composeOfflineDelayTimer != null) {
				clearTimeout(composeOfflineDelayTimer)
				composeOfflineDelayTimer = null
			}
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
