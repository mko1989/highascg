'use strict'

/**
 * WO-616 T11 — in-process "the active project changed" signal for server consumers that keep a derived copy
 * (the follow → Art-Net engine reads `project.fixtures`). Emitted by scheduleProjectSyncBroadcast, which every
 * write path already calls with the stamped project (autosave, save, activate, replication, media links …),
 * so a consumer never re-reads the disk on a timer. Listener errors are contained.
 */
const { EventEmitter } = require('events')

const bus = new EventEmitter()
bus.setMaxListeners(20)

/** @param {(project: object) => void} fn @returns {() => void} unsubscribe */
function onProjectChanged(fn) {
	bus.on('changed', fn)
	return () => bus.off('changed', fn)
}

function emitProjectChanged(project) {
	if (!project || typeof project !== 'object') return
	for (const fn of bus.listeners('changed')) {
		try {
			fn(project)
		} catch (e) {
			console.warn('[project-events] listener failed: ' + (e?.message || e))
		}
	}
}

module.exports = { onProjectChanged, emitProjectChanged }
