import { describe, expect, it } from 'vitest';
import { deriveFamilies } from '../src/core/derive';
import { parseDynasty } from '../src/core/parse';
import { applyOp } from '../src/core/yaml-edit';

/*
 * Review 0.1.1 area E, finding 1: `set-person-fields` with `id` gives a person with no written id
 * (named `~N` after their place in the list) a written id, so later ops of the batch can name them.
 */

const NO_IDS = ['people:', '  - id: a', '    name: Aldric', '  # Bran has no id yet', '  - name: Bran', '    parents: [a]', '  - {name: Cora}', ''].join('\n');

describe('set-person-fields with id', () => {
	it('writes the id as the first key, and nothing else changes', () => {
		const r = applyOp(NO_IDS, { kind: 'set-person-fields', id: '~2', fields: { id: 'bran' } });
		expect(r.ok && r.body).toBe(NO_IDS.replace('  - name: Bran', '  - id: bran\n    name: Bran'));
	});

	it('a flow map gets the id too', () => {
		const r = applyOp(NO_IDS, { kind: 'set-person-fields', id: '~3', fields: { id: 'cora' } });
		expect(r.ok && r.body).toContain('  - {id: cora, name: Cora}');
	});

	it('an empty id key gets the value', () => {
		const body = ['people:', '  - id:', '    name: Bran', ''].join('\n');
		const r = applyOp(body, { kind: 'set-person-fields', id: '~1', fields: { id: 'bran' } });
		expect(r.ok && r.body).toBe(['people:', '  - id: bran', '    name: Bran', ''].join('\n'));
	});

	it('in a batch, the next op names the person by the new id', () => {
		const r = applyOp(NO_IDS, {
			kind: 'batch',
			ops: [
				{ kind: 'set-person-fields', id: '~2', fields: { id: 'bran' } },
				{ kind: 'set-person-fields', id: 'bran', fields: { title: 'Squire' } },
				{ kind: 'set-option', key: 'focus', value: 'bran' },
			],
		});
		if (!r.ok) throw new Error(r.code);
		const p = parseDynasty(r.body);
		if (!p.ok) throw new Error('parse');
		const g = deriveFamilies(p.tree);
		expect(g.byId.get('bran')?.title).toBe('Squire');
		expect(p.tree.options.focus).toBe('bran');
	});

	it('refuses an id in use, a person with an id, and an id that is not text', () => {
		expect(applyOp(NO_IDS, { kind: 'set-person-fields', id: '~2', fields: { id: 'a' } })).toMatchObject({ ok: false, code: 'id-taken' });
		expect(applyOp(NO_IDS, { kind: 'set-person-fields', id: 'a', fields: { id: 'aldric' } })).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp(NO_IDS, { kind: 'set-person-fields', id: '~2', fields: { id: ' ' } })).toMatchObject({ ok: false, code: 'bad-value' });
		expect(applyOp(NO_IDS, { kind: 'set-person-fields', id: '~2', fields: { id: 7 as never } })).toMatchObject({ ok: false, code: 'bad-value' });
	});
});
