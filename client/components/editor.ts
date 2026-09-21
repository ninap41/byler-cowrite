// Convert the contenteditable into the safe subset the server re-enables.
// Two allowlists share this walker:
//   game lines (sanitizeRich): inline + blocks + lists + the font-size ladder
//   solo docs (sanitizeDoc):   the above + links, images, comment anchors
// This is convenience only, NOT a security control — the server sanitizer is
// the trust boundary. Text passes through RAW: the server escapes exactly once,
// so pre-escaping here would double-escape quotes/& (they'd render as literal
// &quot; in the story).
const INLINE: Record<string, string> = { B: "b", STRONG: "b", I: "i", EM: "i", U: "u" }
const BLOCKS: Record<string, string> = { H1: "h1", H2: "h2", H3: "h3", P: "p", DIV: "p" }
// The game and the document share these — only urls/anchors differ.
const DOC_INLINE: Record<string, string> = { S: "s", STRIKE: "s", DEL: "s" }
const DOC_BLOCKS: Record<string, string> = { UL: "ul", OL: "ol", LI: "li", BLOCKQUOTE: "blockquote" }
// The font-size ladder, as classes. Mirrors FONT_SIZES in src/sanitize.js —
// the server validates against its own copy, so a stray value here is dropped
// there rather than trusted.
export const FONT_SIZES = [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48] as const
const FS_CLASS = /^fs-(\d+)$/
// Comment anchor ids — mirrors CID_RE in src/sanitize.js.
export const CID_CLASS = /^[0-9a-f]{12}$/
export const newCid = (): string => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("")

export interface CleanHtmlOpts {
	/** the wider subset (lists, quote, strike, sizes) */
	doc?: boolean
	/** <a>/<img> and comment anchors, which only documents may carry */
	urls?: boolean
}

// doc: the wider subset (lists, quote, strike, sizes). urls: <a>/<img> and
// comment anchors, which only documents may carry — the game passes
// {doc: true, urls: false} so both editors produce the SAME formatting while
// a story line still can't carry a link or pull in a remote image.
export function cleanHtml(el: Node, { doc = false, urls = doc }: CleanHtmlOpts = {}): string {
	const inline = doc ? { ...INLINE, ...DOC_INLINE } : INLINE
	const blocks = doc ? { ...BLOCKS, ...DOC_BLOCKS } : BLOCKS
	const alignCls = (n: HTMLElement): string => {
		const a = (n.style && n.style.textAlign) || n.getAttribute?.("align") || ""
		// Also honour an al-c/al-r class already on the block: our own stored html
		// carries alignment as that class, not as inline style, so without this a
		// re-serialization (an edit, or a beta reader's comment) would silently
		// drop the centering — and a comment whose only "change" is the lost class
		// gets refused by the server's baseline check.
		const cls = n.getAttribute?.("class") || ""
		if (a === "center" || /\bal-c\b/.test(cls)) return ' class="al-c"'
		if (a === "right" || /\bal-r\b/.test(cls)) return ' class="al-r"'
		return ""
	}
	// Only http/https survive to the server anyway; drop the rest here so the
	// editor never shows a link it knows will be stripped.
	const okUrl = (v: unknown): boolean => /^https?:\/\//i.test(String(v || ""))

	// Word processors carry formatting as inline STYLE, not as tags: Google Docs
	// pastes <span style="font-style:italic"> rather than <i>. Without reading
	// styles we'd unwrap those spans and silently lose every italic and bold in
	// a pasted draft. The inverse matters just as much — Google Docs wraps its
	// whole clipboard payload in <b style="font-weight:normal">, so a tag has to
	// be able to CANCEL itself or the entire paste comes out bold.
	const styleTags = (n: HTMLElement): { on: string[]; off: string[] } => {
		const s = n.style
		if (!s) return { on: [], off: [] }
		const weight = String(s.fontWeight || "").toLowerCase()
		const style = String(s.fontStyle || "").toLowerCase()
		const deco = String(s.textDecorationLine || s.textDecoration || "").toLowerCase()
		const on: string[] = []
		const off: string[] = []
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

	const walk = (node: Node): string => {
		let out = ""
		node.childNodes.forEach((child) => {
			if (child.nodeType === 3) {
				// A "<" typed as prose is a CHARACTER here, and must leave as one:
				// emitted raw, `Sarah<Mike and the rest of the line` re-parses as a
				// tag the next time this html is painted, and everything inside the
				// "tag" is gone. Only the angle brackets — "&" is the server's
				// escapeOnce()'s business, and doubling up on it is how apostrophes
				// once turned into &amp;amp;#39;.
				out += (child.nodeValue || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")
			} else if (child.nodeType === 1) {
				const n = child as HTMLElement
				const tag = n.nodeName
				const { on, off } = styleTags(n)
				// wrap whatever this element's own styles ask for
				const wrap = (inner: string) => on.reduce((acc, t) => `<${t}>${acc}</${t}>`, inner)
				if (tag === "BR") out += "<br>"
				else if (tag === "HR") out += "<hr>"
				else if (urls && tag === "IMG") {
					const src = n.getAttribute("src")
					if (okUrl(src)) out += `<img src="${src}">`
				} else if (urls && tag === "A") {
					const href = n.getAttribute("href")
					const inner = wrap(walk(n))
					out += okUrl(href) ? `<a href="${href}">${inner}</a>` : inner
				} else if (urls && tag === "SPAN" && n.classList?.contains("cmt")) {
					// a comment anchor. It must round-trip untouched or the author's
					// next save would quietly unpin every comment in the document;
					// an id that isn't ours is dropped to plain text, matching the
					// server's closed cid shape.
					const cid = n.getAttribute("data-cid") || ""
					const inner = wrap(walk(n))
					out += CID_CLASS.test(cid) ? `<span class="cmt" data-cid="${cid}">${inner}</span>` : inner
				} else if (doc && tag === "SPAN" && FS_CLASS.test(n.className || "")) {
					// a font-size span from the ladder survives as-is; an
					// off-ladder value is dropped to plain text
					const size = Number((n.className.match(FS_CLASS) || [])[1])
					const inner = wrap(walk(n))
					out += (FONT_SIZES as readonly number[]).includes(size) ? `<span class="fs-${size}">${inner}</span>` : inner
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
					if (structural || inner.trim() || inner.includes("<hr>")) out += `<${blocks[tag]}${alignCls(n)}>` + inner + `</${blocks[tag]}>`
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
export function asterisksToTags(html: unknown): string {
	const convert = (text: string) =>
		text
			// **bold** first, so ** isn't eaten as two single markers
			.replace(/\*\*(?!\s)([^*]+?)(?<!\s)\*\*/g, "<b>$1</b>")
			// *italic* — must not span a line and must hug its content, so
			// "2 * 3 * 4" and a lone "*" are left alone
			.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, "$1<i>$2</i>")
	const s = String(html)
	let out = ""
	let i = 0
	for (const m of s.matchAll(/<[^>]*>/g)) {
		out += convert(s.slice(i, m.index)) + m[0]
		i = m.index + m[0].length
	}
	return out + convert(s.slice(i))
}
