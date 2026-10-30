'use strict'

/**
 * WO-837 — the lighting consoles a timeline `light` flag can drive, and their drivers (drivers/*). A driver is a pure
 * message builder — `messages(console, action)` and `testMessages(console)` return OSC messages, console-service.js
 * sends them — so the exact wire bytes are testable without a console. Wire formats and sources: see each driver.
 */

const KINDS = {
	magicq: { label: 'ChamSys MagicQ (OSC)', port: 8000, driver: () => require('./drivers/magicq') },
	eos: { label: 'ETC Eos (OSC)', port: 8000, driver: () => require('./drivers/eos') },
	grandma3: { label: 'MA Lighting grandMA3 (OSC)', port: 8000, driver: () => require('./drivers/grandma3') },
	osc: { label: 'Generic OSC (address templates)', port: 0, driver: () => require('./drivers/osc-generic') },
}

/** @param {string} kind a KINDS key */
function driverFor(kind) {
	const k = KINDS[kind]
	if (!k) throw new Error(`unknown lighting console kind ${JSON.stringify(kind)}`)
	return k.driver()
}

module.exports = { KINDS, driverFor }
