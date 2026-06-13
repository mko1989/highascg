#!/usr/bin/env node
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const net = require('net')
const { spawnSync } = require('child_process')

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
			'AMCP Sequence Tester',
			'',
			'Usage:',
			'  node tools/sequence-tester.js --file <path> [--run] [--edit]',
			'',
			'Options:',
			'  --file "<path>"  Path to the sequence file (default: tools/amcp-test-command.txt)',
			'  --edit          Open the file in $EDITOR before running',
			'  --run           Actually send commands to CasparCG',
			'  --host <ip>     CasparCG host (default: 127.0.0.1)',
			'  --port <port>   CasparCG port (default: 5250)',
			'',
			'File Syntax:',
			'  - Lines starting with "#" are ignored (comments).',
			'  - Lines starting with "WAIT <ms>" will pause execution for <ms> milliseconds.',
			'  - All other non-empty lines are sent as AMCP commands.',
		].join('\n')
	)
}

function maybeEditCommand(filePath) {
	const editor = process.env.EDITOR || 'nano'
	spawnSync(editor, [filePath], { stdio: 'inherit' })
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

	const file = String(args.file || 'tools/amcp-test-command.txt')
	const absPath = path.resolve(file)

	if (!fs.existsSync(absPath)) {
		console.error(`File not found: ${absPath}`)
		if (!args.file) {
			console.log('Creating sample file...')
			fs.writeFileSync(absPath, [
				'# Sample transition sequence',
				'# Format: AMCP command or WAIT <ms>',
				'LOADBG 1-10 AMB',
				'MIXER 1-10 FILL 0 0 0.5 0.5',
				'WAIT 1000',
				'PLAY 1-10 WIPE 25',
			].join('\n') + '\n')
		} else {
			process.exitCode = 1
			return
		}
	}

	if (args.edit) {
		maybeEditCommand(absPath)
	}

	const content = fs.readFileSync(absPath, 'utf8')
	const lines = content
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l && !l.startsWith('#'))

	console.log(`\nProcessing sequence from ${file} (${lines.length} steps)...\n`)

	const host = String(args.host || '127.0.0.1')
	const port = parseInt(String(args.port || '5250'), 10) || 5250

	for (const line of lines) {
		if (line.startsWith('WAIT ')) {
			const ms = parseInt(line.slice(5), 10)
			if (Number.isFinite(ms) && ms > 0) {
				console.log(`[WAIT] Sleeping for ${ms}ms...`)
				await new Promise((r) => setTimeout(r, ms))
			}
		} else {
			console.log(`[CMD]  ${line}`)
			if (args.run) {
				try {
					const res = await sendAmcp(host, port, line)
					console.log(`[RESP] ${res.replace(/\r\n/g, ' | ')}`)
				} catch (e) {
					console.error(`[ERR]  Failed to send: ${e.message}`)
				}
			}
		}
	}
	console.log('\nSequence complete.\n')
}

main().catch((e) => {
	console.error('Sequence tester failed:', e?.message || e)
	process.exitCode = 1
})
