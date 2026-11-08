import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Android proof (0.5.3, owner test 1, item 4b): Obsidian's own phone UI reads the system bars only through its variables
 * `--safe-area-inset-top` / `-bottom` (app.css: `:root { --safe-area-inset-top: env(safe-area-inset-top) }`, then
 * `.is-mobile .workspace > .mod-root { padding-top: var(--safe-area-inset-top) }`, `--prompt-top`, `--view-header-top-offset`,
 * `--navbar-bottom-offset`). On the Android emulator `env()` gives 0 while Obsidian's own bars keep clear, so Obsidian gives
 * the inset through the variable. The model: env() = 0px, the variable = the status bar (45 px) and the gesture bar (24 px).
 * Each rule below must keep its bar clear of the system bar under that model.
 */

const STATUS = 45;
const GESTURE = 24;

function block(file: string, selector: string): string {
	const css = readFileSync(join(__dirname, '../../styles', file), 'utf8');
	const at = css.indexOf(`\n${selector} {`);
	if (at < 0) throw new Error(`no rule ${selector} in ${file}`);
	return css.slice(at, css.indexOf('\n}', at));
}

function decl(body: string, prop: string): string {
	const m = new RegExp(`\\n\\t${prop}:\\s*([^;]+);`).exec(body);
	if (!m) throw new Error(`no ${prop}`);
	return m[1].trim();
}

/** Splits a shorthand at top-level spaces. */
function parts(v: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of v) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (ch === ' ' && depth === 0) {
			if (cur) out.push(cur);
			cur = '';
		} else cur += ch;
	}
	if (cur) out.push(cur);
	return out;
}

/** Resolves one length under the Android model: env() 0, Obsidian's variables and the plugin tokens (D335, which read them) the real bars, other variables 0. */
function android(v: string): number {
	const s = v
		.replace(/env\(safe-area-inset-[a-z]+(,\s*[^)]*)?\)/g, '0px')
		.replace(/var\(--(?:dynasty-)?safe(?:-area-inset)?-top(,\s*[^()]*)?\)/g, `${STATUS}px`)
		.replace(/var\(--(?:dynasty-)?safe(?:-area-inset)?-bottom(,\s*[^()]*)?\)/g, `${GESTURE}px`)
		.replace(/var\(--[a-z0-9-]+(,\s*[^()]*)?\)/g, '0px')
		.replace(/max\(/g, 'Math.max(')
		.replace(/calc\(/g, '(')
		.replace(/(\d+(\.\d+)?)px/g, '$1');
	return Number(new Function(`return ${s};`)());
}

describe('Android: plugin bars keep clear of the system bars (Obsidian --safe-area-inset-* variables)', () => {
	it('person window (every buildShell window): the Cancel/Save bar starts below the status bar', () => {
		const top = parts(decl(block('10-edit-sheet.css', '.dynasty-bar'), 'padding'))[0];
		expect(android(top)).toBeGreaterThanOrEqual(STATUS);
	});

	it('person picker on a phone: the search field and Cancel start below the status bar', () => {
		const top = decl(block('13-person-picker.css', '.prompt.dynasty-picker.is-phone'), 'padding-top');
		expect(android(top)).toBeGreaterThanOrEqual(STATUS);
	});

	it('full-screen view on a phone: the result bar (relation view) starts below the status bar', () => {
		const top = decl(block('18-more-list-finder-bar.css', '.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-result'), 'top');
		expect(android(top)).toBeGreaterThanOrEqual(STATUS);
	});

	it('full-screen view on a phone: the bottom bar keeps clear of the gesture bar', () => {
		const bottom = parts(decl(block('16-full-screen.css', '.modal.dynasty-fullscreen.is-phone .dynasty-full .dynasty-toolbar'), 'padding'))[2];
		expect(android(bottom)).toBeGreaterThanOrEqual(GESTURE);
	});
});
