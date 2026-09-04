// AO3's work-skin CSS rules as a pure lint (no DOM, no I/O) — a mirror of
// otwarchive's lib/css_cleaner.rb + the SUPPORTED_CSS_* lists in
// config/config.yml, so the previewer can say what AO3 will strip BEFORE the
// skin is pasted. ao3-rules.json beside this file carries the same lists as
// documentation-as-data; test/ao3-rules.test.mjs fails if the two drift.
//
// The cleaner's shape, in short: a property must be in the exact list, or
// CONTAIN one of the shorthand words (so `column-gap` passes and bare `gap`
// fails), or be a vendor-prefixed exact property; a value may only carry
// numbers with the short unit list, colours, the transform/filter/gradient
// functions, `var()` and — on a handful of image properties — an http(s)
// `url()` ending in jpg/jpeg/png/gif. `!important` always survives.
// `@font-face` is refused outright; every other at-rule is simply not parsed
// as a rule and vanishes.

export const PROPERTIES = [
	"-replace", "-use-link-source", "accelerator", "accent-color", "align-content", "align-items", "align-self",
	"alignment-adjust", "alignment-baseline", "appearance", "aspect-ratio", "azimuth", "baseline-shift", "behavior",
	"binding", "bookmark-label", "bookmark-level", "bookmark-target", "bottom", "box-align", "box-direction",
	"box-flex", "box-flex-group", "box-lines", "box-orient", "box-pack", "box-shadow", "box-sizing", "caption-side",
	"clear", "clip", "color", "color-profile", "color-scheme", "content", "counter-increment", "counter-reset",
	"crop", "cue", "cue-after", "cue-before", "cursor", "direction", "display", "dominant-baseline",
	"drop-initial-after-adjust", "drop-initial-after-align", "drop-initial-before-adjust",
	"drop-initial-before-align", "drop-initial-size", "drop-initial-value", "elevation", "empty-cells", "fill",
	"filter", "fit", "fit-position", "float", "float-offset", "font", "font-effect", "font-emphasize",
	"font-emphasize-position", "font-emphasize-style", "font-family", "font-size", "font-size-adjust",
	"font-smooth", "font-stretch", "font-style", "font-variant", "font-weight", "grid-columns", "grid-rows",
	"hanging-punctuation", "height", "hyphenate-after", "hyphenate-before", "hyphenate-character",
	"hyphenate-lines", "hyphenate-resource", "hyphens", "icon", "image-orientation", "image-resolution",
	"ime-mode", "include-source", "inline-box-align", "justify-content", "layout-flow", "left", "letter-spacing",
	"line-break", "line-height", "line-stacking", "line-stacking-ruby", "line-stacking-shift",
	"line-stacking-strategy", "mark", "mark-after", "mark-before", "marks", "marquee-direction",
	"marquee-play-count", "marquee-speed", "marquee-style", "max-height", "max-width", "min-height", "min-width",
	"move-to", "nav-down", "nav-index", "nav-left", "nav-right", "nav-up", "opacity", "order", "orphans", "page",
	"page-policy", "phonemes", "pitch", "pitch-range", "play-during", "position", "presentation-level",
	"punctuation-trim", "quotes", "rendering-intent", "resize", "rest", "rest-after", "rest-before", "richness",
	"right", "rotation", "rotation-point", "ruby-align", "ruby-overhang", "ruby-position", "ruby-span", "size",
	"speak", "speak-header", "speak-numeral", "speak-punctuation", "speech-rate", "stress", "string-set",
	"stroke", "stroke-width", "tab-side", "table-layout", "target", "target-name", "target-new",
	"target-position", "top", "unicode-bibi", "unicode-bidi", "user-select", "vertical-align", "visibility",
	"voice-balance", "voice-duration", "voice-family", "voice-pitch", "voice-pitch-range", "voice-rate",
	"voice-stress", "voice-volume", "volume", "white-space", "white-space-collapse", "widows", "width",
	"word-break", "word-spacing", "word-wrap", "writing-mode", "z-index",
]
export const SHORTHANDS = [
	"background", "border", "column", "cue", "flex", "font", "layer-background", "layout-grid", "list-style",
	"margin", "marker", "outline", "overflow", "padding", "page-break", "pause", "scrollbar", "text",
	"transform", "transition",
]
export const VENDOR_PREFIXES = ["moz", "ms", "o", "webkit"]
export const UNITS = ["deg", "cm", "em", "ex", "in", "mm", "pc", "pt", "px", "s", "%"]
export const URL_PROPERTIES = ["background", "background-image", "border", "border-image", "list-style", "list-style-image", "content"]
export const URL_EXTENSIONS = ["jpg", "jpeg", "png", "gif"]
export const TRANSFORM_FUNCTIONS = ["scale", "scalex", "scaley", "translate", "translatex", "translatey", "skew", "skewx", "skewy", "rotate", "rotatex", "rotatey", "matrix"]
export const FILTER_FUNCTIONS = ["blur", "brightness", "contrast", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia", "drop-shadow"]
export const COLOR_FUNCTIONS = ["rgb", "rgba", "hsl", "hsla", "color-stop"]
export const GRADIENT_FUNCTIONS = ["linear-gradient", "radial-gradient", "repeating-linear-gradient", "repeating-radial-gradient"]
export const FORBIDDEN_FUNCTIONS = ["calc", "clamp", "min", "max", "color-mix", "attr", "env", "counter", "counters", "image-set", "conic-gradient"]
export const KEYWORDS = ["!important", "url"]
export const AT_RULES = {
	rejected: ["font-face"],
	dropped: ["import", "media", "keyframes", "supports", "charset", "namespace", "page", "layer", "container"],
}
export const ERRORS = ["no_valid_css", "banned_property", "invalid_custom_property_name", "banned_value_for_property", "no_rules_for_selectors", "no_valid_css_for_selectors", "font_face"]

const ALLOWED_FUNCTIONS = new Set([
	...TRANSFORM_FUNCTIONS, ...FILTER_FUNCTIONS, ...COLOR_FUNCTIONS, ...GRADIENT_FUNCTIONS,
	...GRADIENT_FUNCTIONS.map((g) => "-webkit-" + g), ...GRADIENT_FUNCTIONS.map((g) => "-moz-" + g),
	"var", "url",
])
const PROP_SET = new Set(PROPERTIES)
const VENDOR_RE = new RegExp("^-(" + VENDOR_PREFIXES.join("|") + ")-(.+)$")
const CUSTOM_RE = /^--[a-z0-9_-]+$/i
// css_cleaner.rb: NUMBER_REGEX '-?\.?\d{1,3}\.?\d{0,3}' — the dot is optional,
// so up to six digits run together pass (1000px is fine) and anything longer,
// or more than three decimals, is not a number AO3 knows.
const NUMBER_RE = /^-?\.?\d{1,3}\.?\d{0,3}$/
const UNIT_RE = new RegExp("^(-?\\.?\\d+\\.?\\d*)(" + UNITS.map((u) => u.replace("%", "\\%")).join("|") + ")?$", "i")
const URL_RE = new RegExp("^https?://[a-z0-9.-]+\\.[a-z]{2,}(/[^\\s?#]*)?\\.(" + URL_EXTENSIONS.join("|") + ")$", "i")
const FONT_NAME_RE = /^\s*('[a-z0-9\- ]+'|"[a-z0-9\- ]+"|[a-z0-9\- ]+)\s*$/i

// ---------- property ----------

export function propertyStatus(prop) {
	const p = String(prop || "").trim().toLowerCase()
	if (!p) return { ok: false, code: "banned_property" }
	if (p.startsWith("--")) return CUSTOM_RE.test(p) ? { ok: true, custom: true } : { ok: false, code: "invalid_custom_property_name" }
	if (PROP_SET.has(p)) return { ok: true }
	if (SHORTHANDS.some((s) => p.includes(s))) return { ok: true }
	const m = p.match(VENDOR_RE)
	if (m && PROP_SET.has(m[2])) return { ok: true }
	return { ok: false, code: "banned_property" }
}

// ---------- value ----------

// Split a value on whitespace and commas, but never inside quotes or parens,
// so `rgba(0, 0, 0, .5)` is one token and `"Times New Roman"` is one token.
function tokens(value) {
	const out = []
	let cur = ""
	let depth = 0
	let quote = null
	for (const ch of value) {
		if (quote) {
			cur += ch
			if (ch === quote) quote = null
			continue
		}
		if (ch === '"' || ch === "'") (quote = ch), (cur += ch)
		else if (ch === "(") depth++, (cur += ch)
		else if (ch === ")") depth--, (cur += ch)
		else if ((ch === " " || ch === "\t" || ch === "\n" || ch === ",") && depth === 0) {
			if (cur) out.push(cur)
			cur = ""
		} else cur += ch
	}
	if (cur) out.push(cur)
	return out
}

const stripQuotes = (s) => s.replace(/^(['"])(.*)\1$/s, "$2")
const funcName = (tok) => {
	const m = tok.match(/^([a-z-]+)\(/i)
	return m ? m[1].toLowerCase() : null
}
const innerOf = (tok) => tok.slice(tok.indexOf("(") + 1, tok.lastIndexOf(")"))

function urlProblem(tok, prop) {
	const target = stripQuotes(innerOf(tok).trim())
	if (!URL_PROPERTIES.includes(prop.replace(VENDOR_RE, "$2"))) return `url() is only allowed on ${URL_PROPERTIES.join(", ")}`
	if (!/^https?:\/\//i.test(target)) return "a url() must be a full http(s):// address"
	if (/[?#]/.test(target)) return "a url() may not carry a query string or fragment"
	if (!URL_RE.test(target)) return `a url() must end in .${URL_EXTENSIONS.join(" / .")}`
	return null
}

function numberProblem(tok) {
	const m = tok.match(UNIT_RE)
	if (!m) return null // not a number-shaped token
	if (!NUMBER_RE.test(m[1])) return `"${tok}" — AO3 only reads numbers of up to six digits, three of them after the point`
	return null
}

const looksNumeric = (tok) => /^-?\.?\d/.test(tok)

export function valueStatus(prop, rawValue) {
	const p = String(prop || "").trim().toLowerCase()
	let value = String(rawValue || "").trim()
	const important = /!\s*important\s*$/i.test(value)
	if (important) value = value.replace(/!\s*important\s*$/i, "").trim()
	if (!value) return { ok: false, code: "no_valid_css_for_selectors", message: "empty value" }
	const warnings = []
	if (p.startsWith("--")) {
		warnings.push({ code: "custom_property", message: "custom properties are accepted by the site skin cleaner but reported flaky in work skins — prefer literal values" })
		return { ok: true, warnings }
	}
	const bad = (message) => ({ ok: false, code: "banned_value_for_property", message })

	// forbidden functions anywhere in the value, nested included
	for (const f of FORBIDDEN_FUNCTIONS) {
		if (new RegExp("(^|[^a-z-])" + f.replace("-", "\\-") + "\\(", "i").test(value)) return bad(`${f}() is not on AO3's list — resolve it to a literal value`)
	}
	if (/\bvar\s*\(/i.test(value)) {
		if (p === "content") return bad("var() inside content is refused")
		warnings.push({ code: "var_in_workskin", message: "var() passes the cleaner but is reported flaky in work skins" })
	}

	if (p === "font-family" || p === "font") {
		// the font shorthand is rarer; only the family list is checked here
		const names = p === "font-family" ? value.split(",") : []
		for (const n of names) if (!FONT_NAME_RE.test(n)) return bad(`font name "${n.trim()}" — only letters, digits, dashes and spaces, optionally quoted`)
	}

	if (p === "content") {
		const toks = tokens(value)
		for (const t of toks) {
			if (/^(none|normal|open-quote|close-quote|no-open-quote|no-close-quote)$/i.test(t)) continue
			if (/^(['"]).*\1$/s.test(t)) continue
			if (funcName(t) === "url") {
				const u = urlProblem(t, p)
				if (u) return bad(u)
				continue
			}
			return bad(`content may only be a quoted string, url() or none — "${t}" is unquoted`)
		}
		return { ok: true, warnings, important }
	}

	for (const t of tokens(value)) {
		const fn = funcName(t)
		if (fn) {
			if (fn === "url") {
				const u = urlProblem(t, p)
				if (u) return bad(u)
				continue
			}
			if (!ALLOWED_FUNCTIONS.has(fn)) return bad(`${fn}() is not a function AO3 accepts`)
			// numbers inside the function's arguments follow the same rules
			for (const inner of tokens(innerOf(t))) {
				if (looksNumeric(inner)) {
					const np = numberProblem(inner)
					if (np) return bad(np)
					if (!UNIT_RE.test(inner)) return bad(`"${inner}" — unit not in AO3's list (${UNITS.join(" ")})`)
				}
			}
			continue
		}
		if (t.startsWith("#")) {
			if (!/^#[0-9a-f]{3,6}$/i.test(t)) return bad(`"${t}" is not a colour AO3 reads (#rgb … #rrggbb)`)
			continue
		}
		if (looksNumeric(t)) {
			const np = numberProblem(t)
			if (np) return bad(np)
			if (!UNIT_RE.test(t)) return bad(`"${t}" — unit not in AO3's list (${UNITS.join(" ")})`)
			continue
		}
		if (/^(['"]).*\1$/s.test(t)) continue
		if (!/^[a-z][a-z0-9-]*$/i.test(t) && !/^[\/]$/.test(t)) return bad(`"${t}" is not a value AO3 reads`)
	}
	return { ok: true, warnings, important }
}

// ---------- the sheet ----------

// Comments go, but every newline stays so line numbers still point at the
// author's own text.
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
const lineAt = (text, idx) => text.slice(0, idx).split("\n").length

// Split `a: b; c: d` on semicolons outside quotes and parens.
function splitDecls(body, base) {
	const out = []
	let start = 0
	let depth = 0
	let quote = null
	const push = (end) => {
		const raw = body.slice(start, end)
		if (raw.trim()) out.push({ raw, at: base + start })
		start = end + 1
	}
	for (let i = 0; i < body.length; i++) {
		const ch = body[i]
		if (quote) {
			if (ch === quote) quote = null
			continue
		}
		if (ch === '"' || ch === "'") quote = ch
		else if (ch === "(") depth++
		else if (ch === ")") depth--
		else if (ch === ";" && depth === 0) push(i)
	}
	push(body.length)
	return out
}

// Find the `}` that closes the block opened at `open` (index of `{`).
function closeOf(text, open) {
	let depth = 0
	let quote = null
	for (let i = open; i < text.length; i++) {
		const ch = text[i]
		if (quote) {
			if (ch === quote) quote = null
			continue
		}
		if (ch === '"' || ch === "'") quote = ch
		else if (ch === "{") depth++
		else if (ch === "}") {
			depth--
			if (depth === 0) return i
		}
	}
	return text.length
}

// A selector made only of element names, `*`, pseudo-classes/elements,
// attribute tests and combinators — `body`, `p > em`, `a:hover`, `.userstuff`
// excluded — needs no `#workskin` note: AO3 prefixes it on save and it means
// the same thing either way. Only a class or id written bare gets the note.
export function elementOnly(sel) {
	const s = sel.trim()
	if (!s) return false
	return !/[#.]/.test(s.replace(/\[[^\]]*\]/g, "").replace(/\([^)]*\)/g, ""))
}

// A selector list split on its top-level commas only — a comma inside
// `:has(a, b)` or `:is(...)` stays put.
export function splitSelectors(sel) {
	const out = []
	let depth = 0, start = 0
	for (let i = 0; i < sel.length; i++) {
		const c = sel[i]
		if (c === "(") depth++
		else if (c === ")") depth = Math.max(0, depth - 1)
		else if (c === "," && depth === 0) { out.push(sel.slice(start, i)); start = i + 1 }
	}
	out.push(sel.slice(start))
	return out
}
export const WORKSKIN = "#workskin"
// The two kinds of skin AO3 cleans with the same rules: a WORK skin is stored
// with every selector prefixed `#workskin ` (unless it already starts so) and
// reaches only the work; a SITE skin is stored as written and dresses the
// whole page. `kind` is "work" | "site".
export const SKIN_KINDS = ["work", "site"]
export const cleanKind = (k) => (k === "site" ? "site" : "work")
export function storedSelector(sel, kind = "work") {
	const parts = splitSelectors(sel).map((s) => s.trim()).filter(Boolean)
	if (cleanKind(kind) === "site") return parts.join(", ")
	return parts.map((s) => (new RegExp("^" + WORKSKIN + "\\b").test(s) ? s : WORKSKIN + " " + s)).join(", ")
}

export const MESSAGES = {
	font_face: "@font-face is refused by AO3 — the whole skin fails to save until it is removed",
	at_rule_dropped: "AO3 does not parse this at-rule; everything inside it is dropped",
	banned_property: "not on AO3's property list — this declaration is dropped",
	invalid_custom_property_name: "custom property names may only carry letters, digits, dashes and underscores",
	banned_value_for_property: "this declaration is dropped",
	no_rules_for_selectors: "no declaration in this rule survives, so the whole rule is dropped",
	no_valid_css_for_selectors: "a declaration with no property or no value",
	no_valid_css: "nothing in this sheet survives AO3's cleaner",
	workskin_prefix: "AO3 prefixes every selector with `#workskin ` on save — the preview shows it that way; write it so to be clear",
}

/**
 * lintCss(text) → { rules, problems, cleaned }
 *  rules:    [{ selector, line, decls: [{ prop, value, ok, code?, message? }] }]
 *  problems: [{ line, selector, prop?, value?, code, message, severity }]
 *  cleaned:  the sheet as AO3 would keep it (failing declarations and rules removed)
 */
export function lintCss(source, { kind = "work" } = {}) {
	kind = cleanKind(kind)
	const text = stripComments(String(source || ""))
	const rules = []
	const problems = []
	const problem = (o) => problems.push({ severity: "error", ...o })
	let i = 0
	while (i < text.length) {
		const open = text.indexOf("{", i)
		const semi = text.indexOf(";", i)
		const prelude = text.slice(i, open === -1 ? text.length : open).trim()
		if (!prelude && open === -1) break
		// a bare `@import …;` has no block
		if (prelude.startsWith("@") && semi !== -1 && (open === -1 || semi < open)) {
			const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase()
			problem({ line: lineAt(text, i + text.slice(i).search(/\S/)), selector: "@" + name, code: "at_rule_dropped", message: MESSAGES.at_rule_dropped })
			i = semi + 1
			continue
		}
		if (open === -1) break
		const close = closeOf(text, open)
		const line = lineAt(text, i + text.slice(i).search(/\S/))
		if (prelude.startsWith("@")) {
			const name = prelude.slice(1).split(/[\s(]/)[0].toLowerCase()
			if (AT_RULES.rejected.includes(name)) problem({ line, selector: "@" + name, code: "font_face", message: MESSAGES.font_face })
			else problem({ line, selector: "@" + name, code: "at_rule_dropped", message: MESSAGES.at_rule_dropped })
			i = close + 1
			continue
		}
		const selector = prelude.replace(/\s+/g, " ")
		const rule = { selector, line, decls: [] }
		if (kind === "work" && !splitSelectors(selector).every((s) => /^\s*#workskin\b/.test(s) || elementOnly(s))) {
			problem({ line, selector, code: "workskin_prefix", message: MESSAGES.workskin_prefix, severity: "warning" })
		}
		for (const d of splitDecls(text.slice(open + 1, close), open + 1)) {
			const dline = lineAt(text, d.at + d.raw.search(/\S/))
			const colon = d.raw.indexOf(":")
			if (colon === -1) {
				rule.decls.push({ prop: d.raw.trim(), value: "", ok: false, code: "no_valid_css_for_selectors", message: MESSAGES.no_valid_css_for_selectors })
				problem({ line: dline, selector, prop: d.raw.trim(), value: "", code: "no_valid_css_for_selectors", message: MESSAGES.no_valid_css_for_selectors })
				continue
			}
			const prop = d.raw.slice(0, colon).trim().toLowerCase()
			const value = d.raw.slice(colon + 1).trim()
			const ps = propertyStatus(prop)
			if (!ps.ok) {
				rule.decls.push({ prop, value, ok: false, code: ps.code, message: MESSAGES[ps.code] })
				problem({ line: dline, selector, prop, value, code: ps.code, message: MESSAGES[ps.code] })
				continue
			}
			const vs = valueStatus(prop, value)
			if (!vs.ok) {
				rule.decls.push({ prop, value, ok: false, code: vs.code, message: vs.message })
				problem({ line: dline, selector, prop, value, code: vs.code, message: vs.message || MESSAGES[vs.code] })
				continue
			}
			for (const w of vs.warnings || []) problem({ line: dline, selector, prop, value, code: w.code, message: w.message, severity: "warning" })
			rule.decls.push({ prop, value, ok: true })
		}
		if (rule.decls.length && !rule.decls.some((d) => d.ok)) {
			problem({ line, selector, code: "no_rules_for_selectors", message: MESSAGES.no_rules_for_selectors })
		}
		rules.push(rule)
		i = close + 1
	}
	const kept = rules.filter((r) => r.decls.some((d) => d.ok))
	if (!kept.length && text.trim()) problem({ line: 1, selector: "", code: "no_valid_css", message: MESSAGES.no_valid_css })
	// stored the way AO3 stores it: css_cleaner prefixes every selector with
	// `#workskin ` unless it already starts with it — so a bare `button` rule
	// previews as `#workskin button`, reaching exactly what it reaches on AO3
	const cleaned = kept.map((r) => `${storedSelector(r.selector, kind)} {\n${r.decls.filter((d) => d.ok).map((d) => `  ${d.prop}: ${d.value};`).join("\n")}\n}`).join("\n\n")
	return { rules, problems, cleaned }
}
