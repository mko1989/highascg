'use strict'

const { param } = require('./amcp-utils')

class AmcpData {
	/**
	 * @param {import('./amcp-client').AmcpClient} client
	 */
	constructor(client) {
		this._client = client
	}

	_send(cmd, responseKey) {
		return this._client._send(cmd, responseKey)
	}

	dataStore(name, data) {
		const escaped = String(data)
			.replace(/\\/g, '\\\\')
			.replace(/"/g, '\\"')
			.replace(/\r\n/g, '\\n')
			.replace(/\r/g, '\\n')
			.replace(/\n/g, '\\n')
		const nameQ =
			name == null || name === ''
				? '""'
				: /\s/.test(String(name))
					? `"${String(name).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
					: String(name)
		return this._send(`DATA STORE ${nameQ} "${escaped}"`, 'DATA')
	}

	dataRetrieve(name) {
		return this._send(`DATA RETRIEVE ${param(name)}`, 'DATA')
	}

	dataList(subDir) {
		let cmd = 'DATA LIST'
		if (subDir) cmd += ` ${param(subDir)}`
		return this._send(cmd, 'DATA')
	}

	dataRemove(name) {
		return this._send(`DATA REMOVE ${param(name)}`, 'DATA')
	}
}

module.exports = { AmcpData }
