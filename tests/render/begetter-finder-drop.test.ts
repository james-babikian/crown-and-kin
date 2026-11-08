import { describe, expect, it } from 'vitest';
import { findRelation, lineSubgraph } from '../../src/core/relations';
import { cardForm, geometryFor } from '../../src/layout/geometry';
import { DEFAULT_LAYOUT_SETTINGS, clearLayoutCache, layoutTree } from '../../src/layout/index';
import { build, fixture } from '../support/helpers';

describe('the finder small tree draws a begetter drop with the begetter stroke', () => {
	it('the drop from a begetter to a child that hangs from him is drawn with the begetter stroke (contract section 3, dropKind)', () => {
		const { g } = build(fixture('20'));
		const f = findRelation(g, 'lys', 'oswin');
		if (f.kind !== 'named') throw new Error('no name');
		const sub = lineSubgraph(g, f.relations[0].relation.line);
		expect(sub.placementType.get('ada')).toBe('begetter');
		clearLayoutCache();
		const laid = layoutTree(sub, cardForm(geometryFor(16), 'down'), DEFAULT_LAYOUT_SETTINGS, 'font');
		const kinds = laid.edges.paths.filter((p) => p.people.includes('ada') && p.people.includes('oswin')).map((p) => p.kind);
		expect(kinds).toContain('begetter');
	});
});
