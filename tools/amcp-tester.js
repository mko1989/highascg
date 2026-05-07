#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawnSync } = require('child_process')
const { buildClipCommandPlan, serializeClipCommandPlan } = require('../src/caspar/amcp-command-plan')

function parseArgs(argv) {
	const out = {}
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		if (!a.startsWith('--')) continue
		const k = a.slice(2)
		const n = argv[i + 1]
		if (n && !n.startsWith('--')) {
			out[k] = n
			i++
		} else {
			out[k] = true
		}
	}
	return out
}

function usage() {
	console.log(
		[
			'AMCP tester',
			'',
			'Examples:',
			'  node tools/amcp-tester.js --sample loadbg --channel 1 --layer 110 --clip "422 TEST 2" --seek 0 --edit --run',
			'  node tools/amcp-tester.js --command "MIXER 1-110 OPACITY 1 25 linear" --run',
			'  node tools/amcp-tester.js --plan \'{"commandName":"PLAY","channel":1,"layer":110,"clip":"","opts":{}}\' --run',
			'  node tools/amcp-tester.js --file tools/amcp-test-command.txt --run',
			'',
			'Options:',
			'  --host 127.0.0.1 --port 5250',
			'  --sample loadbg|play|stop|opacity',
			'  --command "<raw AMCP>"',
			'  --plan "<json plan object>"',
			'  --file "<path to command file>"',
			'  --edit   open command in $EDITOR before run/print',
			'  --run    send command to Caspar',
		].join('\n')
	)
}

function buildSampleCommand(args) {
	const sample = String(args.sample || '').toLowerCase()
	const channel = parseInt(String(args.channel || '1'), 10) || 1
	const layer = parseInt(String(args.layer || '10'), 10) || 10
	const clip = String(args.clip || '')
	const seek = args.seek != null ? Math.max(0, parseInt(String(args.seek), 10) || 0) : undefined
	const duration = args.duration != null ? Math.max(0, parseInt(String(args.duration), 10) || 0) : 25
	const tween = String(args.tween || 'linear')
	if (sample === 'loadbg') {
		return serializeClipCommandPlan(buildClipCommandPlan('LOADBG', channel, layer, clip, { ...(seek != null ? { seek } : {}) }))
	}
	if (sample === 'play') {
		return serializeClipCommandPlan(buildClipCommandPlan('PLAY', channel, layer, clip, {}))
	}
	if (sample === 'stop') return `STOP ${channel}-${layer}`
	if (sample === 'opacity') return `MIXER ${channel}-${layer} OPACITY ${args.opacity != null ? args.opacity : 1} ${duration} ${tween}`
	return ''
}

function maybeEditCommand(initial) {
	const editor = process.env.EDITOR || 'nano'
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amcp-tester-'))
	const fp = path.join(dir, 'command.amcp')
	fs.writeFileSync(fp, (initial || '') + '\n', 'utf8')
	spawnSync(editor, [fp], { stdio: 'inherit' })
	const content = fs.readFileSync(fp, 'utf8')
	return content
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'))
		.join('\r\n')
}

function readCommandFile(filePath) {
	const raw = fs.readFileSync(path.resolve(filePath), 'utf8')
	return raw
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'))
		.join('\r\n')
}

function sendAmcp(host, port, command) {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection({ host, port }, () => {
			socket.write(command + '\r\n')
		})
		let buf = ''
		const t = setTimeout(() => {
			socket.destroy()
			resolve(buf.trim() || '(no response within timeout)')
		}, 2500)
		socket.on('data', (d) => {
			buf += d.toString('utf8')
			if (/\r?\n/.test(buf)) {
				clearTimeout(t)
				socket.destroy()
				resolve(buf.trim())
			}
		})
		socket.on('error', (e) => {
			clearTimeout(t)
			reject(e)
		})
	})
}

async function main() {
	const args = parseArgs(process.argv)
	if (args.help) return usage()
	let command = ''
	const cmdFile = String(args.file || 'tools/amcp-test-command.txt')
	if (args.command) command = String(args.command)
	else if (args.plan) command = serializeClipCommandPlan(JSON.parse(String(args.plan)))
	else if (args.sample) command = buildSampleCommand(args)
	else if (fs.existsSync(path.resolve(cmdFile))) command = readCommandFile(cmdFile)
	if (!command) {
		usage()
		process.exitCode = 1
		return
	}
	if (args.edit) command = maybeEditCommand(command)
	console.log('\nAMCP command:\n' + command + '\n')
	if (!args.run) return
	const host = String(args.host || '127.0.0.1')
	const port = parseInt(String(args.port || '5250'), 10) || 5250
	const res = await sendAmcp(host, port, command)
	console.log('Response:\n' + res + '\n')
}

main().catch((e) => {
	console.error('amcp-tester failed:', e?.message || e)
	process.exitCode = 1
})

