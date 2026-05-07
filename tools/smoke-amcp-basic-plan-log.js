'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { AmcpBasic } = require('../src/caspar/amcp-basic')

function createBasicHarness() {
	const sent = []
	const logs = []
	const client = {
		_context: {
			log(level, msg) {
				logs.push({ level, msg })
			},
		},
		_send(cmd, responseKey) {
			sent.push({ cmd, responseKey })
			return Promise.resolve({ ok: true })
		},
	}
	return { basic: new AmcpBasic(client), sent, logs }
}

test('basic PLAY swap logs plan without clip fields', async () => {
	const prev = process.env.HIGHASCG_AMCP_TRACE
	process.env.HIGHASCG_AMCP_TRACE = '1'
	try {
		const { basic, sent, logs } = createBasicHarness()
		await basic.play(1, 10, '', { transition: 'MIX', duration: 25, seek: 12, length: 100 })
		assert.equal(sent.length, 1)
		assert.equal(sent[0].cmd, 'PLAY 1-10')
		assert.ok(logs.some((l) => l.msg.includes('AMCP plan basic-play ch=1 layer=10 cmd=PLAY')))
		assert.ok(!logs.some((l) => l.msg.includes(' seek=')))
		assert.ok(!logs.some((l) => l.msg.includes(' length=')))
	} finally {
		if (prev == null) delete process.env.HIGHASCG_AMCP_TRACE
		else process.env.HIGHASCG_AMCP_TRACE = prev
	}
})

test('basic PLAY clip logs transition + seek + length', async () => {
	const prev = process.env.HIGHASCG_AMCP_TRACE
	process.env.HIGHASCG_AMCP_TRACE = '1'
	try {
		const { basic, sent, logs } = createBasicHarness()
		await basic.play(1, 10, 'AMB/next.mp4', { transition: 'MIX', duration: 25, tween: 'linear', seek: 12, length: 100 })
		assert.equal(sent.length, 1)
		assert.equal(sent[0].cmd, 'PLAY 1-10 AMB/next.mp4 MIX 25 linear SEEK 12 LENGTH 100')
		const msg = logs.find((l) => l.msg.includes('AMCP plan basic-play ch=1 layer=10 cmd=PLAY'))
		assert.ok(msg)
		assert.ok(msg.msg.includes('clip=AMB/next.mp4'))
		assert.ok(msg.msg.includes('transition=MIX duration=25 tween=linear'))
		assert.ok(msg.msg.includes('seek=12'))
		assert.ok(msg.msg.includes('length=100'))
	} finally {
		if (prev == null) delete process.env.HIGHASCG_AMCP_TRACE
		else process.env.HIGHASCG_AMCP_TRACE = prev
	}
})
