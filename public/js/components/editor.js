// Convert the contenteditable into the safe subset the server re-enables.
// Two allowlists share this walker:
//   game lines (sanitizeRich): b/i/u inline, h1-h3/p blocks, br, hr
//   solo docs (sanitizeDoc):   the above + lists, blockquote, s/del, a, img
// This is convenience only, NOT a security control — the server sanitizer is
// the trust boundary. Text passes through RAW: the server escapes exactly once,
// so pre-escaping here would double-escape quotes/& (they'd render as literal
// &quot; in the story).
const INLINE = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u" }
const BLOCKS = { H1: "h1", H2: "h2", H3: "h3", P: "p", DIV: "p" }
// Only reachable with { doc: true } — the game's sanitizer would escape these.
const DOC_INLINE = { S: "s", STRIKE: "s", DEL: "s" }
const DOC_BLOCKS = { UL: "ul", OL: "ol", LI: "li", BLOCKQUOTE: "blockquote" }
// The font-size ladder, as classes. Mirrors FONT_SIZES in src/sanitize.js —
// the server validates against its own copy, so a stray value here is dropped
// there rather than trusted.
export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48]
const FS_CLASS = /^fs-(\d+)$/

// doc: allow the wider document subset (lists/quote/strike/links/images).
export function cleanHtml(el, { doc = false } = {}) {
	const inline = doc ? { ...INLINE, ...DOC_INLINE } : INLINE
	const blocks = doc ? { ...BLOCKS, ...DOC_BLOCKS } : BLOCKS
	const alignCls = (n) => {
		const a = (n.style && n.style.textAlign) || n.getAttribute?.("align") || ""
		return a === "center" ? ' class="al-c"' : a === "right" ? ' class="al-r"' : ""
	}
	// Only http/https survive to the server anyway; drop the rest here so the
	// editor never shows a link it knows will be stripped.
	const okUrl = (v) => /^https?:\/\//i.test(String(v || ""))

	// Word processors carry formatting as inline STYLE, not as tags: Google Docs
	// pastes <span style="font-style:italic"> rather than <i>. Without reading
	// styles we'd unwrap those spans and silently lose every italic and bold in
	// a pasted draft. The inverse matters just as much — Google Docs wraps its
	// whole clipboard payload in <b style="font-weight:normal">, so a tag has to
	// be able to CANCEL itself or the entire paste comes out bold.
	const styleTags = (n) => {
		const s = n.style
		if (!s) return { on: [], off: [] }
		const weight = String(s.fontWeight || "").toLowerCase()
		const style = String(s.fontStyle || "").toLowerCase()
		const deco = String(s.textDecorationLine || s.textDecoration || "").toLowerCase()
		const on = []
		const off = []
		// NB: only an EXPLICIT "normal" cancels a tag. An absent style must mean
		// "inherit", otherwise a plain <b> would cancel itself.
		if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) on.push("b")
		else if (weight === "normal" || (weight !== "" && Number(weight) <= 400)) off.push("b")
		if (style === "italic" || style === "oblique") on.push("i")
		else if (style === "normal") off.push("i")
		if (deco.includes("underline")) on.push("u")
		if (doc && deco.includes("line-through")) on.push("s")
		return { on, off }
	}

	const walk = (node) => {
		let out = ""
		node.childNodes.forEach((n) => {
			if (n.nodeType === 3) {
				out += n.nodeValue
			} else if (n.nodeType === 1) {
				const tag = n.nodeName
				const { on, off } = styleTags(n)
				// wrap whatever this element's own styles ask for
				const wrap = (inner) => on.reduce((acc, t) => `<${t}>${acc}</${t}>`, inner)
				if (tag === "BR") out += "<br>"
				else if (tag === "HR") out += "<hr>"
				else if (doc && tag === "IMG") {
					const src = n.getAttribute("src")
					if (okUrl(src)) out += `<img src="${src}">`
				} else if (doc && tag === "A") {
					const href = n.getAttribute("href")
					const inner = wrap(walk(n))
					out += okUrl(href) ? `<a href="${href}">${inner}</a>` : inner
				} else if (doc && tag === "SPAN" && FS_CLASS.test(n.className || "")) {
					// a font-size span from the ladder survives as-is; an
					// off-ladder value is dropped to plain text
					const size = Number((n.className.match(FS_CLASS) || [])[1])
					const inner = wrap(walk(n))
					out += FONT_SIZES.includes(size) ? `<span class="fs-${size}">${inner}</span>` : inner
				} else if (inline[tag]) {
					const t = inline[tag]
					// an explicit style:normal cancels the tag (the Google Docs wrapper)
					out += off.includes(t) ? wrap(walk(n)) : wrap(`<${t}>` + walk(n) + `</${t}>`)
				} else if (blocks[tag]) {
					// styles wrap INSIDE the block: <p><b>…</b></p>, never <b><p>…</p></b>
					const inner = wrap(walk(n))
					// list containers hold <li>s, not text — keep them even when
					// the text check below would call them empty
					const structural = tag === "UL" || tag === "OL"
					if (structural || inner.trim() || inner.includes("<hr>"))
						out += `<${blocks[tag]}${alignCls(n)}>` + inner + `</${blocks[tag]}>`
				} else {
					// unknown element (SPAN, FONT…) — keep only what its styles say
					out += wrap(walk(n))
				}
			}
		})
		return out
	}
	return walk(el)
}

// Drafts written in plain text (Google Docs, Notes, a phone) mark emphasis with
// asterisks: *he thinks* / **shouting**. Google Docs only carries real styling
// on the clipboard, so anything typed as literal asterisks arrives as literal
// asterisks — this turns those markers into real tags on paste.
// Operates on cleanHtml OUTPUT, so it must never rewrite inside a tag: the
// string is split on tags and only the text spans are converted.
export function asterisksToTags(html) {
	const convert = (text) =>
		text
			// **bold** first, so ** isn't eaten as two single markers
			.replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, "<b>$1</b>")
			// *italic* — must not span a line and must hug its content, so
			// "2 * 3 * 4" and a lone "*" are left alone
			.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, "$1<i>$2</i>")
	let out = ""
	let i = 0
	for (const m of String(html).matchAll(/<[^>]*>/g)) {
		out += convert(String(html).slice(i, m.index)) + m[0]
		i = m.index + m[0].length
	}
	return out + convert(String(html).slice(i))
}
