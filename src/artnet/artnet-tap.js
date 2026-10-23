'use strict'

/**
 * WO-632 — every datagram that reaches the box's Art-Net socket (:6454, owned by the lighting input,
 * artnet-udp.js) is published here before that input filters it to its one port-address. Other readers (the
 * follow read-through) subscribe instead of binding :6454 again: a second SO_REUSEADDR socket on Linux takes
 * unicast datagrams away from the first, which would starve the global-border lighting input.
 */

const subs = new Set()
let owners = 0

function publish(msg, rinfo) {
	for (const fn of subs) {
		try {
			fn(msg, rinfo)
		} catch (_) {
			/* a reader never breaks the lighting input */
		}
	}
}

/** @returns {() => void} unsubscribe */
function subscribe(fn) {
	subs.add(fn)
	return () => subs.delete(fn)
}

/** The lighting input's socket opened (+1) / closed (−1); readers bind their own only while there is none. */
function ownerChanged(delta) {
	owners = Math.max(0, owners + delta)
}

const owned = () => owners > 0
const count = () => owners // WO-693: the DMX viewer owns :6454 while nothing else does, and yields when another opens

module.exports = { publish, subscribe, ownerChanged, owned, count }
