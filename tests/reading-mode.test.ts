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

function makeCtxNull(): MarkdownPostProcessorContext {
	return {
		getSectionInfo: () => null,
	} as unknown as MarkdownPostProcessorContext;
}

function buildBlock(html: string): HTMLElement {
	const p = document.createElement("p");
	p.innerHTML = html;
	return p;
}

describe("transformElement — reading mode", () => {
	test("adds underscore-em class to em from _text_ source", () => {
		const block = buildBlock("<em>hello</em>");
		const ctx = makeCtx("_hello_");
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		expect(em).toHaveClass("underscore-em");
	});

	test("does NOT add class to em from *text* source", () => {
		const block = buildBlock("<em>hello</em>");
		const ctx = makeCtx("*hello*");
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		expect(em).not.toHaveClass("underscore-em");
	});

	test("classifies only the underscore em in mixed _one_ and *two* paragraph", () => {
		const block = buildBlock("<em>one</em> and <em>two</em>");
		const ctx = makeCtx("_one_ and *two*");
		transformElement(block, ctx);
		const ems = block.querySelectorAll("em");
		expect(ems[0]).toHaveClass("underscore-em");
		expect(ems[1]).not.toHaveClass("underscore-em");
	});

	test("does not crash and adds no class when getSectionInfo returns null", () => {
		const block = buildBlock("<em>hello</em>");
		const ctx = makeCtxNull();
		expect(() => transformElement(block, ctx)).not.toThrow();
		const em = block.querySelector("em")!;
		expect(em).not.toHaveClass("underscore-em");
	});

	test("skips em inside code element", () => {
		const block = buildBlock("<code><em>hello</em></code>");
		const ctx = makeCtx("_hello_");
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		expect(em).not.toHaveClass("underscore-em");
	});

	test("skips em inside pre element", () => {
		const pre = document.createElement("pre");
		const code = document.createElement("code");
		const em = document.createElement("em");
		em.textContent = "hello";
		code.appendChild(em);
		pre.appendChild(code);
		const ctx = makeCtx("_hello_");
		transformElement(pre, ctx);
		expect(em).not.toHaveClass("underscore-em");
	});

	test("handles nested markup: _**bold italic**_ matches em with text 'bold italic'", () => {
		// Obsidian renders _**bold italic**_ as <em><strong>bold italic</strong></em>
		// em.textContent would be "bold italic"
		const block = buildBlock("<em><strong>bold italic</strong></em>");
		const ctx = makeCtx("_**bold italic**_");
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		expect(em).toHaveClass("underscore-em");
	});

	test("handles multiple _text_ spans in one paragraph", () => {
		const block = buildBlock("<em>one</em> and <em>two</em>");
		const ctx = makeCtx("_one_ and _two_");
		transformElement(block, ctx);
		const ems = block.querySelectorAll("em");
		expect(ems[0]).toHaveClass("underscore-em");
		expect(ems[1]).toHaveClass("underscore-em");
	});

	test("scopes source lookup to block line range only", () => {
		// Block is at lines 2-2, but _hello_ appears on line 0
		const block = buildBlock("<em>hello</em>");
		const ctx = makeCtx("_hello_\nsome other line\n*hello*", 2, 2);
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		// line 2 is "*hello*" so no underscore-em class
		expect(em).not.toHaveClass("underscore-em");
	});

	test("transforms em inside a root li element", () => {
		const li = document.createElement("li");
		const em = document.createElement("em");
		em.textContent = "item";
		li.appendChild(em);
		const ctx = makeCtx("_item_");
		transformElement(li, ctx);
		expect(em).toHaveClass("underscore-em");
	});
});
