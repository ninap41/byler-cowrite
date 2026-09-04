// The entry esbuild bundles into public/vendor/codemirror.js — the one place
// the previewer's editor imports CodeMirror from. Re-exports only what
// public/ao3/editor.js uses. Rebuild with `npm run build-codemirror`.
export { EditorState, Compartment, StateField, StateEffect } from "@codemirror/state"
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor, Decoration, ViewPlugin, WidgetType, showTooltip } from "@codemirror/view"
export { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
export { css, cssLanguage } from "@codemirror/lang-css"
export { html } from "@codemirror/lang-html"
export { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language"
export { tags } from "@lezer/highlight"
export { oneDark } from "@codemirror/theme-one-dark"
export { linter, lintGutter, setDiagnostics } from "@codemirror/lint"
export { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap, startCompletion, currentCompletions, completionStatus } from "@codemirror/autocomplete"
export { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
