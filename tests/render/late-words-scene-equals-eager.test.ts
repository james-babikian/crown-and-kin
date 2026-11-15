// D352 item 1 (spec §13.1, §13.15 S2): a lazy scene whose relation words come late (`SceneOptions.lateWords`) ends equal to the eager scene,
// byte for byte, whatever the order of fills (inside and outside a gesture), detail changes, idle chunks of words and other readers of the lookup.
// While it runs, no attached card has the D177 centred form when its final word is not empty, and a card that shows a word shows the eager card.
// The genealogy vet's case table: C1 (sample trees, three marks, both settings, both directions), C3, C4, C5, C9.
import { describe, expect, it } from 'vitest';
import { deriveFamilies, type FamilyGraph } from '../../src/core/derive';
import { parseDynasty } from '../../src/core/parse';
import type { RelationOptions } from '../../src/core/relations';
import { cardLabels, needsLabels } from '../../src/core/titles';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree, pictureSets } from '../../src/layout/index';
import type { Geometry } from '../../src/layout/model';
import { buildScene, type SceneOptions } from '../../src/render/dom/scene';
import { clearRelationCache, relationsFor } from '../../src/view/relation-cache';
import { FEl } from '../acceptance/fake-dom';
import { fixtureSource } from '../acceptance/load';
import { serial } from '../acceptance/picture-list-support';
import { useFakeDom } from '../support/fake-dom-setup';
import { lcg } from '../support/rng';

useFakeDom({ css: true, createSvg: true });

const FONTS = { text: 'serif', ui: 'sans', bold: '700' };
const measure = (text: string, font: string) => text.length * (Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 16) * 0.55);
const ROUNDEL = cardForm(geometryFor(16), 'down');
const SIDE = cardForm(geometryFor(16), 'sideways');

const all = (el: FEl): FEl[] => [el, ...el.children.flatMap(all)];
const cardsOf = (root: FEl) => new Map(all(root).filter((e) => e.hasClass('dynasty-card')).map((e) => [e.getAttribute('data-person')!, e]));
const bodyOf = (card: FEl) => card.children.find((c) => c.hasClass('dynasty-card-body'));
const nameY = (body: FEl) => all(body).find((e) => e.hasClass('dynasty-card-name'))?.getAttribute('y');
const hasWord = (body: FEl) => all(body).some((e) => e.hasClass('dynasty-card-relation'));

interface Case {
	g: FamilyGraph;
	geo: Geometry;
	me: string;
	options: RelationOptions;
	show?: boolean;
}

function graphOf(id: string): { g: FamilyGraph; me: string | undefined } {
	const parsed = parseDynasty(fixtureSource(id));
	if (!parsed.ok) throw new Error(`sample tree ${id} does not parse`);
	return { g: deriveFamilies(parsed.tree), me: parsed.tree.options.me };
}

/** The two scenes of one case: eager with every word asked first (as the saved picture), lazy with a fresh lookup and late words (`most`: the group limit of one fill). */
function scenes(c: Case, most = Infinity) {
	const ids = c.g.people.map((p) => p.id);
	const heirs = c.show ? [ids[5], ids[9], ids[14]].filter(Boolean) : [];
	const ordinals = new Map<string, string>(heirs.map((h, i) => [h, ['1st', '2nd', '3rd'][i]] as const));
	clearLayoutCache();
	const settings = { ...DEFAULT_LAYOUT_SETTINGS, ...pictureSets(c.g, true), relationLine: true, ...(c.geo === SIDE ? { orientation: 'sideways' as const } : {}), ...(c.show ? { ordinalCards: [...ordinals.keys()] } : {}) };
	const laid = layoutTree(c.g, c.geo, settings, 'test');
	const base = (relations: SceneOptions['relations']): SceneOptions => ({
		fonts: FONTS,
		measure,
		link: (p) => (p.id.length % 3 === 0 ? { linktext: p.id, resolved: true } : null),
		me: c.me,
		relations,
		...(c.show ? { heirs, ordinals } : {}),
		...(needsLabels(c.g) ? { labels: cardLabels(c.g) } : {}),
	});
	clearRelationCache();
	const eagerLook = relationsFor(c.g, c.me, c.options);
	eagerLook.cards.getMany(ids);
	const eagerRoot = new FEl('g');
	const eager = buildScene(eagerRoot as unknown as SVGGElement, c.g, laid, base(eagerLook.cards));
	clearRelationCache();
	const look = relationsFor(c.g, c.me, c.options);
	const lazyRoot = new FEl('g');
	const lazy = buildScene(lazyRoot as unknown as SVGGElement, c.g, laid, { ...base(look.cards), lazyCards: true, lateWords: most });
	return { ids, laid, eager, eagerRoot, lazy, lazyRoot, look, heirs };
}

/** C3 and C1 while the steps run: an attached card is never centred when its eager card has a word, and a card that shows a word is the eager card. */
function checkAttached(eagerRoot: FEl, lazyRoot: FEl): void {
	const eager = cardsOf(eagerRoot);
	for (const [id, card] of cardsOf(lazyRoot)) {
		const body = bodyOf(card);
		const want = bodyOf(eager.get(id)!);
		if (!body || !want) continue;
		if (hasWord(want)) expect(nameY(body), `${id}: centred while its word is not empty`).toBe(nameY(want));
		if (hasWord(body)) expect(serial(body), `${id}: a card with its word`).toBe(serial(want));
	}
}

function run(c: Case, seed: number): void {
	// Seed 2 lets a fill near the view ask only 3 words (spec §7.7, the group limit): the other late cards it attaches get an empty word line.
	const s = scenes(c, seed === 2 ? 3 : Infinity);
	const r = lcg(seed);
	const W = s.laid.layout.width;
	const H = s.laid.layout.height;
	const view = () => ({ x: r() * W - 300, y: r() * H - 300, w: 600, h: 600 });
	// Every case starts with late cards: only the marked card (and heirs) got a word at the build.
	expect(s.lazy.words.pending).toBeGreaterThan(s.ids.length / 2);
	let detail = true;
	for (let step = 0; step < 16; step++) {
		const k = Math.floor(r() * 8);
		if (k === 0) s.lazy.fill.fillNear(view(), true);
		else if (k === 1) s.lazy.fill.fillNear(view(), false);
		else if (k === 2) s.lazy.fill.fillPerson(s.ids[Math.floor(r() * s.ids.length)]);
		else if (k === 3) s.lazy.fill.fillChunk(view(), 1 + Math.floor(r() * 10));
		else if (k === 4) s.lazy.words.write(s.lazy.words.due(view(), 1 + Math.floor(r() * 20)));
		// C5: another reader (Find, the saved picture, a window, a tip) fills the lookup's memo; the scene still writes its own cards.
		else if (k === 5) s.look.cards.getMany(s.ids.filter(() => r() < 0.2));
		else {
			detail = !detail;
			s.lazy.setDetail(detail);
			s.eager.setDetail(detail);
		}
		checkAttached(s.eagerRoot, s.lazyRoot);
	}
	if (!detail) {
		s.lazy.setDetail(true);
		s.eager.setDetail(true);
	}
	// The queue runs to its end, then the rest of the content comes.
	for (let guard = 0; s.lazy.words.pending > 0 && guard < 10_000; guard++) s.lazy.words.write(s.lazy.words.due(null, 20));
	expect(s.lazy.words.pending).toBe(0);
	s.lazy.fill.fillAll();
	expect(serial(s.lazyRoot)).toBe(serial(s.eagerRoot));
}

/** The tree's mark and two more people, spread over the list. */
function marksOf(g: FamilyGraph, own: string | undefined): string[] {
	const ids = g.people.map((p) => p.id);
	const out = new Set<string>(own && g.byId.has(own) ? [own] : []);
	for (const at of [0.3, 0.8]) if (out.size < 3) out.add(ids[Math.floor(at * (ids.length - 1))]);
	return [...out];
}

describe('late relation words: the lazy scene ends equal to the eager scene (D352 item 1, S2)', () => {
	for (const tree of ['04', '06', '08', '12', '17', '20']) {
		const { g, me } = graphOf(tree);
		for (const mark of marksOf(g, me)) {
			for (const oneParentUnknown of [true, false]) {
				for (const [dir, geo] of [['down', ROUNDEL], ['sideways', SIDE]] as const) {
					it(`sample tree ${tree}, mark ${mark}, oneParentUnknown ${oneParentUnknown}, ${dir}`, () => {
						for (const seed of [1, 2]) run({ g, geo, me: mark, options: { oneParentUnknown } }, seed);
					});
				}
			}
		}
	}

	for (const tree of ['07', '07b']) {
		const { g, me } = graphOf(tree);
		for (const oneParentUnknown of [true, false]) {
			for (const [dir, geo] of [['down', ROUNDEL], ['sideways', SIDE]] as const) {
				it(`sample tree ${tree}, its mark, oneParentUnknown ${oneParentUnknown}, ${dir}`, () => {
					run({ g, geo, me: me ?? g.people[194].id, options: { oneParentUnknown } }, 3);
				});
			}
		}
	}

	it('the marked card, the heirs and the ordinal cards have their eager labels from the build on; the other cards wait', () => {
		const { g, me } = graphOf('06');
		const s = scenes({ g, geo: ROUNDEL, me: me ?? g.people[3].id, options: { oneParentUnknown: true }, show: true });
		const eager = cardsOf(s.eagerRoot);
		const lazy = cardsOf(s.lazyRoot);
		for (const id of [me ?? g.people[3].id, ...s.heirs]) expect(lazy.get(id)!.getAttribute('aria-label'), id).toBe(eager.get(id)!.getAttribute('aria-label'));
		expect(s.lazy.words.pending).toBeGreaterThan(0);
	});

	it('the fill of everything right after the build asks every word first and equals the eager scene', () => {
		const { g, me } = graphOf('12');
		for (const geo of [ROUNDEL, SIDE]) {
			const s = scenes({ g, geo, me: me ?? g.people[0].id, options: { oneParentUnknown: true } });
			s.lazy.fill.fillAll();
			expect(s.lazy.words.pending).toBe(0);
			expect(serial(s.lazyRoot)).toBe(serial(s.eagerRoot));
		}
	});

	it('a fill during a gesture works no word out; the fill near the same view after it writes them', () => {
		const { g, me } = graphOf('06');
		const s = scenes({ g, geo: ROUNDEL, me: me ?? g.people[3].id, options: { oneParentUnknown: true } });
		const everywhere = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 };
		const before = s.lazy.words.pending;
		s.lazy.fill.fillNear(everywhere, false);
		expect(s.lazy.words.pending).toBe(before);
		checkAttached(s.eagerRoot, s.lazyRoot);
		s.lazy.fill.fillNear(everywhere, true);
		expect(s.lazy.words.pending).toBe(0);
		expect(serial(s.lazyRoot)).not.toBe('');
		s.lazy.fill.fillAll();
		expect(serial(s.lazyRoot)).toBe(serial(s.eagerRoot));
	});
});
