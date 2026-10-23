#!/usr/bin/env node
'use strict'

/**
 * WO-717 — run.sh calls this on casparcg.config before EVERY Caspar launch: every `<screen>` consumer gets
 * vsync off + gpu-texture on (src/config/screen-consumer-policy.js), whoever wrote the file — the generator,
 * the ISO template copy (install-iso-defaults.sh / reset-iso-operator-config.sh), a stick restore, a project
 * bundle, a hand edit. Rewrites the file (tmp + rename) only when something changed.
 *
 * Best-effort by contract: any failure prints one line and exits 0 — the launch must never be blocked by it.
 *
 *   node tools/runtime/enforce-screen-consumer-policy.js <casparcg.config>
 */

const fs = require('fs')
const path = require('path')
const { enforceScreenConsumerPolicy } = require('../../src/config/screen-consumer-policy')

function main(file) {
	if (!file) return 'no config path given'
	let xml
	try {
		xml = fs.readFileSync(file, 'utf8')
	} catch (e) {
		return `cannot read ${file}: ${e.code || e.message}`
	}
	const r = enforceScreenConsumerPolicy(xml)
	if (!r.changed) return `${r.screens} screen consumer(s) already vsync off + gpu-texture on`
	const tmp = path.join(path.dirname(file), `.${path.basename(file)}.policy-${process.pid}.tmp`)
	try {
		fs.writeFileSync(tmp, r.xml, 'utf8')
		fs.renameSync(tmp, file)
	} catch (e) {
		try {
			fs.unlinkSync(tmp)
		} catch {}
		return `cannot write ${file}: ${e.code || e.message}`
	}
	return `fixed ${r.screens} screen consumer(s) → vsync off + gpu-texture on`
}

if (require.main === module) {
	let msg
	try {
		msg = main(process.argv[2])
	} catch (e) {
		msg = `error: ${e.message}`
	}
	console.log(`[screen policy] ${msg}`)
	process.exit(0)
}

module.exports = { main }
