// Writes a minified copy of styles.css for the release asset (0.4, slim assessment R1). The file in the repository stays readable.
// Run it as `node scripts/minify-styles.mjs styles.css dist/styles.css`. It then proves that the copy styles the same:
// a second CSS engine (lightningcss) normalises the source and the copy, postcss lists every declaration with its at-rules and selector,
// and the two lists must be equal, in the same order. If they are not, the script stops with an error and writes nothing.
// `lightningcss` and `postcss` come with vitest; they are not part of the plugin.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { isMain } from './is-main.mjs';

/**
 * The minified text of a style sheet. Throws when esbuild reports a warning (a warning means that it may have left something out).
 * No browser target is set: with one, esbuild adds vendor prefixes (-webkit-user-select), and the copy must change nothing but the layout of the text.
 */
export async function minifyStyles(css) {
	const result = await esbuild.transform(css, { loader: 'css', minify: true, legalComments: 'none' });
	if (result.warnings.length > 0) throw new Error(`esbuild warned about styles.css: ${result.warnings.map((w) => w.text).join('; ')}`);
	return result.code;
}

// Spaces carry no meaning round commas and brackets. The two rewrites after them are the only ones that esbuild makes and lightningcss does not:
// it adds the lengths in a sum (44px + 4px = 48px), and it writes translateX(x) as translate(x), which is the same function.
const tidyValue = (value) =>
	value
		.replace(/\s+/g, ' ')
		.replace(/\s*,\s*/g, ',')
		.replace(/\(\s+/g, '(')
		.replace(/\s+\)/g, ')')
		.replace(/([\d.]+)px \+ ([\d.]+)px/g, (_, a, b) => `${Number(a) + Number(b)}px`)
		.replace(/translateX\(/g, 'translate(');

/**
 * Lists every declaration of a style sheet as "at-rules >> selector | property:value", in the order of the sheet,
 * after lightningcss has normalised values (colours, zeros, shorthands) in the sheet.
 */
export async function declarationList(css) {
	const [{ transform }, postcss] = await Promise.all([import('lightningcss'), import('postcss').then((m) => m.default)]);
	const normalised = transform({ filename: 'styles.css', code: Buffer.from(css), minify: true }).code.toString();
	const list = [];
	const context = (node) => {
		const parts = [];
		for (let up = node.parent; up && up.type !== 'root'; up = up.parent) parts.unshift(up.type === 'atrule' ? `@${up.name} ${tidyValue(up.params)}` : tidyValue(up.selector));
		return parts.join(' >> ');
	};
	postcss.parse(normalised).walkDecls((decl) => list.push(`${context(decl)} | ${decl.prop}:${tidyValue(decl.value)}${decl.important ? ' !important' : ''}`));
	return list;
}

const HEX8 = /#[0-9a-f]{8}(?![0-9a-f])/gi;

/**
 * True when two declaration lines are equal. Two 8-digit hex colours with the same red, green and blue may differ by 1 in the alpha byte:
 * esbuild and lightningcss round `rgb(0 0 0/50%)` (127.5) in different directions, and that is no change of the style.
 */
function sameDeclaration(a, b) {
	if (a === b) return true;
	const coloursA = a.match(HEX8) ?? [];
	const coloursB = b.match(HEX8) ?? [];
	if (coloursA.length === 0 || coloursA.length !== coloursB.length) return false;
	if (a.split(HEX8).join('#') !== b.split(HEX8).join('#')) return false;
	return coloursA.every((x, i) => x.slice(0, 7).toLowerCase() === coloursB[i].slice(0, 7).toLowerCase() && Math.abs(parseInt(x.slice(7), 16) - parseInt(coloursB[i].slice(7), 16)) <= 1);
}

/** Compares the two declaration lists. Returns null when they are equal, else a text that shows the first difference. */
export function firstDifference(source, copy) {
	if (source.length !== copy.length) return `the source has ${source.length} declarations and the copy has ${copy.length}`;
	const at = source.findIndex((line, i) => !sameDeclaration(line, copy[i]));
	return at < 0 ? null : `declaration ${at + 1}:\n  source: ${source[at]}\n  copy:   ${copy[at]}`;
}

async function main(inFile, outFile) {
	const source = fs.readFileSync(inFile, 'utf8');
	const copy = await minifyStyles(source);
	const [before, after] = await Promise.all([declarationList(source), declarationList(copy)]);
	const difference = firstDifference(before, after);
	if (difference) throw new Error(`The minified styles do not match the source, ${difference}`);
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, copy);
	const bytes = (text) => Buffer.byteLength(text);
	console.log(`styles.css: ${bytes(source)} bytes, minified copy: ${bytes(copy)} bytes (${Math.round((1 - bytes(copy) / bytes(source)) * 100)} % smaller).`);
	console.log(`Proof: ${before.length} declarations, with the same at-rules, selectors, values and order in the source and in the copy.`);
}

if (isMain(import.meta.url)) {
	const [inFile, outFile] = process.argv.slice(2);
	if (!inFile || !outFile) {
		console.error('Use: node scripts/minify-styles.mjs <styles.css> <output.css>');
		process.exit(1);
	}
	main(inFile, outFile).catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
