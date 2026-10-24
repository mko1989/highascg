'use strict'

/**
 * WO-731 — Yamaha CL / QL / TF / DM3 / DM7 / RIVAGE PM: the text Remote Control Protocol on TCP 49280, one command per
 * LF-terminated line. The same three parameters on every family (the desks' own `prminfo` dumps):
 *   MIXER:Current/InCh/Fader/Level <ch0> 0   integer dB × 100, -32768 = -∞, max 1000 (+10 dB)
 *   MIXER:Current/InCh/Fader/On    <ch0> 0   1 = on (unmuted), 0 = off
 *   MIXER:Current/InCh/Label/Name  <ch0> 0   quoted string
 * Replies: `OK get <addr> x y <value>`, `OK set <addr> x y <value> "<label>"`, `OKm …` (value clamped), `ERROR …`;
 * `NOTIFY set …` lines (another surface moved something) are ignored. One command in flight at a time: an ERROR line
 * may not repeat the address it answers.
 */

const net = require('net')

const TIMEOUT_MS = 1500
const P = {
	level: 'MIXER:Current/InCh/Fader/Level',
	on: 'MIXER:Current/InCh/Fader/On',
	name: 'MIXER:Current/InCh/Label/Name',
}
const NEG_INF = -32768

/** Split a reply line into tokens; "quoted strings" stay one token without their quotes. */
function tokens(line) {
	const out = []
	const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g
	let m
	while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2])
	return out
}

const levelToDb = (v) => (v <= -13800 ? -Infinity : v / 100)
const dbToLevel = (db) => (!(db > -138) ? NEG_INF : Math.min(1000, Math.round(db * 100)))

function create({ host, port, timeoutMs = TIMEOUT_MS }) {
	let sock = null
	let ready = null
	let buf = ''
	let pending = null // { resolve, reject, timer, what }
	let queue = Promise.resolve()

	function onLine(line) {
		const t = tokens(line)
		if (!pending || !t.length || t[0] === 'NOTIFY') return
		// a late OK for a command that already timed out names another verb / address: not ours
		if ((t[0] === 'OK' || t[0] === 'OKm') && (t[1] !== pending.verb || t[2] !== pending.addr)) return
		if (t[0] === 'OK' || t[0] === 'OKm' || t[0] === 'ERROR') {
			const p = pending
			pending = null
			clearTimeout(p.timer)
			if (t[0] === 'ERROR') p.reject(new Error(`the desk refused ${p.what}: ${t.slice(1).join(' ')}`))
			else p.resolve(t)
		}
	}

	function connect() {
		if (ready) return ready
		ready = new Promise((resolve, reject) => {
			const s = net.createConnection({ host, port })
			const t = setTimeout(
				() => s.destroy(new Error(`the desk at ${host}:${port} did not accept a connection`)),
				timeoutMs
			)
			s.setNoDelay(true)
			s.on('connect', () => {
				clearTimeout(t)
				sock = s
				resolve(s)
			})
			s.on('data', (d) => {
				buf += d.toString('utf8')
				let i
				while ((i = buf.indexOf('\n')) >= 0) {
					onLine(buf.slice(0, i).replace(/\r$/, ''))
					buf = buf.slice(i + 1)
				}
			})
			s.on('error', (e) => {
				clearTimeout(t)
				reject(e)
			})
			s.on('close', () => {
				sock = null
				ready = null
				buf = ''
			})
		})
		ready.catch(() => {
			ready = null
		})
		return ready
	}

	/** One command line → the reply's tokens (one at a time). */
	function command(line) {
		const job = queue.then(async () => {
			const s = await connect()
			return new Promise((resolve, reject) => {
				const [verb, addr] = line.split(' ')
				pending = {
					resolve,
					reject,
					verb,
					addr,
					what: line,
					timer: setTimeout(
						() => ((pending = null), reject(new Error(`no answer from the desk at ${host}:${port} (${line})`))),
						timeoutMs
					),
				}
				s.write(line + '\n')
			})
		})
		queue = job.catch(() => {})
		return job
	}

	/** `get <addr> x 0` → the value token (the one after x y). */
	const get = async (addr, ch0) => (await command(`get ${addr} ${ch0} 0`))[5]

	return {
		async probe() {
			const t = await command('devinfo productname')
			return t[t.length - 1]
		},
		async getChannel(n) {
			const level = Number(await get(P.level, n - 1))
			const on = Number(await get(P.on, n - 1))
			return { on: on === 1, db: levelToDb(level) }
		},
		async setOn(n, on) {
			await command(`set ${P.on} ${n - 1} 0 ${on ? 1 : 0}`)
		},
		async setDb(n, db) {
			await command(`set ${P.level} ${n - 1} 0 ${dbToLevel(db)}`)
		},
		async names(count) {
			const out = []
			for (let n = 1; n <= count; n++) out.push({ channel: n, name: String((await get(P.name, n - 1)) ?? '') })
			return out
		},
		close() {
			if (sock) sock.destroy()
			sock = null
			ready = null
		},
	}
}

module.exports = { create, tokens, levelToDb, dbToLevel }
