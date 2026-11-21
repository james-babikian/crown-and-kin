# Contributing to Crown and Kin

Thank you for your interest. This page says how to send a change and which rules the code follows. [`MAINTAINERS.md`](MAINTAINERS.md) lists every command and the rules that the lint checks; [`docs/code-map.md`](docs/code-map.md) is the code map. This page does not repeat them.

This repository is a published copy, not the place where work happens. A pull request here is never merged. The maintainer copies an accepted change into a private repository (see "Pull requests" below).

## Build and test

Set up and run the checks as [`MAINTAINERS.md`, "Build and check"](MAINTAINERS.md#build-and-check) says. Before you send a change, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` and `npm run size -- --check`. To run one test file, use `npx vitest run tests/core/parse.test.ts`.

To try your build, copy `main.js`, `manifest.json` and `styles.css` into `.obsidian/plugins/crown-and-kin/` of a vault that holds test trees only. The plugin writes to the notes that hold trees, so do not try it on notes you care about.

## Code conventions

- TypeScript in strict mode. Indent with tabs. Use single quotes.
- Every file starts with a short header in plain English: what the file does and how it fits in.
- Every exported function, class and type has a one-sentence summary. Inside a function, a comment explains why, not what.
- A change in `src/core` or `src/layout` needs a test. For a change in another folder, add a test where one is practical.
- Follow [`MAINTAINERS.md`](MAINTAINERS.md) for these rules: the layers and the lint rules (no `innerHTML`, no colours set from code) are in "The layers"; the sample trees that a script writes, which you must not edit by hand, are in "Build and check"; the golden files are in "Pictures and golden files". If you record a new golden value, say why in your pull request.

**Size.** A function has at most 70 code lines and 35 branches. A file has at most 600 code lines.

- A code line is a line that holds code. Blank lines and comments do not count.
- A branch is an `if`, a `? :`, a `case`, a loop (`for`, `for of`, `for in`, `while`, `do`), or an `&&`, `||` or `??`.
- A function is a top-level function, a `const` that holds an arrow function, a method of a top-level class, or a function property of a top-level `const` object. A function inside another one counts as part of it.

A few older functions and files are above these limits and are on a list of exceptions. Do not make them larger. The test that checks this rule and holds the list is in the private repository, so you cannot run it. The maintainer runs it on every change before copying it in.

`main.js` has a byte budget for each layer (`scripts/size-budget.json`) and a fixed ceiling (`scripts/size.mjs`). `npm run size -- --check` checks both. A change that needs a bigger budget must say why in the pull request.

## Text that the plugin shows

Text that users read follows Simplified Technical English (ASD-STE100), a standard for short, plain sentences:

- Write sentences of 20 words or fewer, in the active voice, with one instruction each.
- Put a condition before the action: "If the tree is empty, select Add person."
- Write "do not", not "don't".
- Use one word for one thing, every time: "tree", not "graph"; "person" or "card", not "node"; "line", not "edge"; "generation" or "row", not "layer"; "house" for a noble house; "note" for an Obsidian note.

In text that users read, do not write "layer". In code and in these pages, "layer" means one of the five source folders.

No check in this repository tests these rules, so read your text against them before you send it. If you are unsure, copy the style of a nearby text. The texts sit in tables, not in the middle of the code ([`MAINTAINERS.md`, "The layers"](MAINTAINERS.md#the-layers) names them). Reuse a text that already says the same thing.

## Pull requests

Pull requests are welcome.

- **Ask first.** For a large change, open a feature request first (Issues, New issue, Feature request). You and the maintainer agree on the approach there, before you write code.
- **One subject.** Keep each pull request small, with one subject. The maintainer copies each change by hand, so a small change is faster to check. If your change does two things, send two pull requests.
- **What happens to an accepted change.** A pull request is never merged here. If the maintainer accepts your change, the maintainer copies it into the private repository, checks it there and credits you in `CHANGELOG.md`. The change arrives here with the next release. At that time the maintainer closes your pull request. The closing is not a refusal. It means the change is in the code. If the maintainer does not accept a change, the maintainer closes the pull request and says why.
- **Licence.** By sending a pull request, you agree that your change is licensed under the GNU General Public License, version 3 only (see `LICENSE`), the same licence as the rest of the code. You keep your copyright. You also say that you have the right to give the change under this licence.

A pull request and its files are public, and they stay in the history. Use invented names in test trees. Do not post private notes or paths from your computer.

## Report a problem or an idea

To report a bug or suggest a feature, follow [the README, "Report a problem"](README.md#report-a-problem). It says where to open an issue and which form to use.
