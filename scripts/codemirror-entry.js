// The entry esbuild bundles into public/vendor/codemirror.js — the one place
// the previewer's editor imports CodeMirror from. Re-exports only what
// public/ao3/editor.js uses. Rebuild with `npm run build-codemirror`.
export { EditorState, Compartment } from "@codemirror/state"
export { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, highlightSpecialChars, rectangularSelection, crosshairCursor } from "@codemirror/view"
export { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
export { css } from "@codemirror/lang-css"
export { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from "@codemirror/language"
export { tags } from "@lezer/highlight"
export { oneDark } from "@codemirror/theme-one-dark"
export { linter, lintGutter, setDiagnostics } from "@codemirror/lint"
export { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
export { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
