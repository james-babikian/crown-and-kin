// A hover rule that paints over or behind a picture (a portrait, arms, a thumbnail) belongs to a mouse only. On a touch screen a tap leaves
// `:hover` on the tapped element until the next tap elsewhere, so the shade would stay on the picture while a menu is open.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const GUARD = '@media (hover: hover) and (pointer: fine)';

interface Rule {
	selector: string;
	body: string;
	guards: string[];
}

/** Every style rule of one chunk, with the at-rules that enclose it (comments taken out). */
function rulesOf(chunk: string): Rule[] {
	const css = readFileSync(fileURLToPath(new URL(`../../styles/${chunk}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const rules: Rule[] = [];
	const stack: string[] = [];
	let head = '';
	let body = '';
	let open = -1;
	for (let i = 0; i < css.length; i++) {
		const c = css[i];
		if (c === '{') {
			stack.push(head.trim());
			if (!head.trim().startsWith('@')) open = i + 1;
			head = '';
		} else if (c === '}') {
			const closing = stack.pop() ?? '';
			if (open >= 0 && !closing.startsWith('@')) {
				body = css.slice(open, i).trim();
				rules.push({ selector: closing.replace(/\s+/g, ' '), body, guards: stack.filter((s) => s.startsWith('@')).map((s) => s.replace(/\s+/g, ' ')) });
			}
			open = -1;
			head = '';
		} else if (open < 0) head += c;
	}
	return rules;
}

/** The hover rules of a chunk whose selector names `needle`, outside a `:not(:hover)` mention. */
function hoverRules(chunk: string, needle: string): Rule[] {
	return rulesOf(chunk).filter((r) => r.selector.includes(':hover') && r.selector.split(',').some((s) => s.includes(needle) && s.includes(':hover')));
}

/** The picture holders whose hover paint a touch screen must not keep: the chunk, the hover selector. */
const PICTURE_HOVER: [chunk: string, selector: string][] = [
	['10-edit-sheet.css', '.dynasty-pic:hover::after'],
	['21-houses-pictures.css', '.dynasty-sheet button.dynasty-house-arms:hover'],
	['21-houses-pictures.css', '.dynasty-picture-row:hover'],
];

describe('hover rules over pictures', () => {
	it.each(PICTURE_HOVER)('%s: %s sits inside a mouse-only hover guard', (chunk, selector) => {
		const found = rulesOf(chunk).filter((r) => r.selector === selector);
		expect(found, `the rule ${selector}`).toHaveLength(1);
		expect(found[0].guards).toEqual([GUARD]);
	});

	it('the picture row keeps its cursor tint outside the guard, so a keyboard user still sees the row', () => {
		const rule = rulesOf('21-houses-pictures.css').find((r) => r.selector === '.dynasty-picture-row.is-cursor');
		expect(rule?.guards).toEqual([]);
	});

	it('every hover rule of the picture picker chunk that sets a background lies inside a guard or clears the background', () => {
		for (const r of hoverRules('21-houses-pictures.css', '.dynasty-picture-row')) {
			const paints = /background:\s*(?!none|transparent)/.test(r.body);
			if (paints) expect(r.guards, r.selector).toEqual([GUARD]);
		}
	});

	it('the head portrait keeps the shade of the computer: a round shade over the whole portrait in the hover colour', () => {
		const rule = rulesOf('10-edit-sheet.css').find((r) => r.selector === '.dynasty-pic:hover::after');
		expect(rule?.guards).toEqual([GUARD]);
		const decls = new Set((rule?.body ?? '').split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean));
		expect(decls).toEqual(new Set(["content: ''", 'position: absolute', 'inset: 0', 'border-radius: 50%', 'background: var(--background-modifier-hover)']));
	});
});
