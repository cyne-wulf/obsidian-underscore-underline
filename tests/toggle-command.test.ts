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
			if (which === "to" || which === "head") return selTo;
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
		replaceSelection: jest.fn((text: string) => {
			const line = currentLines[selFrom.line];
			currentLines[selFrom.line] = line.slice(0, selFrom.ch) + text + line.slice(selTo.ch);
		}),
		setSelection: jest.fn(),
		setCursor: jest.fn(),
		listSelections: jest.fn(() => [{ anchor: selFrom, head: selTo }]),
	} as unknown as jest.Mocked<Editor>;
	return editor;
}

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
		const state = getUnderlineState("__text__", 2, 6);
		expect(state.isUnderlined).toBe(false);
	});

	it("does not treat __strong__ content selection as underline (right-side guard)", () => {
		// "_word__" with "word" selected (ch 1–5)
		// line[0]='_' (left mark), line[5]='_' (right mark)
		// line[-1]=undefined (left guard passes — no __ on left)
		// line[6]='_' (right guard should block — __ on right)
		const state = getUnderlineState("_word__", 1, 5);
		expect(state.isUnderlined).toBe(false);
	});
});

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
		// cursor collapses to after the closing _ so typing continues past the word
		expect(editor.setSelection).toHaveBeenCalledWith(
			{ line: 0, ch: 13 },
			{ line: 0, ch: 13 },
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

	it("inserts __ and places cursor inside when cursor is on whitespace with no selection", () => {
		// cursor on the space in "hello world"
		const editor = makeEditor(
			["hello world"],
			{ line: 0, ch: 5 },
			{ line: 0, ch: 5 },
		);
		toggleUnderlineCommand(editor);
		expect(editor.replaceSelection).toHaveBeenCalledWith("__");
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 6 });
	});

	it("inserts __ and places cursor inside when on a completely blank line", () => {
		const editor = makeEditor(
			[""],
			{ line: 0, ch: 0 },
			{ line: 0, ch: 0 },
		);
		toggleUnderlineCommand(editor);
		expect(editor.replaceSelection).toHaveBeenCalledWith("__");
		expect(editor.setCursor).toHaveBeenCalledWith({ line: 0, ch: 1 });
	});

	it("removes __ when cursor is exactly between empty underscores", () => {
		const editor = makeEditor(
			["__"],
			{ line: 0, ch: 1 },
			{ line: 0, ch: 1 },
		);
		toggleUnderlineCommand(editor);
		expect(editor.replaceRange).toHaveBeenCalledWith("", { line: 0, ch: 0 }, { line: 0, ch: 2 });
		expect(editor.replaceSelection).not.toHaveBeenCalled();
	});
});
