// A colour picker for the CSS editor: every colour value in the sheet — #hex,
// rgb()/rgba()/hsl()/hsla(), a named colour — wears a small swatch, and
// hovering the value opens a tooltip holding a native <input type="color">;
// picking a colour rewrites the value in place (alpha kept for rgba/hsla).
//
// The tooltip is managed by hand (a StateField + showTooltip) rather than
// hoverTooltip so it can be PINNED while the native picker is open: the OS
// picker is a separate panel, and the pointer leaving the editor must not
// tear the input out from under it.

import { EditorView, Decoration, ViewPlugin, WidgetType, StateField, StateEffect, showTooltip } from "/vendor/codemirror.js?v=4"
import { NAMED_COLORS } from "./css-values.js"

// ---- finding colours ----
const NAMED = new Set(NAMED_COLORS.filter((c) => c !== "transparent" && c !== "currentcolor"))
const COLOR_RE = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^)]*\)|\b[a-z]+\b/gi

/** colorSpans(text, base) → [{from, to, text}] for every colour in `text`, offsets from `base` */
export function colorSpans(text, base = 0) {
	const out = []
	COLOR_RE.lastIndex = 0
	let m
	while ((m = COLOR_RE.exec(text))) {
		const t = m[0]
		const lower = t.toLowerCase()
		let ok = false
		if (t[0] === "#") ok = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)
		else if (/^(rgba?|hsla?)\(/i.test(t)) ok = parseColor(t) !== null
		else ok = NAMED.has(lower) && !inWord(text, m.index, t.length)
		if (ok) out.push({ from: base + m.index, to: base + m.index + t.length, text: t })
	}
	return out
}
// a named colour inside a longer identifier (`red` in `border-red-x`) is not a colour
function inWord(text, i, len) {
	const before = text[i - 1], after = text[i + len]
	return (before && /[\w-]/.test(before)) || (after && /[\w-]/.test(after))
}

// ---- colour maths (no canvas, no DOM: testable) ----
const NAMED_HEX = (() => {
	// the named colours' hex values, computed lazily through a canvas when one
	// is available; the table stays empty in a DOM-less test and named colours
	// then start the picker at black
	return new Map()
})()
export function namedToHex(name, doc) {
	const key = name.toLowerCase()
	if (NAMED_HEX.has(key)) return NAMED_HEX.get(key)
	let hex = null
	try {
		const c = doc?.createElement("canvas")?.getContext("2d")
		if (c) {
			c.fillStyle = key
			hex = c.fillStyle // canvas normalises to #rrggbb
		}
	} catch {}
	if (hex && /^#[0-9a-f]{6}$/i.test(hex)) NAMED_HEX.set(key, hex)
	return hex
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")
export const toHex = (r, g, b) => "#" + hex2(r) + hex2(g) + hex2(b)

/** parseColor(text) → {r,g,b,a} | null (named colours need `doc`) */
export function parseColor(text, doc) {
	const t = String(text).trim()
	let m
	if ((m = t.match(/^#([0-9a-f]{3,8})$/i))) {
		let h = m[1]
		if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("")
		if (h.length !== 6 && h.length !== 8) return null
		const n = parseInt(h.slice(0, 6), 16)
		const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1
		return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a }
	}
	if ((m = t.match(/^(rgba?|hsla?)\(\s*([^)]*)\)$/i))) {
		const fn = m[1].toLowerCase()
		const parts = m[2].split(/\s*[,\/]\s*|\s+/).filter(Boolean)
		if (parts.length < 3 || parts.length > 4) return null
		const num = (s, max) => {
			if (/^-?[\d.]+%$/.test(s)) return (parseFloat(s) / 100) * max
			if (/^-?[\d.]+$/.test(s)) return parseFloat(s)
			return NaN
		}
		const a = parts.length === 4 ? (/%$/.test(parts[3]) ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1
		if (Number.isNaN(a)) return null
		if (fn.startsWith("rgb")) {
			const [r, g, b] = parts.slice(0, 3).map((s) => num(s, 255))
			if ([r, g, b].some(Number.isNaN)) return null
			return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a: clamp(a, 0, 1) }
		}
		const h = parseFloat(parts[0]), s = num(parts[1], 1), l = num(parts[2], 1)
		if ([h, s, l].some(Number.isNaN)) return null
		const { r, g, b } = hslToRgb(((h % 360) + 360) % 360, clamp(s, 0, 1), clamp(l, 0, 1))
		return { r, g, b, a: clamp(a, 0, 1) }
	}
	const hex = NAMED.has(t.toLowerCase()) ? namedToHex(t, doc) : null
	return hex ? parseColor(hex) : null
}
export function hslToRgb(h, s, l) {
	const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2
	let [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
	return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

/** What to write back when the picker lands on `hex` for a value that read `original` */
export function replacement(original, hex) {
	const o = String(original).trim()
	const p = parseColor(o)
	if (p && p.a < 1 && /^(rgba?|hsla?)\(|^#[0-9a-f]{4}$|^#[0-9a-f]{8}$/i.test(o)) {
		const { r, g, b } = parseColor(hex)
		return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+p.a.toFixed(3)})`
	}
	return hex.toLowerCase()
}

// ---- swatches ----
class SwatchWidget extends WidgetType {
	constructor(color) {
		super()
		this.color = color
	}
	eq(o) {
		return o.color === this.color
	}
	toDOM() {
		const s = document.createElement("span")
		s.className = "ap-swatch"
		s.style.backgroundColor = this.color
		s.setAttribute("aria-hidden", "true")
		return s
	}
	ignoreEvent() {
		return false
	}
}
function swatches(view) {
	const decos = []
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.doc.sliceString(from, to)
		for (const c of colorSpans(text, from)) decos.push(Decoration.widget({ widget: new SwatchWidget(c.text), side: -1 }).range(c.from))
	}
	return Decoration.set(decos, true)
}
const swatchPlugin = ViewPlugin.fromClass(
	class {
		constructor(view) {
			this.decorations = swatches(view)
		}
		update(u) {
			if (u.docChanged || u.viewportChanged) this.decorations = swatches(u.view)
		}
	},
	{ decorations: (v) => v.decorations },
)

// ---- the hover tooltip ----
export const setPicker = StateEffect.define() // {from, to} | null
const pickerField = StateField.define({
	create: () => null,
	update(value, tr) {
		for (const e of tr.effects) if (e.is(setPicker)) value = e.value
		if (value && tr.docChanged) {
			const from = tr.changes.mapPos(value.from, -1), to = tr.changes.mapPos(value.to, 1)
			value = to > from ? { from, to } : null
		}
		return value
	},
	provide: (f) => showTooltip.from(f, (v) => (v ? tooltipFor(v) : null)),
})
let pinned = false
function tooltipFor({ from, to }) {
	return {
		pos: from,
		end: to,
		above: true,
		strictSide: false,
		arrow: false,
		create(view) {
			const text = view.state.doc.sliceString(from, to)
			const parsed = parseColor(text, view.dom.ownerDocument)
			const dom = document.createElement("div")
			dom.className = "ap-color-tip"
			const input = document.createElement("input")
			input.type = "color"
			input.value = parsed ? toHex(parsed.r, parsed.g, parsed.b) : "#000000"
			input.title = "Color picker"
			input.setAttribute("aria-label", "Color picker")
			const caption = document.createElement("span")
			caption.className = "ap-color-cap"
			caption.textContent = "Color picker"
			const label = document.createElement("span")
			label.className = "ap-color-val"
			label.textContent = text
			// the caption sits ABOVE the picker; the input and the value share the row under it
			const row = document.createElement("div")
			row.className = "ap-color-row"
			row.append(input, label)
			dom.append(caption, row)
			const write = () => {
				const cur = view.state.field(pickerField, false)
				if (!cur) return
				const now = view.state.doc.sliceString(cur.from, cur.to)
				const next = replacement(now, input.value)
				if (next === now) return
				view.dispatch({ changes: { from: cur.from, to: cur.to, insert: next } })
				label.textContent = next
			}
			input.addEventListener("input", write)
			input.addEventListener("change", () => {
				write()
				pinned = false
			})
			input.addEventListener("focus", () => (pinned = true))
			input.addEventListener("blur", () => {
				pinned = false
			})
			dom.addEventListener("mouseleave", () => {
				if (!pinned) view.dispatch({ effects: setPicker.of(null) })
			})
			return { dom }
		},
	}
}

/** The colour under a document position, or null */
export function colorAt(state, pos) {
	const line = state.doc.lineAt(pos)
	for (const c of colorSpans(line.text, line.from)) if (pos >= c.from && pos <= c.to) return c
	return null
}

const hoverHandlers = EditorView.domEventHandlers({
	mousemove(e, view) {
		if (pinned) return
		const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
		const cur = view.state.field(pickerField, false)
		if (pos == null) return
		const hit = colorAt(view.state, pos)
		// posAtCoords snaps to the nearest position; make sure the pointer is really on the text
		if (hit && cur && cur.from === hit.from && cur.to === hit.to) return
		if (hit) view.dispatch({ effects: setPicker.of({ from: hit.from, to: hit.to }) })
		else if (cur && !e.target?.closest?.(".ap-color-tip")) view.dispatch({ effects: setPicker.of(null) })
	},
	mouseleave(e, view) {
		if (pinned) return
		if (e.relatedTarget?.closest?.(".ap-color-tip")) return
		if (view.state.field(pickerField, false)) view.dispatch({ effects: setPicker.of(null) })
	},
})

const theme = EditorView.baseTheme({
	".ap-swatch": {
		display: "inline-block",
		width: "0.8em",
		height: "0.8em",
		marginRight: "0.3em",
		verticalAlign: "-0.1em",
		borderRadius: "2px",
		boxShadow: "0 0 0 1px rgba(128,128,128,0.6)",
		cursor: "pointer",
	},
	".cm-tooltip.ap-color-tip": {
		display: "flex",
		flexDirection: "column",
		alignItems: "flex-start",
		gap: "5px",
		padding: "6px 8px",
		borderRadius: "6px",
		font: "12px/1 Menlo, Consolas, monospace",
	},
	".ap-color-row": { display: "flex", alignItems: "center", gap: "8px" },
	".ap-color-cap": { fontWeight: "700", letterSpacing: "0.03em", textTransform: "uppercase", fontSize: "10px", opacity: "0.8" },
	".ap-color-val": { opacity: "0.85" },
	".ap-color-tip input[type=color]": {
		width: "28px",
		height: "22px",
		padding: "0",
		border: "none",
		background: "none",
		cursor: "pointer",
	},
})

/** The extension: swatches + hover picker. */
export function colorPicker() {
	return [pickerField, swatchPlugin, hoverHandlers, theme]
}
