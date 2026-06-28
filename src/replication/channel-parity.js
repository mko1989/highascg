'use strict'

const { getChannelMap } = require('../config/routing')

/**
 * Compact channel plan for peer ping / parity checks (program + preview + multiview only).
 * @param {Record<string, unknown>} config
 */
function buildChannelMapSummary(config) {
	const map = getChannelMap(config)
	return {
		screenCount: map.screenCount ?? 0,
		programChannels: [...(map.programChannels || [])],
		previewChannels: (map.previewChannels || []).map((ch) => (ch == null ? null : ch)),
		multiviewCh: map.multiviewCh ?? null,
	}
}

/**
 * @param {ReturnType<typeof buildChannelMapSummary>|null|undefined} local
 * @param {ReturnType<typeof buildChannelMapSummary>|null|undefined} peer
 */
function compareChannelParity(local, peer) {
	if (!local) {
		return { ok: true, mismatches: [], peerAvailable: false }
	}
	if (!peer) {
		return { ok: true, mismatches: [], peerAvailable: false }
	}

	/** @type {Array<{ kind: string, label: string, local: string, peer: string }>} */
	const mismatches = []
	const maxScreens = Math.max(local.programChannels.length, peer.programChannels.length, local.screenCount, peer.screenCount)

	for (let i = 0; i < maxScreens; i++) {
		const lPgm = local.programChannels[i] ?? null
		const pPgm = peer.programChannels[i] ?? null
		if (lPgm !== pPgm) {
			mismatches.push({
				kind: 'program',
				label: `PGM screen ${i + 1}`,
				local: lPgm == null ? '—' : `ch ${lPgm}`,
				peer: pPgm == null ? '—' : `ch ${pPgm}`,
			})
		}
		const lPrv = local.previewChannels[i] ?? null
		const pPrv = peer.previewChannels[i] ?? null
		if (lPrv !== pPrv) {
			mismatches.push({
				kind: 'preview',
				label: `PRV screen ${i + 1}`,
				local: lPrv == null ? 'off' : `ch ${lPrv}`,
				peer: pPrv == null ? 'off' : `ch ${pPrv}`,
			})
		}
	}

	if ((local.multiviewCh ?? null) !== (peer.multiviewCh ?? null)) {
		mismatches.push({
			kind: 'multiview',
			label: 'Multiview',
			local: local.multiviewCh == null ? 'off' : `ch ${local.multiviewCh}`,
			peer: peer.multiviewCh == null ? 'off' : `ch ${peer.multiviewCh}`,
		})
	}

	return { ok: mismatches.length === 0, mismatches, peerAvailable: true }
}

module.exports = { buildChannelMapSummary, compareChannelParity }
