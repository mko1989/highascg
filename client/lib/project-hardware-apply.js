/**
 * Apply saved project hardware to the live machine (snapshot + OS layout + Caspar config).
 */
import { api } from './api-client.js'
import {
	buildDeviceSnapshotFromHardwareConfig,
	osDisplayKeysFromHardware,
} from './project-hardware-mismatch.js'

/**
 * @param {object} hardwareConfig
 * @returns {Promise<{ steps: string[], warnings: string[] }>}
 */
export async function applyProjectHardware(hardwareConfig) {
	const steps = []
	const warnings = []
	const snapshot = buildDeviceSnapshotFromHardwareConfig(hardwareConfig)
	if (snapshot) {
		const r = await api.post('/api/device-snapshot/apply', {
			snapshot,
			mode: 'full',
			dryRun: false,
		})
		if (!r?.ok) throw new Error(r?.error || 'Device snapshot apply failed')
		steps.push('Device graph and screen destinations applied')
	} else {
		warnings.push('No device snapshot payload in project hardware')
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

	document.dispatchEvent(new CustomEvent('highascg-settings-applied'))
	return { steps, warnings }
}
