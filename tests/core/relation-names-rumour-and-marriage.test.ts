// Relation names where a rumour, an adoption or a second union meets a name by marriage or a half or full test (spec §13.1, §13.2).
// Each case is a small tree with the exact words of every name of one person to another, in both settings of "Assume an unknown second
// parent" (D174), and the finder steps of each name. The card words come three ways and must agree: `computeRelations`, `relationLookup`
// and `findRelation`. The known limits at the end pin today's words, so a change either way is noticed.
import { describe, expect, it } from 'vitest';
import { computeRelations, findRelation, relationLookup, type Relation, type RelationOptions } from '../../src/core/relations';
import { build } from '../support/helpers';

const ON: RelationOptions = { oneParentUnknown: true };
const OFF: RelationOptions = { oneParentUnknown: false };

/** The names as one text: "Brother, maybe half | Rumoured half-brother". */
const wordsOf = (list: readonly Relation[] | undefined) => (list ?? []).map((r) => `${r.text}${r.maybe ? `, maybe ${r.maybe.effect}` : ''}`).join(' | ');

interface Ask {
	me: string;
	to: string;
	/** The names with the setting on. */
	on: string;
	/** The names with the setting off, if they differ. */
	off?: string;
	/** The finder steps of each name, in order ("x is y's word. …"), the same in both settings unless `offSteps` is given. */
	steps?: string[];
	offSteps?: string[];
}

/** Checks the names and steps of one ask in one setting, three ways. */
function check(note: string, ask: Ask, options: RelationOptions): void {
	const { g } = build(note);
	const want = options.oneParentUnknown ? ask.on : (ask.off ?? ask.on);
	const all = computeRelations(g, ask.me, options).get(ask.to);
	expect(wordsOf(all)).toBe(want);
	expect(JSON.stringify(relationLookup(g, ask.me, options).get(ask.to))).toBe(JSON.stringify(all));
	const found = findRelation(g, ask.me, ask.to, options);
	if (!want) {
		expect(found.kind).not.toBe('named');
		return;
	}
	expect(found.kind).toBe('named');
	if (found.kind !== 'named') return;
	expect(wordsOf(found.relations.map((r) => r.relation))).toBe(want);
	const steps = options.oneParentUnknown ? ask.steps : (ask.offSteps ?? ask.steps);
	if (steps) expect(found.relations.map((r) => r.steps.map((s) => `${s.person} is ${s.of}'s ${s.word}`).join('. '))).toEqual(steps);
}

/** One describe block: a tree and the asks on it, each in both settings. */
function tree(title: string, note: string, asks: Ask[]): void {
	describe(title, () => {
		for (const ask of asks) {
			for (const options of [ON, OFF]) {
				const words = options.oneParentUnknown ? ask.on : (ask.off ?? ask.on);
				it(`setting ${options.oneParentUnknown ? 'on' : 'off'}: ${ask.me} -> ${ask.to} is "${words}"`, () => check(note, ask, options));
			}
		}
	});
}

describe('a rumour never removes a sure name by marriage (D200 R1)', () => {
	tree(
		'Ulf is the rumoured father of Hal and a rumoured son of Hal’s grandfather, and is married to Ada, the sister of Hal’s mother',
		`people: [{id: gus, sex: m}, {id: gwen, sex: f}, {id: mona, sex: f, parents: [gus, gwen]}, {id: ada, sex: f, parents: [gus, gwen]}, {id: ulf, sex: m, parents: [{id: gus, type: rumoured}]}, {id: hal, sex: m, parents: [mona, {id: ulf, type: rumoured}]}]
unions: [{partners: [ulf, ada]}]`,
		[
			{
				me: 'hal',
				to: 'ulf',
				on: 'Rumoured father | Rumoured half-uncle | Uncle by marriage',
				steps: [
					"ulf is hal's rumoured father",
					"mona is hal's mother. ulf is mona's rumoured half-brother",
					"mona is hal's mother. gus is mona's father. gwen is gus's co-parent. ada is gwen's daughter. ulf is ada's husband",
				],
			},
			{ me: 'ulf', to: 'hal', on: 'Rumoured son | Rumoured half-nephew | Wife’s nephew' },
		],
	);
	tree(
		'without the rumoured link of Ulf to Gus the name by marriage is the same',
		`people: [{id: gus, sex: m}, {id: gwen, sex: f}, {id: mona, sex: f, parents: [gus, gwen]}, {id: ada, sex: f, parents: [gus, gwen]}, {id: ulf, sex: m}, {id: hal, sex: m, parents: [mona, {id: ulf, type: rumoured}]}]
unions: [{partners: [ulf, ada]}]`,
		[{ me: 'hal', to: 'ulf', on: 'Rumoured father | Uncle by marriage' }],
	);
	tree(
		'a line through a rumoured link that passes the partner himself still gives no name by marriage',
		`people: [{id: x, sex: m}, {id: w, sex: f}, {id: p, sex: m, parents: [x, w]}, {id: r, sex: f, parents: [x, w]}, {id: m, sex: m, parents: [{id: p, type: rumoured}]}]
unions: [{partners: [p, r]}]`,
		[
			{ me: 'm', to: 'p', on: 'Rumoured father', steps: ["p is m's rumoured father"] },
			{ me: 'm', to: 'r', on: 'Rumoured stepmother | Rumoured aunt' },
		],
	);
});

describe('the second test reads the two legal parents of D293', () => {
	const r2 = (pia: string, fenn: string) => `people: [{id: wren, sex: m}, {id: calla, sex: f}, {id: rolf, sex: m}, {id: pia, sex: f, parents: [${pia}]}, {id: fenn, sex: m, parents: [${fenn}]}, {id: gail, sex: f, parents: [fenn]}, {id: hal, sex: m, parents: [{id: gail, type: rumoured}]}, {id: ivy, sex: f, parents: [gail]}]
unions: [{partners: [wren, calla]}]`;
	tree('Pia (Calla, adopted by Wren, a rumoured Rolf) and Fenn (Wren and Calla) are full by law; a rumour lower in the line makes nobody half', r2('calla, {id: wren, type: adoptive}, {id: rolf, type: rumoured}', 'wren, calla'), [
		{ me: 'pia', to: 'hal', on: 'Rumoured great-nephew', steps: ["calla is pia's mother. wren is calla's husband. fenn is wren's son. gail is fenn's daughter. hal is gail's rumoured son"] },
		{ me: 'pia', to: 'fenn', on: 'Brother', steps: ["calla is pia's mother. wren is calla's husband. fenn is wren's son"] },
		{ me: 'pia', to: 'ivy', on: 'Great-niece' },
		{ me: 'fenn', to: 'pia', on: 'Sister' },
		{ me: 'hal', to: 'pia', on: 'Rumoured great-aunt' },
	]);
	tree('without the rumoured Rolf the rumoured great-nephew is the same', r2('calla, {id: wren, type: adoptive}', 'wren, calla'), [
		{ me: 'pia', to: 'hal', on: 'Rumoured great-nephew' },
		{ me: 'pia', to: 'fenn', on: 'Brother' },
	]);
	tree('Fenn born to Calla and Rolf: the rumour about Pia’s birth father still adds "maybe full"', r2('calla, {id: wren, type: adoptive}, {id: rolf, type: rumoured}', 'calla, rolf'), [
		{ me: 'pia', to: 'fenn', on: 'Half-brother, maybe full | Rumoured brother', steps: ["fenn is pia's half-brother", "fenn is pia's rumoured brother"] },
		{ me: 'fenn', to: 'pia', on: 'Half-sister, maybe full | Rumoured sister' },
	]);
	tree('Fenn born to Calla and Rolf, Pia with no rumour: the parent who is not listed still reads Pia’s birth mother alone', r2('calla, {id: wren, type: adoptive}', 'calla, rolf'), [
		{ me: 'pia', to: 'fenn', on: 'Half-brother, maybe full', off: 'Half-brother' },
	]);
	tree(
		'a rumoured child of Calla alone is half to the legal child, as a birth child of Calla alone would be',
		`people: [{id: wren, sex: m}, {id: calla, sex: f}, {id: pia, sex: f, parents: [calla, {id: wren, type: adoptive}]}, {id: kit, sex: m, parents: [{id: calla, type: rumoured}]}]
unions: [{partners: [wren, calla]}]`,
		[{ me: 'pia', to: 'kit', on: 'Rumoured half-brother', steps: ["kit is pia's rumoured half-brother"] }],
	);
	const xan = (links: string) => `people: [{id: wren, sex: m}, {id: calla, sex: f}, {id: pia, sex: f, parents: [calla, {id: wren, type: adoptive}]}, {id: fenn, sex: m, parents: [wren, calla]}, {id: xan, sex: m, parents: [${links}]}, {id: nell, sex: f, parents: [xan]}]
unions: [{partners: [wren, calla]}]`;
	tree('Xan, adopted by Wren, rumoured son of Calla: the rumour counts as a birth link, so Xan has the two legal parents if it is true', xan('{id: calla, type: rumoured}, {id: wren, type: adoptive}'), [
		{ me: 'pia', to: 'xan', on: 'Adoptive half-brother | Rumoured brother', steps: ["xan is pia's adoptive half-brother", "xan is pia's rumoured brother"] },
		{ me: 'xan', to: 'pia', on: 'Adoptive half-sister | Rumoured sister' },
		{ me: 'fenn', to: 'xan', on: 'Adoptive half-brother | Rumoured brother' },
		{ me: 'pia', to: 'nell', on: 'Adoptive half-niece | Rumoured niece' },
	]);
	tree('the sure form of the same tree: Xan born to Calla and adopted by Wren is the full brother of Pia', xan('calla, {id: wren, type: adoptive}'), [
		{ me: 'pia', to: 'xan', on: 'Brother' },
		{ me: 'fenn', to: 'xan', on: 'Brother' },
	]);
	tree('Xan, adopted by Calla, rumoured son of Wren: a rumoured full brother of Fenn and of Pia', xan('{id: calla, type: adoptive}, {id: wren, type: rumoured}'), [
		{ me: 'fenn', to: 'xan', on: 'Adoptive half-brother | Rumoured brother', steps: ["xan is fenn's adoptive half-brother", "xan is fenn's rumoured brother"] },
		{ me: 'pia', to: 'xan', on: 'Adoptive half-brother | Rumoured brother' },
	]);
	tree(
		'Ann and Bea, adopted by Gus and rumoured daughters of Gwen, and Cal, son of Gwen and rumoured son of Gus: one couple, so no "double"',
		`people: [{id: gus, sex: m}, {id: gwen, sex: f}, {id: ann, sex: f, parents: [{id: gwen, type: rumoured}, {id: gus, type: adoptive}]}, {id: bea, sex: f, parents: [{id: gwen, type: rumoured}, {id: gus, type: adoptive}]}, {id: cal, sex: m, parents: [{id: gus, type: rumoured}, gwen]}, {id: dot, sex: f, parents: [{id: ann, type: rumoured}]}, {id: eli, sex: m, parents: [cal, {id: bea, type: adoptive}]}]
unions: [{partners: [gwen, gus]}, {partners: [bea, cal]}]`,
		[
			{ me: 'dot', to: 'eli', on: 'Rumoured first cousin', steps: ["ann is dot's rumoured mother. bea is ann's adoptive sister. eli is bea's adopted son"] },
			{ me: 'eli', to: 'dot', on: 'Rumoured first cousin' },
		],
	);
});

describe('a legal pair needs a union that does not depend on the order of a list of parents', () => {
	const kim = (parents: string, unions = '') => `people: [{id: wren, sex: m}, {id: calla, sex: f}, {id: ode, sex: m}, {id: pia, sex: f, parents: [calla, {id: wren, type: adoptive}]}, {id: xan, sex: m, parents: [{id: calla, type: rumoured}, {id: wren, type: adoptive}]}, {id: nat, sex: f, parents: [{id: wren, type: adoptive}]}, {id: kim, sex: f, parents: [${parents}]}]${unions}`;
	tree('Kim lists only Wren and Calla: their implicit union makes Pia a legal child', kim('wren, calla'), [
		{ me: 'pia', to: 'kim', on: 'Sister' },
		{ me: 'pia', to: 'nat', on: 'Adoptive half-sister' },
		{ me: 'pia', to: 'xan', on: 'Adoptive half-brother | Rumoured brother' },
	]);
	for (const order of ['wren, calla, ode', 'ode, wren, calla', 'calla, ode, wren']) {
		tree(`Kim lists three birth parents (${order}): no union of Wren and Calla counts, in any order`, kim(order), [
			{ me: 'pia', to: 'kim', on: 'Half-sister | Adoptive half-sister' },
			{ me: 'pia', to: 'nat', on: 'Adoptive sister' },
			{ me: 'pia', to: 'xan', on: 'Adoptive brother | Rumoured half-brother', off: 'Adoptive brother | Rumoured brother' },
		]);
	}
	tree('Kim lists three birth parents, and Wren and Calla are married: the listed union makes Pia a legal child', kim('ode, wren, calla', '\nunions: [{partners: [wren, calla]}]'), [
		{ me: 'pia', to: 'kim', on: 'Half-sister | Adoptive half-sister' },
		{ me: 'pia', to: 'nat', on: 'Adoptive half-sister' },
		{ me: 'pia', to: 'xan', on: 'Adoptive half-brother | Rumoured brother' },
	]);
});

describe('a rumoured parent who is the partner of the sure parent is named in the possessive form, never as a step-parent', () => {
	tree(
		'Ivo is Hal’s father and married to Wyn; a rumour says Wyn is Hal’s mother',
		`people: [{id: ivo, sex: m}, {id: wyn, sex: f}, {id: hal, sex: m, parents: [ivo, {id: wyn, type: rumoured}]}]
unions: [{partners: [ivo, wyn]}]`,
		[
			{ me: 'hal', to: 'wyn', on: 'Rumoured mother | Father’s wife', steps: ["wyn is hal's rumoured mother", "ivo is hal's father. wyn is ivo's wife"] },
			{ me: 'wyn', to: 'hal', on: 'Rumoured son | Husband’s son', steps: ["hal is wyn's rumoured son", "ivo is wyn's husband. hal is ivo's son"] },
		],
	);
	tree(
		'the same after a divorce: the possessive form says "former" (rule P)',
		`people: [{id: ivo, sex: f}, {id: wyn, sex: m}, {id: hal, sex: m, parents: [ivo, {id: wyn, type: rumoured}]}]
unions: [{partners: [ivo, wyn], ended-by: divorce}]`,
		[
			{ me: 'hal', to: 'wyn', on: 'Rumoured father | Mother’s former husband', steps: ["wyn is hal's rumoured father", "ivo is hal's mother. wyn is ivo's former husband"] },
			{ me: 'wyn', to: 'hal', on: 'Rumoured son | Former wife’s son' },
		],
	);
	tree(
		'a rumoured grandmother married to the sure grandfather',
		`people: [{id: gil, sex: m}, {id: gwen, sex: f}, {id: kit, sex: m, parents: [gil, {id: gwen, type: rumoured}]}, {id: hal, sex: m, parents: [kit]}]
unions: [{partners: [gil, gwen]}]`,
		[
			{ me: 'hal', to: 'gwen', on: 'Rumoured grandmother | Grandfather’s wife', steps: ["kit is hal's father. gwen is kit's rumoured mother", "kit is hal's father. gil is kit's father. gwen is gil's wife"] },
			{ me: 'gwen', to: 'hal', on: 'Rumoured grandson | Husband’s grandson' },
		],
	);
	tree(
		'without the rumour the father’s wife is a stepmother',
		`people: [{id: ivo, sex: m}, {id: wyn, sex: f}, {id: ann, sex: f}, {id: hal, sex: m, parents: [ivo, ann]}]
unions: [{partners: [ivo, wyn]}]`,
		[
			{ me: 'hal', to: 'wyn', on: 'Stepmother' },
			{ me: 'wyn', to: 'hal', on: 'Stepson' },
		],
	);
});

describe('one tie, one name: a rumoured named form adds nothing beside a sure one of the same word (rule D)', () => {
	const people = `people: [{id: fen, sex: m}, {id: gil, sex: f}, {id: max, sex: m, parents: [fen, gil]}, {id: ben, sex: m, parents: [fen, gil]}, {id: bo, sex: m, parents: [{id: fen, type: rumoured}]}, {id: wen, sex: f}]`;
	tree(
		'Ben is Max’s half-brother by their mother and a rumoured full brother; Wen was Ben’s wife',
		`people: [{id: fen, sex: m}, {id: gil, sex: f}, {id: max, sex: m, parents: [fen, gil]}, {id: ben, sex: m, parents: [gil, {id: fen, type: rumoured}]}, {id: wen, sex: f}]
unions: [{partners: [wen, ben], ended-by: divorce}]`,
		[
			{ me: 'max', to: 'wen', on: 'Former sister-in-law', steps: ["ben is max's half-brother. wen is ben's former wife"] },
			{ me: 'wen', to: 'max', on: 'Former brother-in-law' },
		],
	);
	tree('Wen married Bo, a rumoured brother of Max, then Ben, a sure brother: one sister-in-law', `${people}
unions: [{partners: [wen, bo], ended-by: divorce}, {partners: [wen, ben]}]`, [
		{ me: 'max', to: 'wen', on: 'Sister-in-law', steps: ["fen is max's father. gil is fen's co-parent. ben is gil's son. wen is ben's wife"] },
		{ me: 'wen', to: 'max', on: 'Brother-in-law' },
	]);
	tree('Wen married Ben, then Bo: the rumoured tie still holds beside the former one, so both names stay', `${people}
unions: [{partners: [wen, ben], ended-by: divorce}, {partners: [wen, bo]}]`, [
		{
			me: 'max',
			to: 'wen',
			on: 'Former sister-in-law | Rumoured sister-in-law',
			steps: ["fen is max's father. gil is fen's co-parent. ben is gil's son. wen is ben's former wife", "bo is max's rumoured half-brother. wen is bo's wife"],
		},
		{ me: 'wen', to: 'max', on: 'Former brother-in-law | Rumoured brother-in-law' },
	]);
});

describe('the partner step of a line by marriage names the marriage of the name (§13.1 rule 6)', () => {
	tree(
		'Ned divorced Ola and later had an affair with her; Pip is Ned’s son',
		`people: [{id: ned, sex: m}, {id: ola, sex: f}, {id: ann, sex: f}, {id: pip, sex: m, parents: [ned, ann]}]
unions: [{partners: [ned, ola], ended-by: divorce}, {partners: [ned, ola], type: affair}]`,
		[
			{ me: 'pip', to: 'ola', on: 'Former stepmother', steps: ["ned is pip's father. ola is ned's former wife"] },
			{ me: 'ola', to: 'pip', on: 'Former stepson', steps: ["ned is ola's former husband. pip is ned's son"] },
			{ me: 'ned', to: 'ola', on: 'Lover', steps: ["ola is ned's lover"] },
		],
	);
	tree(
		'a step-sibling line names the marriage of the two parents',
		`people: [{id: abe, sex: m}, {id: cora, sex: f}, {id: mia, sex: f, parents: [abe]}, {id: pat, sex: m, parents: [cora]}]
unions: [{partners: [abe, cora]}, {partners: [abe, cora], type: betrothal}]`,
		[{ me: 'mia', to: 'pat', on: 'Stepbrother', steps: ["abe is mia's father. cora is abe's wife. pat is cora's son"] }],
	);
});

describe('the finder crosses a couple through the member whose links match the word', () => {
	tree(
		'A is the son of X2 and was adopted by X1; P’s line to A comes up through D, a child of X1 and X2',
		`people: [{id: x1, sex: f}, {id: x2, sex: m}, {id: y, sex: f}, {id: a, sex: m, parents: [x2, {id: x1, type: adoptive}]}, {id: b, sex: f, parents: [x1, x2]}, {id: d, sex: m, parents: [x1, x2]}, {id: g, sex: m, parents: [x2, y]}, {id: e, sex: f, parents: [b]}, {id: f, sex: f, parents: [d]}, {id: pp, sex: m, parents: [f, g, {id: e, type: adoptive}]}]`,
		[
			{
				me: 'pp',
				to: 'a',
				on: 'Half-uncle, maybe full | Great-uncle',
				off: 'Half-uncle | Great-uncle',
				steps: ["g is pp's father. a is g's half-brother", "f is pp's mother. d is f's father. x1 is d's mother. x2 is x1's co-parent. a is x2's son"],
			},
			{
				me: 'a',
				to: 'pp',
				on: 'Half-nephew, maybe full | Great-nephew',
				off: 'Half-nephew | Great-nephew',
				steps: ["g is a's half-brother. pp is g's son", "x2 is a's father. x1 is x2's co-parent. d is x1's son. f is d's daughter. pp is f's son"],
			},
		],
	);
	tree(
		'an adoptive brother by two adoptions keeps the adoptive steps (D293)',
		`people: [{id: wren, sex: m}, {id: calla, sex: f}, {id: pia, sex: f, parents: [wren, {id: calla, type: adoptive}]}, {id: fenn, sex: m, parents: [calla, {id: wren, type: adoptive}]}]
unions: [{partners: [wren, calla]}]`,
		[{ me: 'pia', to: 'fenn', on: 'Adoptive brother', steps: ["calla is pia's adoptive mother. wren is calla's husband. fenn is wren's adopted son"] }],
	);
});

describe('a possessive form says no more than the spouse’s own list', () => {
	// Sue is Fen's daughter and a rumoured daughter of Gus; Hal is Fen's and Gus's son, Ivo is Gus's son. Pip is the son of Jon (Hal's
	// son) and Kay (Ivo's daughter). Max is Sue's husband.
	const note = `people: [{id: fen, sex: f}, {id: gus, sex: m}, {id: sue, sex: f, parents: [fen, {id: gus, type: rumoured}]}, {id: hal, sex: m, parents: [fen, gus]}, {id: ivo, sex: m, parents: [gus]}, {id: jon, sex: m, parents: [hal]}, {id: kay, sex: f, parents: [ivo]}, {id: pip, sex: m, parents: [jon, kay]}, {id: max, sex: m}]
unions: [{partners: [max, sue]}]`;
	tree('Max’s list has no "Wife’s rumoured half-great-nephew", since Sue’s list has no "Rumoured half-great-nephew"', note, [
		{
			me: 'max',
			to: 'pip',
			on: 'Wife’s half-great-nephew | Wife’s rumoured great-nephew',
			steps: [
				"sue is max's wife. hal is sue's half-brother. jon is hal's son. pip is jon's son",
				"sue is max's wife. gus is sue's rumoured father. fen is gus's co-parent. hal is fen's son. jon is hal's son. pip is jon's son",
			],
		},
	]);
	// Known limit: the rumoured half line through Ivo (Sue's rumoured half-brother, Kay's father) is a line of its own, but a rumoured half
	// line of the same degree as a sure half line with a rumoured "maybe full" adds no name, so neither list names it.
	tree('known limit: the rumoured line through Ivo shows in neither list', note, [
		{
			me: 'sue',
			to: 'pip',
			on: 'Half-great-nephew, maybe full | Rumoured great-nephew',
			steps: ["hal is sue's half-brother. jon is hal's son. pip is jon's son", "gus is sue's rumoured father. fen is gus's co-parent. hal is fen's son. jon is hal's son. pip is jon's son"],
		},
	]);
});

describe('the line of a step-sibling goes through birth links before an adoptive link', () => {
	const note = (mia: string) => `people: [{id: abe, sex: m}, {id: bea, sex: f}, {id: cora, sex: f}, {id: dan, sex: m}, {id: mia, sex: f, parents: [${mia}]}, {id: pat, sex: m, parents: [cora, dan]}]
unions: [{partners: [abe, cora]}, {partners: [bea, dan]}]`;
	for (const parents of ['{id: abe, type: adoptive}, bea', 'bea, {id: abe, type: adoptive}']) {
		tree(`Mia (birth Bea, adopted by Abe) and Pat, parents of Mia listed [${parents}]`, note(parents), [
			{ me: 'mia', to: 'pat', on: 'Stepbrother', steps: ["bea is mia's mother. dan is bea's husband. pat is dan's son"] },
			{ me: 'pat', to: 'mia', on: 'Stepsister', steps: ["dan is pat's father. bea is dan's wife. mia is bea's daughter"] },
		]);
	}
});

describe('known limits of the relation names, pinned as they are', () => {
	tree(
		'a rumoured second parent on one sister only: half-sister, "maybe full" with the setting on (D174 item 3)',
		`people: [{id: fred, sex: m}, {id: mona, sex: f}, {id: ava, sex: f, parents: [fred]}, {id: bel, sex: f, parents: [fred, {id: mona, type: rumoured}]}]`,
		[
			{ me: 'ava', to: 'bel', on: 'Half-sister, maybe full', off: 'Half-sister', steps: ["bel is ava's half-sister"] },
			{ me: 'bel', to: 'ava', on: 'Half-sister, maybe full', off: 'Half-sister', steps: ["ava is bel's half-sister"] },
		],
	);
	tree(
		'limit (d): a man married to his mother has no step-descendant name when the line through him is shorter',
		`people: [{id: sela, sex: f}, {id: xan, sex: m}, {id: yan, sex: m}, {id: milo, sex: m, parents: [sela, xan]}, {id: jude, sex: m, parents: [sela, yan]}, {id: kit, sex: f, parents: [jude]}, {id: pell, sex: m, parents: [milo, kit]}]
unions: [{partners: [milo, sela]}]`,
		[{ me: 'milo', to: 'pell', on: 'Son | Half-great-nephew', steps: ["pell is milo's son", "jude is milo's half-brother. kit is jude's daughter. pell is kit's son"] }],
	);
	tree(
		'three birth parents: only the first two listed are co-parents',
		`people: [{id: abe, sex: m}, {id: bea, sex: f}, {id: cy, sex: m}, {id: kim, sex: f, parents: [abe, bea, cy]}]`,
		[
			{ me: 'abe', to: 'bea', on: 'Co-parent', steps: ["bea is abe's co-parent"] },
			{ me: 'abe', to: 'cy', on: '' },
		],
	);
	tree(
		'three birth parents in another order: the first one listed is no co-parent of the last',
		`people: [{id: abe, sex: m}, {id: bea, sex: f}, {id: cy, sex: m}, {id: kim, sex: f, parents: [cy, bea, abe]}]`,
		[
			{ me: 'abe', to: 'bea', on: '' },
			{ me: 'abe', to: 'cy', on: '' },
		],
	);
	tree(
		'limit (a): a link word is not restored, so "Wife’s adoptive half-nephew" does not show',
		`people: [{id: xav, sex: m}, {id: yva, sex: f}, {id: zia, sex: f}, {id: quin, sex: f, parents: [yva, {id: xav, type: adoptive}]}, {id: mark, sex: m, parents: [xav, yva]}, {id: sue, sex: f, parents: [xav, zia]}, {id: paul, sex: m, parents: [mark, quin]}]
unions: [{partners: [mark, sue]}]`,
		[{ me: 'mark', to: 'paul', on: 'Son | Nephew' }],
	);
	tree(
		'a half-sister who lists one parent: "maybe full" only with the setting on',
		`people: [{id: david, sex: m}, {id: mary, sex: f}, {id: fiona, sex: f, parents: [david, mary]}, {id: helen, sex: f, parents: [mary]}]`,
		[
			{ me: 'fiona', to: 'helen', on: 'Half-sister, maybe full', off: 'Half-sister', steps: ["helen is fiona's half-sister"] },
			{ me: 'helen', to: 'fiona', on: 'Half-sister, maybe full', off: 'Half-sister', steps: ["fiona is helen's half-sister"] },
		],
	);
});
