'use strict'

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { getChannelMap } = require('../config/routing')
const { resolveDecklinkVideoModeForTarget } = require('../config/decklink-output-resolve')
const { isFollowerRole } = require('./follower-machine-profile')

const DEFAULT_CASPAR_CONFIG_PATH = path.join(REPO_ROOT, 'config', 'casparcg.config')

function casparConfigPath() {
	return module.exports.CASPAR_CONFIG_PATH || DEFAULT_CASPAR_CONFIG_PATH
}

function mergedFlatConfig(ctx) {
	const config = ctx?.config || {}
	const cs = config.casparServer || config.caspar_server || {}
	const destinations = config.screenDestinations || config.screen_destinations
	return {
		...config,
		...cs,
		deviceGraph: config.deviceGraph || config.device_graph,
		screenDestinations: Array.isArray(destinations?.destinations) ? destinations.destinations : destinations,
	}
}

/**
 * Follower: DeckLink may be selected in Device View but omitted from casparcg.config when SDI format is unset.
 * @param {object} ctx
 */
function assessFollowerCasparOutputReadiness(ctx) {
	if (!isFollowerRole(ctx)) return { ok: true, warnings: [] }

	const config = mergedFlatConfig(ctx)
	const cs = config
	const screenCount = Math.max(1, parseInt(String(cs.screen_count || config.screen_count || 1), 10) || 1)
	const map = getChannelMap(config)
	/** @type {Array<{ screen: number, channel: number, decklinkDevice: number, code: string, message: string }>} */
	const warnings = []

	for (let screen = 1; screen <= screenCount; screen++) {
		const decklinkDevice = parseInt(String(cs[`screen_${screen}_decklink_device`] || '0'), 10) || 0
		if (decklinkDevice <= 0) continue

		const pgmCh = map.programCh(screen)
		const decklinkVideoMode = resolveDecklinkVideoModeForTarget(config, 'screen', screen)
		if (!decklinkVideoMode) {
			warnings.push({
				screen,
				channel: pgmCh,
				decklinkDevice,
				code: 'decklink_sdi_format_missing',
				message: `Screen ${screen} PGM (ch ${pgmCh}): DeckLink device ${decklinkDevice} needs an SDI output format in Device View — mirror takes will not appear on SDI until you set it and Regenerate Caspar.`,
			})
			continue
		}

		let casparXml = ''
		try {
			if (fs.existsSync(casparConfigPath())) casparXml = fs.readFileSync(casparConfigPath(), 'utf8')
		} catch {
			casparXml = ''
		}

		const channelComment = `Caspar channel ${pgmCh}:`
		const blockStart = casparXml.indexOf(channelComment)
		if (blockStart >= 0) {
			const blockEnd = casparXml.indexOf('</channel>', blockStart)
			const block = blockEnd > blockStart ? casparXml.slice(blockStart, blockEnd) : casparXml.slice(blockStart)
			if (!/<decklink[\s>]/i.test(block)) {
				warnings.push({
					screen,
					channel: pgmCh,
					decklinkDevice,
					code: 'decklink_missing_from_caspar_config',
					message: `Screen ${screen} PGM (ch ${pgmCh}): DeckLink device ${decklinkDevice} is not in casparcg.config — click Regenerate Caspar from Device View on this backup box.`,
				})
			}
		}
	}

	return { ok: warnings.length === 0, warnings }
}

module.exports = { assessFollowerCasparOutputReadiness, CASPAR_CONFIG_PATH: DEFAULT_CASPAR_CONFIG_PATH }
