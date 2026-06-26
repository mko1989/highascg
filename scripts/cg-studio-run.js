#!/usr/bin/env node
/**
 * Run CG Studio locally from the highascg checkout (port 4300).
 * Used for dev and by the Electron launcher (which bundles src/cg-studio).
 */

'use strict'

const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '..')
const PACKAGE_DIR = path.join(REPO_ROOT, 'src/cg-studio')

const { configure } = require(path.join(PACKAGE_DIR, 'cg-studio-context'))
const { startStudioServer } = require(path.join(PACKAGE_DIR, 'studio-server'))
const { resolveStudioPort } = require(path.join(PACKAGE_DIR, 'routes'))

configure({
	packageDir: PACKAGE_DIR,
	templateRoot: path.join(REPO_ROOT, 'template'),
})

const port = resolveStudioPort()
const bindAddress = process.env.HIGHASCG_CG_STUDIO_BIND || '127.0.0.1'

startStudioServer({
	port,
	bindAddress,
	log: (level, msg) => console.log(`[${level}] ${msg}`),
}).then((server) => {
	console.log(`[cg-studio] templates: ${REPO_ROOT}/template`)
	console.log(`[cg-studio] open ${server.url}`)

	const shutdown = async () => {
		await server.close()
		process.exit(0)
	}
	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
})
