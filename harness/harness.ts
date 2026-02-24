import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { underlineViewPlugin } from "../src/editor-decoration";

function makeEditor(parentId: string, doc: string): EditorView {
  const parent = document.getElementById(parentId);
  if (!parent) throw new Error(`No element #${parentId}`);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [underlineViewPlugin],
    }),
    parent,
  });
}

// Case 1: short line
makeEditor("editor-short", "_hello_");

// Case 2: underscore in MIDDLE of line
makeEditor("editor-middle", "Some text before _underline here_ and more after");

// Case 3: long content — crosses soft wrap at 220px container
// EditorView.lineWrapping enables CM6's built-in line wrapping
const parent3 = document.getElementById("editor-wrap");
if (!parent3) throw new Error("No element #editor-wrap");
new EditorView({
  state: EditorState.create({
    doc: "_This sentence is intentionally long enough that it will visually soft-wrap across two or more lines_",
    extensions: [underlineViewPlugin, EditorView.lineWrapping],
  }),
  parent: parent3,
});
