'use strict'

const fs = require('fs')

/** Linux: the pid owning the client end (local port `port`) of a loopback TCP connection to `serverPort`; 0 = unknown. */
function pidOfClientPort(port, serverPort, pids) {
	try {
		const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0')
		const rows = fs.readFileSync('/proc/net/tcp', 'utf8').split('\n').slice(1)
		const row = rows.map((r) => r.trim().split(/\s+/)).find((c) => c[1]?.endsWith(':' + hex(port)) && c[2]?.endsWith(':' + hex(serverPort)))
		if (!row) return 0
		const want = `socket:[${row[9]}]`
		for (const pid of pids()) {
			let fds = []
			try {
				fds = fs.readdirSync(`/proc/${pid}/fd`)
			} catch {
				continue
			}
			for (const fd of fds) {
				try {
					if (fs.readlinkSync(`/proc/${pid}/fd/${fd}`) === want) return pid
				} catch {
					/* closed meanwhile */
				}
			}
		}
	} catch {
		/* not Linux / no /proc */
	}
	return 0
}

module.exports = { pidOfClientPort }
