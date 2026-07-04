'use strict'

const js = require('@eslint/js')
const globals = require('globals')

const IGNORES = [
	'**/node_modules/**',
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
	'preserve-caught-error': 'warn',
	'no-constant-binary-expression': 'warn',
	'no-unexpected-multiline': 'warn',
	'no-unreachable': 'warn',
	'no-setter-return': 'warn',
	'no-useless-escape': 'warn',
}

const SERVER_FILES = ['src/**/*.js', 'tools/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'client/**/*.cjs', 'index.js']

const SERVER_MODULE_FILES = ['tools/**/*.mjs', 'scripts/**/*.mjs']

const SERVER_RULES = {
	'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
	'no-empty': ['warn', { allowEmptyCatch: false }],
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
			'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
			'no-empty': ['warn', { allowEmptyCatch: false }],
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
]
