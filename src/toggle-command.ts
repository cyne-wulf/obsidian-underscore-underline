import type { Editor, EditorPosition } from "obsidian";

// Characters that terminate word detection — whitespace and markdown syntax chars
const STOP_CHARS = /[\s_*~`[\]()|#]/;

/**
 * Given a line string and a cursor column, expands left and right
 * until hitting a stop character (whitespace, markdown syntax) or line boundary.
 * Returns { from, to } column indices of the detected word.
 */
export function detectWordRange(
	line: string,
	ch: number,
): { from: number; to: number } {
	// If cursor is sitting on a stop character, return an empty range immediately
	if (ch < line.length && STOP_CHARS.test(line[ch])) {
		return { from: ch, to: ch };
	}
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
		line[selFrom - 2] !== "_" && // guard: avoid __ on left side
		line[selTo + 1] !== "_"      // guard: avoid __ on right side
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
		// Collapse cursor to after the closing _ so subsequent typing continues past the word
		const afterMark = selFrom + content.length + 2;
		editor.setSelection(
			{ line: lineNum, ch: afterMark },
			{ line: lineNum, ch: afterMark },
		);
	}
}

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
		
		if (word.from === word.to) {
			// Check if we are sitting exactly between two empty underscores: __
			if (from.ch > 0 && from.ch < line.length && line[from.ch - 1] === "_" && line[from.ch] === "_") {
				editor.replaceRange("", { line: from.line, ch: from.ch - 1 }, { line: from.line, ch: from.ch + 1 });
				return;
			}

			// cursor on whitespace or no word: insert "__" and place cursor in the middle
			editor.replaceSelection("__");
			editor.setCursor({ line: from.line, ch: from.ch + 1 });
			return;
		}
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
