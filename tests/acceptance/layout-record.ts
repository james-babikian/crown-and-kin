import type { LaidOut } from '../../src/layout/model';

/*
 * A plain-text record of a whole layout (cards, union points, rows, gaps, tags, lines, markers),
 * for the D24 regression test: `orientation: 'down'` must keep today's layout exactly. Numbers
 * are rounded to 1/1000 px so that a harmless change in the order of float operations does not
 * count; the order of `paths` and `markers` is kept (it is the drawing order).
 */

const n = (v: number) => {
	const r = Math.round(v * 1000) / 1000;
	return Object.is(r, -0) ? '0' : String(r);
};
const nums = (d: string) => d.replace(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g, (m) => n(Number(m)));
const byKey = <T>(m: ReadonlyMap<string, T>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

export function recordLayout({ layout, edges }: LaidOut): string {
	const g = layout.geometry;
	const out: string[] = [
		`orientation ${layout.orientation}`,
		`size ${n(layout.width)} ${n(layout.height)}`,
		`geometry font ${n(g.fontPx)} ${g.cardSize} card ${n(g.cardW)}x${n(g.cardH)} union ${n(g.unionSize)} couple ${n(g.coupleGap)} node ${n(g.nodeGap)} row ${n(g.rowGap)} tag ${n(g.tagH)}`,
	];
	layout.rows.forEach((row, i) => out.push(`row ${i}: ${row.join(' ')}`));
	layout.rowGaps.forEach((gap, i) => out.push(`gap ${i}: ${n(gap.top)} ${n(gap.bottom)}`));
	for (const [id, b] of byKey(layout.persons)) out.push(`person ${id} gen ${b.gen} at ${n(b.x)} ${n(b.y)} size ${n(b.w)} ${n(b.h)}`);
	for (const [key, u] of byKey(layout.unions)) out.push(`union ${key} at ${n(u.x)} ${n(u.y)}${u.bar ? ' bar' : ''}${u.far ? ' far' : ''}`);
	for (const [id, t] of byKey(layout.farTags)) out.push(`tag ${id} [${t.spouses.join(' ')}] at ${n(t.x)} ${n(t.y)} hit ${n(t.hit.x)} ${n(t.hit.y)} ${n(t.hit.w)} ${n(t.hit.h)}`);
	for (const p of edges.paths) out.push(`path ${p.kind} [${p.people.join(' ')}] ${nums(p.d)}`);
	for (const m of edges.markers) out.push(`marker ${m.kind} at ${n(m.x)} ${n(m.y)}`);
	return out.join('\n') + '\n';
}
