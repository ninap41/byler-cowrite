// The previewer's code editor: CodeMirror 6, served from the vendored bundle
// (public/vendor/codemirror.js, built by scripts/build-codemirror.mjs). This
// module is the only thing that knows CodeMirror's API; preview.js talks to
// the small adapter it returns — value in/out, a change callback, the AO3
// lint's problems as diagnostics, and the theme.

import {
	EditorState,
	Compartment,
	EditorView,
	keymap,
	lineNumbers,
	highlightActiveLine,
	highlightActiveLineGutter,
	drawSelection,
	highlightSpecialChars,
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
	css,
	syntaxHighlighting,
	HighlightStyle,
	bracketMatching,
	indentOnInput,
	foldGutter,
	foldKeymap,
	tags,
	oneDark,
	lintGutter,
	setDiagnostics,
	closeBrackets,
	closeBracketsKeymap,
	highlightSelectionMatches,
	searchKeymap,
} from "/vendor/codemirror.js"

// The light palette — the same hues the previewer used before CodeMirror, so
// a colour token reads the same in either mode. Dark is oneDark.
const lightHighlight = HighlightStyle.define([
	{ tag: tags.comment, color: "#8a8a8a", fontStyle: "italic" },
	{ tag: [tags.keyword, tags.definitionKeyword, tags.modifier], color: "#a21caf", fontWeight: "700" },
	{ tag: tags.tagName, color: "#0b5cad" },
	{ tag: tags.labelName, color: "#1d4ed8", fontWeight: "700" }, // #id
	{ tag: tags.className, color: "#6d28d9" },
	{ tag: [tags.derefOperator, tags.attributeName], color: "#0e7490" }, // :pseudo, [attr]
	{ tag: tags.propertyName, color: "#1d4ed8" },
	{ tag: tags.variableName, color: "#7e22ce" }, // --custom
	{ tag: [tags.number, tags.unit], color: "#b45309" },
	{ tag: tags.color, color: "#a16207" },
	{ tag: tags.string, color: "#15803d" },
	{ tag: [tags.function(tags.variableName), tags.atom], color: "#0f766e" },
	{ tag: [tags.punctuation, tags.operator, tags.separator], color: "#666" },
])

const lightTheme = EditorView.theme(
	{
		"&": { backgroundColor: "#ffffff", color: "#222" },
		".cm-gutters": { backgroundColor: "#f7f7f7", color: "#888", borderRight: "1px solid #d9d9d9" },
		".cm-activeLineGutter": { backgroundColor: "#ececec" },
		".cm-activeLine": { backgroundColor: "rgba(0,0,0,0.035)" },
		".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "#cfe3ff" },
		".cm-cursor": { borderLeftColor: "#111" },
	},
	{ dark: false },
)

// Every mode shares this: the editor fills its host and wears the mono face.
const baseTheme = EditorView.theme({
	"&": { height: "100%", fontSize: "0.86rem" },
	".cm-scroller": { fontFamily: '"Inconsolata", Menlo, Consolas, monospace', lineHeight: "1.45", overflow: "auto" },
	".cm-content": { padding: "10px 0" },
	"&.cm-focused": { outline: "none" },
	".cm-lint-marker-error": { content: "none" },
})

// A lint problem names a line; a diagnostic wants a range. The whole line
// carries it so the squiggle is easy to find.
export function toDiagnostics(state, problems) {
	const out = []
	for (const p of problems || []) {
		const n = Math.min(Math.max(1, p.line | 0), state.doc.lines)
		const line = state.doc.line(n)
		const from = line.from + (line.text.length - line.text.trimStart().length)
		out.push({ from, to: Math.max(from, line.to), severity: p.severity === "error" ? "error" : "warning", message: p.message, source: p.code })
	}
	return out
}

/**
 * createEditor(host, { value, dark, onChange, onSave }) →
 *   { get value, set value, setProblems(problems), setDark(bool), focus(), gotoLine(n), view }
 */
export function createEditor(host, { value = "", dark = true, onChange, onSave } = {}) {
	const themeSlot = new Compartment()
	const themeFor = (d) => (d ? [oneDark] : [lightTheme, syntaxHighlighting(lightHighlight)])
	const state = EditorState.create({
		doc: value,
		extensions: [
			baseTheme,
			themeSlot.of(themeFor(dark)),
			lineNumbers(),
			highlightActiveLineGutter(),
			highlightSpecialChars(),
			history(),
			foldGutter(),
			drawSelection(),
			indentOnInput(),
			bracketMatching(),
			closeBrackets(),
			highlightActiveLine(),
			highlightSelectionMatches(),
			css(),
			// the AO3 lint runs in preview.js and pushes its findings in as
			// diagnostics (setProblems below) — no linter source of CodeMirror's own
			lintGutter(),
			EditorView.lineWrapping,
			keymap.of([
				{ key: "Mod-s", run: () => (onSave?.(), true) },
				...closeBracketsKeymap,
				...defaultKeymap,
				...searchKeymap,
				...historyKeymap,
				...foldKeymap,
				indentWithTab,
			]),
			EditorView.updateListener.of((u) => {
				if (u.docChanged) onChange?.(u.state.doc.toString())
			}),
		],
	})
	const view = new EditorView({ state, parent: host })
	return {
		view,
		get value() {
			return view.state.doc.toString()
		},
		set value(v) {
			const next = String(v ?? "")
			if (next === view.state.doc.toString()) return
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } })
		},
		setProblems(list) {
			view.dispatch(setDiagnostics(view.state, toDiagnostics(view.state, list || [])))
		},
		setDark(d) {
			view.dispatch({ effects: themeSlot.reconfigure(themeFor(!!d)) })
		},
		focus() {
			view.focus()
		},
		gotoLine(n) {
			const line = view.state.doc.line(Math.min(Math.max(1, n | 0), view.state.doc.lines))
			view.dispatch({ selection: { anchor: line.from, head: line.to }, scrollIntoView: true })
			view.focus()
		},
	}
}
