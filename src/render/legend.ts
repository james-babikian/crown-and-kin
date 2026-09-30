/*
 * The legend's samples (D25): each line drawn as it looks in the tree, with the same classes as
 * the tree, so styles.css colours both alike. A partnership is a line between two card ends with
 * its union sign (D26, D38: none for no recorded partnership); a child line is a family's bar with two drops; a parent drawn elsewhere
 * is a curve. Pure: the DOM renderer and the headless pictures both build from this.
 * M9 (spec §13.6 "Legend", §13.8): the houses part (`legendHouses`, `LegendHouse`) as pure data; the
 * DOM legend (`buildLegend` in `dom/scene.ts`) and the saved picture (`svg-string.ts`) draw it.
 */
import type { FamilyGraph } from '../core/derive';
import type { StrokeKind } from '../layout/model';
import { UNION_MARKS, unionMark, unionShape, type UnionShape } from './styles';
import { LEGEND_LABELS, LEGEND_ORDER, SIGN_LEGEND_LABEL } from './tree-info';

/** One SVG element of a sample; `cls` are dynasty- classes, never colours. */
export interface LegendPart {
	tag: 'path' | 'circle' | 'rect' | 'line' | 'text' | 'g';
	cls: string[];
	attr: Record<string, string | number>;
	text?: string;
	children?: LegendPart[];
}

/** One row of the legend: a line kind (or the D14 sign) with its label and sample drawing. */
export interface LegendRow {
	/** Line kind, or `sign` for the D14 card sign. */
	kind: StrokeKind | 'sign';
	label: string;
	/** The sample's size in px (its viewBox starts at 0 0). */
	w: number;
	h: number;
	parts: LegendPart[];
}

/** Width in px of one legend sample's viewBox. */
export const LEGEND_SAMPLE_W = 56;
/** Height in px of one legend sample's viewBox. */
export const LEGEND_SAMPLE_H = 22;
/** Union signs in the legend are drawn for a union size of 9 px (the tree's is 10 px at a 16 px font). */
const UNION_PX = 9;

const PARTNER_KINDS: readonly StrokeKind[] = ['marriage', 'betrothal', 'concubinage', 'affair', 'implicit'];
const CURVE_KINDS: readonly StrokeKind[] = ['birth-link', 'rumoured'];

const line = (kind: StrokeKind, d: string): LegendPart => ({ tag: 'path', cls: ['dynasty-line', `dynasty-line-${kind}`], attr: { d } });
const stub = (x: number): LegendPart => ({ tag: 'rect', cls: ['dynasty-legend-card'], attr: { x, y: 3, width: 9, height: 16, rx: 2 } });

/** The class of a union sign's shape, as the tree's markers use it. */
export function unionMarkClass(shape: UnionShape): string[] {
	return ['dynasty-union-dot', `dynasty-union-${shape}`];
}

function sign(shape: UnionShape, x: number, y: number): LegendPart {
	const m = unionMark(shape, x, y, UNION_MARKS[shape].size * UNION_PX);
	return { tag: m.tag, cls: unionMarkClass(shape), attr: m.attr };
}

/** The rumour "?" marker, as in the tree. */
function rumour(x: number, y: number): LegendPart {
	return {
		tag: 'g',
		cls: ['dynasty-rumour-marker'],
		attr: {},
		children: [
			{ tag: 'circle', cls: [], attr: { cx: x, cy: y, r: 6 } },
			{ tag: 'text', cls: [], attr: { x, y: y + 3.5, 'text-anchor': 'middle' }, text: '?' },
		],
	};
}

function sample(kind: StrokeKind): LegendPart[] {
	if (PARTNER_KINDS.includes(kind)) {
		const shape = kind === 'implicit' ? unionShape('implicit-union') : unionShape('union', kind);
		return [stub(0), stub(47), line(kind, 'M9 11H47'), ...(shape ? [sign(shape, 28, 11)] : [])];
	}
	if (CURVE_KINDS.includes(kind)) return [line(kind, 'M6 2C6 13 50 9 50 21'), ...(kind === 'rumoured' ? [rumour(28, 11)] : [])];
	return [line(kind, 'M28 1V8M12 8H44M12 8V21M44 8V21')];
}

/** Every legend row, in legend order, then the D14 card sign on the corner of a card. */
export function legendRows(): LegendRow[] {
	const rows: LegendRow[] = LEGEND_ORDER.map((kind) => ({ kind, label: LEGEND_LABELS[kind], w: LEGEND_SAMPLE_W, h: LEGEND_SAMPLE_H, parts: sample(kind) }));
	rows.push({
		kind: 'sign',
		label: SIGN_LEGEND_LABEL,
		w: LEGEND_SAMPLE_W,
		h: LEGEND_SAMPLE_H,
		parts: [
			{ tag: 'rect', cls: ['dynasty-legend-card'], attr: { x: 4, y: 1, width: 48, height: 20, rx: 3 } },
			{ tag: 'line', cls: ['dynasty-sign'], attr: { x1: 47, y1: 4, x2: 35, y2: 16, 'stroke-width': 2, 'stroke-dasharray': '7.5 2' } },
		],
	});
	return rows;
}

/** One house row of a legend (S4, P3): colour strip, arms and name. */
export interface LegendHouse {
	id: string;
	name: string;
	/** The house colour as written; absent = the no-house colour. The renderer checks that it can draw it. */
	color?: string;
	/** The house has `arms` written (the picture may still fail: then the row shows no arms). */
	arms: boolean;
}

/**
 * The house rows of a legend, in the order of the tree's `houses` list. `only` limits them to the
 * houses of those people (the saved picture shows the houses of the drawn people); without it,
 * every house of the tree (the on-screen legend).
 */
export function legendHouses(g: FamilyGraph, only?: Iterable<string>): LegendHouse[] {
	let used: Set<string> | undefined;
	if (only) {
		used = new Set();
		for (const id of only) {
			const house = g.byId.get(id)?.house;
			if (house !== undefined) used.add(house);
		}
	}
	const out: LegendHouse[] = [];
	for (const h of g.houses.values()) {
		if (used && !used.has(h.id)) continue;
		out.push({ id: h.id, name: h.name, ...(h.color ? { color: h.color } : {}), arms: !!h.arms });
	}
	return out;
}
