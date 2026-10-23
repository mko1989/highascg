'use strict'
/**
 * WO-696 — the ISO's ssh.service drop-in must make the host keys BEFORE Ubuntu's `ExecStartPre=/usr/sbin/sshd -t`.
 * A drop-in's ExecStartPre is appended to the unit's, so the list is cleared first (`ExecStartPre=`) and rebuilt
 * keygen → test. Without that the live ISO (no /etc/ssh/ssh_host_*, WO-669) never starts sshd.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const DROPIN = path.join(__dirname, '../eggs/live-usb/systemd/ssh.service.d-05-host-keys.conf.example')

describe('WO-696 ssh host-key drop-in', () => {
	it('clears ExecStartPre, then keygen before sshd -t', () => {
		const pre = fs
			.readFileSync(DROPIN, 'utf8')
			.split('\n')
			.filter((l) => l.startsWith('ExecStartPre='))
			.map((l) => l.slice('ExecStartPre='.length).trim())
		assert.deepEqual(pre, ['', '/usr/bin/ssh-keygen -A', '/usr/sbin/sshd -t'])
	})
})
