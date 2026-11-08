/*
 * The parent types, the most parents of each type and the most parents by blood (spec §4.2, D332). A leaf of the core: `types.ts` re-exports these names, and `messages.ts` reads the
 * limit for its warning text without importing `types.ts` (that import and the type import the other way made a cycle).
 */

/** The parent types a parent entry can have (spec §4.2). */
export const PARENT_TYPES = ['birth', 'adoptive', 'ward', 'rumoured', 'begetter'] as const;
/** One of `PARENT_TYPES`. */
export type ParentType = (typeof PARENT_TYPES)[number];

/**
 * The most parents of each type that a person may have. Birth, adoptive, ward and begetter parents warn above 2;
 * a rumoured parent is a guess, so a person may have more of them. Read by the family query, the warning text and the relation rules.
 */
export const PARENT_LIMIT: Record<ParentType, number> = { birth: 2, adoptive: 2, ward: 2, rumoured: 8, begetter: 2 };

/** The parent types by blood (D332): birth and begetter links together have their own limit. */
export const BLOOD_TYPES = ['birth', 'begetter'] as const;

/** The most parents by blood (birth and begetter links, distinct ids) a person may have. */
export const BLOOD_LIMIT = 2;

/** True for a parent type by blood (`BLOOD_TYPES`). */
export const isBloodType = (t: string): boolean => t === 'birth' || t === 'begetter';
