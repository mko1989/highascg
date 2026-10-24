'use strict'

/**
 * WO-731 — the desk drivers against emulated desks on 127.0.0.1, built from the protocol documents (see the WO):
 * X32 and WING (OSC/UDP), Yamaha RCP (text/TCP), dLive and SQ (MIDI/TCP). Each emulator keeps channel state, answers
 * queries the way the document shows, does not echo sets, and records what reached it, so the wire bytes are checked
 * against the documents' worked examples. Accept runs end to end through each driver.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const net = require('node:net')
const osc = require('osc')
const { acceptChannel } = require('../../src/audio-desk/desk-service')
const { createDriver } = require('../../src/audio-desk/desk-models')
const { createMidiParser } = require('../../src/audio-desk/drivers/midi-tcp')
const { tokens } = require('../../src/audio-desk/drivers/yamaha-rcp')

const closers = []
after(() => closers.forEach((c) => c()))
const hex = (bytes) => Buffer.from(bytes).toString('hex').replace(/(..)/g, '$1 ').trim().toUpperCase()

/** OSC desk on UDP: `answer(msg)` → reply args or null; sets go to `onSet`. */
async function oscDesk(answer) {
	const sock = dgram.createSocket('udp4')
	const got = []
	sock.on('message', (buf, rinfo) => {
		const m = osc.readPacket(buf, { metadata: true })
		got.push(m)
		const args = answer(m)
		if (args) sock.send(Buffer.from(osc.writePacket({ address: m.address, args })), rinfo.port, rinfo.address)
	})
	await new Promise((r) => sock.bind(0, '127.0.0.1', r))
	closers.push(() => sock.close())
	return { port: sock.address().port, got }
}

/** Split a MIDI byte stream into whole messages: SysEx to F7, else `size(bytes)` bytes (TCP coalesces writes). */
function midiSplitter(size, onMessage) {
	let buf = []
	return (c, d) => {
		buf.push(...d)
		for (;;) {
			const n = buf[0] === 0xf0 ? buf.indexOf(0xf7) + 1 : size(buf)
			if (!n || n > buf.length) return
			onMessage(c, Buffer.from(buf.splice(0, n)))
		}
	}
}

async function tcpDesk(onData) {
	const conns = []
	const srv = net.createServer((c) => {
		conns.push(c)
		c.on('data', (d) => onData(c, d))
	})
	await new Promise((r) => srv.listen(0, '127.0.0.1', r))
	closers.push(() => (conns.forEach((c) => c.destroy()), srv.close()))
	return srv.address().port
}

describe('WO-731 Behringer X32 (OSC, 4-segment fader law)', () => {
	it('reads, unmutes and raises a low fader; names; /info', async () => {
		const st = { '/ch/05/mix/fader': 0.25, '/ch/05/mix/on': 0, '/ch/05/config/name': 'Lav 5' } // -30 dB, muted
		const desk = await oscDesk((m) => {
			if (m.address === '/info') return ['V2.05', 'osc-server', 'X32C', '2.08'].map((value) => ({ type: 's', value }))
			if (!m.args.length && m.address.endsWith('/config/name')) return [{ type: 's', value: st[m.address] ?? '' }]
			if (!m.args.length)
				return st[m.address] === undefined
					? null
					: [{ type: typeof st[m.address] === 'string' ? 's' : m.address.endsWith('/on') ? 'i' : 'f', value: st[m.address] }]
			st[m.address] = m.args[0].value
			return null // no echo
		})
		const d = createDriver('x32', { host: '127.0.0.1', port: desk.port })
		closers.push(() => d.close())
		assert.equal(await d.probe(), 'X32C · firmware 2.08')
		const r = await acceptChannel(d, 5, 0)
		assert.equal(r.ok, true, r.error)
		assert.deepEqual(r.did, ['unmuted', 'fader -30 → 0 dB'])
		assert.equal(st['/ch/05/mix/on'], 1)
		assert.equal(st['/ch/05/mix/fader'], 0.75)
		const sets = desk.got.filter((m) => m.args.length).map((m) => `${m.address} ,${m.args[0].type} ${m.args[0].value}`)
		assert.deepEqual(sets, ['/ch/05/mix/on ,i 1', '/ch/05/mix/fader ,f 0.75'])
		assert.deepEqual((await d.names(5))[4], { channel: 5, name: 'Lav 5' })
	})

	it('a fader above the threshold is never written', async () => {
		const st = { '/ch/01/mix/fader': 0.875, '/ch/01/mix/on': 0 } // +5 dB
		const desk = await oscDesk((m) =>
			m.args.length
				? ((st[m.address] = m.args[0].value), null)
				: [{ type: m.address.endsWith('/on') ? 'i' : 'f', value: st[m.address] }]
		)
		const d = createDriver('xair', { host: '127.0.0.1', port: desk.port })
		closers.push(() => d.close())
		const r = await acceptChannel(d, 1, 0)
		assert.equal(r.ok, true)
		assert.equal(st['/ch/01/mix/fader'], 0.875)
		assert.deepEqual(
			desk.got.filter((m) => m.args.length).map((m) => m.address),
			['/ch/01/mix/on']
		)
	})

	it('a desk that does not answer is a clear error', async () => {
		const desk = await oscDesk(() => null)
		const d = createDriver('x32', { host: '127.0.0.1', port: desk.port })
		closers.push(() => d.close())
		await assert.rejects(d.getChannel(1), /no answer from the desk at 127\.0\.0\.1:\d+ \(\/ch\/01\/mix\/fader\)/)
	})
})

describe('WO-731 Behringer WING (OSC, fader in dB, mute 1 = muted)', () => {
	it('answers ,sff / ,sfi; accept writes dB and mute 0', async () => {
		const st = { fdr: -144, mute: 1, name: 'Host' }
		const desk = await oscDesk((m) => {
			if (m.address === '/?') return [{ type: 's', value: 'WING,192.168.1.71,PGM,ngc-full,NO_SERIAL,1.07.2' }]
			const k = m.address.split('/')[3]
			if (m.address.split('/')[2] !== '3') return null
			if (m.args.length) return ((st[k] = m.args[0].value), null)
			if (k === 'fdr')
				return [
					{ type: 's', value: String(st.fdr) },
					{ type: 'f', value: 0 },
					{ type: 'f', value: st.fdr },
				]
			if (k === 'mute')
				return [
					{ type: 's', value: String(st.mute) },
					{ type: 'f', value: st.mute },
					{ type: 'i', value: st.mute },
				]
			return [{ type: 's', value: st.name }]
		})
		const d = createDriver('wing', { host: '127.0.0.1', port: desk.port })
		closers.push(() => d.close())
		assert.equal(await d.probe(), 'ngc-full · PGM')
		assert.deepEqual(await d.getChannel(3), { on: false, db: -Infinity })
		const r = await acceptChannel(d, 3, -3)
		assert.equal(r.ok, true, r.error)
		assert.deepEqual(r.did, ['unmuted', 'fader -∞ → -3 dB'])
		assert.deepEqual({ fdr: st.fdr, mute: st.mute }, { fdr: -3, mute: 0 })
		const sets = desk.got.filter((m) => m.args.length).map((m) => `${m.address} ,${m.args[0].type} ${m.args[0].value}`)
		assert.deepEqual(sets, ['/ch/3/mute ,i 0', '/ch/3/fdr ,f -3'])
	})
})

describe('WO-731 Yamaha RCP (TCP 49280, dB × 100)', () => {
	it('get / set lines, labels after values, NOTIFY ignored', async () => {
		const st = {
			'MIXER:Current/InCh/Fader/Level 4 0': -2000,
			'MIXER:Current/InCh/Fader/On 4 0': 0,
			'MIXER:Current/InCh/Label/Name 4 0': '"Lectern"',
		}
		const lines = []
		const port = await tcpDesk((c, d) => {
			for (const line of d.toString().split('\n').filter(Boolean)) {
				lines.push(line)
				const [verb, addr, x, y, val] = line.split(' ')
				if (verb === 'devinfo') c.write('OK devinfo productname "CL5"\n')
				else if (verb === 'get')
					c.write(
						`NOTIFY set MIXER:Current/InCh/Fader/Level 9 0 -1000 "-10.00"\nOK get ${addr} ${x} ${y} ${st[`${addr} ${x} ${y}`]}\n`
					)
				else if (verb === 'set') {
					st[`${addr} ${x} ${y}`] = Number(val)
					c.write(`OK set ${addr} ${x} ${y} ${val} "${val}"\r\n`)
				}
			}
		})
		const d = createDriver('yamaha-cl', { host: '127.0.0.1', port })
		closers.push(() => d.close())
		assert.equal(await d.probe(), 'CL5')
		const r = await acceptChannel(d, 5, 0)
		assert.equal(r.ok, true, r.error)
		assert.deepEqual(r.did, ['unmuted', 'fader -20 → 0 dB'])
		assert.ok(lines.includes('set MIXER:Current/InCh/Fader/On 4 0 1'))
		assert.ok(lines.includes('set MIXER:Current/InCh/Fader/Level 4 0 0'))
		assert.deepEqual((await d.names(5))[4], { channel: 5, name: 'Lectern' })
		assert.deepEqual(tokens('OK set MIXER:Current/InCh/Fader/Level 1 0 -2000 "-20.00"'), [
			'OK',
			'set',
			'MIXER:Current/InCh/Fader/Level',
			'1',
			'0',
			'-2000',
			'-20.00',
		])
	})

	it('ERROR is reported with the desk text', async () => {
		const port = await tcpDesk((c) => c.write('ERROR get UnknownAddress\n'))
		const d = createDriver('yamaha-dm7', { host: '127.0.0.1', port })
		closers.push(() => d.close())
		await assert.rejects(
			d.getChannel(1),
			/the desk refused get MIXER:Current\/InCh\/Fader\/Level 0 0: get UnknownAddress/
		)
	})
})

describe('WO-731 Allen & Heath dLive (MIDI over TCP)', () => {
	it('the protocol PDF bytes go out; running-status replies with active sensing, split across reads, come back', async () => {
		const got = []
		const st = { lv: 0x2f, vel: 0x7f } // -30 dB, muted
		let queue = Promise.resolve()
		const port = await tcpDesk(
			midiSplitter(
				(b) => (b[0] === 0x90 ? 6 : 9),
				(c, d) => {
					got.push(...d)
					const s = hex(d)
					// each reply in two reads with active sensing around it; replies queue (a desk never interleaves them)
					const reply = (bytes) => {
						queue = queue.then(() => {
							c.write(Buffer.from([0xfe, ...bytes.slice(0, 3)]))
							return new Promise((r) => setTimeout(() => r(c.write(Buffer.from([...bytes.slice(3), 0xfe]))), 5))
						})
					}
					if (s === 'F0 00 00 1A 50 10 01 00 00 05 0B 17 04 F7') reply([0xb0, 0x63, 0x04, 0x62, 0x17, 0x06, st.lv])
					else if (s === 'F0 00 00 1A 50 10 01 00 00 05 09 04 F7') reply([0x90, 0x04, st.vel, 0x04, 0x00])
					else if (s.startsWith('F0 00 00 1A 50 10 01 00 00 01'))
						reply([
							0xf0,
							0x00,
							0x00,
							0x1a,
							0x50,
							0x10,
							0x01,
							0x00,
							0x00,
							0x02,
							d[10],
							...Buffer.from(d[10] === 4 ? 'Vox 5' : ''),
							0xf7,
						])
					else if (s === '90 04 3F 90 04 00') st.vel = 0x3f
					else if (s.startsWith('B0 63 04 B0 62 17 B0 06')) st.lv = d[8]
				}
			)
		)
		const d = createDriver('dlive', { host: '127.0.0.1', port, midiChannel: 1 })
		closers.push(() => d.close())
		const r = await acceptChannel(d, 5, 0)
		assert.equal(r.ok, true, r.error)
		assert.deepEqual(r.did, ['unmuted', 'fader -30.3 → 0 dB']) // 2F = 47 × 64 / 127 - 54 (the PDF table rounds to -30)
		assert.equal(st.lv, 0x6b, '0 dB = 6B (PDF table)')
		const wire = hex(got)
		assert.ok(wire.includes('90 04 3F 90 04 00'), 'unmute input 5 (PDF)')
		assert.ok(wire.includes('B0 63 04 B0 62 17 B0 06 6B'), 'fader input 5 to 0 dB (PDF)')
		assert.equal((await d.names(5))[4].name, 'Vox 5')
	})

	it('the parser: running status, SysEx, real-time bytes, NRPN per channel', () => {
		const ev = []
		const parse = createMidiParser((e) => ev.push(e))
		parse([0x9b, 0x00, 0x7f, 0x01, 0xf8, 0x7f, 0xb2, 0x63, 0x10])
		parse([0x62, 0x17, 0x06, 0x57, 0xf0, 0x01, 0xfe, 0x02, 0xf7])
		const notes = ev.filter((e) => e.kind === 'note').map((e) => [e.ch, e.note, e.vel])
		assert.deepEqual(notes, [
			[11, 0, 127],
			[11, 1, 127],
		])
		assert.deepEqual(
			ev.find((e) => e.kind === 'nrpn'),
			{ kind: 'nrpn', ch: 2, msb: 0x10, lsb: 0x17, vc: 0x57 }
		)
		assert.deepEqual(ev.find((e) => e.kind === 'sysex').bytes, [0xf0, 0x01, 0x02, 0xf7])
	})
})

describe('WO-731 Allen & Heath SQ (NRPN, Linear Taper)', () => {
	it('get answers the 4-CC set message; mute and 0 dB as in the protocol tables', async () => {
		const got = []
		const st = { mute: 0x01, v: (0x64 << 7) | 0x16 } // muted, -20 dB
		const port = await tcpDesk(
			midiSplitter(
				(b) => (b.length < 8 ? 0 : b[7] === 0x60 ? 9 : 12),
				(c, d) => {
					got.push(...d)
					const s = hex(d)
					if (s === 'B0 63 40 B0 62 04 B0 60 7F')
						c.write(Buffer.from([0xb0, 0x63, 0x40, 0xb0, 0x62, 0x04, 0xb0, 0x06, st.v >> 7, 0xb0, 0x26, st.v & 0x7f]))
					else if (s === 'B0 63 00 B0 62 04 B0 60 7F')
						c.write(Buffer.from([0xb0, 0x63, 0x00, 0x62, 0x04, 0x06, 0x00, 0x26, st.mute]))
					else if (s.startsWith('B0 63 00 B0 62 04 B0 06')) st.mute = d[11]
					else if (s.startsWith('B0 63 40 B0 62 04 B0 06')) st.v = (d[8] << 7) | d[11]
				}
			)
		)
		const d = createDriver('sq', { host: '127.0.0.1', port, midiChannel: 1 })
		closers.push(() => d.close())
		const before = await d.getChannel(5)
		assert.equal(Math.round(before.db * 10) / 10, -20)
		const r = await acceptChannel(d, 5, 0)
		assert.equal(r.ok, true, r.error)
		const wire = hex(got)
		assert.ok(wire.includes('B0 63 00 B0 62 04 B0 06 00 B0 26 00'), 'input 5 mute off')
		assert.ok(wire.includes('B0 63 40 B0 62 04 B0 06 76 B0 26 5C'), 'input 5 to LR at 0 dB = 76 5C (protocol table)')
	})
})
