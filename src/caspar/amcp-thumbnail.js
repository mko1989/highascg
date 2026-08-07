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
		if (subDir) return this._send(`THUMBNAIL LIST ${param(subDir)}`, 'THUMBNAIL')
		return this._client._invokeTyped('thumbnailList', {}, 'THUMBNAIL LIST', 'THUMBNAIL')
	}

	thumbnailRetrieve(filename) {
		return this._client._invokeTyped(
			'thumbnailRetrieve',
			{ filename: String(filename) },
			`THUMBNAIL RETRIEVE ${param(filename)}`,
			'THUMBNAIL',
		)
	}

	thumbnailGenerate(filename) {
		return this._client._invokeTyped(
			'thumbnailGenerate',
			{ filename: String(filename) },
			`THUMBNAIL GENERATE ${param(filename)}`,
			'THUMBNAIL',
		)
	}

	thumbnailGenerateAll() {
		return this._client._invokeTyped('thumbnailGenerateAll', {}, 'THUMBNAIL GENERATE_ALL', 'THUMBNAIL')
	}
}

module.exports = { AmcpThumbnail }
