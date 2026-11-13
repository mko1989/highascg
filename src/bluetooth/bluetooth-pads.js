'use strict'

/**
 * WO-1066 — Bluetooth game controllers (the game window's players, WO-1065), through BlueZ's `bluetoothctl`:
 * what the adapter knows, a timed scan, pair + trust + connect in one step, disconnect, forget.
 *
 * Only controllers are listed: a scan in a venue returns every phone and beacon in range, and the pane is for
 * gamepads. A device counts when BlueZ calls it one (Icon `input-gaming`) or its name says so; paired input devices
 * stay listed whatever their name.
 */

const { execFile, spawn } = require('node:child_process')

const ADDR_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/
const PAD_NAME_RE = /controller|gamepad|dualshock|dualsense|joy-?con|xbox|8bitdo|stadia|pro con/i
const SCAN_MAX_S = 60

function run(args, timeoutMs = 8000) {
	return new Promise((resolve) => {
		execFile('bluetoothctl', args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
			resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, missing: err?.code === 'ENOENT', out: String(stdout || ''), err: String(stderr || '') })
		})
	})
}

const normAddr = (v) => String(v || '').trim().toUpperCase()
const field = (text, key) => (text.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm')) || [])[1]?.trim() ?? ''
const yes = (text, key) => field(text, key) === 'yes'

/** `bluetoothctl devices` → [{ address, name }] (a device with no name is listed under its address with dashes). */
function parseDevices(out) {
	const list = []
	for (const line of String(out || '').split('\n')) {
		const m = line.match(/^Device\s+([0-9A-Fa-f:]{17})\s*(.*)$/)
		if (m) list.push({ address: m[1].toUpperCase(), name: m[2].trim() })
	}
	return list
}

/** `bluetoothctl info <addr>` → the fields the pane shows. */
function parseInfo(out, base) {
	const text = String(out || '')
	const name = field(text, 'Name') || field(text, 'Alias') || base.name
	const icon = field(text, 'Icon')
	const paired = yes(text, 'Paired')
	// device class: major 0x05 = peripheral, minor (bits 2-5) 1 = joystick, 2 = gamepad
	const cls = parseInt((field(text, 'Class').match(/0x[0-9a-fA-F]+/) || ['0'])[0], 16) || 0
	const padClass = ((cls >> 8) & 0x1f) === 5 && [1, 2].includes((cls >> 2) & 0xf)
	return {
		address: base.address,
		name,
		paired,
		trusted: yes(text, 'Trusted'),
		connected: yes(text, 'Connected'),
		gamepad: icon === 'input-gaming' || padClass || PAD_NAME_RE.test(name) || (paired && icon.startsWith('input-')),
		hasClass: cls > 0,
	}
}

const unnamed = (d) => !d.name || d.name.replace(/-/g, ':').toUpperCase() === d.address

/**
 * @param {{ run?: typeof run, spawn?: typeof spawn, now?: () => number }} [deps]
 */
function createBluetoothPads(deps = {}) {
	const exec = deps.run || run
	const now = deps.now || Date.now
	let scan = null // { child, until }

	const scanning = () => !!scan && now() < scan.until

	/** @param {{ all?: boolean }} [opts] all: every device the adapter knows that has a name or a device class */
	async function status(opts = {}) {
		const show = await exec(['show'])
		if (show.missing) return { ok: true, available: false, reason: 'bluetoothctl is not installed (sudo apt install bluez)', powered: false, scanning: false, devices: [] }
		if (!show.ok || !/^Controller\s/m.test(show.out)) {
			return { ok: true, available: false, reason: (show.err || show.out).trim().split('\n')[0] || 'no Bluetooth adapter', powered: false, scanning: false, devices: [] }
		}
		const powered = yes(show.out, 'Powered')
		const known = parseDevices((await exec(['devices'])).out)
		const devices = []
		/* Named devices first: a controller found a moment ago may have no name yet (classic Bluetooth gives the address
		 * and the device class first, the name later) — its class still says "gamepad", so nameless ones are asked too.
		 * (An off-brand PS4 pad was missed by a name-only list, box 13.11.) */
		const ordered = [...known.filter((x) => !unnamed(x)), ...known.filter(unnamed)].slice(0, 60)
		for (const d of ordered) {
			const info = parseInfo((await exec(['info', d.address])).out, d)
			if (info.gamepad || (opts.all && (info.paired || info.hasClass || !unnamed(info)))) devices.push(info)
		}
		devices.sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired) || a.name.localeCompare(b.name))
		return { ok: true, available: true, powered, scanning: scanning(), devices }
	}

	/** A timed discovery; bluetoothd forgets unpaired devices soon after it ends, so pairing happens while it runs. */
	function startScan(seconds = 30) {
		const s = Math.max(5, Math.min(SCAN_MAX_S, Math.round(Number(seconds) || 30)))
		if (scanning()) return { ok: true, scanning: true, seconds: Math.ceil((scan.until - now()) / 1000) }
		const child = (deps.spawn || spawn)('bluetoothctl', ['--timeout', String(s), 'scan', 'on'], { stdio: 'ignore' })
		const mine = { child, until: now() + s * 1000 }
		scan = mine
		const done = () => {
			if (scan === mine) scan = null
		}
		child.on?.('exit', done)
		child.on?.('error', done)
		return { ok: true, scanning: true, seconds: s }
	}

	function stopScan() {
		try {
			scan?.child?.kill?.('SIGTERM')
		} catch {
			/* gone */
		}
		scan = null
	}

	const fail = (step, r) => ({ ok: false, step, error: (r.err || r.out).trim().split('\n').filter(Boolean).pop() || `${step} failed` })

	/** Pair (a controller needs no PIN), trust (so its PS / Home button reconnects it) and connect. */
	async function pair(address) {
		const a = normAddr(address)
		if (!ADDR_RE.test(a)) return { ok: false, step: 'address', error: 'not a Bluetooth address' }
		const info = await exec(['info', a])
		if (!info.ok || /not available/i.test(info.out + info.err)) return { ok: false, step: 'find', error: 'The controller is not in range — put it in pairing mode and scan again.' }
		if (!yes(info.out, 'Paired')) {
			const p = await exec(['pair', a], 30000)
			if (!p.ok && !/AlreadyExists/i.test(p.out + p.err)) return fail('pair', p)
		}
		const t = await exec(['trust', a])
		if (!t.ok) return fail('trust', t)
		const c = await exec(['connect', a], 20000)
		// a controller often connects by itself right after pairing: "already connected" is success
		if (!c.ok && !/already|Connected: yes/i.test(c.out + c.err) && !yes((await exec(['info', a])).out, 'Connected')) return fail('connect', c)
		return { ok: true, address: a }
	}

	async function simple(verb, address, timeoutMs) {
		const a = normAddr(address)
		if (!ADDR_RE.test(a)) return { ok: false, step: 'address', error: 'not a Bluetooth address' }
		const r = await exec([verb, a], timeoutMs)
		return r.ok ? { ok: true, address: a } : fail(verb, r)
	}

	async function power(on) {
		const r = await exec(['power', on ? 'on' : 'off'])
		return r.ok ? { ok: true } : fail('power', r)
	}

	return {
		status,
		startScan,
		stopScan,
		pair,
		connect: (a) => simple('connect', a, 20000),
		disconnect: (a) => simple('disconnect', a, 10000),
		forget: (a) => simple('remove', a, 10000),
		power,
	}
}

module.exports = { createBluetoothPads, parseDevices, parseInfo, ADDR_RE }
