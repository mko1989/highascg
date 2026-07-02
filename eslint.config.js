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
	'client/assets/map-data.json',
	'client/tools/electron-launcher/**',
	'**/*.sync-conflict-*',
	'eslint.config.js',
]

module.exports = [
	{ ignores: IGNORES },
	js.configs.recommended,
	{
		files: [
			'src/**/*.js',
			'tools/**/*.js',
			'scripts/**/*.js',
			'test/**/*.js',
			'index.js',
			'vite.config.js',
			'vite.map.config.js',
		],
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'commonjs',
			globals: {
				...globals.node,
			},
		},
		rules: {
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
		},
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
		},
	},
]
