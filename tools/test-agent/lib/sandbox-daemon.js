'use strict'

/**
 * WO-836 Part 3c — keeps a throwaway sandbox server (tools/e2e/sandbox-server.js) alive for `ui start --sandbox`.
 * Writes <root>/sandbox.json {url, port, pid} once it is up; SIGTERM stops it (and the node under it).
 *   node sandbox-daemon.js <root>
 */

const fs = require('fs')
const path = require('path')
const { startSandbox } = require('../../e2e/sandbox-server')

async function main() {
	const root = path.resolve(process.argv[2] || '')
	if (!process.argv[2]) throw new Error('usage: sandbox-daemon.js <root>')
	const sb = await startSandbox({ root, log: (s) => console.log(`[sandbox] ${s}`) })
	fs.writeFileSync(path.join(root, 'sandbox.json'), JSON.stringify({ url: sb.url, port: sb.port, pid: process.pid, serverPid: sb.pid }))
	const bye = async () => {
		await sb.stop()
		process.exit(0)
	}
	process.on('SIGTERM', bye)
	process.on('SIGINT', bye)
	setInterval(() => {}, 1 << 30)
}

main().catch((e) => {
	console.error(`[sandbox] ${e.stack || e}`)
	process.exit(1)
})
