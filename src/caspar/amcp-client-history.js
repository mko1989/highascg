'use strict'

const fs = require('fs')
const path = require('path')

function recordAmcpHistory(ctx, command) {
	try {
		if (!ctx._amcpHistory) ctx._amcpHistory = []
		const ts = new Date().toISOString()
		ctx._amcpHistory.push(`${ts} ${command}`)
		if (ctx._amcpHistory.length > 50) {
			ctx._amcpHistory = ctx._amcpHistory.slice(ctx._amcpHistory.length - 50)
		}
		const fp = path.join(process.cwd(), 'data', 'amcp-last50.txt')
		fs.mkdirSync(path.dirname(fp), { recursive: true })
		fs.writeFileSync(fp, ctx._amcpHistory.join('\n') + '\n', 'utf8')
	} catch {
		/* non-fatal */
	}
}

module.exports = { recordAmcpHistory }
