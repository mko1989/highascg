/**
 * V4L2 / USB video input API hydration for sources panel.
 */
import { api } from './api-client.js'

/**
 * @param {import('./state-store.js').StateStore} stateStore
 */
export async function refreshV4l2Configured(stateStore) {
	try {
		const payload = await api.get('/api/v4l2-inputs')
		if (payload && typeof payload === 'object') {
			stateStore.applyChange('v4l2Configured', payload)
			if (payload.status != null) {
				stateStore.applyChange('v4l2InputsStatus', payload.status)
			}
			document.dispatchEvent(new CustomEvent('highascg-v4l2-configured', { detail: payload }))
		}
		return payload
	} catch {
		return null
	}
}
