/**
 * Shared live-audio API hydration for mixer + sources panels.
 */
import { api } from './api-client.js'

/**
 * @param {import('./state-store.js').StateStore} stateStore
 */
export async function refreshLiveAudioConfigured(stateStore) {
	try {
		const payload = await api.get('/api/audio/live-inputs')
		if (payload && typeof payload === 'object') {
			stateStore.applyChange('liveAudioConfigured', payload)
			document.dispatchEvent(new CustomEvent('highascg-live-audio-configured', { detail: payload }))
		}
		return payload
	} catch {
		return null
	}
}
