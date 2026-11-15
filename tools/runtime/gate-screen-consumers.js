#!/usr/bin/env node
'use strict'

/**
 * WO-1084 — run.sh calls this on casparcg.config before EVERY Caspar launch, right after the WO-717 policy tool:
 * a `<screen>` consumer whose window would land on no lit screen, or on the operator's screen, is not started — its
 * block is wrapped in a reasoned marker comment (src/config/screen-connector-gate.js), never deleted. The marks of
 * the previous launch are undone first, so each launch decides again from the full config and a screen plugged in
 * since then starts.
 *
 * Connector state: src/utils/connector-state.js (xrandr --current on :0; HIGHASCG_CONNECTOR_STATE injects it).
 * The operator's screen: the file node writes (HIGHASCG_OPERATOR_OUTPUT_FILE / ~/.highascg/run/operator-output.json).
 *
 * Best-effort by contract: any failure prints one line and exits 0 — the launch is never blocked, and with no
 * readable display state every consumer starts as before.
 *
 *   node tools/runtime/gate-screen-consumers.js <casparcg.config>
 */

const fs = require('fs')
const path = require('path')
const { gateScreenConsumers, summarize } = require('../../src/config/screen-connector-gate')
const { enforceScreenConsumerPolicy } = require('../../src/config/screen-consumer-policy')
const { readHeads, readOperatorNames } = require('../../src/utils/connector-state')

function main(file) {
	if (!file) return 'no config path given'
	let xml
	try {
		xml = fs.readFileSync(file, 'utf8')
	} catch (e) {
		return `cannot read ${file}: ${e.code || e.message}`
	}
	const heads = readHeads()
	const operatorNames = readOperatorNames()
	const gated = gateScreenConsumers(xml, { heads, operatorNames })
	// A block restored from a mark has not been through the WO-717 policy of this launch yet.
	const out = enforceScreenConsumerPolicy(gated.xml).xml
	const lit = heads ? heads.filter((h) => h.connected && h.active).map((h) => h.name).join(', ') || 'none' : 'unknown'
	const head = `lit: ${lit}; operator: ${operatorNames.join('+') || 'unknown'}`
	if (out === xml) return `${head} — ${summarize(gated)}`
	const tmp = path.join(path.dirname(file), `.${path.basename(file)}.gate-${process.pid}.tmp`)
	try {
		fs.writeFileSync(tmp, out, 'utf8')
		fs.renameSync(tmp, file)
	} catch (e) {
		try {
			fs.unlinkSync(tmp)
		} catch {}
		return `cannot write ${file}: ${e.code || e.message}`
	}
	return `${head} — ${summarize(gated)}`
}

if (require.main === module) {
	let msg
	try {
		msg = main(process.argv[2])
	} catch (e) {
		msg = `error: ${e.message}`
	}
	console.log(`[screen gate] ${msg}`)
	process.exit(0)
}

module.exports = { main }
