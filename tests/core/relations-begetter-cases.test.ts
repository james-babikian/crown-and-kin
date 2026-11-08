// The case table of the parent link "begetter" (spec §0 D332, D334 Q14 to Q16): rows B1 to B32 of the genealogy study on sample tree 20
// and on small trees beside it, and the added rows B37 to B45 (R0 to R6 with V1 to V3). Every name is checked with the setting
// "Assume an unknown second parent" on and off (the same words unless a row says otherwise), and in four orders of the note: as written,
// the people reversed, every list of parents reversed, and both (R6). The finder steps of B1, B2, B7, B8 and B19 are checked as written.
import { describe, expect, it } from 'vitest';
import { computeRelations, findRelation, type RelationOptions } from '../../src/core/relations';
import { build, fixture } from '../support/helpers';

const SETTINGS: [string, RelationOptions][] = [
	['setting on', { oneParentUnknown: true }],
	['setting off', { oneParentUnknown: false }],
];
const SAMPLE = fixture('20');

/** One person line of a small tree. */
const P = (id: string, sex: string, parents = ''): string => `  - {id: ${id}, name: ${id}, sex: ${sex}${parents ? `, parents: [${parents}]` : ''}}`;
const typed = (id: string, type: string): string => `{id: ${id}, type: ${type}}`;
/** Sample tree 20 with more people at the end of its people list. */
const withPeople = (...lines: string[]): string => SAMPLE.replace('unions:\n', `${lines.join('\n')}\nunions:\n`);
/** A small tree. */
const small = (people: string[], unions: string[] = []): string => `people:\n${people.join('\n')}\n${unions.length ? `unions:\n${unions.join('\n')}\n` : ''}`;

/** The items of a flow list, split at the commas outside braces. */
function items(list: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < list.length; i++) {
		if (list[i] === '{') depth++;
		else if (list[i] === '}') depth--;
		else if (list[i] === ',' && depth === 0) {
			out.push(list.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(list.slice(start).trim());
	return out;
}

/** The note in another order: the person lines reversed (`people`), and every list of parents reversed (`parents`). */
function reorder(source: string, people: boolean, parents: boolean): string {
	const lines = source.split('\n');
	const at = lines.flatMap((l, i) => (/^ {2}- \{id: [^,]+, name: /.test(l) ? [i] : []));
	const person = at.map((i) => (parents ? lines[i].replace(/parents: \[(.*)\]\}$/, (_, list: string) => `parents: [${items(list).reverse().join(', ')}]}`) : lines[i]));
	if (people) person.reverse();
	at.forEach((i, k) => (lines[i] = person[k]));
	return lines.join('\n');
}

const ORDERS: [string, boolean, boolean][] = [
	['as written', false, false],
	['people reversed', true, false],
	['parents reversed', false, true],
	['both reversed', true, true],
];

/** All the names of `to` for `from`, best first, with the maybe text, joined by " | "; "(none)" for no name. */
function words(source: string, from: string, to: string, options: RelationOptions): string {
	const { g } = build(source);
	const list = computeRelations(g, from, options).get(to);
	return list ? list.map((r) => r.text + (r.maybe ? `, maybe ${r.maybe.effect}` : '')).join(' | ') : '(none)';
}

/** The steps of the first relation of the finder (or of its chain), joined by " / ". */
function steps(source: string, from: string, to: string): string {
	const { g } = build(source);
	const f = findRelation(g, from, to);
	const list = f.kind === 'named' ? f.relations[0].steps : f.kind === 'chain' ? f.steps : [];
	return list.map((s) => `${s.person} is ${s.of}'s ${s.word}`).join(' / ');
}

interface Row {
	row: string;
	source: string;
	from: string;
	to: string;
	/** The names with the setting on; `off` when the setting off gives other names. */
	on: string;
	off?: string;
}

const KIT = withPeople(P('kit', 'm', typed('oswin', 'begetter')));
const RHYS = withPeople(P('rhys', 'm', `isaut, ${typed('brisen', 'adoptive')}`));
const ADA2 = withPeople(P('ada2', 'f', `isaut, ${typed('brisen', 'adoptive')}, ${typed('oswin', 'begetter')}, ${typed('hugo', 'rumoured')}`));
const RHYS2 = withPeople(P('rhys2', 'm', `isaut, ${typed('brisen', 'adoptive')}, ${typed('oswin', 'rumoured')}`));
const PELL = small([P('isaut', 'f'), P('oswin', 'm'), P('ada', 'f', `isaut, ${typed('oswin', 'begetter')}`), P('pell', 'm', `oswin, ${typed('isaut', 'rumoured')}`)]);
const TWO_LINKS = (a: string, b: string) => small([P('isaut', 'f'), P('oswin', 'm'), P('maud', 'f'), P('ada', 'f', `isaut, ${typed('oswin', a)}, ${typed('oswin', b)}`)], ['  - {partners: [oswin, maud]}']);

const ROWS: Row[] = [
	{ row: 'B1', source: SAMPLE, from: 'ada', to: 'oswin', on: 'Begetter' },
	{ row: 'B2', source: SAMPLE, from: 'oswin', to: 'ada', on: 'Begotten daughter' },
	{ row: 'B3 (a woman as begetter)', source: SAMPLE, from: 'rafe', to: 'esme', on: 'Begetter' },
	{ row: 'B4', source: SAMPLE, from: 'esme', to: 'rafe', on: 'Begotten son' },
	{ row: 'B5', source: SAMPLE, from: 'ada', to: 'isaut', on: 'Mother' },
	{ row: 'B6', source: SAMPLE, from: 'ada', to: 'brisen', on: 'Adoptive mother' },
	{ row: 'B7 (no partner word for the mother and the begetter)', source: SAMPLE, from: 'isaut', to: 'oswin', on: '(none)' },
	{ row: 'B8 (same mother, same begetter)', source: SAMPLE, from: 'ada', to: 'ivo', on: 'Brother' },
	{ row: 'B9', source: SAMPLE, from: 'ada', to: 'bram', on: 'Half-brother' },
	{ row: 'B10', source: SAMPLE, from: 'bram', to: 'ada', on: 'Half-sister' },
	{ row: 'B11', source: SAMPLE, from: 'ada', to: 'linnet', on: 'Half-sister | Adoptive sister' },
	{ row: 'B12', source: SAMPLE, from: 'ada', to: 'corin', on: 'Half-brother | Adoptive brother' },
	{ row: 'B13 (no shared blood, D293)', source: SAMPLE, from: 'linnet', to: 'corin', on: 'Adoptive brother' },
	{ row: 'B14', source: SAMPLE, from: 'ada', to: 'gerold', on: 'Grandfather' },
	{ row: 'B15', source: SAMPLE, from: 'gerold', to: 'ada', on: 'Granddaughter' },
	{ row: 'B16', source: SAMPLE, from: 'ada', to: 'elfa', on: 'Aunt' },
	{ row: 'B17', source: SAMPLE, from: 'ada', to: 'wynn', on: 'Double first cousin' },
	{ row: 'B18 (control)', source: SAMPLE, from: 'bram', to: 'wynn', on: 'First cousin' },
	{ row: 'B19', source: SAMPLE, from: 'lys', to: 'oswin', on: 'Grandfather' },
	{ row: 'B19 (back)', source: SAMPLE, from: 'oswin', to: 'lys', on: 'Granddaughter' },
	{ row: 'B20', source: SAMPLE, from: 'ada', to: 'tam', on: 'Half-nephew' },
	{ row: 'B20 (Lys)', source: SAMPLE, from: 'lys', to: 'bram', on: 'Half-uncle' },
	{ row: 'B21', source: SAMPLE, from: 'ada', to: 'maud', on: 'Begetter’s wife' },
	{ row: 'B22', source: SAMPLE, from: 'maud', to: 'ada', on: 'Husband’s begotten daughter' },
	{ row: 'B23 (no stepbrother)', source: SAMPLE, from: 'ada', to: 'ned', on: '(none)' },
	{ row: 'B24', source: SAMPLE, from: 'lys', to: 'maud', on: 'Grandfather’s wife' },
	{ row: 'B25', source: SAMPLE, from: 'hugh', to: 'oswin', on: 'Wife’s begetter' },
	{ row: 'B26', source: SAMPLE, from: 'oswin', to: 'hugh', on: 'Begotten daughter’s husband' },
	{ row: 'B27', source: SAMPLE, from: 'ada', to: 'joan', on: 'Sister-in-law' },
	{ row: 'B27 (back)', source: SAMPLE, from: 'joan', to: 'ada', on: 'Sister-in-law' },
	{ row: 'B28', source: SAMPLE, from: 'hugh', to: 'gerold', on: 'Grandfather-in-law' },
	{ row: 'B28 (Bram)', source: SAMPLE, from: 'hugh', to: 'bram', on: 'Brother-in-law' },
	{ row: 'B29 (a begetter only)', source: KIT, from: 'bram', to: 'kit', on: 'Half-brother, maybe full', off: 'Half-brother' },
	{ row: 'B30', source: RHYS, from: 'ada', to: 'rhys', on: 'Half-brother, maybe full | Adoptive brother', off: 'Half-brother | Adoptive brother' },
	{ row: 'B31', source: ADA2, from: 'ivo', to: 'ada2', on: 'Sister, maybe half | Rumoured half-sister' },
	{ row: 'B32', source: SAMPLE, from: 'lys', to: 'ivo', on: 'Uncle' },
	{ row: 'B37', source: SAMPLE, from: 'gerold', to: 'hugh', on: 'Grandson-in-law' },
	{ row: 'B38', source: SAMPLE, from: 'maud', to: 'lys', on: 'Husband’s granddaughter' },
	{ row: 'B39 (R1a)', source: SAMPLE, from: 'lys', to: 'corin', on: 'Half-uncle | Adoptive uncle' },
	{ row: 'B39 (R1a, Rhys2)', source: RHYS2, from: 'ada', to: 'rhys2', on: 'Half-brother, maybe full | Adoptive brother | Rumoured brother' },
	{ row: 'B39 (R1a, Rhys2 back)', source: RHYS2, from: 'rhys2', to: 'ada', on: 'Half-sister, maybe full | Adoptive sister | Rumoured sister' },
	{ row: 'B40 (R1)', source: PELL, from: 'ada', to: 'pell', on: 'Half-brother, maybe full | Rumoured brother' },
	{ row: 'B40 (R1, back)', source: PELL, from: 'pell', to: 'ada', on: 'Half-sister, maybe full | Rumoured sister' },
	{ row: 'B41 (R0: adoptive and begetter)', source: TWO_LINKS('adoptive', 'begetter'), from: 'ada', to: 'oswin', on: 'Begetter | Adoptive father' },
	{ row: 'B41 (R0: adoptive and begetter, back)', source: TWO_LINKS('adoptive', 'begetter'), from: 'oswin', to: 'ada', on: 'Begotten daughter | Adopted daughter' },
	{ row: 'B41 (R0: begetter and adoptive)', source: TWO_LINKS('begetter', 'adoptive'), from: 'ada', to: 'oswin', on: 'Begetter | Adoptive father' },
	{ row: 'B41 (R0: adoptive and rumoured)', source: TWO_LINKS('adoptive', 'rumoured'), from: 'ada', to: 'oswin', on: 'Adoptive father | Rumoured father' },
	{ row: 'B41 (R0: rumoured and adoptive)', source: TWO_LINKS('rumoured', 'adoptive'), from: 'ada', to: 'oswin', on: 'Adoptive father | Rumoured father' },
	{ row: 'B43 (V1: a ward link stays out of R0)', source: TWO_LINKS('ward', 'rumoured'), from: 'ada', to: 'oswin', on: 'Guardian | Rumoured father' },
	{ row: 'B43 (V1, back)', source: TWO_LINKS('ward', 'rumoured'), from: 'oswin', to: 'ada', on: 'Ward | Rumoured daughter' },
	{ row: 'B44 (V2)', source: TWO_LINKS('adoptive', 'rumoured'), from: 'oswin', to: 'ada', on: 'Adopted daughter | Rumoured daughter' },
	{ row: 'B45 (V3: the adoptive link gives the step word)', source: TWO_LINKS('adoptive', 'begetter'), from: 'maud', to: 'ada', on: 'Stepdaughter' },
	{ row: 'B45 (V3, back)', source: TWO_LINKS('adoptive', 'begetter'), from: 'ada', to: 'maud', on: 'Stepmother' },
];

describe('the names of the begetter case table, in every order of the note (D332)', () => {
	for (const r of ROWS) {
		for (const [setting, options] of SETTINGS) {
			it(`${r.row}: ${r.from} → ${r.to}, ${setting}`, () => {
				const want = options.oneParentUnknown ? r.on : (r.off ?? r.on);
				for (const [order, people, parents] of ORDERS) expect(words(reorder(r.source, people, parents), r.from, r.to, options), order).toBe(want);
			});
		}
	}
});

describe('the finder steps of the begetter (D332, spec §13.2)', () => {
	it('Ada and Oswin: the begetter step', () => {
		expect(steps(SAMPLE, 'ada', 'oswin')).toBe("oswin is ada's begetter");
		expect(steps(SAMPLE, 'oswin', 'ada')).toBe("ada is oswin's begotten daughter");
	});

	it('Isaut and Oswin: no co-parent; the chain goes through the child', () => {
		const { g } = build(SAMPLE);
		expect(findRelation(g, 'isaut', 'oswin').kind).toBe('chain');
		expect(steps(SAMPLE, 'isaut', 'oswin')).toBe("ada is isaut's daughter / oswin is ada's begetter");
	});

	it('Ada and Ivo: one sibling step and no couple on the line', () => {
		expect(steps(SAMPLE, 'ada', 'ivo')).toBe("ivo is ada's brother");
		const { g } = build(SAMPLE);
		const f = findRelation(g, 'ada', 'ivo');
		expect(f.kind === 'named' && f.relations[0].relation.line.unions).toEqual([]);
	});

	it('Lys and Oswin: the begetter step above the first step keeps the plain word', () => {
		expect(steps(SAMPLE, 'lys', 'oswin')).toBe("ada is lys's mother / oswin is ada's begetter");
		expect(steps(SAMPLE, 'oswin', 'lys')).toBe("ada is oswin's begotten daughter / lys is ada's daughter");
	});
});

describe('the line of a full pair with begetters does not depend on the order of the note (D332)', () => {
	const kit = (first: string, second: string) =>
		small([P('oswin', 'm'), P('esme', 'f'), P('kit', 'm', `${typed(first, 'begetter')}, ${typed(second, 'begetter')}`), P('kit2', 'm', `${typed(first, 'begetter')}, ${typed(second, 'begetter')}`)]);
	const rafe = (first: string, second: string) => small([P('alard', 'm'), P('esme', 'f'), P('rafe', 'm', `${first}, ${second}`), P('rafe2', 'm', `${first}, ${second}`)]);
	const line = (source: string, from: string, to: string) => {
		const { g } = build(source);
		return computeRelations(g, from).get(to)![0].line;
	};

	it('Kit and Kit2, two begetters: "Brother", the line through Esme (the smaller id), in both list orders', () => {
		for (const source of [kit('oswin', 'esme'), kit('esme', 'oswin')]) {
			for (const [from, to] of [['kit', 'kit2'], ['kit2', 'kit']]) {
				expect(words(source, from, to, { oneParentUnknown: true })).toBe('Brother');
				expect(line(source, from, to)).toMatchObject({ people: [from, 'esme', to], unions: [] });
			}
		}
	});

	it('Rafe and Rafe2, a birth parent and a begetter: the line through Alard (birth to both), in both list orders', () => {
		const begot = typed('esme', 'begetter');
		for (const source of [rafe('alard', begot), rafe(begot, 'alard')]) {
			for (const [from, to] of [['rafe', 'rafe2'], ['rafe2', 'rafe']]) {
				expect(words(source, from, to, { oneParentUnknown: true })).toBe('Brother');
				expect(line(source, from, to)).toMatchObject({ people: [from, 'alard', to], unions: [] });
			}
		}
	});

	it('the note in another order keeps every person line and parent', () => {
		const back = reorder(reorder(SAMPLE, true, true), true, true);
		expect(back).toBe(SAMPLE);
		expect(reorder(SAMPLE, false, true)).toContain('parents: [{id: oswin, type: begetter}, {id: brisen, type: adoptive}, isaut]');
	});
});
