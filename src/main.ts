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
