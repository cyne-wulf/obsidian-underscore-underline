import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";

interface SyntaxNodeRef {
	name: string;
	from: number;
	to: number;
}

const underscoreMarkDecoration = Decoration.mark({
	class: "cm-underscore-mark",
});

const underscoreContentDecoration = Decoration.mark({
	class: "cm-underscore-underline",
});

// Matches _content_ — Removed alphanumeric constraints to match Obsidian's native italics behavior
// Content must not contain newlines or bare underscores.
const UNDERSCORE_RE = /_([^_\n]+?)_/g;

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const { from: vpFrom, to: vpTo } = view.viewport;
	const doc = view.state.doc;

	// Collect code/inline-code/math/link ranges to skip decoration inside them.
	// We still use the syntax tree here because node names are consistent.
	const skippedRanges: Array<{ from: number; to: number }> = [];
	syntaxTree(view.state).iterate({
		enter(node: SyntaxNodeRef) {
			if (/[Cc]ode|[Mm]ath|[Ll]ink|[Uu]rl/.test(node.name)) {
				skippedRanges.push({ from: node.from, to: node.to });
			}
		},
	});

	// Inside Obsidian's Live Preview (.markdown-source-view), skip only the
	// specific token that overlaps the cursor/selection, so the user sees raw
	// _text_ while editing that span — matching native bold/italic behaviour.
	// Other tokens on the same line remain decorated.
	// Outside Obsidian (standalone harness, unit tests) decorate every token.

	// Scan each line in the viewport for _..._
	let pos = vpFrom;
	while (pos <= Math.min(vpTo, doc.length)) {
		const line = doc.lineAt(pos);
		const lineText = line.text;
		
		// Blank out skipped ranges (code, math, links) so their internal underscores don't break regex pairing
		let sanitizedLineText = lineText;
		for (const r of skippedRanges) {
			if (r.to > line.from && r.from < line.to) {
				const start = Math.max(0, r.from - line.from);
				const end = Math.min(lineText.length, r.to - line.from);
				sanitizedLineText =
					sanitizedLineText.slice(0, start) +
					" ".repeat(end - start) +
					sanitizedLineText.slice(end);
			}
		}

		UNDERSCORE_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = UNDERSCORE_RE.exec(sanitizedLineText)) !== null) {
			const from = line.from + match.index;
			const to = from + match[0].length;
			
			// Add decorations in strictly ascending order:
			builder.add(from, from + 1, underscoreMarkDecoration);         // opening _
			builder.add(from + 1, to - 1, underscoreContentDecoration);    // content
			builder.add(to - 1, to, underscoreMarkDecoration);             // closing _
		}
		if (line.to >= doc.length) break;
		pos = line.to + 1;
	}

	return builder.finish();
}

class UnderlinePluginClass {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildDecorations(view);
	}

	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged || update.selectionSet) {
			this.decorations = buildDecorations(update.view);
		}
	}
}

export const underlineViewPlugin = ViewPlugin.fromClass(UnderlinePluginClass, {
	decorations: (instance: UnderlinePluginClass) => instance.decorations,
});
