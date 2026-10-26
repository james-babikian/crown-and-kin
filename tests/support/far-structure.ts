// The judge of the third class of far couple (spec §5.3, D303, the architecture notes A15), read from a finished layout and not from the plan: a couple on two
// rows whose lower partner stands inside a unit (the cards on both sides of it are joined to it by bars) is far by structure, whatever the distance. The
// judges of D11 (`farProblems` in an internal script, `farRuleProblems` in the sideways checks, the stage tests) accept such a couple as far and expect it to be far.
// It is written from the rule, not from `isFarByStructure` of src/layout/layout.ts, so that a mistake in the plan shows.
import type { FamilyGraph } from '../../src/core/derive';
import type { FarCoupleRule, TreeLayout } from '../../src/layout/model';

/** Whether the union `key` is far by structure in this finished layout under `rule` (a rule that never makes a couple far has none). */
export function isStructuralFar(g: FamilyGraph, layout: TreeLayout, key: string, rule: FarCoupleRule): boolean {
	if (!Number.isFinite(rule.maxCardWidths) && !Number.isFinite(rule.maxGenerations)) return false;
	const fu = g.unionByKey.get(key);
	if (!fu) return false;
	const [a, b] = fu.partners.map((p) => layout.persons.get(p)!);
	if (a.gen === b.gen) return false;
	const lower = a.gen > b.gen ? a : b;
	const row = layout.rows[lower.gen];
	const at = row.indexOf(lower.id);
	const joined = (other: string | undefined) => other !== undefined && (g.unionsOf.get(lower.id) ?? []).some((k) => g.unionByKey.get(k)!.partners.includes(other) && layout.unions.get(k)!.bar);
	return joined(row[at - 1]) && joined(row[at + 1]);
}

/** Every union of the graph that is far by structure in this layout. */
export function structuralFarKeys(g: FamilyGraph, layout: TreeLayout, rule: FarCoupleRule): string[] {
	return g.unions.filter((fu) => isStructuralFar(g, layout, fu.key, rule)).map((fu) => fu.key);
}
