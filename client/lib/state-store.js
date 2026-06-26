/**
 * Client-side state store for CasparCG module.
 * Merges full state from WebSocket with incremental change events.
 * @see main_plan.md Prompt 11
 */

import { offlineStorage } from './offline-storage.js'

export class StateStore {
	constructor() {
		this._state = {}
		this._listeners = new Map()
		this._isOffline = false
	}

	setOffline(offline) {
		this._isOffline = !!offline
		this._emit('offline', this._isOffline)
	}

	isOffline() {
		return this._isOffline
	}

	async hydrateFromCache() {
		try {
			const media = await offlineStorage.getSnapshot('media')
			const templates = await offlineStorage.getSnapshot('templates')
			const channelMap = await offlineStorage.getSnapshot('channelMap')
			const mediaProbe = await offlineStorage.getSnapshot('mediaProbe')

			if (media) this._set('media', media)
			if (templates) this._set('templates', templates)
			if (channelMap) this._set('channelMap', channelMap)
			if (mediaProbe) this._set('mediaProbe', mediaProbe)

			console.log('[StateStore] Hydrated from offline cache')
		} catch (e) {
			console.error('[StateStore] Hydration failed:', e)
		}
	}

	on(pathOrKey, fn) {
		const key = pathOrKey
		if (!this._listeners.has(key)) this._listeners.set(key, [])
		this._listeners.get(key).push(fn)
		return () => {
			const fns = this._listeners.get(key)
			if (fns) {
				const i = fns.indexOf(fn)
				if (i >= 0) fns.splice(i, 1)
			}
		}
	}

	_set(path, value) {
		const parts = path.split('.')
		let obj = this._state
		for (let i = 0; i < parts.length - 1; i++) {
			const p = parts[i]
			if (!(p in obj)) obj[p] = {}
			obj = obj[p]
		}
		obj[parts[parts.length - 1]] = value
		this._emit(path, value)

		// Auto-cache important metadata for offline use
		if (!this._isOffline) {
			if (path === 'media') offlineStorage.saveSnapshot('media', value).catch(() => {})
			if (path === 'templates') offlineStorage.saveSnapshot('templates', value).catch(() => {})
			if (path === 'channelMap') offlineStorage.saveSnapshot('channelMap', value).catch(() => {})
			if (path === 'mediaProbe') offlineStorage.saveSnapshot('mediaProbe', value).catch(() => {})
		}
	}

	_get(path) {
		const parts = path.split('.')
		let obj = this._state
		for (const p of parts) {
			if (obj == null) return undefined
			obj = obj[p]
		}
		return obj
	}

	_emit(path, value) {
		const fns = this._listeners.get(path)
		if (fns) fns.forEach((fn) => fn(value))
		const fnsAny = this._listeners.get('*')
		if (fnsAny) fnsAny.forEach((fn) => fn(path, value))
	}

	setState(full) {
		this._state = typeof full === 'object' && full !== null ? { ...full } : {}
		this._emit('*', null)

		// Cache on full state update
		if (!this._isOffline && this._state) {
			if (this._state.media) offlineStorage.saveSnapshot('media', this._state.media).catch(() => {})
			if (this._state.templates) offlineStorage.saveSnapshot('templates', this._state.templates).catch(() => {})
			if (this._state.channelMap) offlineStorage.saveSnapshot('channelMap', this._state.channelMap).catch(() => {})
		}
	}

	applyChange(path, value) {
		this._set(path, value)
	}

	getState() {
		return this._state
	}
}

export default StateStore
