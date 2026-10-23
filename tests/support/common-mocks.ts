/*
 * Setup file for every test file: the three mocks that most test files repeated at their top.
 * 'obsidian' is the fake of tests/acceptance/fake-obsidian.ts. The two CodeMirror packages are
 * stubs: main.ts pulls in the Live Preview extension, and its CodeMirror parts are not needed.
 * A mock that a test file declares itself (vi.mock in that file) replaces the one of this file
 * (proved in tests/obsidian/setup-mocks-override.test.ts); a test that needs the real package calls
 * vi.unmock for it. The factories run only when a file imports the package.
 */
import { vi } from 'vitest';

vi.mock('obsidian', () => import('../acceptance/fake-obsidian'));
vi.mock('@codemirror/language', () => ({ forceParsing: () => false, syntaxTree: () => ({ length: 0 }) }));
vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: () => ({}) } }));
