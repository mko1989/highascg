'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')

const DEVICE_IDENTITY_PATH = path.join(REPO_ROOT, 'config', 'device-identity.json')

/** @type {{ publicKeyPem: string, privateKeyPem: string, createdAt: string } | null} */
let _cached = null

/**
 * @returns {{ publicKeyPem: string, privateKeyPem: string, createdAt?: string } | null}
 */
function readDeviceIdentityFile() {
	try {
		if (!fs.existsSync(DEVICE_IDENTITY_PATH)) return null
		const raw = JSON.parse(fs.readFileSync(DEVICE_IDENTITY_PATH, 'utf8'))
		const publicKeyPem = String(raw?.publicKeyPem || '').trim()
		const privateKeyPem = String(raw?.privateKeyPem || '').trim()
		if (!publicKeyPem || !privateKeyPem) return null
		return { publicKeyPem, privateKeyPem, createdAt: raw?.createdAt }
	} catch {
		return null
	}
}

/**
 * @param {{ publicKeyPem: string, privateKeyPem: string, createdAt?: string }} identity
 */
function writeDeviceIdentityFile(identity) {
	fs.mkdirSync(path.dirname(DEVICE_IDENTITY_PATH), { recursive: true })
	fs.writeFileSync(
		DEVICE_IDENTITY_PATH,
		JSON.stringify(
			{
				publicKeyPem: identity.publicKeyPem,
				privateKeyPem: identity.privateKeyPem,
				createdAt: identity.createdAt || new Date().toISOString(),
			},
			null,
			2,
		),
		'utf8',
	)
	_cached = {
		publicKeyPem: identity.publicKeyPem,
		privateKeyPem: identity.privateKeyPem,
		createdAt: identity.createdAt || new Date().toISOString(),
	}
}

/**
 * @returns {{ publicKeyPem: string, privateKeyPem: string, createdAt: string }}
 */
function ensureDeviceIdentity() {
	if (_cached) return _cached
	const file = readDeviceIdentityFile()
	if (file?.publicKeyPem && file?.privateKeyPem) {
		_cached = {
			publicKeyPem: file.publicKeyPem,
			privateKeyPem: file.privateKeyPem,
			createdAt: file.createdAt || new Date().toISOString(),
		}
		return _cached
	}
	const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
	const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
	const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
	const identity = { publicKeyPem, privateKeyPem, createdAt: new Date().toISOString() }
	writeDeviceIdentityFile(identity)
	return _cached
}

/**
 * @returns {string}
 */
function getDevicePublicKeyPem() {
	return ensureDeviceIdentity().publicKeyPem
}

/**
 * @param {string} message
 * @returns {string}
 */
function signMessage(message) {
	const { privateKeyPem } = ensureDeviceIdentity()
	const key = crypto.createPrivateKey(privateKeyPem)
	return crypto.sign(null, Buffer.from(message, 'utf8'), key).toString('base64')
}

/**
 * @param {string} publicKeyPem
 * @param {string} message
 * @param {string} signatureB64
 * @returns {boolean}
 */
function verifyMessage(publicKeyPem, message, signatureB64) {
	try {
		const key = crypto.createPublicKey(String(publicKeyPem || '').trim())
		const sig = Buffer.from(String(signatureB64 || '').trim(), 'base64')
		if (!sig.length) return false
		return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig)
	} catch {
		return false
	}
}

module.exports = {
	DEVICE_IDENTITY_PATH,
	readDeviceIdentityFile,
	ensureDeviceIdentity,
	getDevicePublicKeyPem,
	signMessage,
	verifyMessage,
}
