'use strict'

/**
 * WO-752 — one sandbox failing to start must not leak the ones that started: their processes kept the test process,
 * and with it test:ci, alive for hours (smoke-wo725-cluster-e2e, 25.10). And the failure says why (the log's tail),
 * since the test's cleanup removes the sandbox root.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { startSandboxNodes } = require('../e2e/cluster-nodes')

/** Live processes whose working directory is inside `root`. */
function processesIn(root) {
	return fs.readdirSync('/proc').filter((p) => /^\d+$/.test(p)).filter((p) => {
		try {
			return fs.readlinkSync(`/proc/${p}/cwd`).startsWith(root)
		} catch {
			return false
		}
	})
}

test('a sandbox that cannot start: the call rejects and the started one is stopped', { timeout: 90000 }, async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo752-'))
	try {
		fs.writeFileSync(path.join(root, 'sb-bad'), 'a file where the sandbox root should be\n')
		await assert.rejects(startSandboxNodes(root, ['sb-ok', 'sb-bad']))
		assert.deepEqual(processesIn(root), [], 'no sandbox server left running')
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})
