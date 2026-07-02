'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { syncNuclearPasswordVisibility, getNuclearPasswordFromModal } = require('../../client/lib/settings-nuclear-shared.js')
const { checkNuclearPassword } = require('../../src/api/routes-system-setup')
const { hashNuclearPassword } = require('../../src/utils/nuclear-password')

function mockModal({ requirePassword = false, nuclearPassword = '' } = {}) {
	const fields = { style: { display: '' } }
	const requirePass = { checked: requirePassword }
	const nuclearPass = { value: nuclearPassword }
	return {
		querySelector(sel) {
			if (sel === '#set-nuclear-require-pass') return requirePass
			if (sel === '#set-nuclear-password-fields') return fields
			if (sel === '#set-nuclear-password') return nuclearPass
			return null
		},
		_fields: fields,
		_requirePass: requirePass,
		_nuclearPass: nuclearPass,
	}
}

test('syncNuclearPasswordVisibility hides nuclear password when protection off', () => {
	const modal = mockModal({ requirePassword: false })
	syncNuclearPasswordVisibility(modal)
	assert.equal(modal._fields.style.display, 'none')
})

test('syncNuclearPasswordVisibility shows nuclear password when protection on', () => {
	const modal = mockModal({ requirePassword: true })
	syncNuclearPasswordVisibility(modal)
	assert.equal(modal._fields.style.display, '')
})

test('getNuclearPasswordFromModal reads unified password field', () => {
	const modal = mockModal({ nuclearPassword: 'hunter2' })
	assert.equal(getNuclearPasswordFromModal(modal), 'hunter2')
})

test('checkNuclearPassword allows actions when protection disabled', () => {
	const ctx = { config: { ui: { nuclearRequirePassword: false, nuclearPassword: 'secret' } } }
	assert.deepEqual(checkNuclearPassword({}, ctx), { ok: true })
	assert.deepEqual(checkNuclearPassword({ password: 'wrong' }, ctx), { ok: true })
})

test('checkNuclearPassword rejects missing configured password', () => {
	const ctx = { config: { ui: { nuclearRequirePassword: true, nuclearPassword: '' } } }
	const r = checkNuclearPassword({ password: '' }, ctx)
	assert.equal(r.ok, false)
	assert.equal(r.status, 403)
	assert.match(r.error, /not configured/)
})

test('checkNuclearPassword rejects wrong password', () => {
	const hash = hashNuclearPassword('hunter2')
	const ctx = {
		config: { ui: { nuclearRequirePassword: true, nuclearPassword: '', nuclearPasswordHash: hash } },
	}
	const r = checkNuclearPassword({ password: 'wrong' }, ctx)
	assert.equal(r.ok, false)
	assert.equal(r.status, 403)
	assert.match(r.error, /Invalid password/)
})

test('checkNuclearPassword accepts matching password (scrypt hash)', () => {
	const hash = hashNuclearPassword('hunter2')
	const ctx = {
		config: { ui: { nuclearRequirePassword: true, nuclearPassword: '', nuclearPasswordHash: hash } },
	}
	assert.deepEqual(checkNuclearPassword({ password: 'hunter2' }, ctx), { ok: true })
})

test('checkNuclearPassword accepts legacy plaintext until migrated', () => {
	const ctx = { config: { ui: { nuclearRequirePassword: true, nuclearPassword: 'hunter2' } } }
	assert.deepEqual(checkNuclearPassword({ password: 'hunter2' }, ctx), { ok: true })
})
