import { transformElement } from "../src/reading-mode";
import { MarkdownPostProcessorContext } from "obsidian";

function makeCtx(source: string, lineStart = 0, lineEnd?: number): MarkdownPostProcessorContext {
	const lines = source.split("\n");
	const end = lineEnd ?? lines.length - 1;
	return {
		getSectionInfo: () => ({
			text: source,
			lineStart,
			lineEnd: end,
		}),
	} as unknown as MarkdownPostProcessorContext;
}

function buildBlock(html: string): HTMLElement {
	const p = document.createElement("p");
	p.innerHTML = html;
	return p;
}

describe("transformElement — math", () => {
	test("adds underscore-em class to em from _text_ source when math is present", () => {
		const block = buildBlock("<em>underlined</em> text and <span class=\"math\">math</span>.");
		const ctx = makeCtx("This is _underlined_ text and $math$.");
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		console.log(em.outerHTML);
		expect(em).toHaveClass("underscore-em");
	});
});
