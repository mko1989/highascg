'use strict'

const fs = require('fs')
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const {
	parseStatusJson,
	assertSafeAuthUrl,
	getTailscaleStatus,
} = require('../../src/network/tailscale-service')
const { normalizeTailscaleConfig } = require('../../src/config/tailscale-config')

describe('tailscale service', () => {
	it('parseStatusJson detects connected running node', () => {
		const st = parseStatusJson({
			BackendState: 'Running',
			TailscaleIPs: ['100.64.0.1'],
			Self: { HostName: 'playout-a', DNSName: 'playout-a.example.ts.net.' },
		})
		assert.equal(st.connected, true)
		assert.equal(st.ipv4, '100.64.0.1')
		assert.equal(st.dnsName, 'playout-a.example.ts.net')
	})

	it('parseStatusJson detects needs login from AuthURL', () => {
		const st = parseStatusJson({
			BackendState: 'NeedsLogin',
			AuthURL: 'https://login.tailscale.com/a/example',
		})
		assert.equal(st.needsLogin, true)
		assert.match(st.authUrl, /^https:\/\/login\.tailscale\.com\//)
	})

	it('assertSafeAuthUrl rejects non-tailscale URLs', () => {
		assert.throws(() => assertSafeAuthUrl('https://evil.example/phish'), /Invalid Tailscale auth URL/)
		assert.equal(
			assertSafeAuthUrl('https://login.tailscale.com/a/bc'),
			'https://login.tailscale.com/a/bc',
		)
	})

	it('normalizeTailscaleConfig defaults', () => {
		const cfg = normalizeTailscaleConfig({})
		assert.equal(cfg.enabled, true)
		assert.equal(cfg.operatorLoginAssist, true)
		assert.equal(cfg.autoLoginOnBoot, false)
	})

	it('getTailscaleStatus finds snap tailscale socket when present', () => {
		const snapSock = '/var/snap/tailscale/common/socket/tailscaled.sock'
		if (!fs.existsSync(snapSock)) return
		const st = getTailscaleStatus()
		assert.equal(st.socketPath, snapSock)
		assert.equal(st.connected, true)
	})
})
