import esbuild from 'esbuild';
import process from 'node:process';
import { builtinModules } from 'node:module';

const banner = `/*
Dynasty Tree: generated file. Do not edit. Source: src/obsidian/main.ts.
*/
`;

const prod = process.argv[2] === 'production';

// Second line of defence behind ESLint: elkjs must never reach main.js (spec §3, D9).
const noElk = {
	name: 'no-elkjs',
	setup(build) {
		const fail = (what, from) => ({
			errors: [{ text: `elkjs must not be bundled into the plugin (spec §3, D9): ${what}${from ? ` from ${from}` : ''}` }],
		});
		build.onResolve({ filter: /^elkjs(\/|$)/ }, (args) => fail(args.path, args.importer));
		build.onLoad({ filter: /[\\/]node_modules[\\/]elkjs[\\/]/ }, (args) => fail(args.path));
	},
};

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ['src/obsidian/main.ts'],
	bundle: true,
	external: [
		'obsidian',
		'electron',
		'@codemirror/*',
		'@lezer/*',
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	format: 'cjs',
	target: 'es2020',
	logLevel: 'info',
	sourcemap: prod ? false : 'inline',
	treeShaking: true,
	outfile: 'main.js',
	minify: prod,
	plugins: [noElk],
});

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
