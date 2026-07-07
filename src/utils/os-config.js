'use strict'

const { execFileSync } = require('child_process')
const logger = require('./buffered-logger').osDisplay
const { getGpuConnectorInventory } = require('./hardware-info')
const { calculateLayoutPositions } = require('./os-layout-calculator')
const { verifyXrandrMatchesLayout } = require('./xrandr-layout-verify')
const { resolveSysIdToXrandrOutput, looksLikeDrmConnectorName } = require('./xrandr-output-resolve')
const { applyX11Layout } = require('./os-config-xrandr-apply')
const { clearPersistedOsLayout } = require('./os-config-persist')

function checkXrandrLayout(config) {
	const layout = calculateLayoutPositions(config)
	const inventory = getGpuConnectorInventory()
	return verifyXrandrMatchesLayout(layout, { inventory, config })
}

function restartDisplayManager() {
	const cmd = 'sudo -n systemctl restart nodm'
	logger.info(`[OS-Config] Restarting display manager: ${cmd}`)
	try {
		execFileSync('sudo', ['-n', 'systemctl', 'restart', 'nodm'], { stdio: 'inherit' })
		return true
	} catch (e) {
		logger.error(`[OS-Config] Failed to restart nodm (requires passwordless sudo): ${e.message}`)
		return false
	}
}

module.exports = {
	applyX11Layout,
	calculateLayoutPositions,
	checkXrandrLayout,
	clearPersistedOsLayout,
	restartDisplayManager,
	looksLikeDrmConnectorName,
	resolveSysIdToXrandrOutput,
}
