/**
 * Remove extra live sources (NDI host, webpage host, layer routes, legacy NDI/browser tiles).
 */
import { api } from './api-client.js'
import { markCasparRestartDirty } from './caspar-restart-hint.js'

/**
 * @param {object | null | undefined} source
 */
export async function stopHostChannelPlayback(source) {
	const ch = source?.hostChannel ?? source?.inputsChannel
	const layer = source?.hostLayer ?? source?.inputsLayer ?? 1
	if (ch == null) return
	const cl = `${ch}-${layer}`
	await api.post('/api/raw', { cmd: `STOP ${cl}` }).catch(() => {})
	await api.post('/api/raw', { cmd: `MIXER ${cl} CLEAR` }).catch(() => {})
}

/**
 * @param {object | null | undefined} source
 * @param {object | null | undefined} [hostOperatorFullscreen]
 */
export async function removeExtraLiveHostSource(source, hostOperatorFullscreen = null) {
	const value = String(source?.value || '').trim()
	if (!value) throw new Error('Live source route missing')

	await stopHostChannelPlayback(source)

	const fsActive =
		hostOperatorFullscreen?.active &&
		String(hostOperatorFullscreen?.sourceId || '') === String(source?.sourceId || '')
	if (fsActive && source?.sourceId) {
		await api.post('/api/host-live/operator-fullscreen', { action: 'off', sourceId: source.sourceId }).catch(() => {})
	}

	const rm = await api.post('/api/device-view', { removeExtraLiveSource: { value } })
	if (Array.isArray(rm?.extraLiveSources) && typeof window.__highascgApplyExtraLiveSources === 'function') {
		window.__highascgApplyExtraLiveSources(rm.extraLiveSources)
	}
	markCasparRestartDirty()
	return rm
}

/**
 * @param {object | null | undefined} extras
 * @param {{ sourceId?: string, value?: string, hostChannel?: number, routeType?: string }} query
 */
export function resolveExtraLiveHostSource(extras, query) {
	const list = Array.isArray(extras) ? extras : []
	const sourceId = String(query?.sourceId || '').trim()
	const value = String(query?.value || '').trim()
	const hostChannel = query?.hostChannel != null ? Number(query.hostChannel) : null
	const routeType = String(query?.routeType || '').trim().toLowerCase()
	return (
		list.find((s) => {
			if (routeType && String(s?.routeType || '').toLowerCase() !== routeType) return false
			if (sourceId && String(s?.sourceId || '') === sourceId) return true
			if (value && String(s?.value || '') === value) return true
			if (hostChannel != null && Number(s?.hostChannel) === hostChannel) return true
			return false
		}) || null
	)
}
