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
		// HighAsCG escaping differs from library DATA STORE serializer — keep raw.
		return this._send(`DATA STORE ${nameQ} "${escaped}"`, 'DATA')
	}

	dataRetrieve(name) {
		return this._client._invokeTyped('dataRetrieve', { name: String(name) }, `DATA RETRIEVE ${param(name)}`, 'DATA')
	}

	dataList(subDir) {
		if (subDir) return this._send(`DATA LIST ${param(subDir)}`, 'DATA')
		return this._client._invokeTyped('dataList', {}, 'DATA LIST', 'DATA')
	}

	dataRemove(name) {
		return this._client._invokeTyped('dataRemove', { name: String(name) }, `DATA REMOVE ${param(name)}`, 'DATA')
	}
}

module.exports = { AmcpData }
