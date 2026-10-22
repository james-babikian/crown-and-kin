/**
 * One deep freeze for the shared results of the core and layout caches (parse cache, relation cache, layout cache).
 * It is a leaf: it imports nothing.
 */

const readOnly = () => {
	throw new TypeError('Cached results are read-only');
};

/** Makes `set`, `delete` and `clear` of a Map throw: `Object.freeze` does not stop them on a Map. */
export function lockMap(map: Map<unknown, unknown>): void {
	for (const method of ['set', 'delete', 'clear']) Object.defineProperty(map, method, { value: readOnly });
}

/**
 * Freezes a plain data value at every depth and returns it. A Map is frozen with its keys and values, and `set`, `delete`
 * and `clear` throw, because `Object.freeze` does not stop them on a Map. A cycle or a shared object is visited once.
 * An object that is already frozen is taken as frozen all the way down, so a shared result is not walked twice.
 */
export function deepFreeze<T>(value: T): T {
	if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
	const isMap = value instanceof Map;
	if (isMap) lockMap(value);
	// Freeze first: a cycle then meets a frozen object and stops.
	Object.freeze(value);
	if (isMap) {
		for (const [k, v] of value) {
			deepFreeze(k);
			deepFreeze(v);
		}
	} else {
		for (const v of Object.values(value)) deepFreeze(v);
	}
	return value;
}
