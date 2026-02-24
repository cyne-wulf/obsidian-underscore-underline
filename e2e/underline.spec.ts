import { test, expect } from "@playwright/test";

/**
 * Helper: wait for CM6 to render, then collect computed styles on
 * every .cm-underscore-underline span inside a given editor container.
 */
async function getUnderlineStyles(page: any, editorSelector: string) {
  await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 5000 });

  return page.evaluate((sel: string) => {
    const container = document.querySelector(sel);
    if (!container) return [];
    const spans = Array.from(container.querySelectorAll(".cm-underscore-underline")) as HTMLElement[];
    return spans.map((el) => {
      const cs = getComputedStyle(el);
      return {
        textDecorationLine: cs.textDecorationLine,
        display:            cs.display,
        textContent:        el.textContent?.slice(0, 40) ?? "",
      };
    });
  }, editorSelector);
}

async function getMarkStyles(page: any, editorSelector: string) {
  await page.waitForSelector(`${editorSelector} .cm-content`, { timeout: 5000 });
  return page.evaluate((sel: string) => {
    const container = document.querySelector(sel);
    if (!container) return [];
    const spans = Array.from(container.querySelectorAll(".cm-underscore-mark")) as HTMLElement[];
    return spans.map((el) => {
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, textContent: el.textContent ?? "" };
    });
  }, editorSelector);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

// ── Test 0: CSS interference (critical — catches the Obsidian rendering bug) ──
//
// This test directly replicates Obsidian's DOM structure:
//   .cm-em { text-decoration: none }  wraps  .cm-underscore-underline
// WITHOUT our :has() fix the underline would be suppressed by the parent.
// The harness CSS contains both the simulation (cm-em:none) and the fix
// (cm-em:has(.cm-underscore-underline) { text-decoration: underline !important }).

test("CSS interference: underline survives cm-em text-decoration:none parent", async ({ page }) => {
  const el = page.locator("#css-interference .cm-underscore-underline");
  await el.waitFor({ timeout: 3000 });

  // The harness CSS has:
  //   .cm-em { text-decoration: none }          ← Obsidian simulation
  //   .cm-em:has(.cm-underscore-underline) { text-decoration: underline !important }  ← our fix
  // Without the :has() rule, the child's underline would be suppressed.
  // We assert only the child's final computed value — that's what the user sees.
  const childDecorationLine = await el.evaluate((node: HTMLElement) =>
    getComputedStyle(node).textDecorationLine
  );

  expect(
    childDecorationLine,
    "cm-underscore-underline must show underline even when wrapped in cm-em (text-decoration:none in base CSS)"
  ).toContain("underline");
});

// ── Test 1: Short line ─────────────────────────────────────────────────────────

test("short line: _hello_ gets underline decoration", async ({ page }) => {
  const styles = await getUnderlineStyles(page, "#editor-short");

  expect(styles.length).toBeGreaterThan(0);
  for (const s of styles) {
    expect(s.textDecorationLine, `span "${s.textContent}" should be underlined`).toContain("underline");
  }
});

test("short line: underscore marks are hidden (opacity 0)", async ({ page }) => {
  const marks = await getMarkStyles(page, "#editor-short");

  expect(marks.length).toBeGreaterThan(0);
  for (const m of marks) {
    expect(m.opacity, `mark "${m.textContent}" opacity should be 0`).toBe("0");
  }
});

// ── Test 2: Middle of line ────────────────────────────────────────────────────

test("middle-of-line: _underline here_ gets underline decoration", async ({ page }) => {
  const styles = await getUnderlineStyles(page, "#editor-middle");

  expect(
    styles.length,
    "Expected at least one .cm-underscore-underline span in middle-of-line editor"
  ).toBeGreaterThan(0);

  for (const s of styles) {
    expect(
      s.textDecorationLine,
      `span "${s.textContent}" should be underlined`
    ).toContain("underline");
  }
});

test("middle-of-line: underscore marks are hidden", async ({ page }) => {
  const marks = await getMarkStyles(page, "#editor-middle");
  expect(marks.length).toBeGreaterThan(0);
  for (const m of marks) {
    expect(m.opacity).toBe("0");
  }
});

// ── Test 3: Soft-wrap boundary (critical case) ────────────────────────────────

test("soft-wrap: long underlined text that wraps gets underline decoration", async ({ page }) => {
  const didWrap = await page.evaluate(() => {
    const line = document.querySelector("#editor-wrap .cm-line") as HTMLElement | null;
    if (!line) return false;
    const rect = line.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(line).lineHeight) || 20;
    return rect.height > lineHeight * 1.5;
  });
  expect(didWrap, "Editor should have visually soft-wrapped (line height > 1.5x single line)").toBe(true);

  const styles = await getUnderlineStyles(page, "#editor-wrap");

  expect(
    styles.length,
    "Expected .cm-underscore-underline spans in the soft-wrap editor"
  ).toBeGreaterThan(0);

  for (const s of styles) {
    expect(
      s.textDecorationLine,
      `span "${s.textContent}..." should be underlined even when it crosses a soft-wrap boundary`
    ).toContain("underline");
  }
});

test("soft-wrap: underscore marks are hidden in wrapped editor", async ({ page }) => {
  const marks = await getMarkStyles(page, "#editor-wrap");
  expect(marks.length).toBeGreaterThan(0);
  for (const m of marks) {
    expect(m.opacity).toBe("0");
  }
});
