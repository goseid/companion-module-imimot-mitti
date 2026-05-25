import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({})

const browserGlobals = {
	window: 'readonly',
	document: 'readonly',
	WebSocket: 'readonly',
	setTimeout: 'readonly',
	clearTimeout: 'readonly',
	JSON: 'readonly',
	module: 'readonly',
}

const customConfig = [
	...baseConfig,
	{
		languageOptions: {
			sourceType: 'module',
		},
	},
	{
		files: ['public/**/*.js'],
		languageOptions: {
			sourceType: 'script',
			globals: browserGlobals,
		},
	},
]

export default customConfig
