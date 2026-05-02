/**
 * Command-line argument parsing and help for HighAsCG.
 */
'use strict'

const defaults = require('../config/defaults')

function parseArgs(argv) {
	const opts = {}
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		if (a === '--help' || a === '-h') opts.help = true
		else if ((a === '--port' || a === '-p') && argv[i + 1]) opts.httpPort = parseInt(argv[++i], 10)
		else if (a === '--ws-port' && argv[i + 1]) opts.wsPort = parseInt(argv[++i], 10)
		else if (a === '--caspar-host' && argv[i + 1]) opts.casparHost = argv[++i]
		else if (a === '--caspar-port' && argv[i + 1]) opts.casparPort = parseInt(argv[++i], 10)
		else if (a === '--bind' && argv[i + 1]) opts.bindAddress = argv[++i]
		else if (a === '--no-http') opts.noHttp = true
		else if (a === '--no-caspar') opts.noCaspar = true
		else if (a === '--no-osc') opts.noOsc = true
		else if (a === '--ws-broadcast-ms' && argv[i + 1]) opts.wsBroadcastMs = parseInt(argv[++i], 10)
	}
	return opts
}

function printHelp() {
	const d = defaults
	console.log(`highascg — HighAsCG standalone server

Usage:
  node index.js [options]

Options:
  --port, -p <n>     HTTP server port (default ${d.server.httpPort})
  --ws-port <n>      Reserved for split WS port (future)
  --caspar-host <h>  CasparCG host (default ${d.caspar.host})
  --caspar-port <n>  CasparCG AMCP port (default ${d.caspar.port})
  --bind <addr>      Bind address (default ${d.server.bindAddress})
  --ws-broadcast-ms <n>  Periodic WebSocket state broadcast (0 = off)
  --no-caspar        Do not open AMCP TCP (web UI only)
  --no-osc           Do not bind OSC UDP listener
  --no-http          Do not start HTTP (print config and exit)
  -h, --help         Show this help
`)
}

module.exports = { parseArgs, printHelp }
