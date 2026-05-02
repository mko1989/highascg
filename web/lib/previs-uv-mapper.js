/**
 * Previs UV mapping math (WO-17).
 *
 * Pure functions — no Three.js, no DOM. Ported 1:1 from
 * `work/references/show_creator/ScreenSystem.tsx` (`ContentLayer` + `IrregularPanel` layout
 * memos). Rewritten as plain JS so the Previs module can use them without React / R3F.
 *
 * Why a separate file:
 *   - Testable in isolation (see the `__selfTest()` export at the bottom).
 *   - Reused by both regular-screen rendering and irregular (per-panel) rendering.
 *   - `previs-pgm-3d.js` stays focused on scene wiring and stays well under 500 lines.
 *
 * Coordinate conventions (match Show Creator's, enforced across the module):
 *   - Virtual canvas is a 2D rect, pixels or arbitrary units. `y = 0` is **top**.
 *   - World space is metres, right-handed, +Y up. `y = 0` is **floor**.
 *   - UV `v = 0` is **bottom** (OpenGL default). When sampling the canvas, UV v is
 *     inverted relative to canvas y.
 *   - Panel `localX/localY` is measured from the screen's bottom-left in metres. 3D
 *     Y-up means canvas-y → world-y is an inversion for offsets (`offsetY = -deltaY`).
 *
 * Shape reference:
 *   - See `src/previs/types.js` for the `ScreenRegion`, `LEDPanel`, `VirtualCanvas` shapes.
 */

/**
 * @typedef {Object} Rect
 * @property {number} startX
 * @property {number} startY
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {Object} UVRect
 * @property {number} uLeft
 * @property {number} uRight
 * @property {number} vBottom
 * @property {number} vTop
 */

/**
 * @typedef {Object} ScreenUVResult
 * @property {UVRect} uvs               UV rect to apply to a flat plane attached to the screen.
 * @property {number} meshWidth         Mesh width in metres — the portion of the screen that shows content.
 * @property {number} meshHeight
 * @property {number} offsetX           Metres offset (world X) from screen centre to mesh centre, **before** the screen's rotation.
 * @property {number} offsetY           Metres offset (world Y) from screen centre to mesh centre, already Y-inverted vs canvas.
 */

/**
 * Resolve a content source's effective rect on the virtual canvas. Content smaller than the
 * canvas is centred (Show Creator's "centered fit" rule); content larger is clamped to the
 * canvas bounds.
 *
 * @param {{ width: number, height: number } | null | undefined} contentDims  Source dims
 *   (from `videoElement.videoWidth/Height` or `image.width/height`). `null` → fill canvas.
 * @param {{ width: number, height: number }} virtualCanvas
 * @returns {Rect}
 */
function computeContentBounds(contentDims, virtualCanvas) {
	const cw = contentDims && contentDims.width > 0 ? contentDims.width : virtualCanvas.width
	const ch = contentDims && contentDims.height > 0 ? contentDims.height : virtualCanvas.height

	const effectiveWidth = Math.min(cw, virtualCanvas.width)
	const effectiveHeight = Math.min(ch, virtualCanvas.height)

	return {
		startX: (virtualCanvas.width - effectiveWidth) / 2,
		startY: (virtualCanvas.height - effectiveHeight) / 2,
		width: effectiveWidth,
		height: effectiveHeight,
	}
}

/**
 * Compute the UV rect + mesh size + mesh offset for a regular (flat rectangular) screen
 * pulling from a portion of the virtual canvas.
 *
 * Returns `null` when the screen's canvas rect and the content rect don't overlap — the
 * caller should render a solid black backing and no content mesh.
 *
 * @param {{
 *   canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number,
 *   worldWidth: number, worldHeight: number,
 * }} region
 * @param {{ width: number, height: number } | null | undefined} contentDims
 * @param {{ width: number, height: number }} virtualCanvas
 * @returns {ScreenUVResult | null}
 */
function computeScreenUV(region, contentDims, virtualCanvas) {
	const content = computeContentBounds(contentDims, virtualCanvas)

	const screenStartX = region.canvasX
	const screenEndX = region.canvasX + region.canvasWidth
	const screenStartY = region.canvasY
	const screenEndY = region.canvasY + region.canvasHeight

	const contentEndX = content.startX + content.width
	const contentEndY = content.startY + content.height

	const overlapStartX = Math.max(screenStartX, content.startX)
	const overlapEndX = Math.min(screenEndX, contentEndX)
	const overlapStartY = Math.max(screenStartY, content.startY)
	const overlapEndY = Math.min(screenEndY, contentEndY)

	if (overlapStartX >= overlapEndX || overlapStartY >= overlapEndY) {
		return null
	}

	const uLeft = (overlapStartX - content.startX) / content.width
	const uRight = (overlapEndX - content.startX) / content.width
	const vBottom = 1 - (overlapEndY - content.startY) / content.height
	const vTop = 1 - (overlapStartY - content.startY) / content.height

	const overlapW = overlapEndX - overlapStartX
	const overlapH = overlapEndY - overlapStartY
	const meshWidth = (overlapW / region.canvasWidth) * region.worldWidth
	const meshHeight = (overlapH / region.canvasHeight) * region.worldHeight

	const overlapCenterX = (overlapStartX + overlapEndX) / 2
	const overlapCenterY = (overlapStartY + overlapEndY) / 2
	const screenCenterX = (screenStartX + screenEndX) / 2
	const screenCenterY = (screenStartY + screenEndY) / 2
	const offsetX = ((overlapCenterX - screenCenterX) / region.canvasWidth) * region.worldWidth
	const offsetY = -((overlapCenterY - screenCenterY) / region.canvasHeight) * region.worldHeight

	return {
		uvs: { uLeft, uRight, vBottom, vTop },
		meshWidth,
		meshHeight,
		offsetX,
		offsetY,
	}
}

/**
 * @typedef {Object} PanelUVResult
 * @property {boolean} hasContent        `false` when the panel doesn't overlap content — caller draws solid black only.
 * @property {number} panelOffsetX       Metres offset from screen centre to panel centre, **before** screen rotation.
 * @property {number} panelOffsetY
 * @property {number} panelWidth         Panel plane size (metres) — includes the 1 mm gap-eliminator.
 * @property {number} panelHeight
 * @property {number} contentOffsetX     Metres offset from screen centre to content-mesh centre.
 * @property {number} contentOffsetY
 * @property {number} contentWidth       Content-mesh size (metres) — 0 when `hasContent` is false.
 * @property {number} contentHeight
 * @property {UVRect} uvs                UV rect for the content mesh (identity when `hasContent` is false).
 */

/**
 * Compute the panel + content mesh geometry for one panel of an irregular (composite) screen.
 * Handles the three common cases:
 *   - Panel fully inside the content rect → full-panel UV.
 *   - Panel straddles the content edge → partial-content mesh sized to the overlap.
 *   - Panel entirely outside content → `hasContent: false`.
 *
 * @param {{ localX: number, localY: number, width: number, height: number }} panel
 * @param {{
 *   worldWidth: number, worldHeight: number,
 *   canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number,
 * }} region
 * @param {Rect} contentBounds   From {@link computeContentBounds}.
 * @param {{ gapEliminatorMeters?: number }} [opts]
 * @returns {PanelUVResult}
 */
function computePanelUV(panel, region, contentBounds, opts) {
	const gap = (opts && typeof opts.gapEliminatorMeters === 'number') ? opts.gapEliminatorMeters : 0.001

	const panelNormMinX = panel.localX / region.worldWidth
	const panelNormMaxX = (panel.localX + panel.width) / region.worldWidth
	const panelNormMinY = 1 - (panel.localY + panel.height) / region.worldHeight
	const panelNormMaxY = 1 - panel.localY / region.worldHeight

	const panelStartX = region.canvasX + panelNormMinX * region.canvasWidth
	const panelEndX = region.canvasX + panelNormMaxX * region.canvasWidth
	const panelStartY = region.canvasY + panelNormMinY * region.canvasHeight
	const panelEndY = region.canvasY + panelNormMaxY * region.canvasHeight

	const contentEndX = contentBounds.startX + contentBounds.width
	const contentEndY = contentBounds.startY + contentBounds.height

	const overlapStartX = Math.max(panelStartX, contentBounds.startX)
	const overlapEndX = Math.min(panelEndX, contentEndX)
	const overlapStartY = Math.max(panelStartY, contentBounds.startY)
	const overlapEndY = Math.min(panelEndY, contentEndY)

	const panelOffsetX = panel.localX + panel.width / 2 - region.worldWidth / 2
	const panelOffsetY = panel.localY + panel.height / 2 - region.worldHeight / 2
	const panelWidth = panel.width + gap
	const panelHeight = panel.height + gap

	if (overlapStartX >= overlapEndX || overlapStartY >= overlapEndY) {
		return {
			hasContent: false,
			panelOffsetX,
			panelOffsetY,
			panelWidth,
			panelHeight,
			contentOffsetX: panelOffsetX,
			contentOffsetY: panelOffsetY,
			contentWidth: 0,
			contentHeight: 0,
			uvs: { uLeft: 0, uRight: 1, vBottom: 0, vTop: 1 },
		}
	}

	const uLeft = (overlapStartX - contentBounds.startX) / contentBounds.width
	const uRight = (overlapEndX - contentBounds.startX) / contentBounds.width
	const vBottom = 1 - (overlapEndY - contentBounds.startY) / contentBounds.height
	const vTop = 1 - (overlapStartY - contentBounds.startY) / contentBounds.height

	const panelCanvasWidth = panelEndX - panelStartX
	const panelCanvasHeight = panelEndY - panelStartY
	const widthRatio = (overlapEndX - overlapStartX) / panelCanvasWidth
	const heightRatio = (overlapEndY - overlapStartY) / panelCanvasHeight

	const overlapCenterX = (overlapStartX + overlapEndX) / 2
	const overlapCenterY = (overlapStartY + overlapEndY) / 2
	const panelCenterX = (panelStartX + panelEndX) / 2
	const panelCenterY = (panelStartY + panelEndY) / 2
	const offsetRatioX = (overlapCenterX - panelCenterX) / panelCanvasWidth
	const offsetRatioY = -(overlapCenterY - panelCenterY) / panelCanvasHeight

	return {
		hasContent: true,
		panelOffsetX,
		panelOffsetY,
		panelWidth,
		panelHeight,
		contentOffsetX: panelOffsetX + offsetRatioX * panel.width,
		contentOffsetY: panelOffsetY + offsetRatioY * panel.height,
		contentWidth: panelWidth * widthRatio,
		contentHeight: panelHeight * heightRatio,
		uvs: { uLeft, uRight, vBottom, vTop },
	}
}

/**
 * Convert LED wall pixel pitch + panel grid into a per-panel physical size in metres.
 *
 * @param {{ pixelPitch: number, panelWidth: number, panelHeight: number }} led
 *   `pixelPitch` in millimetres. `panelWidth/Height` in pixels.
 * @returns {{ panelWidthMeters: number, panelHeightMeters: number }}
 */
function ledPanelSizeMeters(led) {
	return {
		panelWidthMeters: (led.panelWidth * led.pixelPitch) / 1000,
		panelHeightMeters: (led.panelHeight * led.pixelPitch) / 1000,
	}
}

/**
 * Apply a Z-rotation matrix style 2D vector transform — used when converting a local offset
 * (which is always expressed "before rotation") into world coordinates. Kept inline here so
 * consumers that haven't imported Three.js yet (e.g. unit tests) don't need it.
 *
 * For full 3D rotations, callers should use `THREE.Vector3.applyEuler()` — this helper is
 * only correct when the screen's rotation is around the world Z axis. `ScreenSystem.tsx`
 * uses the full Euler rotation via THREE; we defer that to the scene code.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} angleZ
 * @returns {[number, number]}
 */
function rotate2D(x, y, angleZ) {
	const c = Math.cos(angleZ)
	const s = Math.sin(angleZ)
	return [x * c - y * s, x * s + y * c]
}

function __approx(a, b, epsilon = 1e-6) {
	return Math.abs(a - b) < epsilon
}

/**
 * Self-test — invoked by `tools/smoke-previs-uv.js` and also runnable directly via
 * `node -e "require('./web/lib/previs-uv-mapper.js').__selfTest()"` (with a shim for ESM).
 *
 * Keep the cases small and explicit — they double as documentation. See the WO-17 "Borrowed
 * workflows" section for diagrams.
 * @returns {{ passed: number, failed: number, failures: string[] }}
 */
export function __selfTest() {
	/** @type {string[]} */
	const failures = []
	let passed = 0
	const check = (cond, label) => {
		if (cond) passed++
		else failures.push(label)
	}

	const vc = { width: 1920, height: 1080 }
	const content = { width: 1920, height: 1080 }

	{
		const region = {
			canvasX: 0, canvasY: 0, canvasWidth: 1920, canvasHeight: 1080,
			worldWidth: 16, worldHeight: 9,
		}
		const r = computeScreenUV(region, content, vc)
		check(r !== null, 'full-canvas screen returns result')
		check(__approx(r.uvs.uLeft, 0) && __approx(r.uvs.uRight, 1), 'full-canvas UV u = 0..1')
		check(__approx(r.uvs.vBottom, 0) && __approx(r.uvs.vTop, 1), 'full-canvas UV v = 0..1')
		check(__approx(r.meshWidth, 16) && __approx(r.meshHeight, 9), 'full-canvas mesh = screen')
		check(__approx(r.offsetX, 0) && __approx(r.offsetY, 0), 'full-canvas offset = centre')
	}

	{
		const region = {
			canvasX: 960, canvasY: 0, canvasWidth: 960, canvasHeight: 1080,
			worldWidth: 8, worldHeight: 9,
		}
		const r = computeScreenUV(region, content, vc)
		check(r !== null, 'right-half screen returns result')
		check(__approx(r.uvs.uLeft, 0.5) && __approx(r.uvs.uRight, 1), 'right-half UV uLeft = 0.5')
		check(__approx(r.uvs.vBottom, 0) && __approx(r.uvs.vTop, 1), 'right-half UV v full')
		check(__approx(r.meshWidth, 8) && __approx(r.meshHeight, 9), 'right-half mesh = full screen')
	}

	{
		const region = {
			canvasX: 2000, canvasY: 0, canvasWidth: 100, canvasHeight: 100,
			worldWidth: 1, worldHeight: 1,
		}
		const r = computeScreenUV(region, content, vc)
		check(r === null, 'off-canvas screen returns null')
	}

	{
		const region = {
			canvasX: 0, canvasY: 0, canvasWidth: 1920, canvasHeight: 1080,
			worldWidth: 16, worldHeight: 9,
		}
		const smallContent = { width: 960, height: 540 }
		const bounds = computeContentBounds(smallContent, vc)
		check(__approx(bounds.startX, 480) && __approx(bounds.startY, 270), 'small content centred on canvas')
		const r = computeScreenUV(region, smallContent, vc)
		check(r !== null, 'screen shows centred small content')
		check(__approx(r.meshWidth, (960 / 1920) * 16), 'mesh width = content proportion * screen world width')
	}

	{
		const region = {
			worldWidth: 4, worldHeight: 3,
			canvasX: 0, canvasY: 0, canvasWidth: 1920, canvasHeight: 1080,
		}
		const bounds = computeContentBounds(content, vc)
		const panel = { localX: 0, localY: 0, width: 1, height: 1 }
		const r = computePanelUV(panel, region, bounds)
		check(r.hasContent === true, 'bottom-left panel has content')
		// Panel centre is at (localX + w/2 - screenW/2, localY + h/2 - screenH/2) = (-1.5, -1).
		check(__approx(r.panelOffsetX, -1.5) && __approx(r.panelOffsetY, -1), 'panel offset from screen centre')
		check(__approx(r.panelWidth, 1 + 0.001) && __approx(r.panelHeight, 1 + 0.001), 'panel includes gap eliminator')
		// Panel is localY=0 (screen bottom) → canvas bottom → UV v at bottom 1/3.
		check(__approx(r.uvs.uLeft, 0) && __approx(r.uvs.uRight, 0.25), 'bottom-left panel UV u = 0..0.25')
		check(__approx(r.uvs.vBottom, 0) && __approx(r.uvs.vTop, 1 / 3), 'bottom-left panel UV v at bottom of content')
	}

	{
		const region = {
			worldWidth: 4, worldHeight: 3,
			canvasX: 0, canvasY: 0, canvasWidth: 200, canvasHeight: 100,
		}
		const smallContent = { width: 50, height: 50 }
		const bounds = computeContentBounds(smallContent, { width: 200, height: 100 })
		const panel = { localX: 3, localY: 2, width: 1, height: 1 }
		const r = computePanelUV(panel, region, bounds)
		check(r.hasContent === false, 'out-of-content panel reports hasContent=false')
		check(r.contentWidth === 0 && r.contentHeight === 0, 'out-of-content panel content dims = 0')
	}

	return { passed, failed: failures.length, failures }
}

export {
	computeContentBounds,
	computeScreenUV,
	computePanelUV,
	ledPanelSizeMeters,
	rotate2D,
}
