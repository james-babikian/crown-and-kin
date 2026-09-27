/**
 * Places items on a line in a fixed order, as close as possible to their target positions
 * (least squares), while keeping each item at least `minGap[i]` after the previous one.
 * `minGap[0]` is ignored. Pool-adjacent-violators on the gap-adjusted targets: O(n).
 */
export function placeInOrder(targets: number[], minGap: number[]): number[] {
	const n = targets.length;
	if (n === 0) return [];
	const offset = new Array<number>(n);
	offset[0] = 0;
	for (let i = 1; i < n; i++) offset[i] = offset[i - 1] + minGap[i];

	// Isotonic regression of (target - offset): blocks of [sum, count].
	const sums: number[] = [];
	const counts: number[] = [];
	for (let i = 0; i < n; i++) {
		sums.push(targets[i] - offset[i]);
		counts.push(1);
		while (sums.length > 1) {
			const k = sums.length - 1;
			if (sums[k - 1] / counts[k - 1] <= sums[k] / counts[k]) break;
			sums[k - 1] += sums[k];
			counts[k - 1] += counts[k];
			sums.pop();
			counts.pop();
		}
	}
	const out = new Array<number>(n);
	let i = 0;
	for (let b = 0; b < sums.length; b++) {
		const mean = sums[b] / counts[b];
		for (let c = 0; c < counts[b]; c++, i++) out[i] = mean + offset[i];
	}
	return out;
}
