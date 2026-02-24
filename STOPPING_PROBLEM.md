# Stopping Problem: Underlines Disappear on Active Line

**Status:** Unresolved as of 2026-02-21
**Symptom:** In Obsidian Live Preview (edit mode), `_underlined text_` loses its underline decoration whenever the cursor is on the same line as the underlined span. The goal is to match Obsidian's native behavior for `**bold**` and `_italic_`, which keep their rendering on all lines that don't have the cursor *inside* that specific formatting token.

---

## The Plugin Architecture (Read This First)

The plugin has two completely separate rendering systems:

### 1. Live Preview / Edit Mode (`src/editor-decoration.ts`)
A CodeMirror 6 `ViewPlugin` that uses `Decoration.mark()` to apply two CSS classes:
- `.cm-underscore-mark` on each `_` character → `opacity: 0` (hides the delimiter)
- `.cm-underscore-underline` on the text between underscores → `text-decoration: underline`

The plugin rescans on every `docChanged`, `viewportChanged`, or `selectionSet` event and rebuilds decorations from scratch via a regex scan of each visible line.

### 2. Reading Mode (`src/reading-mode.ts`)
A `MarkdownPostProcessor` that adds class `.underscore-em` to `<em>` elements whose source markdown used `_` (not `*`). No known issues with this mode — problems are isolated to Live Preview.

### CSS (`styles.css`)
Two rules critical to understanding failures:
```css
.cm-underscore-underline {
    font-style: normal;
    text-decoration: underline;
}
.cm-em:has(.cm-underscore-underline) {
    font-style: normal;
    text-decoration: underline !important;
}
```
The `:has()` rule exists because Obsidian's own ViewPlugin wraps `_text_` spans in `.cm-em` which sets `text-decoration: none`. In Chrome/Electron, a parent's `text-decoration: none` suppresses a child's `text-decoration: underline`. The `:has()` override forces underline back on the `.cm-em` parent when it contains our span.

---

## Critical Testing Gap

**All unit tests and E2E tests pass, but they do not exercise the Obsidian-specific code path.**

The `buildDecorations()` function in `editor-decoration.ts` contains this detection:
```typescript
const inObsidian = !!view.dom.closest(".markdown-source-view");
```

The test harness (`harness/index.html`, `harness/harness.ts`) mounts a bare `EditorView` directly in a `<div class="editor-wrap">`. There is no `.markdown-source-view` ancestor. Therefore:

- `inObsidian` is always `false` in every test
- `selFrom` and `selTo` are always `-1`
- `cursorInToken()` always returns `false`
- **The cursor-detection code is never triggered by any test**

Every test passing is meaningless for validating the Live Preview behavior. A test could delete the entire cursor-detection block and all tests would still pass. This is the fundamental testing gap: **the symptom only manifests inside actual Obsidian**, and the test harness does not replicate the Obsidian DOM structure well enough to catch it.

---

## Attempt 1 — Skip the Entire Cursor Line

### What was done
The original code (author unknown, pre-existing when investigation started) skipped decorating any line that the cursor was on:

```typescript
const cursorLineFrom = inObsidian
    ? doc.lineAt(view.state.selection.main.head).from
    : -1;

// Inside the line-scan loop:
if (line.from !== cursorLineFrom) {
    // ... decorate this line
}
```

### Why it failed
This is too aggressive. If a line contains multiple `_span_` tokens, placing the cursor anywhere on that line (even far from any underlined text) removes ALL underline decorations on the entire line.

The goal is to match Obsidian's native italic/bold behavior: only the specific token the cursor is *inside* should revert to raw markup; other tokens on the same line should stay rendered.

### Result
All underlines on the cursor line disappear. User reports this as wrong.

---

## Attempt 2 — Skip Only the Token Containing the Cursor

### What was done (2026-02-21, this session)
Changed from line-level cursor detection to token-level cursor detection:

```typescript
const inObsidian = !!view.dom.closest(".markdown-source-view");
const selFrom = inObsidian ? view.state.selection.main.from : -1;
const selTo   = inObsidian ? view.state.selection.main.to   : -1;

function cursorInToken(tokenFrom: number, tokenTo: number): boolean {
    return selFrom <= tokenTo && selTo >= tokenFrom;
}

// Inside the match loop:
if (cursorInToken(from, to)) continue; // skip this specific token only
```

This approach:
- Removes the line-level `if` check entirely
- For each regex match, checks if the cursor/selection range overlaps that specific token
- If yes, skips that one token; all others on the same line are still decorated

### Why it might have failed
The user reports the problem still remains. Several hypotheses:

**Hypothesis A: Obsidian Plugin Cache / No Reload**
Obsidian caches the compiled `main.js`. If the user did not reload the plugin (via "Community Plugins → Reload" or restarting Obsidian) after the rebuild, it was still running Attempt 1's code. Build succeeded and tests passed, but Obsidian never loaded the new code. This is impossible to rule out without user confirmation.

**Hypothesis B: Obsidian's Live Preview Uses `Decoration.replace`, Not Just `Decoration.mark`**
This is the most likely fundamental cause. Obsidian's own Live Preview ViewPlugin implements the "source mode when cursor is on a line" behavior using `Decoration.replace` to swap rendered spans back to raw text. In CM6, `ReplaceDecoration` ranges have higher atomic priority than `MarkDecoration` ranges. When Obsidian applies a `Decoration.replace` over the cursor line's content, it may remove or override our mark decorations entirely — not because our JS code decided to remove them, but because CM6's decoration resolution removes them at the rendering layer.

If this is the mechanism, no amount of conditional logic in our `buildDecorations()` will fix it. Obsidian is removing our decorations *after* we add them, at the CM6 render phase. Our JS says "add these decorations" but CM6's decoration merging (after applying Obsidian's higher-priority replacements) removes them.

**Hypothesis C: The `.cm-em` Wrapper Is Absent on the Cursor Line**
When Obsidian goes into "source mode" for the cursor line, it removes its own `.cm-em` wrapping around italic text (because the line is showing raw source, not rendered output). Without `.cm-em`, the CSS rule:
```css
.cm-em:has(.cm-underscore-underline) { text-decoration: underline !important; }
```
does not fire. Our `.cm-underscore-underline` span is now a direct child of `.cm-line` (or `.cm-content`) with no `.cm-em` parent. In theory `text-decoration: underline` on the span itself should still work. But if Obsidian's source-mode rendering applies a reset (like `text-decoration: none` or `font-style: italic` directly on `.cm-content` or `.cm-line` for the cursor line), our underline is suppressed without the `:has()` override.

**Hypothesis D: `inObsidian` Detection Fails**
`view.dom.closest(".markdown-source-view")` traverses the DOM upward from the CM6 editor root. In some Obsidian pane configurations (split panes, embedded editors, canvas), the editor may not be a descendant of `.markdown-source-view`. If this selector never matches, `inObsidian` is always `false` and `selFrom`/`selTo` are always `-1`. Then `cursorInToken()` is never true, decorations are added to all tokens including those the cursor is inside, and the display would be correct — but if Obsidian is ALSO separately applying its own "show source" mechanism at the CM6 layer, our decorations would conflict with its rendering and produce visual artifacts.

**Hypothesis E: The Regex Matches Positions Misalign With Obsidian's Tokenization**
Our cursor check compares `view.state.selection.main.from/to` (document character offsets) against our regex match positions. If the document uses non-standard line endings or if Obsidian processes the document through a normalization layer before we see it, the offsets could be off by one or more characters. This would cause `cursorInToken()` to return wrong results.

---

## What Has Never Been Tried

### Option A: Atomic Ranges
CM6's `atomicRanges` facet tells the editor that certain decoration ranges should be treated as atomic units (cursor can't enter them). This could potentially interact with Obsidian's own cursor-tracking in ways that preserve our decorations. Not investigated.

### Option B: `EditorView.decorations` as a `StateField` Instead of `ViewPlugin`
`StateField` decorations have different priority than `ViewPlugin` decorations in CM6. If Obsidian's own ViewPlugin is overriding ours because of plugin registration order, a `StateField` might have higher or lower priority and behave differently. Not investigated.

### Option C: CSS-Only Approach — Drop the Cursor-Detection Logic Entirely
Remove all cursor-detection code. Let Obsidian show raw source on the cursor line AND let our decorations fire. The result would be that on the cursor line, both Obsidian's "raw text" rendering and our `cm-underscore-mark` / `cm-underscore-underline` decorations are applied simultaneously. What actually renders in the DOM is unknown — it might look correct (underlined text with delimiters showing), or it might have conflicting styles. This approach would match Obsidian's native bold/italic behavior most closely since bold/italic tokens that don't contain the cursor still render even when the cursor is on that line.

**This is the most promising untried approach.** Obsidian's native bold/italic rendering already works this way: the asterisks/underscores show up on the cursor line, the font-weight/style stays applied. We should let Obsidian do its thing and just piggyback.

### Option D: Inspect Actual Obsidian DOM with DevTools
No one has opened Obsidian DevTools (Ctrl+Shift+I) and inspected the actual DOM structure of a line containing `_text_` when the cursor is on that line vs. off it. Without this, all hypotheses are speculation. The real answer is in the DOM.

Key questions to answer with DevTools:
1. When cursor is ON the line: does `.cm-underscore-underline` exist in the DOM?
2. When cursor is ON the line: does `.cm-em` still wrap our span?
3. When cursor is ON the line: what is the computed `text-decoration` on `.cm-underscore-underline`?
4. When cursor is ON the line: are there any `Decoration.replace` spans from Obsidian that overlap our match ranges?
5. What CSS class is on the cursor's `.cm-line` element specifically?

### Option E: Hook Into Obsidian's Decoration Priority
Register our ViewPlugin with an explicit priority relative to Obsidian's built-in plugins. CM6 allows plugins to declare their position in the decoration stack. If Obsidian's replacements are evaluated after ours and win, registering ours last (highest priority) might help. But this is speculative and CM6's decoration merging rules are complex.

### Option F: Use `EditorView.baseTheme()` or Inline Styles
If the problem is CSS inheritance (parent suppressing child), using CM6's `EditorView.baseTheme()` to inject CSS rules into the editor's shadow DOM might give higher specificity than the shared `styles.css`. Not investigated.

---

## The Core Difficulty

The fundamental problem is that **we are adding decorations to spans that Obsidian's own rendering system may be simultaneously modifying**. We cannot see what Obsidian's ViewPlugin does because it is closed-source. We can only observe outputs.

The test suite is built around a standalone CM6 editor with no Obsidian code. Every test passes. But the symptom only manifests in Obsidian where the full, undocumented Live Preview decoration system is running alongside ours.

The correct fix likely requires one of:
1. Understanding exactly what Obsidian does at the CM6 layer (requires DevTools inspection or source reading)
2. Making our plugin's behavior independent of what Obsidian does (e.g., removing cursor detection entirely and accepting whatever the combined rendering produces)
3. Using a different CM6 API that interacts differently with Obsidian's rendering priority

---

## Recommended First Steps for a Successor Agent

1. **Open Obsidian DevTools** and inspect the DOM on a line containing `_hello_` when the cursor is both ON and OFF that line. Screenshot the results. This is the single most valuable piece of information missing from all investigations so far.

2. **Try Option C** (remove all cursor-detection): delete the `selFrom`/`selTo`/`cursorInToken` logic and always decorate every matching token. Rebuild, reload Obsidian, and observe behavior. This costs nothing and quickly tells us whether the cursor-detection JS is even the right layer to be working in.

3. **Add a `console.log`** inside `buildDecorations()` that fires when `inObsidian` is true to confirm the detection works at all: `console.log('[underline] inObsidian:', inObsidian, 'selFrom:', selFrom, 'selTo:', selTo)`. Open Obsidian DevTools console and verify these values are what we expect when editing a file.

4. **Check whether the token-level fix was actually loaded**: in DevTools console, inspect `app.plugins.plugins["underline"]` — its version and the actual running code. Confirm the newly built `main.js` was loaded.

5. If DevTools shows our `.cm-underscore-underline` spans ARE in the DOM but have `text-decoration: none` computed, the issue is CSS. If they are NOT in the DOM, the issue is the decoration not being applied (CM6 layer conflict with Obsidian).

---

## File Map

| File | Purpose |
|------|---------|
| `src/editor-decoration.ts` | CM6 ViewPlugin — the broken file |
| `src/reading-mode.ts` | Reading mode post-processor — works fine |
| `src/toggle-command.ts` | Toggle command — works fine |
| `src/main.ts` | Plugin entry point |
| `styles.css` | CSS classes — may be part of inheritance issue |
| `harness/index.html` | E2E test harness — does NOT replicate Obsidian DOM |
| `harness/harness.ts` | Sets up bare CM6 editors — no `.markdown-source-view` |
| `e2e/underline.spec.ts` | Playwright tests — all pass, none test Obsidian-specific behavior |
| `tests/` | Jest unit tests — all pass, test logic not rendering |
