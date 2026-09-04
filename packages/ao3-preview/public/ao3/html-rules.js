// AO3's HTML rules for the Work Content fields — a lint mirroring what the
// site's sanitizer keeps and strips. Sources (otwarchive):
//   config/initializers/gem-plugin_config/sanitizer_config.rb  (ARCHIVE, CSS_ALLOWED)
//   lib/html_cleaner.rb, lib/otw_sanitize/user_class_sanitizer.rb,
//   lib/otw_sanitize/embed_sanitizer.rb, config/config.yml (the *_MAX limits,
//   FIELDS_ALLOWING_CSS, FIELDS_ALLOWING_MEDIA_EMBEDS)
// and the FAQ "Formatting content on AO3 with HTML". Pure: no DOM.
//
// What AO3 does: a tag off the list is REMOVED and its text kept (except the
// remove_contents set, which loses its insides too); an attribute off the
// list is dropped; `class` survives only in work text and notes (never a
// summary) and only names matching /^[a-zA-Z][\w-]+$/; inline `style` and
// `id` never survive; a link/image/cite with another scheme loses the
// attribute; <iframe>/<embed> survive only in work text and only from the
// embed hosts; single returns become <br>, double returns paragraphs.

export const ELEMENTS = [
	"a", "abbr", "acronym", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col",
	"colgroup", "details", "figcaption", "figure", "dd", "del", "dfn", "div", "dl", "dt", "em", "h1", "h2", "h3", "h4", "h5", "h6", "hr",
	"i", "img", "ins", "kbd", "li", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "small", "span", "strike", "strong",
	"sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "var",
]
export const ATTRIBUTES = {
	all: ["align", "dir", "lang", "title"],
	a: ["href", "name"],
	blockquote: ["cite"],
	col: ["span", "width"],
	colgroup: ["span", "width"],
	details: ["open"],
	hr: ["align", "width"],
	img: ["align", "alt", "border", "height", "src", "width"],
	ol: ["start", "type"],
	q: ["cite"],
	table: ["border", "summary", "width"],
	td: ["abbr", "axis", "colspan", "height", "rowspan", "width"],
	th: ["abbr", "axis", "colspan", "height", "rowspan", "scope", "width"],
	ul: ["type"],
}
export const PROTOCOLS = {
	"a href": ["ftp", "http", "https", "mailto", "relative"],
	"blockquote cite": ["http", "https", "relative"],
	"img src": ["http", "https"],
	"q cite": ["http", "https", "relative"],
}
// contents go with the tag
export const REMOVE_CONTENTS = ["iframe", "math", "noembed", "noframes", "noscript", "plaintext", "script", "style", "svg", "xmp"]
export const CLASS_RE = /^[a-zA-Z][\w-]+$/
export const EMBED_HOSTS = [
	/^4shared\.com\/web\/embed/, /^audio\.com\/embed\/audio\//, /^archive\.org\/embed\//, /^(player\.)?bilibili\.com\//, /^criticalcommons\.org\//,
	/^podfic\.com\//, /^(w\.)?soundcloud\.com\//, /^(open\.)?spotify\.com\//, /^vidders\.net\//, /^viddertube\.com\//, /^(player\.)?vimeo\.com\//,
	/^youtube(-nocookie)?\.com\//,
]
export const EMBED_ELEMENTS = ["iframe", "embed"]

// The kinds of field, as AO3 configures them (config.yml)
export const FIELD_KINDS = {
	summary: { max: 1250, css: false, embeds: false, label: "a summary" },
	notes: { max: 5000, css: true, embeds: false, label: "notes" },
	content: { max: 510000, css: true, embeds: true, label: "work text" },
	title: { max: 255, html: false, label: "a title" },
}
// Work Content field id → kind
export const FIELD_KIND = {
	summary: "summary",
	chapterSummary: "summary",
	notes: "notes",
	endNotes: "notes",
	chapterNotes: "notes",
	chapterEndNotes: "notes",
	chapterText: "content",
	title: "title",
	chapterTitle: "title",
}

const ELEMENT_SET = new Set(ELEMENTS)
const VOID = new Set(["br", "hr", "img", "col"])
const lineAt = (text, idx) => text.slice(0, idx).split("\n").length

function schemeOf(url) {
	const u = String(url).trim()
	const m = u.match(/^([a-z][a-z0-9+.-]*):/i)
	if (m) return m[1].toLowerCase()
	if (/^\/\//.test(u)) return "relative-scheme"
	return "relative"
}
function embedHostOk(url) {
	const u = String(url).trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "")
	return EMBED_HOSTS.some((re) => re.test(u))
}

/**
 * lintHtml(text, kindId) → { problems: [{line, code, message, severity, tag?, attr?}] }
 * kindId: "summary" | "notes" | "content" | "title" (see FIELD_KINDS)
 */
export function lintHtml(text, kindId = "content") {
	const kind = FIELD_KINDS[kindId] || FIELD_KINDS.content
	const src = String(text ?? "")
	const problems = []
	const push = (idx, p) => problems.push({ line: lineAt(src, idx), severity: "warning", ...p })

	if (src.length > kind.max) push(0, { code: "too_long", severity: "error", message: `${src.length.toLocaleString()} characters — AO3 allows ${kind.max.toLocaleString()} in ${kind.label}` })
	if (kind.html === false) {
		if (/<[a-z/!]/i.test(src)) push(src.search(/<[a-z/!]/i), { code: "no_html", message: `${kind.label} takes no HTML — AO3 shows the tag as text` })
		return { problems }
	}

	// comments are stripped
	for (const m of src.matchAll(/<!--[\s\S]*?-->/g)) push(m.index, { code: "comment", severity: "info", message: "an HTML comment — AO3 strips it" })
	// remove_contents: the tag AND its insides go
	for (const m of src.matchAll(/<(iframe|math|noembed|noframes|noscript|plaintext|script|style|svg|xmp)\b[^>]*>/gi)) {
		const tag = m[1].toLowerCase()
		if (EMBED_ELEMENTS.includes(tag)) continue // embeds are judged below, per field
		push(m.index, { code: "removed_with_contents", severity: "error", tag, message: `<${tag}> is removed with everything inside it` })
	}
	const open = [] // stack of {tag, idx} for the unclosed check
	for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
		const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3], self = !!m[4], idx = m.index
		if (REMOVE_CONTENTS.includes(tag) && !EMBED_ELEMENTS.includes(tag)) continue
		if (EMBED_ELEMENTS.includes(tag)) {
			if (close) continue
			if (!kind.embeds) push(idx, { code: "embed_not_here", severity: "error", tag, message: `<${tag}> only works in the work text — AO3 removes it from ${kind.label}` })
			else if (!close) {
				const srcm = attrs.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i)
				const url = srcm ? srcm[2] ?? srcm[3] ?? srcm[4] : ""
				if (!url || !embedHostOk(url)) push(idx, { code: "embed_host", severity: "error", tag, message: `<${tag}> may only embed from AO3's list (YouTube, Vimeo, SoundCloud, Spotify, archive.org, Bilibili, podfic.com…) — this one is removed` })
			}
			continue
		}
		if (!ELEMENT_SET.has(tag)) {
			if (!close) push(idx, { code: "tag_removed", severity: "error", tag, message: `<${tag}> is not on AO3's list — the tag is removed, its text stays` })
			continue
		}
		if (close) {
			// pop to the matching opener; a close with no opener is stray
			const i = open.map((o) => o.tag).lastIndexOf(tag)
			if (i < 0) push(idx, { code: "stray_close", severity: "info", tag, message: `</${tag}> closes nothing — AO3's parser drops it` })
			else {
				for (const o of open.splice(i + 1)) push(o.idx, { code: "unclosed", severity: "info", tag: o.tag, message: `<${o.tag}> is never closed — AO3's parser closes it for you, maybe not where you meant` })
				open.pop()
			}
			continue
		}
		// attributes
		const allowed = new Set([...ATTRIBUTES.all, ...(ATTRIBUTES[tag] || [])])
		if (kind.css) allowed.add("class")
		for (const a of attrs.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
			const name = a[1].toLowerCase(), value = a[3] ?? a[4] ?? a[5] ?? ""
			if (name === "style") push(idx, { code: "inline_style", severity: "error", tag, attr: name, message: "inline style is never allowed — AO3 drops it; use a work skin class instead" })
			else if (name === "class" && !kind.css) push(idx, { code: "class_not_here", tag, attr: name, message: `class survives only in work text and notes, not ${kind.label} — dropped` })
			else if (name === "class") {
				const bad = value.split(/\s+/).filter((c) => c && !CLASS_RE.test(c))
				if (bad.length) push(idx, { code: "class_name", tag, attr: name, message: `class "${bad[0]}" is dropped — a class must start with a letter and be letters, digits, - or _ (at least two characters)` })
			} else if (/^on/i.test(name)) push(idx, { code: "event_attr", severity: "error", tag, attr: name, message: `${name} is dropped — no scripting` })
			else if (!allowed.has(name)) push(idx, { code: "attr_removed", tag, attr: name, message: `${name} is not allowed on <${tag}> — AO3 drops it` })
			else {
				const key = `${tag} ${name}`
				if (PROTOCOLS[key]) {
					const sch = schemeOf(value)
					if (!PROTOCOLS[key].includes(sch)) push(idx, { code: "protocol", severity: "error", tag, attr: name, message: `${name}="${value.slice(0, 40)}" — only ${PROTOCOLS[key].filter((p) => p !== "relative").join(", ")} links are kept on <${tag}>` })
				}
			}
		}
		if (!self && !VOID.has(tag)) open.push({ tag, idx })
	}
	for (const o of open) push(o.idx, { code: "unclosed", severity: "info", tag: o.tag, message: `<${o.tag}> is never closed — AO3's parser closes it for you, maybe not where you meant` })
	problems.sort((a, b) => a.line - b.line)
	return { problems }
}

/** lintField(fieldId, value) → the problems for a Work Content field (by its AO3 kind) */
export const lintField = (fieldId, value) => lintHtml(value, FIELD_KIND[fieldId] || "content").problems
