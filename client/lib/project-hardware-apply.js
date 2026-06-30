/**
 * Apply saved project hardware to the live machine (config + OS layout + Caspar config).
 */
import { api } from './api-client.js'
import { hasProjectHardwareConfig, osDisplayKeysFromHardware } from './project-hardware-mismatch.js'

/**
 * Write project hardwareConfig into server settings (Device View, routing) without restarting Caspar.
 * @param {object} hardwareConfig
 * @returns {Promise<boolean>} true when config was applied
 */
export async function applyServerHardwareConfigOnly(hardwareConfig) {
	if (!hasProjectHardwareConfig(hardwareConfig)) return false
	const r = await api.post('/api/project/apply-hardware', { hardwareConfig })
	if (!r?.ok) throw new Error(r?.error || 'Project hardware apply failed')
	document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
	return r.applied === true
}

/**
 * @param {object} hardwareConfig
 * @returns {Promise<{ steps: string[], warnings: string[] }>}
 */
export async function applyProjectHardware(hardwareConfig) {
	const steps = []
	const warnings = []
	try {
		const applied = await applyServerHardwareConfigOnly(hardwareConfig)
		if (applied) steps.push('Device graph, destinations, and routing applied')
		else warnings.push('No device snapshot payload in project hardware')
	} catch (e) {
		throw new Error(e?.message || 'Project hardware apply failed')
	}

	const osPatch = osDisplayKeysFromHardware(hardwareConfig)
	if (Object.keys(osPatch).length) {
		try {
			const r = await api.post('/api/settings/apply-os', osPatch)
			if (r?.ok === false) warnings.push(r?.error || 'OS layout apply returned not ok')
			else steps.push('GPU / xrandr layout applied')
		} catch (e) {
			warnings.push(`OS layout apply failed: ${e?.message || e}`)
		}
	}

	try {
		await api.post('/api/caspar-config/apply', {})
		steps.push('Caspar config regenerated (restart may be required)')
	} catch (e) {
		warnings.push(`Caspar config apply failed: ${e?.message || e}`)
	}

	return { steps, warnings }
}
