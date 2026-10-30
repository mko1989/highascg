'use strict'

/**
 * WO-830b — which release asset the GUI update may install. Split out of server-update.js (500-line limit).
 */

const DEFAULT_GITHUB_REPO = 'mko1989/highascg'

function resolveGithubRepo() {
	const env = String(process.env.HIGHASCG_GITHUB_RELEASE_REPO || '').trim()
	if (env && /^[\w.-]+\/[\w.-]+$/.test(env)) return env
	return DEFAULT_GITHUB_REPO
}

/**
 * WO-830b: the asset to install is the one THIS server resolved from the configured repo (`check`), never
 * the request body. A body-supplied assetUrl/assetName is only accepted when it equals that asset — it used to
 * be trusted as-is, i.e. any github.com URL (an attacker's repo) and a `../` name were installable as root.
 * @param {{ assetUrl?: string|null, assetName?: string|null, githubRepo?: string }} check
 * @param {{ assetUrl?: string, assetName?: string }} [opts]
 * @returns {{ assetUrl: string, assetName: string }}
 */
function resolveVerifiedAsset(check, opts = {}) {
	const assetUrl = String(check?.assetUrl || '').trim()
	const assetName = String(check?.assetName || '').trim()
	if (!assetUrl || !assetName) throw new Error('No server release asset URL available')
	if (!/^highascg-server_[A-Za-z0-9._-]+\.tar\.gz$/.test(assetName) || assetName.includes('..')) {
		throw new Error('Release asset name is not a highascg server drop')
	}
	const repo = String(check?.githubRepo || resolveGithubRepo())
	const prefix = `https://github.com/${repo}/releases/download/`
	let u
	try {
		u = new URL(assetUrl)
	} catch {
		throw new Error('Release asset URL is invalid')
	}
	let urlFile = ''
	try {
		urlFile = decodeURIComponent(u.pathname.split('/').pop() || '')
	} catch {
		/* malformed escape → mismatch below */
	}
	if (u.protocol !== 'https:' || u.host !== 'github.com' || !assetUrl.startsWith(prefix) || urlFile !== assetName) {
		throw new Error('Release asset does not come from the configured release repository')
	}
	const askedUrl = opts?.assetUrl == null ? '' : String(opts.assetUrl).trim()
	const askedName = opts?.assetName == null ? '' : String(opts.assetName).trim()
	if ((askedUrl && askedUrl !== assetUrl) || (askedName && askedName !== assetName)) {
		throw new Error('Requested asset is not the verified latest release asset')
	}
	return { assetUrl, assetName }
}

module.exports = { resolveVerifiedAsset, resolveGithubRepo }
