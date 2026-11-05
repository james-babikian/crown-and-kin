/*
 * The legend popover's content (D25, D330 O-05): draws the groups of rows from `legend.ts` as DOM with the classes of the tree, so styles.css colours the samples
 * like the tree. The tree scene (`scene.ts`) re-exports `buildLegend`; the tree view's More list opens it.
 */
import { legendGroups, type LegendPart } from '../legend';

function addPart(parent: SVGElement, part: LegendPart): void {
	const el = parent.createSvg(part.tag, { cls: part.cls, attr: part.attr });
	if (part.text !== undefined) el.setText(part.text);
	for (const c of part.children ?? []) addPart(el, c);
}

/**
 * Fills the legend popover (D25, D330 O-05): two groups, "Lines" (one row per line kind and the D14 sign) and "Death labels" (the two dead signs), each sample drawn like the tree.
 * The group headings and the hairline between the groups are siblings of the rows, so the legend stays one list that grows with its content. D196 item 3: the
 * live legend shows the line styles only; the houses are in the Houses window, and the saved picture keeps its own house legend (`svg-string.ts`).
 */
export function buildLegend(list: HTMLElement): void {
	for (const group of legendGroups()) {
		list.createDiv({ cls: ['dynasty-legend-group-title', `is-${group.kind}`], text: group.heading, attr: { role: 'heading', 'aria-level': '3' } });
		for (const r of group.rows) {
			const row = list.createDiv({ cls: r.kind === 'sign' ? 'dynasty-legend-row dynasty-legend-sign' : 'dynasty-legend-row' });
			const sample = row.createSvg('svg', { cls: 'dynasty-legend-sample', attr: { width: r.w, height: r.h, viewBox: `0 0 ${r.w} ${r.h}` } });
			for (const part of r.parts) addPart(sample, part);
			row.createSpan({ cls: 'dynasty-legend-label', text: r.label });
		}
	}
}
