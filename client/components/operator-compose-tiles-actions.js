/**
 * WO-272 (todos19.07.26): PGM-tile action buttons for the operator compose tiles. Split out of
 * operator-compose-tiles-tile-controller.js under the 500-line limit (WO-529) — self-contained
 * DOM chrome with no tile state, so it moves whole.
 */
import { api } from '../lib/api-client.js'
import { showAppToast } from '../lib/app-toast.js'

/**
 * WO-272 (todos19.07.26): PGM-tile action buttons — real chrome only (the footer label row; hole
 * rects are click-dead by design, X SHAPE input∩bounding).
 *  - EDIT PGM: dispatches the existing 'scenes-edit-live-on-pgm' event (same as the compose-pair
 *    badge in preview-canvas-compose-cell-chrome.js) — the scenes editor opens the look live on
 *    this main's PGM channel with edits applying straight to air (edit-on-PGM mode).
 *  - CAPTURE: POST /api/pgm/capture — Caspar PRINT of the resolved PGM channel; PNG lands in the
 *    Caspar media folder. Toast confirms (decklink-input-toast.js conventions).
 * pointerdown must not bubble: the footer is the tile drag handle.
 * @param {number} mainIndex
 * @returns {HTMLElement}
 */
export function buildPgmTileActions(mainIndex) {
	const wrap = document.createElement('div')
	wrap.className = 'operator-tile__actions'
	const stopDrag = (e) => e.stopPropagation()

	const editBtn = document.createElement('button')
	editBtn.type = 'button'
	editBtn.className = 'operator-tile__btn operator-tile__btn--edit'
	editBtn.textContent = 'EDIT PGM'
	editBtn.title = 'Open the on-air look in the looks editor — edits apply straight to PGM'
	editBtn.addEventListener('pointerdown', stopDrag)
	editBtn.addEventListener('click', (e) => {
		e.stopPropagation()
		document.dispatchEvent(new CustomEvent('scenes-edit-live-on-pgm', { detail: { mainIndex } }))
	})

	const captureBtn = document.createElement('button')
	captureBtn.type = 'button'
	captureBtn.className = 'operator-tile__btn operator-tile__btn--capture'
	captureBtn.textContent = 'CAPTURE'
	captureBtn.title = 'Snapshot this PGM channel (Caspar PRINT → PNG in the media folder)'
	captureBtn.addEventListener('pointerdown', stopDrag)
	captureBtn.addEventListener('click', async (e) => {
		e.stopPropagation()
		if (captureBtn.disabled) return
		captureBtn.disabled = true
		try {
			const res = await api.post('/api/pgm/capture', { mainIndex })
			showAppToast(
				res?.file
					? `PGM ${mainIndex + 1} captured → ${res.file}`
					: `PGM ${mainIndex + 1} captured (PNG in Caspar media folder)`,
				'success',
			)
		} catch (err) {
			showAppToast(`Capture failed: ${err?.message || err}`, 'error')
		} finally {
			captureBtn.disabled = false
		}
	})

	wrap.append(editBtn, captureBtn)
	return wrap
}
