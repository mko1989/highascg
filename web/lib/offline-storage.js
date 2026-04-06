/**
 * @file offline-storage.js
 * Browser-side persistence for media/template metadata snapshots.
 */

const DB_NAME = 'HighAsCG_Offline'
const DB_VERSION = 1
const STORE_NAME = 'Snapshots'

export const offlineStorage = {
	_db: null,

	async _getDb() {
		if (this._db) return this._db
		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION)
			request.onupgradeneeded = (e) => {
				const db = e.target.result
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME)
				}
			}
			request.onsuccess = (e) => {
				this._db = e.target.result
				resolve(this._db)
			}
			request.onerror = (e) => reject(e.target.error)
		})
	},

	/**
	 * Save a snapshot of a specific category (e.g., 'media', 'templates')
	 */
	async saveSnapshot(key, data) {
		const db = await this._getDb()
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite')
			const store = tx.objectStore(STORE_NAME)
			store.put(data, key)
			tx.oncomplete = () => resolve()
			tx.onerror = (e) => reject(e.target.error)
		})
	},

	/**
	 * Retrieve a snapshot
	 */
	async getSnapshot(key) {
		const db = await this._getDb()
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readonly')
			const store = tx.objectStore(STORE_NAME)
			const request = store.get(key)
			request.onsuccess = () => resolve(request.result)
			request.onerror = (e) => reject(e.target.error)
		})
	},

	/**
	 * Clear all cached metadata
	 */
	async clear() {
		const db = await this._getDb()
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, 'readwrite')
			const store = tx.objectStore(STORE_NAME)
			store.clear()
			tx.oncomplete = () => resolve()
			tx.onerror = (e) => reject(e.target.error)
		})
	}
}
