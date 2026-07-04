/**
 * Virtual camera (v4l2 loopback) status for Device View.
 */
import { api } from './api-client.js'

/** @type {object | null} */
let status = null
/** @type {Set<(st: object | null) => void>} */
const listeners = new Set()

function notify() {
	for (const fn of listeners) {
		try {
			fn(status)
		} catch (e) {
			console.warn('[virtual-camera-state]', e)
		}
	}
}

export function getVirtualCameraStatus() {
	return status
}

/**
 * @param {(st: object | null) => void} fn
 * @returns {() => void}
 */
export function subscribeVirtualCameraStatus(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}

export async function refreshVirtualCameraStatus() {
	try {
		const payload = await api.get('/api/virtual-camera/status')
		if (payload && typeof payload === 'object') {
			status = payload
			notify()
			document.dispatchEvent(new CustomEvent('highascg-virtual-camera-status', { detail: payload }))
		}
		return payload
	} catch {
		return null
	}
}

/**
 * @param {import('./state-store.js').StateStore} stateStore
 */
export function applyVirtualCameraStatusFromState(stateStore) {
	const st = stateStore?.get?.()?.virtualCameraStatus
	if (st && typeof st === 'object') {
		status = st
		notify()
	}
}

/**
 * @param {object} patch
 * @param {{ persist?: boolean }} [opts]
 */
export async function saveVirtualCameraConfig(patch, opts = {}) {
	const body = { ...(patch || {}), persist: !!opts.persist }
	return api.post('/api/virtual-camera/config', body)
}

/**
 * @param {object} [patch]
 * @param {{ persist?: boolean }} [opts]
 */
export async function startVirtualCamera(patch, opts = {}) {
	const body = { ...(patch || {}), persist: !!opts.persist }
	const payload = await api.post('/api/virtual-camera/start', body)
	if (payload && typeof payload === 'object') {
		status = payload
		notify()
	}
	return payload
}

export async function stopVirtualCamera(opts = {}) {
	const payload = await api.post('/api/virtual-camera/stop', { persist: !!opts.persist })
	if (payload && typeof payload === 'object') {
		status = payload
		notify()
	}
	return payload
}
