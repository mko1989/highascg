#!/usr/bin/env node
/**
 * Phase 1 smoke: headless flag + CORS allowlist (server-side).
 * Client api-origin.js is browser-only; verify with split dev:
 *   HIGHASCG_HEADLESS=true npm start
 *   npm run dev:client
 */
import assert from 'node:assert'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isHeadlessMode } = require('../../src/server/headless-mode.js')

assert.strictEqual(isHeadlessMode(), false)
process.env.HIGHASCG_HEADLESS = 'true'
assert.strictEqual(isHeadlessMode(), true)
process.env.HIGHASCG_HEADLESS = '1'
assert.strictEqual(isHeadlessMode(), true)
process.env.HIGHASCG_HEADLESS = 'yes'
assert.strictEqual(isHeadlessMode(), true)
delete process.env.HIGHASCG_HEADLESS
assert.strictEqual(isHeadlessMode(), false)

const { parseAllowedOrigins } = require('../../src/server/cors.js')
process.env.HIGHASCG_HEADLESS = 'true'
delete process.env.HIGHASCG_CORS_ORIGINS
const defaults = parseAllowedOrigins()
assert.ok(defaults.includes('http://localhost:3000'), 'default CORS includes Vite :3000')
process.env.HIGHASCG_CORS_ORIGINS = 'http://example.test:9,http://foo.test'
assert.deepStrictEqual(parseAllowedOrigins(), ['http://example.test:9', 'http://foo.test'])
delete process.env.HIGHASCG_CORS_ORIGINS
delete process.env.HIGHASCG_HEADLESS

console.log('smoke-api-origin: OK (server headless + CORS)')
