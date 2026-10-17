import esbuild from 'esbuild';
import fs from 'node:fs';
import process from 'node:process';
import { builtinModules } from 'node:module';
import { writeStyles } from './styles/concat.mjs';

const banner = `/*
Crown and Kin: generated file. Do not edit. Source: src/obsidian/main.ts.
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
	// Only the harness install turns this on (DYNASTY_HARNESS=1): the parse cache then freezes its trees (spec §13.15 rule 3).
	define: { __DYNASTY_HARNESS__: process.env.DYNASTY_HARNESS === '1' ? 'true' : 'false' },
	minify: prod,
	plugins: [noElk],
});

// styles.css is the join of the numbered chunks in styles/ (styles/README.md). Builders edit chunks only.
const joinStyles = () => {
	if (writeStyles('styles.css')) console.log('styles.css joined from styles/');
};
joinStyles();

if (prod) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
	// esbuild watches only the script entry, so a chunk change needs its own watcher (one join per burst of events).
	let timer;
	fs.watch('styles', () => {
		clearTimeout(timer);
		timer = setTimeout(joinStyles, 50);
	});
}
