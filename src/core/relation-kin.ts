/*
 * The top class of the search for relation names, `Kin`: every kind of name of one person to another (partner, guardian, ward, by marriage, step-sibling, blood), their order
 * and lines, the finder's chain and steps, and the frozen `Relation`. The base classes are `KinBase` (`relation-kin-base.ts`) and `KinBlood` (`relation-kin-blood.ts`). The rules are in the header of `relations.ts`.
 */

import { deepFreeze } from './deep-freeze';
import type { FamilyUnion } from './derive';
import { compareCands, forget, isFullCousin, maybeRank, walkLine, withoutFormerTwins } from './relation-candidates';
import { type Blood, type BloodLine, BY_IN_LAW, BY_MARRIAGE, BY_STEP, type Cand, type Edge, FORMER, implicitKey, isStepLink, type Line, named, possessive, type Up, type Walk, type Word } from './relation-internal';
import { KinBlood } from './relation-kin-blood';
import { type Relation, relationCallStats, type RelationLine, type RelationMaybe, type RelationStep } from './relation-types';
import { capital, childStepWord, cousinWord, nephewWord, parentStepWord, type Sex, siblingStepWord, uncleWord, WORDS } from './relation-words';

/** The top layer of the relation search: the names of one person to another, the chain, the steps and the frozen relations. */
export class Kin extends KinBlood {
	/**
	 * The walk of a blood candidate (file header, "Lines", blood): up from the first person to `x`;
	 * for a full relation across the couple to `x`'s partner; then down to the second person.
	 */
	bloodWalk(c: BloodLine): Walk {
		const nodes = [...c.pathF];
		const edges: Edge[] = [];
		for (let i = 0; i + 1 < c.pathF.length; i++) edges.push({ k: 'up', type: this.typeOf(c.pathF[i], c.pathF[i + 1]) });
		let top = c.x;
		if (c.y >= 0 && c.a > 0 && c.b > 0) {
			nodes.push(c.y);
			edges.push({ k: 'partner', union: this.coupleUnion(c.pathF[c.pathF.length - 2], c.x, c.y) });
			top = c.y;
		}
		for (let i = c.pathP.length - 2; i >= 0; i--) {
			nodes.push(c.pathP[i]);
			edges.push({ k: 'down', type: this.typeOf(c.pathP[i], i === c.pathP.length - 2 ? top : c.pathP[i + 1]) });
		}
		return { nodes, edges };
	}

	/** The line of a blood candidate. */
	bloodLine(c: BloodLine): Line {
		return walkLine(this.bloodWalk(c));
	}

	/** Every named relation of `p` to `m` (§13.1), best first, one per name. */
	relationsFor(m: number, p: number): Cand[] {
		relationCallStats.calls++;
		this.clearScratch();
		const cands: Cand[] = [];
		const sexP = this.sex[p];
		const aP = this.anc(p);

		const pu = this.pairUnion(m, p);
		if (pu) {
			const walk: Walk = { nodes: [m, p], edges: [{ k: 'partner', union: pu.key }] };
			cands.push({ ...this.partnerOf(pu, m, p), kind: 'partner', distance: 1, cat: 0, direct: 1, half: 0, removal: 0, elder: 0, group: 0, anc: -1, make: () => ({ line: walkLine(walk), walk }) });
		}

		if (this.drawn[m].some((l) => l.p === p && l.type === 'ward')) cands.push(this.wardCand(m, p, 'guardian'));
		if (this.drawn[p].some((l) => l.p === m && l.type === 'ward')) cands.push(this.wardCand(m, p, 'ward'));

		const blood = this.blood(m, p, aP);
		// A rumoured half line of the same degree as a sure line whose "maybe full" the rumour causes adds no name: the "maybe" has made its
		// "Rumoured" name already. It reads no pair of children, since the lines kept for a key depend on the order of the people.
		const dupRumoured = (rc: Blood) => rc.word === 'rumoured' && blood.some((c) => c !== rc && c.word !== 'rumoured' && c.maybe === 'full' && c.cause === 'rumoured' && c.half && rc.half && c.a === rc.a && c.b === rc.b);
		for (const c of blood) {
			if (dupRumoured(c)) continue;
			const lower = this.bloodLower(c, sexP);
			cands.push({
				lower,
				...(c.maybe ? { maybe: this.maybeOf(c, sexP) } : {}),
				kind: 'blood',
				distance: c.a + c.b,
				cat: c.word === 'rumoured' ? 4 : c.word === 'adoptive' ? 1 : 0,
				second: c.word === 'rumoured',
				direct: c.a === 0 || c.b === 0 ? 0 : 1,
				half: c.half ? 1 : 0,
				removal: Math.abs(c.a - c.b),
				elder: c.a - c.b,
				group: 0,
				anc: c.x,
				make: () => ({ line: this.bloodLine(c), walk: this.bloodWalk(c) }),
			});
		}

		// D123: the name that the rumoured parents would make true is also a relation, with the word "rumoured", unless a rumoured line already gave it.
		// A doubt of only a parent who is not listed adds no name (D174).
		const have = new Set(cands.map((c) => c.lower));
		for (const c of blood) {
			if (!c.maybe || c.cause !== 'rumoured') continue;
			const lower = this.bloodLower({ ...c, half: !c.half, word: 'rumoured' }, sexP);
			// A "double" name of the rumoured lines already says that the rumours make them full cousins, and more.
			if (have.has(lower) || have.has(this.bloodLower({ ...c, half: !c.half, word: 'rumoured', double: true }, sexP))) continue;
			have.add(lower);
			// The line of the pair of children that the rumour concerns, so that a step says "rumoured" whatever the order of the people.
			const source = c.maybeFrom ?? c;
			cands.push({
				lower,
				kind: 'blood',
				distance: c.a + c.b,
				cat: 4,
				second: true,
				direct: 1,
				half: c.half ? 0 : 1,
				removal: Math.abs(c.a - c.b),
				elder: c.a - c.b,
				group: 0,
				stepHalf: !c.half,
				anc: c.x,
				// A half name passes the top of its line alone (D176 item 7): the rumoured parent is not an ancestor of the other person, so a couple would be false.
				make: () => {
					const top = c.half ? source : { ...source, y: -1 };
					return { line: this.bloodLine(top), walk: this.bloodWalk(top) };
				},
			});
		}

		// A sure blood name of P puts the names by marriage after it (D200 R3 key 2) and hides rule 1; a name through a rumoured link does neither.
		const sureBlood = blood.some((c) => c.word !== 'rumoured');
		// By marriage, rule 1: P is married to a blood relative R of M, and P is not a sure blood relative.
		if (!sureBlood) {
			// A rumoured blood relative P can lie on the line from M to R, and the line lists each person once: such a name is left out.
			// The test reads the ancestors, not the line found, so the names never depend on the order of the people.
			const aM = blood.length ? this.ancFrom(m) : undefined;
			for (const r of this.spouses(p)) {
				if (r === m) continue;
				const marriages = this.marriagesOf(r, p);
				const aR = aM ? this.anc(r) : undefined;
				for (const c of this.blood(m, r)) {
					// The first member of a couple is chosen by the order of the people, so every member counts.
					if (aM && (c.x === p || c.y === p || c.couple.includes(p) || ((aM.has(p) || aR!.has(p)) && (aP.has(c.x) || c.couple.some((q) => aP.has(q)))))) continue;
					cands.push(this.ruleOneCand(c, m, r, p, sexP, marriages));
				}
			}
		}

		cands.push(...this.byMarriageTwo(m, p, aP, sexP));
		// Only this call reads the other lines of these lists; rule 1 reads none.
		forget(blood);

		const step = this.stepSibling(m, p);
		if (step) cands.push(step);

		// A name by marriage (rules 1 and 2) never wins over a sure blood name.
		if (sureBlood) for (const c of cands) if (c.kind === 'by-marriage') c.after = 1;
		cands.sort(compareCands);
		const seen = new Map<string, Cand>();
		return withoutFormerTwins(cands).filter((c) => {
			const first = seen.get(c.lower);
			if (!first) {
				seen.set(c.lower, c);
				return true;
			}
			// Equal names keep the maybe of any of them ('full' wins, then a rumoured cause), so it never depends on the order of the people.
			if (c.maybe && first.kind === 'blood' && c.kind === 'blood' && (!first.maybe || maybeRank(c.maybe) < maybeRank(first.maybe))) first.maybe = c.maybe;
			return false;
		});
	}

	/** By marriage, rule 2: P is a blood relative of M's spouse S (the names of §13.1 "Names by marriage"). */
	private byMarriageTwo(m: number, p: number, aP: Map<number, number>, sexP: Sex): Cand[] {
		const cands: Cand[] = [];
		const avoids = (d: BloodLine) => d.y !== m && !d.pathF.includes(m) && !d.pathP.includes(m);
		for (const s of this.spouses(m)) {
			if (s === p) continue;
			const marriage = this.lastUnion(m, s, true)!;
			const marriages = this.marriagesOf(m, s);
			const ofS = this.blood(s, p, aP);
			const sexS = this.sex[s];
			// A line passes M only if M is an ancestor of S or of P (a couple member is a parent of the children below it).
			const dM = Math.min(this.ancFrom(s).get(m) ?? Infinity, aP.get(m) ?? Infinity);
			// The tree without M's blood links, searched at most once for this S and P: every name of the pair that needs it reads this list.
			// A name has legs up to the longest leg of any name of the pair, so only the ancestors that near can give it.
			let cut: Blood[] | undefined;
			const inCut = () => (cut ??= this.cutView(m).bloodNear(s, p, ofS.reduce((r, d) => Math.max(r, d.a, d.b), 0)));
			// A descendant of S through M's own child is M's own descendant, not a step-descendant (rule 2, §13.1 "Names by marriage"):
			// its name, its link word and its line come from a child of S who is not M's own by a birth or adoptive link, so they are
			// searched in the tree without S's links down to M's children. Without such a child S's lines are all as they are.
			const own = this.ownChildren(m, s);
			let steps: Blood[] | undefined;
			let stepCut: Blood[] | undefined;
			const forgotten: Blood[][] = [];
			const inStepCut = () => (stepCut ??= this.stepView(m, s, own, true).descent(s, p));
			const list = !own.length || !ofS.some((c) => c.a === 0) ? ofS : ofS.flatMap((c) => (c.a !== 0 ? [c] : steps ? [] : (steps = this.down[s].some((k) => !own.includes(k) && aP.has(k)) ? this.stepView(m, s, own, false).descent(s, p) : [])));
			const add = (c: Blood, via: BloodLine) => {
				// The years read the stepchildren of S on a shortest line to P, never the one found first.
				const stepKids = c.a === 0 ? this.lineKids(s, p, aP, c.b, c.word !== 'rumoured').filter((k) => !own.includes(k)) : [];
				cands.push(
					this.marriageCand(this.rule2Word(c, sexP, sexS, ...this.ruleTwoYears(c, p, stepKids, marriages)), c, () => {
						const top = this.throughPassingK(via, stepKids, marriages);
						const inner = this.bloodLine(top);
						const walk = this.bloodWalk(top);
						return {
							line: { people: [m, ...inner.people], links: inner.links, unions: [marriage.key, ...inner.unions] },
							walk: { nodes: [m, ...walk.nodes], edges: [{ k: 'partner', union: marriage.key }, ...walk.edges] },
						};
					}),
				);
			};
			for (const c of list) {
				const forms = this.restoredDouble(c, m, s, p, dM, avoids);
				if (forms) {
					forgotten.push(forms);
					for (const v of forms) add(v, v);
					continue;
				}
				// The line lists each person once, so a relation to S that runs through M is not one by marriage. Any line
				// of the name that avoids M will do (the first one found depends on the order of the people), and is shown.
				// Blood lines keep one line for each name, so a line that avoids M can be missing from this list. Then the
				// tree without M's blood links gives it, and the name stays only if that tree gives the same name.
				const via = avoids(c) ? c : (c.also?.find(avoids) ?? this.restoredLine(c, sexP, sexS, c.a === 0 && own.length ? inStepCut : inCut, avoids));
				if (via) add(c, via);
			}
			forget(ofS);
			// The lines that a restored name shows are the only ones kept.
			if (cut) forget(cut);
			for (const kept of forgotten) forget(kept);
			if (steps) forget(steps);
			if (stepCut) forget(stepCut);
		}
		return cands;
	}

	/**
	 * Order repair: a "double" name is two couples, and needs a line of each that avoids M. If every couple has a known line that
	 * avoids M (in `c` or `c.also`; a couple is the top of its lines, x and y), the double stands and this gives undefined. Else the
	 * lines that the search kept depend on the order of the people, so the tree without M's links decides: it gives the double if both
	 * couples avoid M, else the single name of the couple that does, in every order. This returns those names, each with a line that
	 * avoids M. A rumoured double always asks that tree: its couples come from the second test, which the known lines do not show.
	 * `dM` is the distance of M from S or from P; M is on no line of the double if it is farther than the longest leg of the name.
	 */
	private restoredDouble(c: Blood, m: number, s: number, p: number, dM: number, avoids: (d: BloodLine) => boolean): Blood[] | undefined {
		if (!c.double || dM > Math.max(c.a, c.b)) return undefined;
		const lines = c.also ? [c, ...c.also] : [c];
		const avoiding = new Map<string, boolean>();
		for (const l of lines) {
			const top = `${Math.min(l.x, l.y < 0 ? l.x : l.y)}:${Math.max(l.x, l.y)}`;
			avoiding.set(top, avoiding.get(top) === true || avoids(l));
		}
		if (c.word !== 'rumoured' && [...avoiding.values()].every(Boolean)) return undefined;
		const tops = new Set<number>();
		for (const l of lines) {
			tops.add(l.x);
			if (l.y >= 0) tops.add(l.y);
		}
		const word = cousinWord(c.a, c.b, false);
		return this.cutView(m)
			.bloodAt(s, p, [...tops])
			.filter((v) => isFullCousin(v) && v.word === c.word && cousinWord(v.a, v.b, false) === word && avoids(v));
	}

	/** D123: the name a sure blood candidate would have if every rumoured link were true (or, D174, if the parent who is not listed is the same person). */
	private maybeOf(c: Blood, sex: Sex): RelationMaybe {
		const lower = this.bloodLower({ ...c, half: !c.half }, sex);
		return Object.freeze({ effect: c.maybe!, text: capital(lower), lower, cause: c.cause ?? 'rumoured', ...(c.some ? { some: true as const } : {}), ...(c.cause === 'unlisted' && c.form ? { unlistedForm: c.form } : {}) });
	}

	private wardCand(m: number, p: number, kind: 'guardian' | 'ward'): Cand {
		const [parent, child] = kind === 'guardian' ? [p, m] : [m, p];
		const walk: Walk = { nodes: [m, p], edges: [{ k: kind === 'guardian' ? 'up' : 'down', type: 'ward' }] };
		const line: Line = { people: [m, p], links: [{ parent, child, type: 'ward' }], unions: [] };
		return { lower: kind === 'guardian' ? WORDS.guardian : WORDS.ward, kind, distance: 1, cat: 2, direct: 1, half: 0, removal: 0, elder: 0, group: 0, anc: -1, make: () => ({ line, walk }) };
	}

	private marriageCand([lower, group, base]: Word, c: Blood, make: Cand['make']): Cand {
		return {
			lower,
			...(base !== undefined ? { base } : {}),
			kind: 'by-marriage',
			distance: 1 + c.a + c.b,
			// D200 R3 key 4: a name through a rumoured link counts as rumoured.
			cat: c.word === 'rumoured' ? 4 : 3,
			direct: c.a === 0 || c.b === 0 ? 0 : 1,
			half: c.half ? 1 : 0,
			removal: Math.abs(c.a - c.b),
			elder: c.a - c.b,
			group,
			anc: c.x,
			make,
		};
	}

	/** The name of P by marriage, rule 1: P is married (`marriages`, the last-listed shows on the line) to R, a blood relative of M by `c`. */
	private ruleOneCand(c: Blood, m: number, r: number, p: number, sexP: Sex, marriages: FamilyUnion[]): Cand {
		const marriage = marriages[marriages.length - 1];
		const ks = this.ruleOneKs(c, m, r);
		return this.marriageCand(this.rule1Word(c, this.sex[r], sexP, ...this.ruleOneYears(c, m, marriages, ks)), c, () => {
			const top = this.throughPassingK(c, ks, marriages);
			const line = this.bloodLine(top);
			line.people.push(p);
			line.unions.push(marriage.key);
			const walk = this.bloodWalk(top);
			walk.nodes.push(p);
			walk.edges.push({ k: 'partner', union: marriage.key });
			return { line, walk };
		});
	}

	/**
	 * Rule 1 and the years: the people whose life the step word is read at (indices). A step-parent is read at the life of M; a step-grandparent
	 * at the life of every parent of M who is a child of R (the set of parents, never the line found, so the order of the people cannot
	 * decide). For a confirmed name only birth and adoptive links count on both steps; a rumoured name keeps every link.
	 */
	private ruleOneKs(c: Blood, m: number, r: number): number[] {
		if (c.b !== 0 || (c.a !== 1 && c.a !== 2)) return [];
		if (c.a === 1) return [m];
		const sure = c.word !== 'rumoured';
		return this.up[m].filter((l) => (!sure || isStepLink(l)) && this.up[l.p].some((u) => u.p === r && (!sure || isStepLink(u)))).map((l) => l.p);
	}

	/**
	 * Rule 1 and the years (D304 to D309): `[step, former]` for P, from all the marriages of R and P (`marriages`), read each time (`MarriageYears.verdict`).
	 * `ks` is `ruleOneKs`. The person on the blood side of F4 is M.
	 */
	private ruleOneYears(c: Blood, m: number, marriages: FamilyUnion[], ks: number[]): [boolean, boolean] {
		const me = this.ids[m];
		if (c.b === 0 && (c.a === 1 || c.a === 2)) return this.years.verdict(marriages, 'step', [me], ks.map((k) => this.ids[k]));
		return this.years.verdict(marriages, (c.b === 0 && c.a >= 3) || (c.a === 0 && c.b >= 3) ? 'possessive' : 'named', [me]);
	}

	/**
	 * The finder line of a step-grandparent or step-grandchild name goes through a K whose life a marriage may overlap, so the steps support the
	 * word. The line found first stays if its K passes; else the first passing K (document index). Without a passing K the line is as found.
	 */
	private throughPassingK(c: BloodLine, ks: number[], marriages: FamilyUnion[]): BloodLine {
		const spot = c.a === 2 && c.b === 0 ? c.pathF : c.a === 0 && c.b === 2 ? c.pathP : undefined;
		if (!ks.length || spot?.length !== 3) return c;
		const passes = (k: number) => ks.includes(k) && marriages.some((u) => !this.years.apart(u, this.ids[k]));
		if (passes(spot[1])) return c;
		const k = ks.filter(passes).reduce<number | undefined>((best, v) => (best === undefined || v < best ? v : best), undefined);
		if (k === undefined || k === spot[0] || k === spot[2]) return c;
		const path = [spot[0], k, spot[2]];
		return c.a === 2 ? { a: c.a, b: c.b, x: c.x, y: c.y, pathF: path, pathP: c.pathP } : { a: c.a, b: c.b, x: c.x, y: c.y, pathF: c.pathF, pathP: path };
	}

	/**
	 * Rule 2 and the years (D304 to D309), as `ruleOneYears`: `marriages` are all the marriages of M and S, `stepKids` the stepchildren of S
	 * on a shortest line to P (the years read the one that passes, never the one found first). The person on the
	 * blood side of F4 is P.
	 */
	private ruleTwoYears(c: Blood, p: number, stepKids: number[], marriages: FamilyUnion[]): [boolean, boolean] {
		const you = this.ids[p];
		if (c.a === 0 && (c.b === 1 || c.b === 2)) return this.years.verdict(marriages, 'step', [you], stepKids.map((k) => this.ids[k]));
		return this.years.verdict(marriages, (c.b === 0 && (c.a === 1 || c.a === 2)) || (c.a === 1 && c.b === 1) ? 'named' : 'possessive', [you]);
	}

	/**
	 * Rule 1 names, by R's relation `c` to M; P has `sexP`, R has `sexR`. The second value is the group of D200 R3 key 9. A leg through
	 * a rumoured link puts "rumoured" in front; the possessive form already says it in the name of the leg.
	 */
	private rule1Word(c: Blood, sexR: Sex, sexP: Sex, step = true, former = false): Word {
		const { a, b } = c;
		// A step word that the years remove (D304) is the possessive form instead.
		if (step && b === 0 && a === 1) return named(c, WORDS.stepParent[sexP], BY_STEP, former);
		if (step && b === 0 && a === 2) return named(c, WORDS.stepGrandparent[sexP], BY_STEP, former);
		if (a === 0 && b === 1) return named(c, WORDS.childInLaw[sexP], BY_IN_LAW, former);
		if (a === 0 && b === 2) return named(c, WORDS.grandchildInLaw[sexP], BY_IN_LAW, former);
		if (a === 1 && b === 1) return named(c, WORDS.siblingInLaw[sexP], BY_IN_LAW, former);
		if (a >= 2 && b === 1) return named(c, `${uncleWord(a, sexP, false)} ${WORDS.byMarriage}`, BY_MARRIAGE, former);
		if (a === 1 && b >= 2) return named(c, `${nephewWord(b, sexP, false)} ${WORDS.byMarriage}`, BY_MARRIAGE, former);
		if (a >= 2 && b >= 2) return named(c, `${cousinWord(a, b, false)} ${WORDS.byMarriage}`, BY_MARRIAGE, former);
		return possessive((f) => `${this.bloodLower(c, sexR)}${WORDS.possessive} ${f}${WORDS.spouse[sexP]}`, former);
	}

	/** Order repair: a line that avoids M and gives the same name as `c`, from the lines of S to P in the tree without M's blood links. */
	private restoredLine(c: Blood, sexP: Sex, sexS: Sex, inCut: () => Blood[], avoids: (d: BloodLine) => boolean): BloodLine | undefined {
		const name = this.rule2Word(c, sexP, sexS)[0];
		const same = inCut().filter((v) => this.rule2Word(v, sexP, sexS)[0] === name);
		// The line of the same link word first, as the line of `c` itself would show.
		same.sort((u, v) => (u.word === c.word ? 0 : 1) - (v.word === c.word ? 0 : 1));
		return same.find(avoids);
	}

	/** Rule 2 names, by P's relation `c` to M's spouse S, with the group of D200 R3 key 9 (see `rule1Word`). */
	private rule2Word(c: Blood, sexP: Sex, sexS: Sex, step = true, former = false): Word {
		const { a, b } = c;
		if (b === 0 && a === 1) return named(c, WORDS.parentInLaw[sexP], BY_IN_LAW, former);
		if (b === 0 && a === 2) return named(c, WORDS.grandparentInLaw[sexP], BY_IN_LAW, former);
		if (a === 1 && b === 1) return named(c, WORDS.siblingInLaw[sexP], BY_IN_LAW, former);
		if (step && a === 0 && b === 1) return named(c, WORDS.stepChild[sexP], BY_STEP, former);
		if (step && a === 0 && b === 2) return named(c, WORDS.stepGrandchild[sexP], BY_STEP, former);
		return possessive((f) => `${f}${WORDS.spouse[sexS]}${WORDS.possessive} ${this.bloodLower(c, sexP)}`, former);
	}

	/** Rule 3: P is a child of Q, Q is married to M's parent N, and P and M share no parent (birth and adoptive parents only). */
	private stepSibling(m: number, p: number): Cand | undefined {
		const mine = this.up[m].filter(isStepLink);
		const theirs = this.up[p].filter(isStepLink);
		if (mine.some((l) => theirs.some((t) => t.p === l.p))) return undefined;
		// Every pair (N, Q) that has a marriage, and every marriage of it (D304 to D309). Most people have none, so nothing is made before one is found.
		let pairs: { n: Up; q: number; link: Up; marriages: FamilyUnion[] }[] | undefined;
		for (const n of mine) {
			for (const q of this.spouses(n.p)) {
				const link = theirs.find((t) => t.p === q);
				if (link && new Set([m, n.p, q, p]).size === 4) (pairs ??= []).push({ n, q, link, marriages: this.marriagesOf(n.p, q) });
			}
		}
		if (!pairs) return undefined;
		// A fixed order, so the name never depends on the order of the people; only the line follows it.
		pairs.sort((i, j) => i.n.p - j.n.p || i.q - j.q);
		// A marriage counts if it may overlap the life of both children (D304).
		const y = this.years;
		const both = [this.ids[m], this.ids[p]];
		const counting = pairs.map((x) => ({ ...x, passing: x.marriages.filter((u) => both.every((k) => !y.apart(u, k))) })).filter((x) => x.passing.length);
		if (!counting.length) return undefined;
		const open = (u: FamilyUnion) => !y.former(u, both);
		const former = !counting.some((x) => x.passing.some(open));
		// The line: the first pair with a marriage that is not "former", else the first pair; in it the last-listed such marriage.
		const pick = counting.find((x) => x.passing.some(open)) ?? counting[0];
		const marriages = former ? pick.passing : pick.passing.filter(open);
		const marriage = marriages[marriages.length - 1];
		const walk: Walk = {
			nodes: [m, pick.n.p, pick.q, p],
			edges: [
				{ k: 'up', type: pick.n.type },
				{ k: 'partner', union: marriage.key },
				{ k: 'down', type: pick.link.type },
			],
		};
		const word = WORDS.stepSibling[this.sex[p]];
		return { lower: former ? `${FORMER}${word}` : word, ...(former ? { base: word } : {}), kind: 'step-sibling', distance: 3, cat: 3, direct: 1, half: 0, removal: 0, elder: 0, group: BY_STEP, anc: -1, make: () => ({ line: walkLine(walk), walk }) };
	}

	/** The shortest chain of links of any type and partnerships (§13.2), by the search order of the file header. */
	chain(f: number, t: number): Walk | undefined {
		const n = this.ids.length;
		const prev = new Int32Array(n).fill(-1);
		const via = new Array<Edge | undefined>(n);
		prev[f] = f;
		const queue = [f];
		for (let head = 0; head < queue.length && prev[t] < 0; head++) {
			const v = queue[head];
			const visit = (w: number, e: Edge) => {
				if (prev[w] >= 0) return;
				prev[w] = v;
				via[w] = e;
				queue.push(w);
			};
			for (const l of this.drawn[v]) visit(l.p, { k: 'up', type: l.type });
			for (const c of this.downAll[v]) visit(c.p, { k: 'down', type: c.type });
			for (const w of this.partners(v)) visit(w, { k: 'partner', union: this.pairUnion(v, w)?.key ?? implicitKey(this.ids[v], this.ids[w]) });
		}
		if (prev[t] < 0) return undefined;
		const nodes = [t];
		const edges: Edge[] = [];
		for (let cur = t; cur !== f; cur = prev[cur]) {
			nodes.push(prev[cur]);
			edges.push(via[cur]!);
		}
		return { nodes: nodes.reverse(), edges: edges.reverse() };
	}

	/** The steps of a walk (file header, "Steps"): an up step then a down step to another child is one sibling step (not through a ward link). `second`: the walk of a rumoured name. */
	steps(walk: Walk, second = false, stepHalf?: boolean): RelationStep[] {
		const out: RelationStep[] = [];
		const { nodes, edges } = walk;
		for (let i = 0; i < edges.length; i++) {
			const e = edges[i];
			const from = nodes[i];
			const to = nodes[i + 1];
			const after = edges[i + 1];
			// A ward is not a sibling: a ward link stays a step of its own.
			if (e.k === 'up' && after?.k === 'down' && nodes[i + 2] !== from && e.type !== 'ward' && after.type !== 'ward') {
				const sib = nodes[i + 2];
				// The steps of a rumoured name follow its second test; a chain's step follows its own links.
				const sure = this.isHalf(from, e.type, sib, after.type);
					// D200 R4: the extra name of a maybe prints the other outcome of the sure pair, whatever the second test says.
				const half = stepHalf ?? (second || e.type === 'rumoured' || after.type === 'rumoured' ? this.halfCounted(from, e.type, sib, after.type) : sure);
				// A step that only the rumours make full (or half) says so, also over two birth links.
				out.push({ person: this.ids[sib], of: this.ids[from], word: siblingStepWord(this.sex[sib], half, e.type, after.type, half !== sure) });
				i++;
				continue;
			}
			let word: string;
			// The word type comes from the pair's last-listed union, as the card says it, not from the union the walk crossed.
			if (e.k === 'partner') word = this.partnerOf(this.pairUnion(from, to) ?? this.g.unionByKey.get(e.union), from, to).lower;
			else word = e.k === 'up' ? parentStepWord(e.type, this.sex[to]) : childStepWord(e.type, this.sex[to]);
			out.push({ person: this.ids[to], of: this.ids[from], word });
		}
		return out;
	}

	/** A `Relation` with ids in place of indices. */
	relation(c: Cand, line: Line): Relation {
		return { text: capital(c.lower), lower: c.lower, kind: c.kind, distance: c.distance, line: this.lineIds(line), ...(c.maybe ? { maybe: c.maybe } : {}) };
	}

	/**
	 * A frozen `Relation` whose line is built (and frozen) the first time it is read: a tree of
	 * hundreds of people has thousands of names, and the cards need only the text.
	 */
	lazyRelation(c: Cand): Relation {
		let line: RelationLine | undefined;
		const make = () => (line ??= deepFreeze(this.lineIds(c.make().line)));
		return Object.freeze({
			text: capital(c.lower),
			lower: c.lower,
			kind: c.kind,
			distance: c.distance,
			...(c.maybe ? { maybe: c.maybe } : {}),
			get line() {
				return make();
			},
		});
	}
}
