#!/usr/bin/env bash
# Load interactive_click_test fullscreen on multiview for CEF input testing.
set -euo pipefail
cd "$(dirname "$0")/../.."
node <<'NODE'
const { ConnectionManager } = require('./src/caspar/connection-manager')
;(async () => {
	const c = new ConnectionManager({
		host: '127.0.0.1',
		port: 5250,
		config: {},
		log() {},
		healthIntervalMs: 0,
		healthConnectDelayMs: 0,
	})
	await new Promise((res, rej) => {
		c.on('status', (p) => {
			if (p.connected) res()
		})
		c.start()
		setTimeout(() => rej(new Error('AMCP timeout')), 10000)
	})
	const cmds = [
		'CLEAR 4-10',
		'CLEAR 4-11',
		'CLEAR 4-12',
		'CLEAR 4-60',
		'CLEAR 4-999',
		'PLAY 4-999 [HTML] interactive_click_test',
		'MIXER 4-999 FILL 0 0 1 1',
		'MIXER 4-999 OPACITY 1',
		'MIXER 4 COMMIT',
	]
	for (const cmd of cmds) {
		const r = await c.amcp.raw(cmd)
		console.log(cmd, '→', String(r?.data || r?.raw || '').split('\n')[0])
	}
	console.log('Ready — click multiview (Space/Enter also work when pointer is in zone)')
	console.log('Trace logs: bash tools/runtime/cef-interactive-watch-logs.sh')
	c.stop()
})().catch((e) => {
	console.error(e?.message || e)
	process.exit(1)
})
NODE
