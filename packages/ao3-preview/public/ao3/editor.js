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
	cssLanguage,
	html,
	autocompletion,
	completionKeymap,
	startCompletion,
	currentCompletions,
	completionStatus,
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
} from "/vendor/codemirror.js?v=4"
import { PROPERTIES, SHORTHANDS } from "./ao3-rules.js"
import { valuesFor } from "./css-values.js"
import { colorPicker } from "./color-picker.js"

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

// ---- language data: AO3's own completions ----
// The CSS language's data facet (EditorState.languageDataAt) is where a
// language hangs its editor services; `css()` would hang CodeMirror's full
// property list there, which offers what AO3 refuses. The previewer registers
// the language itself and hangs ONE completion source on it: AO3's property
// whitelist, shorthands included, so what the editor suggests is what saves.
export const AO3_PROPERTY_NAMES = Array.from(new Set([...PROPERTIES, ...SHORTHANDS])).filter((p) => !p.startsWith("-")).sort()
// Choosing a property writes `name: ` and opens its value list on the spot.
const applyProperty = (view, completion, from, to) => {
	view.dispatch({ changes: { from, to, insert: completion.label + ": " }, selection: { anchor: from + completion.label.length + 2 } })
	startCompletion(view)
}
const propertyOptions = AO3_PROPERTY_NAMES.map((label) => ({ label, type: "property", apply: applyProperty }))

// The declaration the caret is in: text from the last `{`/`;` before pos, or
// null outside a block.
function declarationAt(state, pos) {
	const before = state.doc.sliceString(0, pos)
	const open = before.lastIndexOf("{")
	const close = before.lastIndexOf("}")
	if (open < 0 || close > open) return null
	const line = state.doc.lineAt(pos)
	return before.slice(Math.max(open + 1, before.lastIndexOf(";", pos - 1) + 1, line.from))
}

// Property position: inside a block, before the declaration's colon.
export function inPropertyPosition(state, pos) {
	const decl = declarationAt(state, pos)
	return decl !== null && !decl.includes(":")
}

// Value position: inside a block, after the colon — returns the property name
// (lowercased, trimmed) or null. Inside a string or an open `(` (a url, a
// function's arguments) it is null: nothing sensible to offer there.
export function valuePropertyAt(state, pos) {
	const decl = declarationAt(state, pos)
	if (decl === null) return null
	const colon = decl.indexOf(":")
	if (colon < 0) return null
	const value = decl.slice(colon + 1)
	if ((value.match(/"/g) || []).length % 2 || (value.match(/'/g) || []).length % 2) return null
	if ((value.match(/\(/g) || []).length > (value.match(/\)/g) || []).length) return null
	return decl.slice(0, colon).trim().toLowerCase() || null
}

// A chosen function lands the caret between its parens.
const applyFunction = (view, completion, from, to) => {
	const name = completion.label // "rgb("
	view.dispatch({ changes: { from, to, insert: name + ")" }, selection: { anchor: from + name.length } })
}
const valueCache = new Map()
function valueOptions(prop) {
	if (valueCache.has(prop)) return valueCache.get(prop)
	const opts = valuesFor(prop).map((v) =>
		v.kind === "function"
			? { label: v.label, type: "function", apply: applyFunction }
			: { label: v.label, type: v.kind === "color" ? "constant" : "keyword", boost: v.kind === "keyword" ? 1 : v.kind === "important" ? -2 : v.kind === "global" ? -1 : 0 },
	)
	valueCache.set(prop, opts)
	return opts
}

export function ao3CompletionSource(context) {
	const { state, pos } = context
	const prop = valuePropertyAt(state, pos)
	if (prop) {
		const word = context.matchBefore(/[\w!-]*/)
		if (!word) return null
		// an empty prefix completes right after the colon (a property just chosen,
		// or a colon just typed) and on request; not after every space
		if (word.from === word.to && !context.explicit && !/:\s?$/.test(state.doc.sliceString(Math.max(0, word.from - 2), word.from))) return null
		return { from: word.from, options: valueOptions(prop), validFor: /^[\w!-]*$/ }
	}
	const word = context.matchBefore(/[\w-]*/)
	if (!word || (word.from === word.to && !context.explicit)) return null
	if (!inPropertyPosition(state, word.from)) return null
	return { from: word.from, options: propertyOptions, validFor: /^[\w-]*$/ }
}

export const ao3LanguageData = cssLanguage.data.of({ autocomplete: ao3CompletionSource })

// A lint problem names a line; a diagnostic wants a range. The whole line
// carries it so the squiggle is easy to find.
export function toDiagnostics(state, problems) {
	const out = []
	for (const p of problems || []) {
		const n = Math.min(Math.max(1, p.line | 0), state.doc.lines)
		const line = state.doc.line(n)
		const from = line.from + (line.text.length - line.text.trimStart().length)
		out.push({ from, to: Math.max(from, line.to), severity: p.severity === "error" ? "error" : p.severity === "info" ? "info" : "warning", message: p.message, source: p.code })
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
			// the AO3 lint runs in preview.js and pushes its findings in as
			// diagnostics (setProblems below) — no linter source of CodeMirror's own
			lintGutter(),
			// it's CSS, not prose: no Grammarly (data-gramm is its opt-out, the
			// other two are older spellings it still reads), no spellcheck, no
			// autocorrect/capitalisation on touch keyboards
			EditorView.contentAttributes.of({
				"data-gramm": "false",
				"data-gramm_editor": "false",
				"data-enable-grammarly": "false",
				spellcheck: "false",
				autocorrect: "off",
				autocapitalize: "off",
			}),
			// the CSS language plus the previewer's own language data — not
			// `css()`, which would also register CodeMirror's full property list
			cssLanguage,
			ao3LanguageData,
			autocompletion(),
			// a swatch beside every colour value; hover it for a picker
			colorPicker(),
			EditorView.lineWrapping,
			keymap.of([
				{ key: "Mod-s", run: () => (onSave?.(), true) },
				...closeBracketsKeymap,
				...completionKeymap,
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
		// what the language data facet holds at a position (EditorState.languageDataAt)
		languageDataAt(name, pos = view.state.selection.main.head) {
			return view.state.languageDataAt(name, pos)
		},
		completions() {
			return currentCompletions(view.state)
		},
		completionStatus() {
			return completionStatus(view.state)
		},
		startCompletion() {
			return startCompletion(view)
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
		// The inspector's pick: a rule already opening with this selector gets
		// the caret on its first inner line; otherwise an empty rule is appended
		// and the caret set inside it. Either way the property dropdown opens
		// there — AO3's whitelist, the whole point of picking an element.
		appendRule(selector) {
			const sel = String(selector || "").trim()
			if (!sel) return null
			const re = new RegExp("^\\s*" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{")
			const doc = view.state.doc
			for (let i = 1; i <= doc.lines; i++) {
				if (re.test(doc.line(i).text)) {
					const opener = doc.line(i)
					// a one-line rule (`p { color: red }`) keeps the caret after its "{"
					const inner = opener.text.trim().endsWith("{") && i < doc.lines ? doc.line(i + 1) : null
					const caret = inner ? inner.to : opener.from + opener.text.indexOf("{") + 1
					view.dispatch({ selection: { anchor: caret }, scrollIntoView: true })
					view.focus()
					startCompletion(view)
					return { line: view.state.doc.lineAt(caret).number, existed: true }
				}
			}
			const text = doc.toString()
			const lead = text.length === 0 ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n"
			const insert = `${lead}${sel} {\n\t\n}\n`
			const caret = doc.length + lead.length + sel.length + 4 // after "{\n\t"
			view.dispatch({ changes: { from: doc.length, insert }, selection: { anchor: caret }, scrollIntoView: true })
			view.focus()
			startCompletion(view)
			return { line: view.state.doc.lineAt(caret).number, existed: false }
		},
	}
}

/**
 * createHtmlEditor(host, { value, dark, onChange }) → { get value, set value, setDark, focus, view }
 * A small HTML editor for the Work Content fields: HTML mode, wrapping, no
 * gutter, the same two themes as the CSS editor. `rows` sets a minimum height.
 */
export function createHtmlEditor(host, { value = "", dark = true, onChange, rows = 4 } = {}) {
	const themeSlot = new Compartment()
	const themeFor = (d) => (d ? [oneDark] : [lightTheme, syntaxHighlighting(lightHighlight)])
	const state = EditorState.create({
		doc: value,
		extensions: [
			EditorView.theme({
				"&": { fontSize: "0.82rem", minHeight: rows * 1.45 + 1 + "em" },
				".cm-scroller": { fontFamily: '"Inconsolata", Menlo, Consolas, monospace', lineHeight: "1.45", overflow: "auto", maxHeight: "60vh" },
				".cm-content": { padding: "6px 0" },
				"&.cm-focused": { outline: "none" },
			}),
			themeSlot.of(themeFor(dark)),
			history(),
			drawSelection(),
			highlightSpecialChars(),
			bracketMatching(),
			closeBrackets(),
			html(),
			autocompletion(),
			// AO3's HTML rules run in preview.js and land here as diagnostics
			lintGutter(),
			EditorView.lineWrapping,
			keymap.of([...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
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
	}
}
