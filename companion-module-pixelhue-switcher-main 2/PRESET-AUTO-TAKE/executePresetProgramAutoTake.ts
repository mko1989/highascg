import type { Preset } from '../src/interfaces/Preset.js'
import { LoadIn } from '../src/interfaces/Preset.js'
import type { Screen } from '../src/interfaces/Screen.js'
import type { ApiClient } from '../src/services/ApiClient.js'

/**
 * Recall preset to Preview, then TAKE to Program (auto-transition).
 * Mirrors PixelHue workflow: load PVW → take PGM.
 */
export async function executePresetProgramAutoTake(
	apiClient: ApiClient | null | undefined,
	preset: Preset,
	allScreens: Screen[],
	swapEnabled: boolean,
	effectTime: number,
): Promise<void> {
	const presetScreenGuids = preset.screens.map((screen) => screen.guid)
	const screensToTake = allScreens.filter((screen) => presetScreenGuids.includes(screen.guid))

	if (screensToTake.length === 0) return

	await apiClient?.loadPreset(preset, LoadIn.preview)
	await apiClient?.take(screensToTake, swapEnabled, false, effectTime)
}
