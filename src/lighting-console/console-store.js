'use strict'

/**
 * WO-837 — the lighting consoles HighAsCG talks to (Devices tab), kept in ~/.highascg/lighting-consoles.json (outside the
 * repo, so Syncthing never fights it; desk-store.js pattern). HIGHASCG_LIGHTING_CONSOLES_FILE overrides the path; under
 * the Node test runner the default is a private temp dir per process.
 * Record: { id, name, kind, host, port } + `prefix` (grandma3, optional OSC prefix) / `templates` (osc: per-action
 * address templates, see drivers/osc-generic.js).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { underTestRunner } = require('../engine/projects-root')
const { KINDS } = require('./console-models')
const { KEYS: TEMPLATE_KEYS } = require('./drivers/osc-generic')

const HOST_RE = /^[A-Za-z0-9.:-]{1,253}$/
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const PREFIX_RE = /^[A-Za-z0-9_-]{0,32}$/
// eslint-disable-next-line no-control-regex
const ADDR_RE = /^\/[^\s\u0000-\u001f]{0,199}$/
const MAX_CONSOLES = 16

let _testDir = null

function consolesFile() {
	if (process.env.HIGHASCG_LIGHTING_CONSOLES_FILE) return path.resolve(process.env.HIGHASCG_LIGHTING_CONSOLES_FILE)
	if (underTestRunner()) {
		if (!_testDir) _testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-lighting-'))
		return path.join(_testDir, 'lighting-consoles.json')
	}
	return path.join(os.homedir(), '.highascg', 'lighting-consoles.json')
}

const bad = (error) => ({ ok: false, error })

function validateTemplates(src) {
	if (!src || typeof src !== 'object' || Array.isArray(src)) return bad('templates must be an object')
	const out = {}
	for (const [k, t] of Object.entries(src)) {
		if (!TEMPLATE_KEYS.includes(k)) return bad(`templates.${k}: unknown action (${TEMPLATE_KEYS.join(', ')})`)
		if (!t || typeof t !== 'object' || typeof t.address !== 'string' || !ADDR_RE.test(t.address)) {
			return bad(`templates.${k}.address must be an OSC address starting with /`)
		}
		const args = t.args == null ? [] : t.args
		if (!Array.isArray(args) || args.length > 8) return bad(`templates.${k}.args must be a list of at most 8`)
		for (const a of args) {
			const ok = (typeof a === 'number' && Number.isFinite(a)) || (typeof a === 'string' && a.length <= 200)
			if (!ok) return bad(`templates.${k}.args holds a number or text only`)
		}
		out[k] = { address: t.address, args }
	}
	return { ok: true, templates: out }
}

/**
 * Strict check of one console record.
 * @param {any} src @param {{ makeId?: () => string }} [opts] makeId supplies an id when `src.id` is absent
 * @returns {{ ok: true, console: object } | { ok: false, error: string }}
 */
function validateConsole(src, opts = {}) {
	if (!src || typeof src !== 'object' || Array.isArray(src)) return bad('console must be an object')
	const id = src.id == null || src.id === '' ? opts.makeId?.() : src.id
	if (typeof id !== 'string' || !ID_RE.test(id)) return bad('id must be 1–32 characters: a-z 0-9 _ - (starting with a letter or digit)')
	const name = typeof src.name === 'string' ? src.name.trim() : ''
	// eslint-disable-next-line no-control-regex
	if (!name || name.length > 40 || /[\u0000-\u001f]/.test(name)) return bad('name must be 1–40 characters')
	const kind = KINDS[src.kind] ? src.kind : null
	if (!kind) return bad(`kind must be one of ${Object.keys(KINDS).join(', ')}`)
	const host = typeof src.host === 'string' ? src.host.trim() : ''
	if (!HOST_RE.test(host)) return bad('host must be an IP address or host name')
	let port = src.port
	if (port == null || port === '') port = KINDS[kind].port
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		return bad(kind === 'osc' && !KINDS[kind].port ? 'port is required for a generic OSC console (1–65535)' : 'port must be 1–65535')
	}
	const out = { id, name, kind, host, port }
	if (src.prefix != null && src.prefix !== '') {
		if (kind !== 'grandma3') return bad('prefix is only for grandMA3 consoles')
		if (typeof src.prefix !== 'string' || !PREFIX_RE.test(src.prefix)) return bad('prefix must be letters, digits, _ or - (no slashes)')
		out.prefix = src.prefix
	}
	if (src.templates != null) {
		if (kind !== 'osc') return bad('templates are only for generic OSC consoles')
		const t = validateTemplates(src.templates)
		if (!t.ok) return t
		out.templates = t.templates
	}
	return { ok: true, console: out }
}

function loadConsoles(file = consolesFile()) {
	try {
		const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
		const out = []
		for (const c of Array.isArray(raw?.consoles) ? raw.consoles : []) {
			const v = validateConsole(c)
			if (v.ok && !out.some((o) => o.id === v.console.id)) out.push(v.console)
		}
		return out.slice(0, MAX_CONSOLES)
	} catch {
		return []
	}
}

/** Atomic write (tmp + rename). → true, or false when the disk refused it. */
function saveConsoles(consoles, file = consolesFile()) {
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true })
		const tmp = `${file}.${process.pid}.tmp`
		fs.writeFileSync(tmp, JSON.stringify({ version: 1, consoles }, null, '\t') + '\n')
		fs.renameSync(tmp, file)
		return true
	} catch {
		return false
	}
}

module.exports = { consolesFile, validateConsole, loadConsoles, saveConsoles, MAX_CONSOLES }
