'use strict'

const crypto = require('crypto')

const PREFIX = 'scrypt$'
const REDACTED_PLACEHOLDER = '[REDACTED]'
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

function isNuclearPasswordHash(value) {
	return typeof value === 'string' && value.startsWith(PREFIX)
}

/**
 * @param {string} plaintext
 * @returns {string}
 */
function hashNuclearPassword(plaintext) {
	const pwd = String(plaintext || '')
	if (!pwd) return ''
	const salt = crypto.randomBytes(16)
	const hash = crypto.scryptSync(pwd, salt, 32, SCRYPT_PARAMS)
	return `${PREFIX}${salt.toString('hex')}$${hash.toString('hex')}`
}

/**
 * @param {string} provided
 * @param {string} storedHash
 */
function verifyNuclearPassword(provided, storedHash) {
	if (!storedHash || !isNuclearPasswordHash(storedHash)) return false
	const body = storedHash.slice(PREFIX.length)
	const sep = body.indexOf('$')
	if (sep <= 0) return false
	const saltHex = body.slice(0, sep)
	const keyHex = body.slice(sep + 1)
	// WO-830b: an empty or undecodable stored hash (`scrypt$ab$`, `scrypt$$zz`) decoded to a 0-byte key, and
	// two 0-byte buffers compare equal — ANY password passed. Fail closed on anything that is not a real hash.
	if (!/^(?:[0-9a-fA-F]{2}){8,}$/.test(saltHex) || !/^(?:[0-9a-fA-F]{2}){16,}$/.test(keyHex)) return false
	const salt = Buffer.from(saltHex, 'hex')
	const expected = Buffer.from(keyHex, 'hex')
	if (salt.length < 8 || expected.length < 16) return false
	let derived
	try {
		derived = crypto.scryptSync(String(provided || ''), salt, expected.length, SCRYPT_PARAMS)
	} catch {
		return false
	}
	if (derived.length !== expected.length) return false
	return crypto.timingSafeEqual(derived, expected)
}

function secureComparePlain(a, b) {
	const left = Buffer.from(String(a || ''), 'utf8')
	const right = Buffer.from(String(b || ''), 'utf8')
	if (left.length !== right.length) return false
	return crypto.timingSafeEqual(left, right)
}

/**
 * @param {string} provided
 * @param {Record<string, unknown>} ui
 */
function verifyNuclearPasswordFromUi(provided, ui) {
	const hash = String(ui?.nuclearPasswordHash || '')
	if (hash) return verifyNuclearPassword(provided, hash)
	const legacy = String(ui?.nuclearPassword || '')
	if (!legacy) return false
	return secureComparePlain(provided, legacy)
}

/**
 * @param {Record<string, unknown>} ui
 */
function hasConfiguredNuclearPassword(ui) {
	return !!(
		String(ui?.nuclearPasswordHash || '').trim() ||
		String(ui?.nuclearPassword || '').trim()
	)
}

/**
 * Migrate legacy plaintext `ui.nuclearPassword` to `ui.nuclearPasswordHash`.
 * @param {Record<string, unknown>} ui
 */
function migrateUiNuclearPassword(ui) {
	const next = { ...(ui || {}) }
	let changed = false
	const plain = String(next.nuclearPassword || '').trim()
	if (plain && plain !== REDACTED_PLACEHOLDER && !isNuclearPasswordHash(plain)) {
		next.nuclearPasswordHash = hashNuclearPassword(plain)
		next.nuclearPassword = ''
		changed = true
	}
	if (next.nuclearPasswordHash && next.nuclearPassword) {
		next.nuclearPassword = ''
		changed = true
	}
	return { ui: next, changed }
}

/**
 * @param {Record<string, unknown>} incoming merged ui from settings POST
 * @param {Record<string, unknown>} previous persisted ui
 */
function mergeUiNuclearPasswordSettings(incoming, previous) {
	const next = { ...incoming }
	const pwd = String(next.nuclearPassword ?? '')
	if (pwd === REDACTED_PLACEHOLDER) {
		next.nuclearPassword = ''
		if (previous?.nuclearPasswordHash) next.nuclearPasswordHash = previous.nuclearPasswordHash
	} else if (pwd === '') {
		next.nuclearPassword = ''
		if (next.nuclearRequirePassword === true || next.nuclearRequirePassword === 'true') {
			if (previous?.nuclearPasswordHash) next.nuclearPasswordHash = previous.nuclearPasswordHash
		} else {
			next.nuclearPasswordHash = ''
		}
	} else {
		next.nuclearPasswordHash = hashNuclearPassword(pwd)
		next.nuclearPassword = ''
	}
	return next
}

module.exports = {
	REDACTED_PLACEHOLDER,
	isNuclearPasswordHash,
	hashNuclearPassword,
	verifyNuclearPassword,
	verifyNuclearPasswordFromUi,
	hasConfiguredNuclearPassword,
	migrateUiNuclearPassword,
	mergeUiNuclearPasswordSettings,
}
