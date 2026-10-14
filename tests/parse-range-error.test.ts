import { describe, expect, it, vi } from 'vitest';
import { LIMIT_DETAIL } from '../src/core/messages';

/*
 * WP-H2 fix round: only a stack overflow is reported as "too deep". The package is replaced by one that throws, so each
 * error can be tested alone.
 */

const thrown = vi.hoisted(() => ({ error: null as unknown }));
vi.mock('yaml', async (importOriginal) => {
	const real = await importOriginal<typeof import('yaml')>();
	return {
		...real,
		parseDocument: (...args: Parameters<typeof real.parseDocument>) => {
			if (thrown.error) throw thrown.error;
			return real.parseDocument(...args);
		},
	};
});

import { parseBody } from '../src/core/parse';

describe('the "too deep" text is only for a stack overflow', () => {
	it('a RangeError of the engine stack is too deep', () => {
		thrown.error = new RangeError('Maximum call stack size exceeded');
		expect(parseBody('a: 1\n')).toEqual({ ok: false, error: { code: 'yaml-invalid', detail: LIMIT_DETAIL.tooDeep } });
	});

	it('the message of Firefox and Safari is too deep', () => {
		thrown.error = new RangeError('too much recursion');
		expect(parseBody('a: 1\n')).toMatchObject({ ok: false, error: { detail: LIMIT_DETAIL.tooDeep } });
	});

	it('a RangeError with another message is not too deep', () => {
		thrown.error = new RangeError('Invalid array length');
		const r = parseBody('a: 1\n');
		expect(r).toEqual({ ok: false, error: { code: 'yaml-invalid', detail: 'Invalid array length' } });
	});

	it('a stack overflow from another realm (a plain object with the message) is too deep', () => {
		thrown.error = { name: 'RangeError', message: 'Maximum call stack size exceeded' };
		expect(parseBody('a: 1\n')).toMatchObject({ ok: false, error: { detail: LIMIT_DETAIL.tooDeep } });
	});
});
