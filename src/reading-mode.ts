import { MarkdownPostProcessorContext } from "obsidian";

const UNDERSCORE_REGEX = /_([^_\n]+?)_/g;

/**
 * Strip inline markdown markers and trim whitespace so that
 * "_**bold italic**_" → "bold italic" can match em.textContent "bold italic".
 */
function normalizeText(text: string): string {
	return text
		.replace(/\*\*|__|~~|`/g, "")
		.replace(/\*/g, "")
		.trim();
}

/**
 * Collect the set of normalized underscore-italic texts from the source lines
 * of the given block element.
 */
function getUnderscoreTexts(
	block: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): Set<string> | null {
	const sectionInfo = ctx.getSectionInfo(block);
	if (!sectionInfo) {
		return null;
	}

	const { text, lineStart, lineEnd } = sectionInfo;
	let blockLines = text
		.split("\n")
		.slice(lineStart, lineEnd + 1)
		.join("\n");

	// Strip out code blocks and math blocks to prevent their internal underscores
	// from breaking the regex pairing for surrounding text.
	blockLines = blockLines
		.replace(/```[\s\S]*?```/g, (m) => m.replace(/_/g, "\0"))
		.replace(/`[^`]*?`/g, (m) => m.replace(/_/g, "\0"))
		.replace(/\$\$[\s\S]*?\$\$/g, (m) => m.replace(/_/g, "\0"))
		.replace(/\$[^$\n]*?\$/g, (m) => m.replace(/_/g, "\0"))
		.replace(/\[\[[\s\S]*?\]\]/g, (m) => m.replace(/_/g, "\0")) // internal links
		.replace(/\[[\s\S]*?\]\([\s\S]*?\)/g, (m) => m.replace(/_/g, "\0")) // external links
		.replace(/https?:\/\/[^\s]+/g, (m) => m.replace(/_/g, "\0")); // bare URLs

	const underscoreTexts = new Set<string>();
	let match: RegExpExecArray | null;
	UNDERSCORE_REGEX.lastIndex = 0;
	while ((match = UNDERSCORE_REGEX.exec(blockLines)) !== null) {
		const innerText = match[1].replace(/\0/g, "_");
		underscoreTexts.add(normalizeText(innerText));
	}

	return underscoreTexts;
}

/**
 * Post-processor entry point. Classifies <em> elements as underscore-sourced
 * by comparing normalized text content against source lines.
 */
export function transformElement(
	root: HTMLElement,
	ctx: MarkdownPostProcessorContext,
): void {
	const underscoreTexts = getUnderscoreTexts(root, ctx);
	if (underscoreTexts === null || underscoreTexts.size === 0) {
		return;
	}

	root.querySelectorAll<HTMLElement>("em").forEach((em) => {
		if (em.closest("code, pre, .math, .math-block")) {
			return;
		}
		const normalized = normalizeText(em.textContent ?? "");
		if (underscoreTexts.has(normalized)) {
			em.classList.add("underscore-em");
		}
	});
}
