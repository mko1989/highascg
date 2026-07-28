'use strict'

const js = require('@eslint/js')
const globals = require('globals')

const IGNORES = [
	'**/node_modules/**',
	// Runtime-generated Firefox kiosk profile (prefs.js/user.js are not our code)
	'.operator-firefox-profile/**',
	'dist-web/**',
	'dist/**',
	'dist-map/**',
	'cef-cache/**',
	'vendor/**',
	'docs/**',
	'work/references/**',
	'.reference/**',
	'CT-SS-master/**',
	'work/**',
	'template/**',
	'client/assets/map-data.json',
	'client/tools/electron-launcher/**',
	'client/tools/portable-desktop/**',
	'**/*.sync-conflict-*',
	'eslint.config.js',
]

const ESLINT_10_RECOMMENDED_OVERRIDES = {
	// ESLint 10 expanded eslint:recommended — warn until existing code is cleaned up.
	'no-useless-assignment': 'warn',
	'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
	'preserve-caught-error': 'warn',
	'no-constant-binary-expression': 'warn',
	'no-unexpected-multiline': 'warn',
	'no-unreachable': 'warn',
	'no-setter-return': 'warn',
	'no-useless-escape': 'warn',
}

/* Previs is a PARKED future module (owner 2026-07-28): registry-gated, three.js not installed,
 * nothing in core may call it. Its internal dead code is expected until the module is picked up. */
const PREVIS_PARKED = {
	files: ['client/components/previs-*.js', 'client/lib/previs-*.js', 'src/previs/**/*.js'],
	rules: {
		'no-unreachable': 'off',
		'no-unused-vars': 'off',
		'no-useless-assignment': 'off',
	},
}

const SERVER_FILES = ['src/**/*.js', 'tools/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'client/**/*.cjs', 'index.js']

const SERVER_MODULE_FILES = ['tools/**/*.mjs', 'scripts/**/*.mjs']

const SERVER_RULES = {
	'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
	'no-empty': ['warn', { allowEmptyCatch: true }],
	'no-undef': 'warn',
	'no-restricted-syntax': [
		'warn',
		{
			selector: 'CallExpression[callee.property.name="execSync"] > TemplateLiteral',
			message: 'Avoid execSync with template literals; use execFileSync with an arg array (WO-97).',
		},
	],
	...ESLINT_10_RECOMMENDED_OVERRIDES,
}

module.exports = [
	{ ignores: IGNORES },
	js.configs.recommended,
	{
		files: ['vite.config.js', 'vite.map.config.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
			},
		},
		rules: SERVER_RULES,
	},
	{
		files: SERVER_MODULE_FILES,
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
			},
		},
		rules: SERVER_RULES,
	},
	{
		files: SERVER_FILES,
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			globals: {
				...globals.node,
			},
		},
		rules: SERVER_RULES,
	},
	{
		files: ['client/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.browser,
				...globals.es2021,
			},
		},
		rules: {
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
			'no-empty': ['warn', { allowEmptyCatch: true }],
			'no-undef': 'off',
			'no-restricted-syntax': [
				'warn',
				{
					selector:
						'AssignmentExpression[left.property.name="innerHTML"] > TemplateLiteral:not(:has(CallExpression[callee.name="escapeHtml"])):not(:has(CallExpression[callee.name="escapeAttr"])):not(:has(CallExpression[callee.name="html"]))',
					message:
						'Escape interpolations with escapeHtml/escapeAttr from client/lib/dom-escape.js before assigning to innerHTML (WO-103).',
				},
			],
			...ESLINT_10_RECOMMENDED_OVERRIDES,
		},
	},
	{
		// CG Studio's served UI: plain browser scripts under src/ (same code also synced into
		// client/tools/electron-launcher/cg-studio/). Without this block they inherit the node
		// globals from the server block above and every `document` use warns no-undef.
		files: ['src/cg-studio/public/**/*.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'script',
			globals: {
				...globals.browser,
				...globals.es2021,
				StudioPlacement: 'readonly',
			},
		},
		rules: {
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
			'no-empty': ['warn', { allowEmptyCatch: true }],
			...ESLINT_10_RECOMMENDED_OVERRIDES,
		},
	},
	{
		// DOM smoke test files that run browser code via headless Chrome + CDP. These files
		// execute page.evaluate() callbacks in the browser context, so they need browser globals.
		files: ['tools/smoke/smoke-logs-modal-toggles.mjs', 'tools/smoke/smoke-settings-nuclear-password-dom.mjs'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'module',
			globals: {
				...globals.node,
				...globals.browser,
			},
		},
		rules: SERVER_RULES,
	},
	{
		// Mocha test files that use describe/it globals (not imported).
		files: ['test/**/*.js', 'test/**/*.test.js'],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			globals: {
				...globals.node,
				describe: 'readonly',
				it: 'readonly',
				before: 'readonly',
				after: 'readonly',
				beforeEach: 'readonly',
				afterEach: 'readonly',
			},
		},
		rules: SERVER_RULES,
	},
	PREVIS_PARKED,
	{
		/* Smoke-test stubs: unused ARGS are the mocked API's shape (documentation, not dead
		 * code) — e.g. `loadbg: (channel, pLayer, clip, opts) =>` reading only some. Unused
		 * VARS still warn (a forgotten assertion is a real smell). Owner-approved 2026-07-28. */
		files: ['tools/smoke/**/*.js', 'tools/smoke/**/*.mjs'],
		rules: {
			'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
		},
	},
]
