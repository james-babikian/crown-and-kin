import { describe, expect, it } from 'vitest';
import { checkNewId, makeIdFromName, newIdIn, nextPersonId, personIdSource, slugify, uniqueId } from '../../src/core/id-gen';
import { newTitleId } from '../../src/core/title-ops';
import { newHouseId } from '../../src/core/yaml-edit';

describe('ids', () => {
	it('slugifies names', () => {
		expect(slugify('Aldric Valmont')).toBe('aldric-valmont');
		expect(slugify('Þórr Ísólfsson')).toBe('thorr-isolfsson');
		// 0.2.8 (I16): the letters of other writing systems stay in an id.
		expect(slugify('李')).toBe('李');
		expect(slugify('???')).toBe('person');
		expect(slugify('1102')).toBe('p-1102');
	});
	it('maps Latin letters that NFKD does not split', () => {
		expect(slugify('ŁUKASZ Władysław')).toBe('lukasz-wladyslaw');
		expect(slugify('Đorđe')).toBe('dorde');
		expect(slugify('Œdipe Cœur')).toBe('oedipe-coeur');
		expect(slugify('Ħal Għargħur')).toBe('hal-gharghur');
		expect(slugify('Kırıkkale')).toBe('kirikkale');
	});
	it('avoids collisions', () => {
		expect(uniqueId('Aldric', new Set(['aldric', 'aldric-2']))).toBe('aldric-3');
	});
});

describe('newIdIn', () => {
	it('avoids the ids of the items in the list, whatever else the list holds', () => {
		expect(newIdIn([{ id: 'a' }, { id: 'a-2' }, null, 'a-3', { name: 'x' }], 'A')).toBe('a-3');
		expect(newIdIn([{ id: 7 }], '7')).toBe('p-7');
		expect(newIdIn(undefined, 'Hal Ashford')).toBe('hal-ashford');
		expect(newIdIn({ id: 'hal-ashford' }, 'Hal Ashford')).toBe('hal-ashford');
	});
});

describe('nextPersonId (D104, spec §13.17 rule 1)', () => {
	const next = (...ids: string[]) => nextPersonId(new Set(ids));

	it('p1 when no id is numbered, and p8 after p7', () => {
		expect(next()).toBe('p1');
		expect(next('aldric', 'bea')).toBe('p1');
		expect(next('p7')).toBe('p8');
		expect(next('p1', 'p2', 'p7', 'p3')).toBe('p8');
	});

	it('ids of other shapes are ignored', () => {
		for (const other of ['aldric', 'p-5', 'p1a', 'p3-p7', 'P5', '~3', 'p', 'p 9', 'pp9', '9', 'p9.5', ' p9', 'p9 ', 'p٣']) expect(next(other), other).toBe('p1');
		expect(next('p3-p7', 'p2')).toBe('p3');
	});

	it('leading zeros count', () => {
		expect(next('p007')).toBe('p8');
		expect(next('p0')).toBe('p1');
		expect(next('p000')).toBe('p1');
	});

	it('an id with more than 15 digits is ignored, and the result is never taken', () => {
		expect(next('p1234567890123456')).toBe('p1');
		expect(next('p999999999999999')).toBe('p1000000000000000');
		const taken = new Set(['p999999999999999']);
		for (let i = 0; i < 4; i++) {
			const id = nextPersonId(taken);
			expect(taken.has(id)).toBe(false);
			taken.add(id);
		}
		expect([...taken].sort()).toEqual(['p1000000000000000', 'p1000000000000001', 'p1000000000000002', 'p1000000000000003', 'p999999999999999']);
	});

	it('does not change `taken`', () => {
		const taken = new Set(['p3']);
		nextPersonId(taken);
		expect([...taken]).toEqual(['p3']);
	});

	it('a gap is not filled: only the highest number counts', () => {
		expect(next('p1', 'p5')).toBe('p6');
	});

	it('property: the result is above every counted number, is not taken, and adding it gives the next one', () => {
		let a = 12345;
		const rand = () => {
			a = (Math.imul(a, 1103515245) + 12345) >>> 0;
			return a / 4294967296;
		};
		const shapes = ['p', 'q', 'P', 'p-', 'p0', '~', ''];
		for (let round = 0; round < 200; round++) {
			const taken = new Set<string>();
			const size = Math.floor(rand() * 12);
			let highest = 0;
			for (let i = 0; i < size; i++) {
				const n = Math.floor(rand() * 40);
				const pad = rand() < 0.2 ? '00' : '';
				const shape = shapes[Math.floor(rand() * shapes.length)];
				taken.add(`${shape}${pad}${n}${rand() < 0.1 ? 'x' : ''}`);
			}
			for (const id of taken) {
				const m = /^p(\d+)$/.exec(id);
				if (m) highest = Math.max(highest, Number(m[1]));
			}
			const id = nextPersonId(taken);
			expect(id).toBe(`p${highest + 1}`);
			expect(taken.has(id)).toBe(false);
			taken.add(id);
			expect(nextPersonId(taken)).toBe(`p${highest + 2}`);
		}
	});
});

describe('personIdSource (the reader makes many examples at once)', () => {
	// The first version of `nextPersonId`, kept here as the reference: a scan of `taken` on each call.
	const reference = (taken: ReadonlySet<string>): string => {
		let max = 0;
		for (const id of taken) {
			const m = /^p(\d+)$/.exec(id);
			if (m && m[1].length <= 15) max = Math.max(max, Number(m[1]));
		}
		let n = max + 1;
		while (taken.has(`p${n}`)) n++;
		return `p${n}`;
	};

	it('gives p1, p2, p3 for a set with no numbered id, and adds each id to `taken`', () => {
		const taken = new Set(['aldric']);
		const next = personIdSource(taken);
		expect([next(), next(), next()]).toEqual(['p1', 'p2', 'p3']);
		expect([...taken]).toEqual(['aldric', 'p1', 'p2', 'p3']);
	});

	it('continues after the highest number, and the 15-digit rule holds', () => {
		const next = personIdSource(new Set(['p7', 'p1234567890123456']));
		expect([next(), next()]).toEqual(['p8', 'p9']);
		const big = personIdSource(new Set(['p999999999999999']));
		expect([big(), big(), big()]).toEqual(['p1000000000000000', 'p1000000000000001', 'p1000000000000002']);
	});

	it('property: the same sequence as repeated calls of the first version with a growing `taken`', () => {
		let a = 987;
		const rand = () => {
			a = (Math.imul(a, 1103515245) + 12345) >>> 0;
			return a / 4294967296;
		};
		const shapes = ['p', 'q', 'P', 'p-', 'p0', '~', ''];
		const bigs = ['p999999999999998', 'p999999999999999', 'p1000000000000000', 'p1000000000000001', 'p1234567890123456'];
		for (let round = 0; round < 300; round++) {
			const taken = new Set<string>();
			const size = Math.floor(rand() * 14);
			for (let i = 0; i < size; i++) {
				if (rand() < 0.2) taken.add(bigs[Math.floor(rand() * bigs.length)]);
				else taken.add(`${shapes[Math.floor(rand() * shapes.length)]}${rand() < 0.2 ? '00' : ''}${Math.floor(rand() * 40)}${rand() < 0.1 ? 'x' : ''}`);
			}
			const slow = new Set(taken);
			const fast = new Set(taken);
			const next = personIdSource(fast);
			for (let i = 0; i < 12; i++) {
				const expected = reference(slow);
				slow.add(expected);
				expect(next(), `round ${round}, call ${i}`).toBe(expected);
			}
			expect([...fast].sort()).toEqual([...slow].sort());
		}
	});
});

describe('checkNewId (spec §13.17 rule 5)', () => {
	const none = new Set<string>();

	it('an id that is fine', () => {
		for (const ok of ['crown', 'valmont-2', 'a', '7', 'house-7', '-a-', 'a--b', 'á', '李', 'иван']) expect(checkNewId(ok, none), ok).toBeNull();
	});

	it('empty', () => {
		expect(checkNewId('', none)).toBe('empty');
		expect(checkNewId('   ', none)).toBe('empty');
	});

	it('a character other than a-z, 0-9 and hyphen, and an id with no letter and no digit', () => {
		for (const bad of ['Valmont', 'VALMONT', 'a b', ' a', 'a ', 'a_b', 'a.b', 'a/b', '-', '--', '---']) expect(checkNewId(bad, none), bad).toBe('characters');
	});

	it('an id that is taken', () => {
		expect(checkNewId('crown', new Set(['crown']))).toBe('taken');
		expect(checkNewId('crown', new Set(['Crown']))).toBeNull();
	});

	it('the order of the reasons: empty, then characters, then taken', () => {
		expect(checkNewId('', new Set(['']))).toBe('empty');
		expect(checkNewId('Crown', new Set(['Crown']))).toBe('characters');
	});

	it('does not throw for input that is not text', () => {
		expect(checkNewId(undefined as unknown as string, none)).toBe('empty');
		expect(checkNewId(5 as unknown as string, none)).toBe('empty');
	});
});

describe('makeIdFromName (spec §13.17 rule 5)', () => {
	const none = new Set<string>();

	it('a house: the slug of the name, with -2 on a clash', () => {
		expect(makeIdFromName('house', 'House Valmont', none)).toBe('house-valmont');
		expect(makeIdFromName('house', 'Valmont', new Set(['valmont']))).toBe('valmont-2');
		expect(makeIdFromName('house', 'Valmont', new Set(['valmont', 'valmont-2']))).toBe('valmont-3');
		expect(makeIdFromName('house', '1102', none)).toBe('p-1102');
	});

	it('a title: the same, and `title` when the name has no usable letter', () => {
		expect(makeIdFromName('title', 'Duke of Valmont', none)).toBe('duke-of-valmont');
		expect(makeIdFromName('title', '???', none)).toBe('title');
		expect(makeIdFromName('title', '???', new Set(['title']))).toBe('title-2');
		expect(makeIdFromName('title', '李', none)).toBe('李');
		expect(makeIdFromName('title', '', none)).toBe('title');
		expect(makeIdFromName('title', 'Person of note', none)).toBe('person-of-note');
	});

	it('a title id is the one newTitleId gives, and a house id the one add-house gives', () => {
		const body = 'titles:\n  - {id: duke, name: D}\nhouses:\n  - {id: valmont, name: V}\npeople:\n  - {id: p1, name: One}\n';
		expect(makeIdFromName('title', 'Duke', new Set(['duke']))).toBe(newTitleId(body, 'Duke'));
		expect(makeIdFromName('title', '李', new Set(['title']))).toBe(newTitleId('titles:\n  - {id: title, name: T}\n', '李'));
		expect(makeIdFromName('house', 'Valmont', new Set(['valmont']))).toBe(newHouseId({ houses: [{ id: 'valmont' }] }, 'Valmont'));
	});

	it('a result is accepted by checkNewId', () => {
		for (const name of ['House Valmont', 'Þórr', '李', '1102', 'A--B', '']) {
			for (const kind of ['house', 'title'] as const) expect(checkNewId(makeIdFromName(kind, name, none), none), `${kind} ${name}`).toBeNull();
		}
	});
});
