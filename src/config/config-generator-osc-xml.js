'use strict'

const { escapeXml } = require('./config-generator-utils')

/**
 * CasparCG `<osc>` block: predefined UDP client → HighAsCG (and AMCP echo policy).
 * Omitted when `osc_port` is missing or ≤ 0 (same gate as before full-block T5.1).
 * Optional: `caspar_osc_default_port`, `osc_target_host` / `highascg_host`, `osc_target_port`, `osc_disable_send_to_amcp`.
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function buildOscConfigurationXml(config) {
	const oscPort = parseInt(String(config.osc_port || '0'), 10) || 0
	if (oscPort <= 0) return ''

	let targetAddr = String(config.osc_target_host || config.highascg_host || '127.0.0.1').trim()
	if (!targetAddr) targetAddr = '127.0.0.1'
	const targetPort = parseInt(String(config.osc_target_port || oscPort), 10) || oscPort
	let defaultPort = parseInt(String(config.caspar_osc_default_port || '6250'), 10) || 6250
	if (defaultPort === targetPort) {
		defaultPort = targetPort + 1
		if (defaultPort > 65535) defaultPort = Math.max(1024, targetPort - 1)
	}
	const disableAmcp = config.osc_disable_send_to_amcp === true || config.osc_disable_send_to_amcp === 'true'

	return `    <osc>
        <default-port>${defaultPort}</default-port>
        <disable-send-to-amcp-clients>${disableAmcp ? 'true' : 'false'}</disable-send-to-amcp-clients>
        <predefined-clients>
            <predefined-client>
                <address>${escapeXml(targetAddr)}</address>
                <port>${targetPort}</port>
            </predefined-client>
        </predefined-clients>
    </osc>
`
}

module.exports = {
	buildOscConfigurationXml,
}
