/**
 * Launch allow-listed operator GUI tools on :0 (Firefox, file manager).
 */
import { api } from './api-client.js'
import { settingsState } from './settings-state.js'

function nuclearPassword() {
	const ui = settingsState.getSettings()?.ui || {}
	if (!ui.nuclearRequirePassword) return ''
	const p = String(ui.nuclearPassword || '')
	if (!p || p === '[REDACTED]') return ''
	return p
}

/**
 * @param {'firefox'|'file-manager'|string} action
 * @returns {Promise<{ exe?: string, error?: string }>}
 */
export async function launchOperatorGui(action) {
	try {
		const res = await api.post('/api/system/gui-launch', {
			action,
			password: nuclearPassword(),
		})
		return { exe: res?.exe }
	} catch (e) {
		return { error: e?.message || String(e) }
	}
}

/**
 * WO-283 — open a foreign window (DeckLink setup, nvidia-settings, file manager, browser) ON TOP
 * of the shaped kiosk. Unlike {@link launchOperatorGui} (which spawns behind the always-on-top
 * kiosk and is therefore invisible to the operator), the server also promotes the helper into
 * Openbox's ABOVE layer and suspends the shape overlay's kiosk top-assert until it closes.
 * @param {'firefox'|'file-manager'|'nvidia-settings'|'desktopvideo_setup'|'desktop_video_updater'} action
 * @returns {Promise<{ ok?: boolean, state?: string, error?: string }>}
 */
export async function openOperatorHelperWindow(action) {
	try {
		const res = await api.post('/api/system/operator-helper-window', {
			mode: 'open',
			action,
			password: nuclearPassword(),
		})
		return { ok: true, state: res?.state }
	} catch (e) {
		return { error: e?.message || String(e) }
	}
}

/**
 * WO-283 — force the kiosk back on top. Does NOT kill the helper (the operator closes their own
 * window); this is the "I'm done" / "unstick me" path. The server also restores automatically
 * when the helper's window disappears, so this is belt-and-braces.
 * @returns {Promise<{ ok?: boolean, state?: string, error?: string }>}
 */
export async function closeOperatorHelperWindow() {
	try {
		const res = await api.post('/api/system/operator-helper-window', {
			mode: 'close',
			password: nuclearPassword(),
		})
		return { ok: true, state: res?.state }
	} catch (e) {
		return { error: e?.message || String(e) }
	}
}

/**
 * WO-283 — current helper state, so the button can flip back by itself when a helper the operator
 * closed (or that crashed) is reaped by the server watchdog.
 * @returns {Promise<{ state: string, action: string|null }>}
 */
export async function getOperatorHelperWindowState() {
	try {
		const res = await api.get('/api/system/operator-helper-window')
		return { state: String(res?.state || 'idle'), action: res?.action ?? null }
	} catch {
		return { state: 'idle', action: null }
	}
}

/**
 * @param {boolean} enabled
 */
export async function setOperatorPointerConfine(enabled) {
	try {
		await api.post('/api/system/pointer-confine', {
			enabled: !!enabled,
			password: nuclearPassword(),
		})
		return { ok: true }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}
