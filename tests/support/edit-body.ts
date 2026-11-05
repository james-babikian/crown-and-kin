// The body of an edit result for the edit tests: a refusal fails the test with its code, so a test that expects a body never reads a refusal.
import type { EditResult } from '../../src/core/edit';

/** The new body of an edit that was applied; throws with the refusal code when the edit was refused. */
export function body(r: EditResult): string {
	if (!r.ok) throw new Error(`refused: ${r.code} ${r.detail ?? ''}`);
	return r.body;
}
