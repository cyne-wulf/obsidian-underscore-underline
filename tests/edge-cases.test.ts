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

describe("transformElement — edge cases", () => {
	test("__strong__ does not cause underscore-em treatment", () => {
		// __strong__ renders as <strong>, not <em>
		// This test verifies no errors and no false positives
		const block = buildBlock("<strong>strong</strong>");
		const ctx = makeCtx("__strong__");
		expect(() => transformElement(block, ctx)).not.toThrow();
		const strong = block.querySelector("strong")!;
		expect(strong).not.toHaveClass("underscore-em");
	});

	test("documented limitation: same text as _X_ and *X* in same paragraph — both get class", () => {
		// This is the known v1 limitation: identical text from _ and * both get treated
		const block = buildBlock("<em>same</em> and <em>same</em>");
		const ctx = makeCtx("_same_ and *same*");
		transformElement(block, ctx);
		const ems = block.querySelectorAll("em");
		// Both have the same normalized text "same" which is in underscoreTexts
		expect(ems[0]).toHaveClass("underscore-em");
		expect(ems[1]).toHaveClass("underscore-em");
	});

	test("empty em does not crash", () => {
		const block = buildBlock("<em></em>");
		const ctx = makeCtx("_ _");
		expect(() => transformElement(block, ctx)).not.toThrow();
	});

	test("em with only whitespace textContent does not match non-whitespace source text", () => {
		const block = buildBlock("<em>   </em>");
		const ctx = makeCtx("_hello_");
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		expect(em).not.toHaveClass("underscore-em");
	});

	test("no em elements — no crash", () => {
		const block = buildBlock("<p>Just plain text</p>");
		const ctx = makeCtx("_hello_");
		expect(() => transformElement(block, ctx)).not.toThrow();
	});

	test("source with no underscore patterns — no em gets class", () => {
		const block = buildBlock("<em>hello</em>");
		const ctx = makeCtx("*hello*");
		transformElement(block, ctx);
		const em = block.querySelector("em")!;
		expect(em).not.toHaveClass("underscore-em");
	});

	test("underscore text with backtick markers normalizes correctly", () => {
		// If em.textContent has backtick-surrounded text (unusual but possible)
		const block = buildBlock("<em>code</em>");
		const ctx = makeCtx("_`code`_");
		transformElement(block, ctx);
		// normalizeText("`code`") = "code" and normalizeText("code") = "code"
		const em = block.querySelector("em")!;
		expect(em).toHaveClass("underscore-em");
	});
});
