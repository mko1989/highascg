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
