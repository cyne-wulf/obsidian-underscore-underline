# Toggle Underline Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Toggle underline" command that wraps/unwraps `_text_` underline markup, operating like Obsidian's native bold/italic — word detection at cursor when no selection, single-line toggle for single-line selections, and smart majority multi-line toggle for multi-line selections.

**Architecture:** Single new file `src/toggle-command.ts` exports `toggleUnderlineCommand(editor: Editor)`. The command is registered in `src/main.ts` via `this.addCommand()`. Three modes: (1) no selection → detect word at cursor → resolve to (2) single-line toggle, or (3) multi-line toggle with smart majority rule. Multi-line processes each line's selected slice independently (first line: selFrom.ch to line end; middle: full line; last: 0 to selTo.ch).

**Tech Stack:** Obsidian `Editor` API (`Editor`, `EditorPosition`), TypeScript, Jest + jsdom (existing test setup).

---

### Task 1: Create test scaffold

**Files:**
- Create: `tests/toggle-command.test.ts`

**Step 1: Create the test file with a mock Editor factory**

Create `tests/toggle-command.test.ts` with this content:

```typescript
import { toggleUnderlineCommand } from "../src/toggle-command";
import { detectWordRange } from "../src/toggle-command";
import { getUnderlineState } from "../src/toggle-command";
import { applySingleLineToggle } from "../src/toggle-command";
import { applyMultiLineToggle, countUnderlinedLines } from "../src/toggle-command";
import type { Editor, EditorPosition } from "obsidian";

function makeEditor(
	lines: string[],
	selFrom: EditorPosition,
	selTo: EditorPosition,
): jest.Mocked<Editor> {
	const currentLines = [...lines];
	const editor = {
		getSelection: jest.fn(() => {
			if (selFrom.line === selTo.line) {
				return currentLines[selFrom.line].slice(selFrom.ch, selTo.ch);
			}
			return currentLines.slice(selFrom.line, selTo.line + 1).join("\n");
		}),
		getCursor: jest.fn((which?: string) => {
			if (which === "to") return selTo;
			return selFrom;
		}),
		getLine: jest.fn((n: number) => currentLines[n]),
		replaceRange: jest.fn(
			(text: string, from: EditorPosition, to?: EditorPosition) => {
				const toPos = to ?? from;
				if (from.line === toPos.line) {
					const line = currentLines[from.line];
					currentLines[from.line] =
						line.slice(0, from.ch) + text + line.slice(toPos.ch);
				}
			},
		),
		setSelection: jest.fn(),
		listSelections: jest.fn(() => [{ anchor: selFrom, head: selTo }]),
	} as unknown as jest.Mocked<Editor>;
	return editor;
}

// Tests go here (added in subsequent tasks)
```

**Step 2: Run to confirm it compiles (no tests yet)**

```bash
cd "/Users/adevine/codingProjects/obsidian plugin project/testVault/.obsidian/plugins/underline"
npx jest tests/toggle-command.test.ts --no-coverage 2>&1 | tail -10
```

Expected: Error like "Your test suite must contain at least one test" — this confirms no TypeScript compile errors.

**Step 3: Commit**

```bash
git add tests/toggle-command.test.ts
git commit -m "test: scaffold toggle-command test file with mock editor"
```

---

### Task 2: Word boundary detection

**Files:**
- Create: `src/toggle-command.ts`
- Modify: `tests/toggle-command.test.ts`

**Step 1: Add failing tests for `detectWordRange`**

Add to `tests/toggle-command.test.ts` (above the final closing):

```typescript
describe("detectWordRange", () => {
	it("expands cursor to word in middle of word", () => {
		// "hello world" cursor at ch=8 (inside "world")
		expect(detectWordRange("hello world", 8)).toEqual({ from: 6, to: 11 });
	});

	it("returns empty range when cursor is on a stop character", () => {
		// cursor on the space between words
		expect(detectWordRange("hello world", 5)).toEqual({ from: 5, to: 5 });
	});

	it("stops at underscore characters", () => {
		// "_hello_" cursor at ch=3 → expands within the word, stops at _
		expect(detectWordRange("_hello_", 3)).toEqual({ from: 1, to: 6 });
	});

	it("stops at asterisk characters", () => {
		expect(detectWordRange("*hello* world", 3)).toEqual({ from: 1, to: 6 });
	});

	it("handles cursor at start of line", () => {
		expect(detectWordRange("hello", 0)).toEqual({ from: 0, to: 5 });
	});

	it("handles cursor at end of word", () => {
		expect(detectWordRange("hello", 5)).toEqual({ from: 0, to: 5 });
	});

	it("handles empty string", () => {
		expect(detectWordRange("", 0)).toEqual({ from: 0, to: 0 });
	});
});
```

**Step 2: Run to confirm they fail**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "detectWordRange" 2>&1 | tail -10
```

Expected: FAIL — `detectWordRange` not found.

**Step 3: Create `src/toggle-command.ts`**

```typescript
import type { Editor, EditorPosition } from "obsidian";

// Characters that terminate word detection — whitespace and markdown syntax chars
const STOP_CHARS = /[\s_*~`[\]()]/;

/**
 * Given a line string and a cursor column, expands left and right
 * until hitting a stop character (whitespace, markdown syntax) or line boundary.
 * Returns { from, to } column indices of the detected word.
 */
export function detectWordRange(
	line: string,
	ch: number,
): { from: number; to: number } {
	let left = ch;
	while (left > 0 && !STOP_CHARS.test(line[left - 1])) {
		left--;
	}
	let right = ch;
	while (right < line.length && !STOP_CHARS.test(line[right])) {
		right++;
	}
	return { from: left, to: right };
}
```

**Step 4: Run tests to confirm they pass**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "detectWordRange" 2>&1 | tail -10
```

Expected: PASS (7 tests).

**Step 5: Commit**

```bash
git add src/toggle-command.ts tests/toggle-command.test.ts
git commit -m "feat: add detectWordRange for toggle command word detection"
```

---

### Task 3: Underline state detection (single-line)

**Files:**
- Modify: `src/toggle-command.ts`
- Modify: `tests/toggle-command.test.ts`

**Step 1: Add failing tests for `getUnderlineState`**

```typescript
describe("getUnderlineState", () => {
	it("detects underline when selection excludes underscore marks", () => {
		// line: "_hello_", selected "hello" (ch 1–6)
		expect(getUnderlineState("_hello_", 1, 6)).toEqual({
			isUnderlined: true,
			markFrom: 0,
			markTo: 7,
			contentFrom: 1,
			contentTo: 6,
		});
	});

	it("detects underline when selection includes underscore marks", () => {
		// line: "_hello_", selected "_hello_" (ch 0–7)
		expect(getUnderlineState("_hello_", 0, 7)).toEqual({
			isUnderlined: true,
			markFrom: 0,
			markTo: 7,
			contentFrom: 1,
			contentTo: 6,
		});
	});

	it("returns not-underlined for plain text", () => {
		expect(getUnderlineState("hello world", 0, 5)).toEqual({
			isUnderlined: false,
			markFrom: 0,
			markTo: 5,
			contentFrom: 0,
			contentTo: 5,
		});
	});

	it("does not treat asterisk-bounded selection as underline", () => {
		expect(getUnderlineState("*hello*", 1, 6)).toEqual({
			isUnderlined: false,
			markFrom: 1,
			markTo: 6,
			contentFrom: 1,
			contentTo: 6,
		});
	});

	it("does not treat double-underscore __ as underline mark", () => {
		// "__text__" selected (ch 0–8) — strong emphasis, not underline
		const state = getUnderlineState("__text__", 0, 8);
		expect(state.isUnderlined).toBe(false);
	});

	it("does not treat __text__ content selection as underline", () => {
		// "__text__" with "text" selected (ch 2–6)
		// line[1]='_' and line[1-1=0]='_' → double underscore guard triggers
		const state = getUnderlineState("__text__", 2, 6);
		expect(state.isUnderlined).toBe(false);
	});
});
```

**Step 2: Run to confirm they fail**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "getUnderlineState" 2>&1 | tail -10
```

**Step 3: Add `getUnderlineState` to `src/toggle-command.ts`**

```typescript
export interface UnderlineState {
	isUnderlined: boolean;
	markFrom: number;    // ch of opening _ (or selFrom if not underlined)
	markTo: number;      // ch past closing _ (or selTo if not underlined)
	contentFrom: number; // ch of content start (excluding _)
	contentTo: number;   // ch of content end (excluding _)
}

/**
 * Determines whether a selection [selFrom, selTo) is already underlined,
 * and returns positions for the marks and content.
 *
 * Two detection cases:
 *   Case 1 — selection includes marks: line[selFrom]==='_' && line[selTo-1]==='_'
 *   Case 2 — selection excludes marks: line[selFrom-1]==='_' && line[selTo]==='_'
 *
 * Double-underscore (__) is guarded against in both cases.
 */
export function getUnderlineState(
	line: string,
	selFrom: number,
	selTo: number,
): UnderlineState {
	// Case 1: selection includes the underscore marks
	if (
		selTo - selFrom >= 2 &&
		line[selFrom] === "_" &&
		line[selTo - 1] === "_" &&
		line[selFrom + 1] !== "_" // guard: avoid __ (strong emphasis)
	) {
		return {
			isUnderlined: true,
			markFrom: selFrom,
			markTo: selTo,
			contentFrom: selFrom + 1,
			contentTo: selTo - 1,
		};
	}

	// Case 2: selection excludes the underscore marks
	if (
		selFrom > 0 &&
		selTo < line.length &&
		line[selFrom - 1] === "_" &&
		line[selTo] === "_" &&
		line[selFrom - 2] !== "_" // guard: avoid __ on left side
	) {
		return {
			isUnderlined: true,
			markFrom: selFrom - 1,
			markTo: selTo + 1,
			contentFrom: selFrom,
			contentTo: selTo,
		};
	}

	// Not underlined
	return {
		isUnderlined: false,
		markFrom: selFrom,
		markTo: selTo,
		contentFrom: selFrom,
		contentTo: selTo,
	};
}
```

**Step 4: Run tests**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "getUnderlineState" 2>&1 | tail -10
```

Expected: PASS (6 tests).

**Step 5: Commit**

```bash
git add src/toggle-command.ts tests/toggle-command.test.ts
git commit -m "feat: add getUnderlineState for single-line toggle detection"
```

---

### Task 4: Single-line toggle application

**Files:**
- Modify: `src/toggle-command.ts`
- Modify: `tests/toggle-command.test.ts`

**Step 1: Add failing tests for `applySingleLineToggle`**

```typescript
describe("applySingleLineToggle", () => {
	it("wraps selected word with underscores", () => {
		const editor = makeEditor(
			["hello world"],
			{ line: 0, ch: 6 },
			{ line: 0, ch: 11 },
		);
		applySingleLineToggle(editor, 0, 6, 11);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"_world_",
			{ line: 0, ch: 6 },
			{ line: 0, ch: 11 },
		);
		// selection moves to content only (excluding marks)
		expect(editor.setSelection).toHaveBeenCalledWith(
			{ line: 0, ch: 7 },
			{ line: 0, ch: 12 },
		);
	});

	it("removes underscores when content is selected (marks not in selection)", () => {
		// "_hello_", "hello" selected (ch 1–6)
		const editor = makeEditor(
			["_hello_"],
			{ line: 0, ch: 1 },
			{ line: 0, ch: 6 },
		);
		applySingleLineToggle(editor, 0, 1, 6);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"hello",
			{ line: 0, ch: 0 },
			{ line: 0, ch: 7 },
		);
		expect(editor.setSelection).toHaveBeenCalledWith(
			{ line: 0, ch: 0 },
			{ line: 0, ch: 5 },
		);
	});

	it("removes underscores when full marked text is selected (marks in selection)", () => {
		// "_hello_" selected (ch 0–7)
		const editor = makeEditor(
			["_hello_"],
			{ line: 0, ch: 0 },
			{ line: 0, ch: 7 },
		);
		applySingleLineToggle(editor, 0, 0, 7);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"hello",
			{ line: 0, ch: 0 },
			{ line: 0, ch: 7 },
		);
		expect(editor.setSelection).toHaveBeenCalledWith(
			{ line: 0, ch: 0 },
			{ line: 0, ch: 5 },
		);
	});

	it("does nothing for empty range", () => {
		const editor = makeEditor(["  "], { line: 0, ch: 1 }, { line: 0, ch: 1 });
		applySingleLineToggle(editor, 0, 1, 1);
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});
});
```

**Step 2: Run to confirm they fail**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "applySingleLineToggle" 2>&1 | tail -10
```

**Step 3: Add `applySingleLineToggle` to `src/toggle-command.ts`**

```typescript
/**
 * Applies underline toggle for a single-line range [selFrom, selTo).
 * If the range (or its surroundings) are already underlined → removes marks.
 * Otherwise → wraps with underscores.
 * Adjusts the editor selection to the content range after the edit.
 */
export function applySingleLineToggle(
	editor: Editor,
	lineNum: number,
	selFrom: number,
	selTo: number,
): void {
	if (selFrom === selTo) return; // empty range — nothing to do

	const line = editor.getLine(lineNum);
	const state = getUnderlineState(line, selFrom, selTo);
	const content = line.slice(state.contentFrom, state.contentTo);

	if (state.isUnderlined) {
		// Remove marks
		editor.replaceRange(
			content,
			{ line: lineNum, ch: state.markFrom },
			{ line: lineNum, ch: state.markTo },
		);
		editor.setSelection(
			{ line: lineNum, ch: state.markFrom },
			{ line: lineNum, ch: state.markFrom + content.length },
		);
	} else {
		// Add marks
		editor.replaceRange(
			`_${content}_`,
			{ line: lineNum, ch: selFrom },
			{ line: lineNum, ch: selTo },
		);
		editor.setSelection(
			{ line: lineNum, ch: selFrom + 1 },
			{ line: lineNum, ch: selFrom + 1 + content.length },
		);
	}
}
```

**Step 4: Run tests**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "applySingleLineToggle" 2>&1 | tail -10
```

Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/toggle-command.ts tests/toggle-command.test.ts
git commit -m "feat: add applySingleLineToggle"
```

---

### Task 5: Multi-line toggle with smart majority

**Files:**
- Modify: `src/toggle-command.ts`
- Modify: `tests/toggle-command.test.ts`

**Step 1: Add failing tests**

```typescript
describe("countUnderlinedLines", () => {
	it("counts underlined lines correctly across a selection", () => {
		const editor = {
			getLine: (n: number) => ["_first_", "plain", "_third_"][n],
		} as unknown as Editor;
		// selFrom {0,0}, selTo {2,7} — full lines for all three
		const result = countUnderlinedLines(
			editor,
			{ line: 0, ch: 0 },
			{ line: 2, ch: 7 },
		);
		expect(result).toEqual({ underlined: 2, total: 3 });
	});

	it("excludes empty slices from the total count", () => {
		const editor = {
			getLine: (n: number) => ["hello", "world"][n],
		} as unknown as Editor;
		// selFrom {0,5} (end of "hello"), selTo {1,5}
		// Line 0 slice: ch5 to ch5 → empty → skipped
		// Line 1 slice: ch0 to ch5 → "world" → not underlined
		const result = countUnderlinedLines(
			editor,
			{ line: 0, ch: 5 },
			{ line: 1, ch: 5 },
		);
		expect(result).toEqual({ underlined: 0, total: 1 });
	});
});

describe("applyMultiLineToggle", () => {
	it("wraps each line's selected slice when majority is not underlined", () => {
		const editor = makeEditor(
			["first line", "second line", "third line"],
			{ line: 0, ch: 6 }, // selected slice of line 0: "line"
			{ line: 2, ch: 5 }, // selected slice of line 2: "third"
		);
		applyMultiLineToggle(editor, { line: 0, ch: 6 }, { line: 2, ch: 5 });
		// 0/3 underlined → shouldRemove=false → all 3 lines get wrapped
		expect(editor.replaceRange).toHaveBeenCalledTimes(3);
	});

	it("unwraps lines when majority is underlined (2 of 3)", () => {
		const editor = makeEditor(
			["_first_", "_second_", "plain"],
			{ line: 0, ch: 0 },
			{ line: 2, ch: 5 },
		);
		applyMultiLineToggle(editor, { line: 0, ch: 0 }, { line: 2, ch: 5 });
		// Lines 0,1 underlined; line 2 not → 2/3 → shouldRemove=true
		// Only the 2 underlined lines get replaceRange called
		expect(editor.replaceRange).toHaveBeenCalledTimes(2);
	});

	it("adds marks to non-underlined lines when minority is underlined (1 of 3)", () => {
		const editor = makeEditor(
			["_first_", "plain", "also plain"],
			{ line: 0, ch: 0 },
			{ line: 2, ch: 10 },
		);
		applyMultiLineToggle(editor, { line: 0, ch: 0 }, { line: 2, ch: 10 });
		// 1/3 underlined → shouldRemove=false → wrap the 2 non-underlined lines
		expect(editor.replaceRange).toHaveBeenCalledTimes(2);
	});
});
```

**Step 2: Run to confirm they fail**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "countUnderlinedLines|applyMultiLineToggle" 2>&1 | tail -15
```

**Step 3: Add multi-line functions to `src/toggle-command.ts`**

```typescript
/**
 * Returns the selected portion [from, to) of a line given the overall selection.
 *   First line:  selFrom.ch → line.length
 *   Middle lines: 0 → line.length
 *   Last line:   0 → min(selTo.ch, line.length)
 *   Single-line: selFrom.ch → min(selTo.ch, line.length)
 */
function getLineSlice(
	line: string,
	lineNum: number,
	selFrom: EditorPosition,
	selTo: EditorPosition,
): { from: number; to: number } {
	if (lineNum === selFrom.line && lineNum === selTo.line) {
		return { from: selFrom.ch, to: Math.min(selTo.ch, line.length) };
	}
	if (lineNum === selFrom.line) return { from: selFrom.ch, to: line.length };
	if (lineNum === selTo.line)
		return { from: 0, to: Math.min(selTo.ch, line.length) };
	return { from: 0, to: line.length };
}

/**
 * Counts how many lines in [selFrom.line, selTo.line] have their
 * selected slice already underlined. Empty slices are excluded from the total.
 */
export function countUnderlinedLines(
	editor: Editor,
	selFrom: EditorPosition,
	selTo: EditorPosition,
): { underlined: number; total: number } {
	let underlined = 0;
	let total = 0;
	for (let i = selFrom.line; i <= selTo.line; i++) {
		const line = editor.getLine(i);
		const slice = getLineSlice(line, i, selFrom, selTo);
		if (slice.from >= slice.to) continue; // skip empty slices
		total++;
		if (getUnderlineState(line, slice.from, slice.to).isUnderlined) {
			underlined++;
		}
	}
	return { underlined, total };
}

/**
 * Applies multi-line underline toggle.
 * Smart majority: if strictly >50% of lines are underlined → remove all; else add to all.
 * Processes lines in reverse order so earlier line indices stay stable during edits.
 * Each line's selected slice is wrapped/unwrapped independently.
 */
export function applyMultiLineToggle(
	editor: Editor,
	selFrom: EditorPosition,
	selTo: EditorPosition,
): void {
	const { underlined, total } = countUnderlinedLines(editor, selFrom, selTo);
	const shouldRemove = underlined > total / 2;

	// Reverse order: modify last lines first so earlier line offsets remain valid
	for (let i = selTo.line; i >= selFrom.line; i--) {
		const line = editor.getLine(i);
		const slice = getLineSlice(line, i, selFrom, selTo);
		if (slice.from >= slice.to) continue;

		const state = getUnderlineState(line, slice.from, slice.to);
		const content = line.slice(state.contentFrom, state.contentTo);

		if (shouldRemove && state.isUnderlined) {
			editor.replaceRange(
				content,
				{ line: i, ch: state.markFrom },
				{ line: i, ch: state.markTo },
			);
		} else if (!shouldRemove && !state.isUnderlined) {
			editor.replaceRange(
				`_${content}_`,
				{ line: i, ch: slice.from },
				{ line: i, ch: slice.to },
			);
		}
	}
}
```

**Step 4: Run all tests so far**

```bash
npx jest tests/toggle-command.test.ts --no-coverage 2>&1 | tail -15
```

Expected: All toggle-command tests pass.

**Step 5: Commit**

```bash
git add src/toggle-command.ts tests/toggle-command.test.ts
git commit -m "feat: add multi-line toggle with smart majority rule"
```

---

### Task 6: Main command orchestrator

**Files:**
- Modify: `src/toggle-command.ts`
- Modify: `tests/toggle-command.test.ts`

**Step 1: Add failing tests for `toggleUnderlineCommand`**

```typescript
describe("toggleUnderlineCommand", () => {
	it("expands to word when there is no selection and cursor is in a word", () => {
		// "hello world", cursor at ch=8 (inside "world")
		const editor = makeEditor(
			["hello world"],
			{ line: 0, ch: 8 },
			{ line: 0, ch: 8 }, // same from/to → no selection
		);
		toggleUnderlineCommand(editor);
		// detectWordRange("hello world", 8) → {from:6, to:11} → "world"
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"_world_",
			{ line: 0, ch: 6 },
			{ line: 0, ch: 11 },
		);
	});

	it("uses single-line path when selection is on one line", () => {
		const editor = makeEditor(
			["hello world"],
			{ line: 0, ch: 6 },
			{ line: 0, ch: 11 },
		);
		toggleUnderlineCommand(editor);
		expect(editor.replaceRange).toHaveBeenCalledWith(
			"_world_",
			{ line: 0, ch: 6 },
			{ line: 0, ch: 11 },
		);
	});

	it("uses multi-line path when selection spans multiple lines", () => {
		const editor = makeEditor(
			["first", "second"],
			{ line: 0, ch: 0 },
			{ line: 1, ch: 6 },
		);
		toggleUnderlineCommand(editor);
		// Two lines, neither underlined → both get wrapped
		expect(editor.replaceRange).toHaveBeenCalledTimes(2);
	});

	it("does nothing when cursor is on whitespace with no selection", () => {
		// cursor on the space in "hello world"
		const editor = makeEditor(
			["hello world"],
			{ line: 0, ch: 5 },
			{ line: 0, ch: 5 },
		);
		toggleUnderlineCommand(editor);
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});
});
```

**Step 2: Run to confirm they fail**

```bash
npx jest tests/toggle-command.test.ts --no-coverage -t "toggleUnderlineCommand" 2>&1 | tail -10
```

**Step 3: Add `toggleUnderlineCommand` to `src/toggle-command.ts`**

```typescript
/**
 * Main command handler — dispatches to the correct mode:
 *   Mode 1 (no selection): detect word at cursor → resolve to Mode 2
 *   Mode 2 (single-line): toggle underline on the selected/detected range
 *   Mode 3 (multi-line): toggle underline per-line with smart majority
 */
export function toggleUnderlineCommand(editor: Editor): void {
	const from = editor.getCursor("from") as EditorPosition;
	const to = editor.getCursor("to") as EditorPosition;
	const hasSelection = from.line !== to.line || from.ch !== to.ch;

	if (!hasSelection) {
		// Mode 1: no selection — expand to word at cursor
		const line = editor.getLine(from.line);
		const word = detectWordRange(line, from.ch);
		if (word.from === word.to) return; // cursor on whitespace, nothing to do
		applySingleLineToggle(editor, from.line, word.from, word.to);
		return;
	}

	if (from.line === to.line) {
		// Mode 2: single-line selection
		applySingleLineToggle(editor, from.line, from.ch, to.ch);
		return;
	}

	// Mode 3: multi-line selection
	applyMultiLineToggle(editor, from, to);
}
```

**Step 4: Run all tests (existing 17 + new toggle tests)**

```bash
npx jest --no-coverage 2>&1 | tail -20
```

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/toggle-command.ts tests/toggle-command.test.ts
git commit -m "feat: add toggleUnderlineCommand orchestrator"
```

---

### Task 7: Register command in main.ts and build

**Files:**
- Modify: `src/main.ts`

**Step 1: Open and read current `src/main.ts`**

Current content is:

```typescript
import { Plugin, MarkdownPostProcessorContext } from "obsidian";
import { underlineViewPlugin } from "./editor-decoration";
import { transformElement } from "./reading-mode";

export default class UnderlinePlugin extends Plugin {
	onload() {
		this.registerEditorExtension(underlineViewPlugin);
		this.registerMarkdownPostProcessor(
			(element: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				transformElement(element, ctx);
			},
		);
	}
}
```

**Step 2: Add import and command registration**

Replace the file with:

```typescript
import { Plugin, MarkdownPostProcessorContext, Editor } from "obsidian";
import { underlineViewPlugin } from "./editor-decoration";
import { transformElement } from "./reading-mode";
import { toggleUnderlineCommand } from "./toggle-command";

export default class UnderlinePlugin extends Plugin {
	onload() {
		this.registerEditorExtension(underlineViewPlugin);
		this.registerMarkdownPostProcessor(
			(element: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				transformElement(element, ctx);
			},
		);
		this.addCommand({
			id: "toggle-underline",
			name: "Toggle underline",
			editorCallback: (editor: Editor) => {
				toggleUnderlineCommand(editor);
			},
		});
	}
}
```

**Step 3: Build**

```bash
cd "/Users/adevine/codingProjects/obsidian plugin project/testVault/.obsidian/plugins/underline"
npm run build 2>&1
```

Expected: No errors. `main.js` updated.

**Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: All tests pass (existing 17 + new toggle tests).

**Step 5: Commit**

```bash
git add src/main.ts
git commit -m "feat: register toggle-underline command in plugin"
```

---

### Task 8: Manual verification in Obsidian

**Step 1: Reload the plugin**

In Obsidian: **Settings → Community plugins → "Underscore Underline"** → toggle off → toggle on.
(Or use the Hot Reload plugin if installed.)

**Step 2: Create a test note with this content:**

```
Regular _underscore italic_ text here.
Regular *asterisk italic* text here.
hello world
_already underlined_
first line here
second line here
third line here
```

**Step 3: Verify each scenario:**

| Scenario | Steps | Expected result |
|---|---|---|
| Word at cursor | Place cursor inside `world` (no selection), run "Underscore Underline: Toggle underline" | `world` → `_world_`, shown underlined |
| Select and wrap | Select `hello`, run command | → `_hello_` |
| Unwrap (marks not selected) | In `_already underlined_`, select `already underlined` (no marks), run command | Marks removed, shown as italic |
| Unwrap (marks selected) | Select `_already underlined_` including underscores, run command | Marks removed |
| Multi-line wrap | Select across "first line here" and "second line here", run command | Both lines get `_` on their selected portions |
| Multi-line majority unwrap | Select across two already-wrapped `_line_` lines and one plain line, run command | 2/3 underlined → all unwrapped |
| Cursor on space | Place cursor on a space, run command | Nothing changes |
| Asterisk italic | Place cursor in `*asterisk italic*`, run command | `asterisk italic` gets `_` wrapped (separate from the `*`) |

**Step 4: Verify command appears in command palette**

Open command palette (Cmd+P / Ctrl+P), type "underline" → should see "Underscore Underline: Toggle underline".

**Step 5: Optional — bind a hotkey**

Settings → Hotkeys → search "Toggle underline" → assign a shortcut (e.g., Cmd+U).

---

## Summary

**New files:**
- `src/toggle-command.ts` — all toggle logic (detectWordRange, getUnderlineState, applySingleLineToggle, applyMultiLineToggle, countUnderlinedLines, toggleUnderlineCommand)
- `tests/toggle-command.test.ts` — tests for all exported functions

**Modified files:**
- `src/main.ts` — adds `import { toggleUnderlineCommand }` and `this.addCommand(...)` registration

**The command appears in Obsidian's command palette as "Underscore Underline: Toggle underline" and can be assigned a hotkey in Settings → Hotkeys.**
