/**
 * WO-319 follow-up (todos22.07.26) — the Live preview stream is now a choice in the Compose preview
 * "Preview source" dropdown, not a standalone header button. This driver is the single writer of the
 * per-client operator live canvas: it mirrors the shared `composePreview.mode === 'stream'` setting
 * onto setOperatorLiveCanvasEnabled(). Everything downstream (the tiles+stream view flip in
 * preview-canvas-panel.js, the overlay blit in operator-compose-tiles.js) already reacts to the
 * live-canvas STATE, so no other surface needs to know the setting moved.
 *
 * Availability still gates acquisition: selecting 'stream' where the gui-stream channel is disabled
 * or the browser lacks WebCodecs simply never acquires, and the client keeps showing Canvas
 * thumbnails — so a shared 'stream' default never breaks a client that can't decode it.
 */

import { initOperatorLiveCanvas, setOperatorLiveCanvasEnabled } from './preview-canvas-live-stream.js'
import { settingsState } from '../lib/settings-state.js'
import { isStreamComposePreview } from '../lib/compose-preview-url.js'

/** Call once at UI init. Idempotent init of the live canvas + a subscription that keeps it in sync. */
export function initComposePreviewStreamDriver() {
	// Probe availability + restore any persisted state (was previously kicked by the header toggle).
	initOperatorLiveCanvas()
	// subscribe() fires immediately with current settings and on every load()/save() notify, so the
	// canvas follows the dropdown across the initial GET /api/settings and any later Apply.
	settingsState.subscribe(() => {
		setOperatorLiveCanvasEnabled(isStreamComposePreview())
	})
}
