'use strict'

const { param } = require('./amcp-utils')

class AmcpThumbnail {
	/**
	 * @param {import('./amcp-client').AmcpClient} client
	 */
	constructor(client) {
		this._client = client
	}

	_send(cmd, responseKey) {
		return this._client._send(cmd, responseKey)
	}

	thumbnailList(subDir) {
		let cmd = 'THUMBNAIL LIST'
		if (subDir) cmd += ` ${param(subDir)}`
		return this._send(cmd, 'THUMBNAIL')
	}

	thumbnailRetrieve(filename) {
		return this._send(`THUMBNAIL RETRIEVE ${param(filename)}`, 'THUMBNAIL')
	}

	thumbnailGenerate(filename) {
		return this._send(`THUMBNAIL GENERATE ${param(filename)}`, 'THUMBNAIL')
	}

	thumbnailGenerateAll() {
		return this._send('THUMBNAIL GENERATE_ALL', 'THUMBNAIL')
	}
}

module.exports = { AmcpThumbnail }
