#!/usr/bin/env node
'use strict'

/**
 * run-operator-monitor-picker.js — WO-290 CLI entry for the operator-monitor picker.
 *
 * THIS IS THE ONLY CALL SITE. It is deliberately NOT wired into the boot path: the picker paints
 * over every connected output, so "an operator ran it on purpose" is the opt-in signal, and the
 * unconfigured gate in src/system/operator-monitor-picker.js then still has to agree. Running this
 * on a configured box logs a SKIP line and exits without mapping a window.
 *
 *   node tools/runtime/run-operator-monitor-picker.js [--timeout-ms N] [--dry-run]
 *
 * --dry-run evaluates the gate and lists the outputs it would prompt on, then exits — the safe way
 * to check what this would do on a live box.
 *
 * Config path resolution mirrors index.js (HIGHASCG_CONFIG_PATH, else the modular ./config dir,
 * else ./highascg.config.json), so the choice lands exactly where the running service reads it.
 */

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')
const { ConfigManager } = require(path.join(REPO_ROOT, 'src/config/config-manager'))
const {
	runOperatorMonitorPicker,
	evaluateMonitorPickerTrigger,
	formatTriggerLog,
	listPickerOutputs,
	DEFAULT_TIMEOUT_MS,
} = require(path.join(REPO_ROOT, 'src/system/operator-monitor-picker'))

function resolveConfigPath() {
	if (process.env.HIGHASCG_CONFIG_PATH) return path.resolve(process.env.HIGHASCG_CONFIG_PATH)
	const modularDir = path.join(REPO_ROOT, 'config')
	try {
		if (fs.existsSync(modularDir) && fs.statSync(modularDir).isDirectory()) return modularDir
	} catch (_) {
		/* fall through to the monolithic path */
	}
	return path.join(REPO_ROOT, 'highascg.config.json')
}

function parseArgs(argv) {
	const out = { timeoutMs: DEFAULT_TIMEOUT_MS, dryRun: false }
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--dry-run') out.dryRun = true
		else if (argv[i] === '--timeout-ms') {
			const n = parseInt(String(argv[++i] || ''), 10)
			if (Number.isFinite(n) && n > 0) out.timeoutMs = n
		}
	}
	return out
}

function log(level, msg) {
	const line = `${new Date().toISOString()} ${msg}`
	if (level === 'error') console.error(line)
	else if (level === 'warn') console.warn(line)
	else console.log(line)
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const configPath = resolveConfigPath()
	const cm = new ConfigManager(configPath, { info: () => {}, warn: () => {}, error: (m) => log('error', m) })
	cm.load()
	const config = cm.get()

	if (args.dryRun) {
		const verdict = evaluateMonitorPickerTrigger(config, { explicit: true })
		log('info', formatTriggerLog(verdict))
		if (!verdict.run) return 0
		let outputs = []
		try {
			outputs = listPickerOutputs(config)
		} catch (e) {
			log('warn', `[Operator monitor picker] output enumeration failed: ${e?.message || e}`)
		}
		for (const o of outputs) {
			log('info', `[Operator monitor picker] would prompt on ${o.name} @ ${o.x},${o.y} ${o.width}x${o.height} (port ${o.port ?? 'unmapped'})`)
		}
		return 0
	}

	const result = await runOperatorMonitorPicker({
		config,
		log,
		explicit: true,
		timeoutMs: args.timeoutMs,
		persist: (next) => cm.save(next),
	})
	return result.ok ? 0 : 1
}

main()
	.then((code) => process.exit(code))
	.catch((e) => {
		log('error', `[Operator monitor picker] ${e?.stack || e}`)
		process.exit(1)
	})
