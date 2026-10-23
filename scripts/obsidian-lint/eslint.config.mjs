// Config for the official Obsidian lint tool (eslint-plugin-obsidianmd), run over `src/` only. It is separate from the
// main `eslint.config.mjs` (module and colour rules) and from `npm run lint`. The tool and its pinned helpers are installed
// in a folder OUTSIDE the checkout (see README.md in this folder), so this file loads the plugin from there. The folder
// comes from the environment variable OBSIDIAN_LINT_DIR.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const toolDir = process.env.OBSIDIAN_LINT_DIR;
if (!toolDir) {
	throw new Error('Set OBSIDIAN_LINT_DIR to the folder where eslint-plugin-obsidianmd is installed (see scripts/obsidian-lint/README.md).');
}
const requireFromTool = createRequire(pathToFileURL(`${toolDir.replace(/[\/]+$/, '')}/`));
const { default: obsidianmd } = await import(pathToFileURL(requireFromTool.resolve('eslint-plugin-obsidianmd')).href);

export default [
	{ ignores: ['**/*.d.ts'] },
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: process.cwd(),
			},
		},
		rules: {
			// The code refuses control characters in imported text on purpose; the regexes name them.
			'no-control-regex': 'off',
			// '@codemirror/state' and '@codemirror/view' come from Obsidian at run time and are not in package.json.
			// The bundle marks them as external (esbuild.config.mjs).
			'import/no-extraneous-dependencies': 'off',
			// The four `keyCode === 229` sites (the IME check) carry this warning. Safari has no replacement for
			// keyCode 229 while the user composes text, so the warning stays visible and does not fail the run.
			'@typescript-eslint/no-deprecated': 'warn',
		},
	},
];
