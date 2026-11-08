import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLegend } from '../../src/render/dom/scene';
import { legendGroups, legendRows } from '../../src/render/legend';
import { LEGEND_GROUP_DEAD, LEGEND_GROUP_LINES, LEGEND_LABELS, LEGEND_LINES_LABEL, SIGN_LEGEND_LABEL } from '../../src/render/legend-text';
import { FEl } from '../acceptance/fake-dom';
import { useFakeDom } from '../support/fake-dom-setup';

/*
 * D330 O-05: the legend window has two groups, "Lines" and "Death labels", with a hairline between. The sign row stays last in Lines.
 * The saved picture keeps its own heading "Line styles" (D74). The window grows with its content.
 */

useFakeDom({ css: true, createSvg: true });

const css = readFileSync('styles/23-legend-save.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string): string => {
	const at = css.indexOf(`${selector} {`);
	expect(at, selector).toBeGreaterThanOrEqual(0);
	return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
};

describe('the legend window in two groups', () => {
	it('Lines holds every line style with the card sign directly under "Illegitimate child"; Death labels holds the two dead rows', () => {
		const [lines, dead] = legendGroups();
		expect([lines.heading, dead.heading]).toEqual([LEGEND_GROUP_LINES, LEGEND_GROUP_DEAD]);
		// D338 point 7: the sign row no longer ends the group; it stands right after "Illegitimate child".
		const kinds = lines.rows.map((r) => r.kind);
		const sign = kinds.indexOf('sign');
		expect(kinds[sign - 1]).toBe('illegitimate');
		expect(lines.rows[sign].label).toBe(SIGN_LEGEND_LABEL);
		expect(lines.rows[sign - 1].label).toBe(LEGEND_LABELS.illegitimate);
		expect(lines.rows.some((r) => r.kind === 'dead' || r.kind === 'dead-doubt')).toBe(false);
		expect(dead.rows.map((r) => r.kind)).toEqual(['dead', 'dead-doubt']);
		// No row is lost or doubled.
		expect([...lines.rows, ...dead.rows].map((r) => r.kind)).toEqual(legendRows().map((r) => r.kind));
	});

	it('the window draws a heading before each group, with the second group after the sign row', () => {
		const list = new FEl('div');
		buildLegend(list as unknown as HTMLElement);
		const kinds = list.children.map((c) => (c.hasClass('dynasty-legend-group-title') ? `heading:${c.getText()}` : 'row'));
		const rows = legendRows().length;
		expect(kinds).toHaveLength(rows + 2);
		expect(kinds[0]).toBe('heading:Lines');
		expect(kinds.indexOf('heading:Death labels')).toBe(rows - 2 + 1);
		expect(kinds.filter((k) => k === 'row')).toHaveLength(rows);
		const second = list.children.find((c) => c.hasClass('is-dead'))!;
		expect(second.getAttribute('role')).toBe('heading');
	});

	it('the saved picture keeps the heading "Line styles" (D74)', () => {
		expect(LEGEND_LINES_LABEL).toBe('Line styles');
	});

	it('the style: a hairline above the second heading, muted semibold headings, no fixed height and no scroll of its own', () => {
		expect(rule('.dynasty-legend-group-title.is-dead')).toMatch(/border-top:\s*var\(--dynasty-hairline\)/);
		const head = rule('.dynasty-legend-group-title');
		expect(head).toMatch(/color:\s*var\(--dynasty-muted\)/);
		expect(head).toMatch(/font-weight:\s*var\(--dynasty-weight-semibold\)/);
		expect(css).not.toMatch(/dynasty-legend[^{]*\{[^}]*(?<!-)(?:height|overflow)\s*:/);
	});
});
